// 编辑器入口：全局状态 + 三区视图接线 + WASM 载入 + 布局面板 + 导入/导出/往返验证。
import {
    defaultProject, defaultSection, computeFrame, endFrame, toEngineConfig, fromEngineConfig, setKeyframe,
    moveKeyframe, removeKeyframesAt,
} from './model.js';
import { PreviewRenderer } from './render.js';
import { TimelineView } from './timeline.js';
import { SidebarView } from './sidebar.js';
import { QuickPanel } from './quickpanel.js';
import { generateCode } from './codegen.js';
import { loadWasm } from './wasm.js';
import { listProjects, saveProject, loadProject, deleteProject, updateProjectConfig } from './storage.js';

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const PRESETS = [
    { name: 'WS2812B-5050 (5.0×5.0mm)', w: 14, h: 14 },
    { name: 'WS2812B-3535 (3.5×3.5mm)', w: 10, h: 10 },
    { name: 'WS2812B-2020 (2.0×2.0mm)', w: 6, h: 6 },
    { name: 'SK6812-5050 (5.0×5.0mm)', w: 14, h: 14 },
    { name: 'SK6812-MINI (3.2×2.8mm)', w: 8, h: 7 },
    { name: 'APA102-5050 (5.0×5.0mm)', w: 14, h: 14 },
];

const state = {
    project: defaultProject(),
    frame: 0,
    selection: -1,
    layout: { rows: 1, spacing: 4, ledW: 14, ledH: 14 },
    framePixels: [],
};

let preview, timeline, sidebar, quickPanel, wasm = null;
let currentProjectId = null;   // 当前工程对应的已保存项目 id（null = 尚未保存到本地项目）

function setFrame(f) {
    // 允许超出当前结束帧（在范围外放置关键帧会自动扩展动画时长）
    state.frame = Math.max(0, Math.round(f) || 0);
    refresh();
}

function refresh() {
    state.framePixels = computeFrame(state.project, state.frame);
    if (preview) preview.render();
    if (timeline) timeline.render();
    if (sidebar) sidebar.sync();
    if (quickPanel) quickPanel.sync();
}

function refreshAll() {
    if (quickPanel) quickPanel.close();
    refresh();
    if (sidebar) sidebar.render();
}

// ---------- 布局面板 ----------

function buildLayoutPanel() {
    const host = document.querySelector('#layout-panel');
    host.innerHTML = `
        <div class="lp-title">灯带布局</div>
        <label class="lp-field">行 <input id="lp-rows" type="number" value="1" disabled title="当前仅支持单行灯条"></label>
        <label class="lp-field">列 <input id="lp-cols" type="number" min="1" max="1024" step="1"></label>
        <label class="lp-field">间距 <input id="lp-spacing" type="number" min="0" step="1"></label>
        <label class="lp-field">长 <input id="lp-ledw" type="number" min="2" step="1"></label>
        <label class="lp-field">宽 <input id="lp-ledh" type="number" min="2" step="1"></label>
        <label class="lp-field">封装
            <select id="lp-preset">
                ${PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('')}
            </select>
        </label>
        <label class="lp-field">引脚 <input id="lp-pin" type="number" min="0" max="64" step="1"></label>
        <label class="lp-field"><input id="lp-loop" type="checkbox"> 回环 loop</label>`;

    const rows = host.querySelector('#lp-rows');
    const cols = host.querySelector('#lp-cols');
    const spacing = host.querySelector('#lp-spacing');
    const ledw = host.querySelector('#lp-ledw');
    const ledh = host.querySelector('#lp-ledh');
    const preset = host.querySelector('#lp-preset');

    rows.value = state.layout.rows;
    cols.value = state.project.strip.length;
    spacing.value = state.layout.spacing;
    ledw.value = state.layout.ledW;
    ledh.value = state.layout.ledH;
    preset.value = '0';

    const applyLayout = (refit) => {
        state.layout.spacing = Math.max(0, parseFloat(spacing.value) || 0);
        state.layout.ledW = Math.max(2, parseFloat(ledw.value) || 14);
        state.layout.ledH = Math.max(2, parseFloat(ledh.value) || 14);
        if (refit && preview) preview.fit(); else refresh();
    };
    spacing.addEventListener('change', () => applyLayout(false));
    ledw.addEventListener('change', () => applyLayout(false));
    ledh.addEventListener('change', () => applyLayout(false));

    cols.addEventListener('input', () => {
        const v = parseInt(cols.value, 10);
        if (Number.isNaN(v)) return;
        state.project.strip.length = Math.max(1, Math.min(1024, v));
        refresh();                 // 重算 framePixels，使灯珠数量随 strip.length 变化
        if (preview) preview.fit();
    });
    cols.addEventListener('change', () => {
        // 失焦/回车时把显示值规整到 [1,1024]
        cols.value = state.project.strip.length;
    });

    preset.addEventListener('change', () => {
        const p = PRESETS[parseInt(preset.value)];
        if (!p) return;
        ledw.value = p.w;
        ledh.value = p.h;
        applyLayout(true);
    });

    const pin = host.querySelector('#lp-pin');
    const loop = host.querySelector('#lp-loop');
    pin.value = state.project.strip.pin;
    loop.checked = !!state.project.strip.loop;
    pin.addEventListener('change', () => {
        const v = parseInt(pin.value, 10);
        state.project.strip.pin = Number.isNaN(v) ? 5 : Math.max(0, Math.min(64, v));
        pin.value = state.project.strip.pin;
    });
    loop.addEventListener('change', () => {
        state.project.strip.loop = loop.checked;
        refresh();   // loop 影响预览（索引回绕）
    });
}

function syncLayoutPanel() {
    const cols = document.querySelector('#lp-cols');
    if (cols) cols.value = state.project.strip.length;
    const spacing = document.querySelector('#lp-spacing');
    const ledw = document.querySelector('#lp-ledw');
    const ledh = document.querySelector('#lp-ledh');
    const pin = document.querySelector('#lp-pin');
    const loop = document.querySelector('#lp-loop');
    if (spacing) spacing.value = state.layout.spacing;
    if (ledw) ledw.value = state.layout.ledW;
    if (ledh) ledh.value = state.layout.ledH;
    if (pin) pin.value = state.project.strip.pin;
    if (loop) loop.checked = !!state.project.strip.loop;
}

// ---------- 分段操作 ----------

function addSection() {
    const sec = defaultSection();
    sec.name = `Section ${state.project.sections.length + 1}`;
    sec.len = Math.min(8, Math.max(1, state.project.strip.length));
    state.project.sections.push(sec);
    state.selection = state.project.sections.length - 1;
    refreshAll();
}

function removeSection(i) {
    state.project.sections.splice(i, 1);
    if (state.selection >= state.project.sections.length) {
        state.selection = state.project.sections.length - 1;
    }
    refreshAll();
}

// 拖拽排序：把 from 移到 to（最终下标），z 序 = 数组顺序（后者绘制在上层）
function reorderSection(from, to) {
    const arr = state.project.sections;
    if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    state.selection = to;
    refreshAll();
}

function selectSection(i) {
    state.selection = i;
    sidebar.render();
    refresh();
}

// ---------- 导入 / 导出 / 引擎往返 ----------

function exportJson() {
    const cfg = toEngineConfig(state.project);
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ws2812b-project.json';
    a.click();
    URL.revokeObjectURL(a.href);
}

// 用引擎配置替换当前工程（导入 JSON 与项目管理载入共用）
function applyProject(cfg, id = null, layout = null) {
    state.project = fromEngineConfig(cfg);
    state.frame = 0;
    state.selection = state.project.sections.length > 0 ? 0 : -1;
    currentProjectId = id;
    if (layout) Object.assign(state.layout, layout);
    syncLayoutPanel();
    refreshAll();
    if (preview) preview.fit();
}

function importJson(text) {
    let cfg;
    try { cfg = JSON.parse(text); } catch (e) { alert('JSON 解析失败: ' + e.message); return; }
    applyProject(cfg);
}

// ---------- 项目管理（localStorage） ----------

function openProjectManager() {
    const old = document.querySelector('.modal-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal proj-modal">
            <div class="modal-head">
                <span class="modal-title">打开项目</span>
                <button class="modal-close" type="button" title="关闭">×</button>
            </div>
            <div class="proj-list" id="proj-list"></div>
        </div>`;
    document.body.appendChild(overlay);

    const listEl = overlay.querySelector('#proj-list');

    const renderList = () => {
        const items = listProjects().sort((a, b) => b.updatedAt - a.updatedAt);
        if (!items.length) {
            listEl.innerHTML = '<div class="proj-empty">暂无已保存的项目</div>';
            return;
        }
        listEl.innerHTML = '';
        for (const p of items) {
            const row = document.createElement('div');
            row.className = 'proj-item';
            row.innerHTML = `
                <div class="proj-info">
                    <div class="proj-name">${escapeHtml(p.name)} <span class="proj-time">${new Date(p.updatedAt).toLocaleString()}</span></div>
                    <div class="proj-desc">${escapeHtml(p.description || '')}</div>
                </div>
                <div class="proj-actions">
                    <button data-act="load" type="button">载入</button>
                    <button data-act="del" type="button">删除</button>
                </div>`;
            row.querySelector('[data-act="load"]').addEventListener('click', () => {
                const rec = loadProject(p.id);
                if (!rec) return;
                applyProject(rec.config, p.id, rec.layout);
                close();
            });
            row.querySelector('[data-act="del"]').addEventListener('click', () => {
                if (!confirm(`删除项目「${p.name}」？`)) return;
                deleteProject(p.id);
                if (currentProjectId === p.id) currentProjectId = null;
                renderList();
            });
            listEl.appendChild(row);
        }
    };

    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    const close = () => { window.removeEventListener('keydown', onKey); overlay.remove(); };
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.addEventListener('mousedown', (ev) => { if (ev.target === overlay) close(); });
    window.addEventListener('keydown', onKey);

    renderList();
}

// 项目设置：编辑当前项目的名称与说明（并保存当前工程）
function openProjectSettings() {
    const old = document.querySelector('.modal-overlay');
    if (old) old.remove();

    let curName = '', curDesc = '';
    if (currentProjectId) {
        const rec = listProjects().find(r => r.id === currentProjectId);
        if (rec) { curName = rec.name; curDesc = rec.description || ''; }
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal">
            <div class="modal-head">
                <span class="modal-title">项目设置</span>
                <button class="modal-close" type="button" title="关闭">×</button>
            </div>
            <div class="proj-save">
                <label class="ms-field">名称 <input id="proj-name" type="text" placeholder="项目名称"></label>
                <label class="ms-field proj-desc-field">说明 <textarea id="proj-desc" rows="3" placeholder="可选说明"></textarea></label>
                <span class="proj-hint" id="proj-hint"></span>
            </div>
            <div class="modal-actions">
                <button id="proj-save" class="primary" type="button">保存</button>
                <button id="proj-close" type="button">关闭</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const nameEl = overlay.querySelector('#proj-name');
    const descEl = overlay.querySelector('#proj-desc');
    const hintEl = overlay.querySelector('#proj-hint');
    nameEl.value = curName;
    descEl.value = curDesc;

    overlay.querySelector('#proj-save').addEventListener('click', () => {
        const name = nameEl.value.trim();
        if (!name) { hintEl.textContent = '请填写项目名称'; return; }
        const id = saveProject(toEngineConfig(state.project), { ...state.layout }, {
            id: currentProjectId,
            name,
            description: descEl.value.trim(),
        });
        currentProjectId = id;
        hintEl.textContent = '已保存 ✓';
        setTimeout(() => { hintEl.textContent = ''; }, 1500);
    });

    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    const close = () => { window.removeEventListener('keydown', onKey); overlay.remove(); };
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('#proj-close').addEventListener('click', close);
    overlay.addEventListener('mousedown', (ev) => { if (ev.target === overlay) close(); });
    window.addEventListener('keydown', onKey);
}

// 新建项目：重置为空工程
function newProject() {
    state.project = defaultProject();
    state.layout = { rows: 1, spacing: 4, ledW: 14, ledH: 14 };
    state.frame = 0;
    state.selection = -1;
    currentProjectId = null;
    syncLayoutPanel();
    refreshAll();
    if (preview) preview.fit();
}

// 一键保存：当前有已保存项目时直接覆盖；否则打开项目管理弹窗命名
function quickSave() {
    const cfg = toEngineConfig(state.project);
    const btn = document.querySelector('#btn-quick-save');
    if (currentProjectId && updateProjectConfig(currentProjectId, cfg, { ...state.layout })) {
        const html = btn.innerHTML;
        btn.innerHTML = '<span style="color:#3ecf8e;font-weight:700">✓</span>';
        setTimeout(() => { btn.innerHTML = html; }, 1200);
    } else {
        openProjectManager();
    }
}

// ---------- 导出 beshell 代码（弹窗 + setup 参数） ----------

const EXPORT_SETUP_KEY = 'beshell.ws2812b.exportSetup';

function loadExportSetup() {
    try {
        const raw = localStorage.getItem(EXPORT_SETUP_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}

function saveExportSetup(s) {
    try { localStorage.setItem(EXPORT_SETUP_KEY, JSON.stringify(s)); } catch (e) {}
}

function openCodeExport() {
    const old = document.querySelector('.modal-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal">
            <div class="modal-head">
                <span class="modal-title">生成 beshell 代码</span>
                <button class="modal-close" type="button" title="关闭">×</button>
            </div>
            <div class="modal-setup">
                <label class="ms-field">引脚 <input id="code-pin" type="number" min="0" step="1"></label>
                <label class="ms-field">灯数 <input id="code-length" type="number" min="1" step="1"></label>
                <label class="ms-field"><input id="code-loop" type="checkbox"> 回环 loop</label>
            </div>
            <textarea id="code-output" class="modal-code" spellcheck="false" readonly></textarea>
            <div class="modal-actions">
                <button id="code-copy" class="primary" type="button">复制代码</button>
                <button id="code-close" type="button">关闭</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const pin = overlay.querySelector('#code-pin');
    const length = overlay.querySelector('#code-length');
    const loop = overlay.querySelector('#code-loop');
    const out = overlay.querySelector('#code-output');
    const copyBtn = overlay.querySelector('#code-copy');

    const saved = loadExportSetup();
    pin.value = saved.pin != null ? saved.pin : 8;
    length.value = state.project.strip.length;
    loop.checked = saved.loop != null ? !!saved.loop : false;

    const regen = () => {
        const pinV = parseInt(pin.value, 10);
        const lenV = parseInt(length.value, 10);
        const loopV = loop.checked;
        saveExportSetup({ pin: pinV, loop: loopV });
        out.value = generateCode(state.project, { pin: pinV, length: lenV, loop: loopV });
    };

    pin.addEventListener('input', regen);
    length.addEventListener('input', regen);
    loop.addEventListener('change', regen);

    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    const close = () => {
        window.removeEventListener('keydown', onKey);
        overlay.remove();
    };

    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('#code-close').addEventListener('click', close);
    overlay.addEventListener('mousedown', (ev) => { if (ev.target === overlay) close(); });
    copyBtn.addEventListener('click', async () => {
        let ok = false;
        try {
            await navigator.clipboard.writeText(out.value);
            ok = true;
        } catch (e) {
            try {
                out.select();
                ok = document.execCommand('copy');
            } catch (_) { ok = false; }
        }
        if (ok) {
            const t = copyBtn.textContent;
            copyBtn.textContent = '已复制 ✓';
            setTimeout(() => { copyBtn.textContent = t; }, 1200);
        } else {
            alert('复制失败，请手动全选复制');
        }
    });
    window.addEventListener('keydown', onKey);

    regen();
}

function setWasmStatus(text, ok) {
    const el = document.querySelector('#wasm-status');
    el.textContent = text;
    el.className = 'wasm-status ' + (ok ? 'ok' : 'err');
}

async function verifyEngine() {
    if (!wasm) { setWasmStatus('WASM 未就绪', false); return; }
    const cfg = toEngineConfig(state.project);
    try {
        const engineCfg = wasm.roundtrip(cfg);
        // 关键字段一致性对照
        const a = cfg.keyframes.length, b = engineCfg.keyframes.length;
        const fa = cfg.frameActions.length, fb = engineCfg.frameActions.length;
        const sa = cfg.sections.length, sb = engineCfg.sections.length;
        const ok = a === b && fa === fb && sa === sb;
        setWasmStatus(
            `往返: 分段 ${sb}/${sa} · 关键帧 ${b}/${a} · 帧动作 ${fb}/${fa} ${ok ? '✓ 一致' : '✗ 不一致'}`,
            ok
        );
        console.log('[engine] exportConfig =', engineCfg);
    } catch (e) {
        setWasmStatus('验证失败: ' + e.message, false);
    }
}

// ---------- 启动 ----------

async function main() {
    buildLayoutPanel();

    const getState = () => state;

    preview = new PreviewRenderer(document.querySelector('#preview-canvas'), getState, {
        onSelect: (i) => { state.selection = i; sidebar.render(); refresh(); },
        onSectionChange: (i, prop, value) => {
            const sec = state.project.sections[i];
            if (!sec) return;
            setKeyframe(sec, prop, state.frame, value, 'linear', 1.70158);
            refresh();
        },
        onStripLengthChange: (length) => {
            state.project.strip.length = Math.max(1, Math.min(1024, Math.round(length)));
            syncLayoutPanel();
            refresh();
        },
        onEndpointEdit: (i, endpointKey, mx, my) => {
            quickPanel.open(i, endpointKey, mx, my);
        },
    });
    timeline = new TimelineView(document.querySelector('#timeline'), getState, {
        onScrub: setFrame,
        onFpsChange: (fps) => { state.project.fps = fps; refresh(); },
        onLengthChange: (frames) => { state.project.frames = frames; refresh(); },
        onMoveKeyframe: (si, from, to) => {
            const sec = state.project.sections[si];
            if (!sec) return;
            moveKeyframe(sec, from, to);
            refresh();
        },
        onDeleteKeyframe: (si, frame) => {
            const sec = state.project.sections[si];
            if (!sec) return;
            removeKeyframesAt(sec, frame);
            refresh();
        },
    });
    sidebar = new SidebarView(document.querySelector('#sidebar'), getState, {
        onAdd: addSection,
        onRemove: removeSection,
        onSelect: selectSection,
        onReorder: reorderSection,
        onChange: refresh,
    });
    quickPanel = new QuickPanel(document.querySelector('#preview'), getState, {
        onChange: refresh,
    });

    // 初始示例：一个彩虹分段
    addSection();
    preview.fit();

    // 工具条按钮
    document.querySelector('#btn-new').addEventListener('click', newProject);
    document.querySelector('#btn-quick-save').addEventListener('click', quickSave);
    document.querySelector('#btn-projects').addEventListener('click', openProjectManager);
    document.querySelector('#btn-settings').addEventListener('click', openProjectSettings);
    document.querySelector('#btn-export').addEventListener('click', exportJson);
    document.querySelector('#btn-import').addEventListener('click', () => {
        document.querySelector('#file-import').click();
    });
    document.querySelector('#file-import').addEventListener('change', (ev) => {
        const f = ev.target.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => importJson(String(reader.result));
        reader.readAsText(f);
        ev.target.value = '';
    });
    document.querySelector('#btn-verify').addEventListener('click', verifyEngine);
    document.querySelector('#btn-export-code').addEventListener('click', openCodeExport);

    // Ctrl/Cmd+S 保存（等价于「保存」按钮；阻止浏览器默认「保存网页」）
    window.addEventListener('keydown', (ev) => {
        if (!(ev.ctrlKey || ev.metaKey)) return;
        if (ev.key === 's' || ev.key === 'S') {
            ev.preventDefault();
            quickSave();
        }
    });

    // WASM 载入（非阻塞；失败不影响编辑器）
    setWasmStatus('WASM 载入中…', false);
    try {
        wasm = await loadWasm('beshell-ws2812b-wasm.js');
        const ok = wasm.probe();
        setWasmStatus(ok ? 'WASM 就绪' : 'WASM 探测未通过', ok);
    } catch (e) {
        setWasmStatus('WASM 载入失败: ' + e.message, false);
    }
}

main();
