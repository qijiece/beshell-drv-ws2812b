// 编辑器入口：全局状态 + 三区视图接线 + WASM 载入 + 布局面板 + 导入/导出/往返验证。
import {
    defaultProject, defaultSection, computeFrame, endFrame, toEngineConfig, fromEngineConfig, setKeyframe,
    moveKeyframe, removeKeyframesAt,
} from './model.js';
import { PreviewRenderer } from './render.js';
import { TimelineView } from './timeline.js';
import { SidebarView } from './sidebar.js';
import { loadWasm } from './wasm.js';

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

let preview, timeline, sidebar, wasm = null;

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
}

function refreshAll() {
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
        </label>`;

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
}

function syncLayoutPanel() {
    const cols = document.querySelector('#lp-cols');
    if (cols) cols.value = state.project.strip.length;
    const spacing = document.querySelector('#lp-spacing');
    const ledw = document.querySelector('#lp-ledw');
    const ledh = document.querySelector('#lp-ledh');
    if (spacing) spacing.value = state.layout.spacing;
    if (ledw) ledw.value = state.layout.ledW;
    if (ledh) ledh.value = state.layout.ledH;
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

function importJson(text) {
    let cfg;
    try { cfg = JSON.parse(text); } catch (e) { alert('JSON 解析失败: ' + e.message); return; }
    state.project = fromEngineConfig(cfg);
    state.frame = 0;
    state.selection = state.project.sections.length > 0 ? 0 : -1;
    syncLayoutPanel();
    refreshAll();
    if (preview) preview.fit();
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

    // 初始示例：一个彩虹分段
    addSection();
    preview.fit();

    // 工具条按钮
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
