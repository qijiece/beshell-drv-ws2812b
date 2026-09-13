// 右侧属性侧边：上部分段列表，下部选中分段属性（三列：属性值 | 过渡缓动 | 间补缓动）。
// 分段有「主体 / 前阴影 / 后阴影」三种渲染过渡，结构与参数完全一致。
// 每个可过渡/间补属性独享一行；H/S/V 通道有「启用」复选框（仅前端预览生效，状态随配置持久化）。
// 属性值显示「选中帧的插补计算结果」；编辑即在当前帧写入关键帧（帧 0 写基准值）。
import {
    NUM_PROPS, EASE_PROPS, TRANSITIONS, evalProp, setKeyframe, cRound,
    keyframeAt, setKeyframeEase, isDistinctKeyframe,
    frameActionAt, setFrameAction, removeFrameAction, frameToMs, frameLabels, endFrame, labelAtFrame, normalizeInputText,
    hasEmptyKeyframe, hasRealKeyframe,
} from './model.js';
import { EaseMenu } from './easemenu.js';
import { HSVPicker } from './hsvpicker.js';
import { hsv2rgb, rgbToHex } from './color.js';

// 整数类型属性：绘制时对灯珠索引/数量做四舍五入，中间帧插值结果按整数显示
const INTEGER_PROPS = ['x', 'len', 'shadowFront', 'shadowBack'];

export class SidebarView {
    constructor(container, getState, cb) {
        this.container = container;
        this.getState = getState;   // () => { project, frame, selection }
        this.cb = cb || {};

        // 颜色通道：'body-start' / 'body-end' / 'front-start' ... → { h, s, v }
        this._colorChannels = {};
        // 过渡缓动属性 → S 参数属性
        this._easeSMap = {};
        for (const tr of TRANSITIONS) {
            // 4 色模型：前/后阴影起点共享主体，无独立起点色块
            if (tr.ownStart) {
                this._colorChannels[tr.key + '-start'] = { h: tr.h0, s: tr.s0, v: tr.v0 };
            }
            this._colorChannels[tr.key + '-end'] = { h: tr.h1, s: tr.s1, v: tr.v1 };
            this._easeSMap[tr.easeH] = tr.easeHS;
            this._easeSMap[tr.easeS] = tr.easeSS;
            this._easeSMap[tr.easeV] = tr.easeVS;
        }

        this._colorBtns = {};       // channel -> button element
        this._colorPop = null;      // 弹出取色器 {pop, cleanup}
        this._targetCombo = null;   // 跳转/播放目标下拉 {input, list, cleanup}
        this._numInputs = {};       // prop -> value input
        this._easeMenus = {};       // easeProp -> EaseMenu（列 2 过渡缓动）
        this._tweenMenus = {};      // prop -> EaseMenu（列 3 间补缓动）
        this._enInputs = {};        // enableProp -> checkbox
        this._enRowsByProp = {};    // prop -> { enable, startProp }（禁用通道显示起点值并置灰）
        this._ccwInputs = {};       // ccwProp -> checkbox
        this._editFrame = null;     // 值输入框聚焦时捕获的帧号（change 在 blur 时触发，可能已 scrub 到别的帧）
        this.render();
    }

    // 全量重建（选择变化 / 分段增删时调用）
    render() {
        const { project, frame, selection } = this.getState();
        const sec = project.sections[selection];
        this._closeColorPopup();
        this._closeTargetCombo();

        this.container.innerHTML = `
            <div class="sb-sections">
                <div class="sb-header"><span>分段</span><button class="sb-add" title="添加分段">＋</button></div>
                <div class="sb-list"></div>
            </div>
            <div class="sb-props"></div>
            <div class="sb-frame"></div>`;

        const list = this.container.querySelector('.sb-list');
        const n = project.sections.length;
        project.sections.forEach((s, i) => {
            const row = document.createElement('div');
            row.className = 'sb-item' + (i === selection ? ' selected' : '');
            row.draggable = true;
            row.innerHTML = `
                <span class="sb-name">${s.name}</span>
                <button class="sb-del" title="删除分段">×</button>`;
            row.addEventListener('click', (ev) => {
                if (ev.target.classList.contains('sb-del')) return;
                if (this.cb.onSelect) this.cb.onSelect(i);
            });
            row.querySelector('.sb-del').addEventListener('click', () => {
                if (this.cb.onRemove) this.cb.onRemove(i);
            });

            // 上下拖动排序（z 序 = 数组顺序）
            row.addEventListener('dragstart', (ev) => {
                this._dragIndex = i;
                ev.dataTransfer.effectAllowed = 'move';
                try { ev.dataTransfer.setData('text/plain', String(i)); } catch (e) {}
                row.classList.add('dragging');
            });
            row.addEventListener('dragover', (ev) => {
                ev.preventDefault();
                ev.dataTransfer.dropEffect = 'move';
                const rect = row.getBoundingClientRect();
                this._dropBefore = ev.clientY < rect.top + rect.height / 2;
                this._dropRow = i;
                row.classList.remove('drop-before', 'drop-after');
                row.classList.add(this._dropBefore ? 'drop-before' : 'drop-after');
            });
            row.addEventListener('dragleave', () => {
                row.classList.remove('drop-before', 'drop-after');
            });
            row.addEventListener('drop', (ev) => {
                ev.preventDefault();
                row.classList.remove('drop-before', 'drop-after');
                const from = this._dragIndex;
                if (from === undefined || from === this._dropRow) return;
                let to = this._dropBefore ? this._dropRow : this._dropRow + 1;
                if (from < to) to -= 1;
                to = Math.max(0, Math.min(n - 1, to));
                if (from !== to && this.cb.onReorder) this.cb.onReorder(from, to);
            });
            row.addEventListener('dragend', () => {
                this._dragIndex = undefined;
                this._dropRow = undefined;
                this._dropBefore = undefined;
                row.classList.remove('dragging', 'drop-before', 'drop-after');
            });

            list.appendChild(row);
        });

        this.container.querySelector('.sb-add').addEventListener('click', () => {
            if (this.cb.onAdd) this.cb.onAdd();
        });

        const propsEl = this.container.querySelector('.sb-props');
        const frameEl = this.container.querySelector('.sb-frame');
        if (!sec) {
            propsEl.innerHTML = `<div class="sb-hint">未选择分段<br>点击「＋」添加一个分段</div>`;
            frameEl.innerHTML = '';
            return;
        }
        this._buildProps(propsEl, frameEl, sec, frame);
        this.sync();
    }

    _buildProps(propsEl, frameEl, sec, frame) {
        propsEl.innerHTML = `
            <div class="sb-subheader">${sec.name} · 属性</div>
            <div class="sb-props-body"></div>`;

        frameEl.innerHTML = `
            <div class="sb-frame-head">
                <div class="sb-subheader">帧动作 (Action)</div>
                <div class="sb-frame-info"></div>
            </div>
            <label class="sb-field" title="给当前帧命名；时间轴上会显示该名字，并可作为「跳转到 / 播放到」的下拉选项"><span class="sb-field-label">命名</span><input type="text" id="sb-label" placeholder="帧名"></label>
            <label class="sb-field" title="到达本帧时立即跳转到目标帧（可输入帧号或标签名，或从下拉选择；留空 = 无）"><span class="sb-field-label">跳转到</span><span class="sb-combo"><input class="sb-combo-input" id="sb-jump" placeholder="帧号" autocomplete="off"><span class="sb-combo-arrow">▾</span></span><button type="button" class="sb-clear-target" id="sb-clearjump" title="清除跳转目标">清除</button></label>
            <label class="sb-field" title="跳转触发次数（0 = 不触发，-1 = 不限）"><span class="sb-field-label">跳转次数</span><input type="number" id="sb-jumpc" step="1" min="-1"></label>
            <label class="sb-field" title="到达本帧时播放到目标帧（默认到达后停止；勾选「然后继续」则继续原顺序播放；可输入帧号或标签名，或从下拉选择；中途遇到其他动作会改向新目标；留空 = 无）"><span class="sb-field-label">播放到</span><span class="sb-combo"><input class="sb-combo-input" id="sb-play" placeholder="帧号" autocomplete="off"><span class="sb-combo-arrow">▾</span></span><button type="button" class="sb-clear-target" id="sb-clearplay" title="清除播放目标">清除</button></label>
            <label class="sb-field" title="播放触发次数（0 = 不触发，-1 = 不限）"><span class="sb-field-label">播放次数</span><input type="number" id="sb-playc" step="1" min="-1"></label>
            <label class="sb-field sb-stop" title="勾选后，播放到目标帧后继续原顺序播放；否则到达即停止"><span class="sb-field-label"></span><input type="checkbox" id="sb-resume"><span>然后继续</span></label>
            <label class="sb-field sb-stop" title="到达本帧即停止播放（优先于跳转 / 播放）"><span class="sb-field-label"></span><input type="checkbox" id="sb-stop"><span>停止</span></label>
            <button class="sb-clr-act" id="sb-clract">清除本帧动作</button>`;

        this._numInputs = {};
        this._easeMenus = {};
        this._tweenMenus = {};
        this._enInputs = {};
        this._enRowsByProp = {};
        this._ccwInputs = {};
        this._colorBtns = {};

        const body = propsEl.querySelector('.sb-props-body');

        // 列头：渲染过渡 / 动画间补（两列缓动函数）
        const colHead = document.createElement('div');
        colHead.className = 'sb-col-head';
        colHead.innerHTML = '<span></span><span></span><span>渲染过渡</span><span>动画间补</span>';
        body.appendChild(colHead);

        // 标量属性：位置 / 长度（各独享一行）
        this._propRow(body, sec, { label: '位置(x)', prop: 'x', step: 1 });
        this._propRow(body, sec, { label: '长度', prop: 'len', step: 1, min: 1 });

        // 三种过渡块
        for (const tr of TRANSITIONS) {
            this._buildTransitionBlock(body, sec, tr);
        }

        // 帧动作
        const jump = frameEl.querySelector('#sb-jump');
        const jumpc = frameEl.querySelector('#sb-jumpc');
        const play = frameEl.querySelector('#sb-play');
        const playc = frameEl.querySelector('#sb-playc');
        const stopCb = frameEl.querySelector('#sb-stop');
        const resumeCb = frameEl.querySelector('#sb-resume');
        const labelIn = frameEl.querySelector('#sb-label');
        const commitAction = () => this._commitFrameAction();
        jump.addEventListener('change', commitAction);
        jumpc.addEventListener('change', commitAction);
        play.addEventListener('change', commitAction);
        playc.addEventListener('change', commitAction);
        stopCb.addEventListener('change', commitAction);
        resumeCb.addEventListener('change', commitAction);
        labelIn.addEventListener('change', commitAction);
        frameEl.querySelector('#sb-clract').addEventListener('click', () => {
            removeFrameAction(this.getState().project, this.getState().frame);
            if (this.cb.onChange) this.cb.onChange();
        });
        frameEl.querySelector('#sb-clearjump').addEventListener('click', () => this._clearTarget('jump'));
        frameEl.querySelector('#sb-clearplay').addEventListener('click', () => this._clearTarget('play'));
        // 跳转/播放目标：自定义下拉（每项一行：标签名 · 帧号 · 时间秒）
        this._initTargetCombo(jump);
        this._initTargetCombo(play);
    }

    // 一行属性：标签 | 值输入 | 过渡缓动(可选) | 间补缓动
    // opts.enable 存在时，在标签前加「启用」复选框（H/S/V 通道用）
    _propRow(parent, sec, opts) {
        const row = document.createElement('div');
        row.className = 'sb-prop-row';

        const lab = document.createElement('span');
        lab.className = 'sb-prop-label';
        if (opts.enable) {
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!sec[opts.enable];
            cb.addEventListener('change', () => {
                sec[opts.enable] = cb.checked;
                if (this.cb.onChange) this.cb.onChange();
            });
            lab.appendChild(cb);
            this._enInputs[opts.enable] = cb;
        }
        lab.appendChild(document.createTextNode(opts.label));
        if (opts.indent) lab.classList.add('sb-indent');
        row.appendChild(lab);

        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = String(opts.step != null ? opts.step : 1);
        if (opts.min !== undefined) inp.min = opts.min;
        if (opts.max !== undefined) inp.max = opts.max;
        inp.className = 'sb-val-input';
        // 聚焦时记住当前帧：change 在 blur 时触发，时间轴在 mousedown 已 scrub 到新帧，
        // 若按提交时的帧号写入会误改关键帧，故按聚焦时的帧号提交。
        inp.addEventListener('focus', () => { this._editFrame = this.getState().frame; });
        inp.addEventListener('change', () => {
            const v = parseFloat(normalizeInputText(inp.value));
            if (isNaN(v)) { this.sync(); return; }
            this._writeKeyframe(sec, opts.prop, v);
        });
        row.appendChild(inp);
        this._numInputs[opts.prop] = inp;
        if (opts.enable) {
            this._enRowsByProp[opts.prop] = { enable: opts.enable, startProp: opts.startProp };
        }

        // 列 2：过渡缓动（仅 H/S/V 起点行传入 transitionEase）
        const easeCell = document.createElement('div');
        easeCell.className = 'sb-prop-ease';
        if (opts.transitionEase) {
            const te = opts.transitionEase;
            const menu = new EaseMenu(sec[te.easeProp], (name) => {
                sec[te.easeProp] = name;
                if (this.cb.onChange) this.cb.onChange();
            }, sec[te.easeSProp], (v) => {
                sec[te.easeSProp] = v;
                if (this.cb.onChange) this.cb.onChange();
            });
            easeCell.appendChild(menu.el);
            this._easeMenus[te.easeProp] = menu;
        }
        row.appendChild(easeCell);

        // 列 3：间补缓动（当前帧关键帧的 ease/easeS，中间帧禁用）
        const tweenCell = document.createElement('div');
        tweenCell.className = 'sb-prop-ease';
        const tmenu = new EaseMenu('linear', (name) => {
            this._setTweenEase(sec, opts.prop, name, tmenu.sVal);
        }, 1.70158, (v) => {
            this._setTweenEase(sec, opts.prop, tmenu.value, v);
        });
        tweenCell.appendChild(tmenu.el);
        this._tweenMenus[opts.prop] = tmenu;
        row.appendChild(tweenCell);

        parent.appendChild(row);
    }

    _buildTransitionBlock(parent, sec, tr) {
        const block = document.createElement('div');
        block.className = 'sb-trans';

        const head = document.createElement('div');
        head.className = 'sb-subheader';
        head.textContent = tr.label;
        block.appendChild(head);

        // 阴影长度（前/后阴影）
        if (tr.len) {
            this._propRow(block, sec, { label: '长度', prop: tr.len, step: 0.5, min: 0 });
        }

        // 起点端点：仅 body 有独立起点色（值输入框，无「启用」/缓动——统一放在终点行）
        if (tr.ownStart) {
            block.appendChild(this._colorRow('起点色', tr.key + '-start'));
            this._propRow(block, sec, { label: '色相', prop: tr.h0, step: 1, indent: true });
            this._propRow(block, sec, { label: '饱和', prop: tr.s0, step: 1, min: 0, max: 100, indent: true });
            this._propRow(block, sec, { label: '明度', prop: tr.v0, step: 1, min: 0, max: 100, indent: true });
        }

        // 终点端点：「启用」复选框 + 过渡缓动统一放在结束位置——不同过渡可共享起点，终点才是每段独有
        block.appendChild(this._colorRow('终点色', tr.key + '-end'));
        this._propRow(block, sec, { label: '色相', prop: tr.h1, step: 1, indent: true, enable: tr.hEn, startProp: tr.h0, transitionEase: { easeProp: tr.easeH, easeSProp: tr.easeHS } });
        this._propRow(block, sec, { label: '饱和', prop: tr.s1, step: 1, min: 0, max: 100, indent: true, enable: tr.sEn, startProp: tr.s0, transitionEase: { easeProp: tr.easeS, easeSProp: tr.easeSS } });
        this._propRow(block, sec, { label: '明度', prop: tr.v1, step: 1, min: 0, max: 100, indent: true, enable: tr.vEn, startProp: tr.v0, transitionEase: { easeProp: tr.easeV, easeSProp: tr.easeVS } });

        // 色相逆时针
        const ccw = document.createElement('label');
        ccw.className = 'sb-check sb-mid';
        const ccwInput = document.createElement('input');
        ccwInput.type = 'checkbox';
        ccw.appendChild(ccwInput);
        ccw.appendChild(document.createTextNode(' 色相逆时针'));
        ccwInput.addEventListener('change', () => {
            sec[tr.ccw] = ccwInput.checked;
            if (this.cb.onChange) this.cb.onChange();
        });
        block.appendChild(ccw);
        this._ccwInputs[tr.ccw] = ccwInput;

        parent.appendChild(block);
    }

    // 色块行：起点色 / 终点色 标签（第 1 列）+ 色块左对齐于数值输入列（第 2 列起）
    _colorRow(label, channel) {
        const row = document.createElement('div');
        row.className = 'sb-color-row';
        const lab = document.createElement('span');
        lab.className = 'sb-color-label';
        lab.textContent = label;
        const btn = this._makeColorBtn(channel);
        row.appendChild(lab);
        row.appendChild(btn);
        this._colorBtns[channel] = btn;
        return row;
    }

    _makeColorBtn(channel) {
        const btn = document.createElement('button');
        btn.className = 'sb-color';
        btn.dataset.color = channel;
        btn.title = '点击弹出取色器';
        btn.innerHTML = '<span class="sw"></span><span class="txt"></span>';
        btn.addEventListener('click', () => this._openColorPopup(btn, channel));
        return btn;
    }

    // ---------- 弹出取色器 ----------

    _openColorPopup(btn, channel) {
        this._closeColorPopup();
        const sec = this.getState().project.sections[this.getState().selection];
        const ch = this._colorChannels[channel];
        if (!sec || !ch) return;

        const pop = document.createElement('div');
        pop.className = 'sb-color-pop';
        document.body.appendChild(pop);

        const picker = new HSVPicker(pop, (h, s, v) => {
            this._writeColor(sec, channel, h, s, v);
        });

        // 初始值 = 当前帧插补色（静默设置，不触发写回）
        const frame = this.getState().frame;
        picker.set(evalProp(sec, ch.h, frame), evalProp(sec, ch.s, frame), evalProp(sec, ch.v, frame), true);

        // 定位到按钮左侧（侧边栏在右，避免被裁剪），超出时贴边
        pop.style.left = '0px';
        pop.style.top = '0px';
        const rect = btn.getBoundingClientRect();
        const pw = pop.offsetWidth, ph = pop.offsetHeight;
        let left = rect.left - pw - 10;
        if (left < 8) left = 8;
        let top = rect.top;
        if (top + ph > window.innerHeight - 8) top = Math.max(8, window.innerHeight - ph - 8);
        pop.style.left = left + 'px';
        pop.style.top = top + 'px';

        const onDocDown = (ev) => {
            if (pop.contains(ev.target) || btn.contains(ev.target)) return;
            this._closeColorPopup();
        };
        const onKey = (ev) => { if (ev.key === 'Escape') this._closeColorPopup(); };
        // 延迟绑定，避免当前 click 立即触发关闭
        setTimeout(() => {
            document.addEventListener('mousedown', onDocDown);
            window.addEventListener('keydown', onKey);
        }, 0);

        this._colorPop = {
            pop,
            cleanup: () => {
                document.removeEventListener('mousedown', onDocDown);
                window.removeEventListener('keydown', onKey);
            },
        };
    }

    _closeColorPopup() {
        if (this._colorPop) {
            if (this._colorPop.cleanup) this._colorPop.cleanup();
            this._colorPop.pop.remove();
            this._colorPop = null;
        }
    }

    // ---------- 帧动作提交 + 跳转/播放目标下拉 ----------

    // 读取跳转/播放/停止/标记输入，写入当前帧（与 C++ setFrameAction 语义一致）
    _commitFrameAction() {
        const { project, frame } = this.getState();
        const jump = this.container.querySelector('#sb-jump');
        const jumpc = this.container.querySelector('#sb-jumpc');
        const play = this.container.querySelector('#sb-play');
        const playc = this.container.querySelector('#sb-playc');
        const stopCb = this.container.querySelector('#sb-stop');
        const resumeCb = this.container.querySelector('#sb-resume');
        const labelIn = this.container.querySelector('#sb-label');
        if (!jump) return;
        // 解析目标：纯数字 = 帧号；否则按已标记帧名解析；无效 = -1（无）
        const resolveTarget = (v) => {
            const s = normalizeInputText(v);
            if (s === '') return -1;
            if (/^\d+$/.test(s)) return parseInt(s, 10);
            if (s === '开始帧') return 0;
            if (s === '结束帧') return endFrame(project);
            const found = frameLabels(project).find(l => l.label === s);
            return found ? found.frame : -1;
        };
        const jt = resolveTarget(jump.value);
        const pt = resolveTarget(play.value);
        const jcN = normalizeInputText(jumpc.value);
        const pcN = normalizeInputText(playc.value);
        const jc = jcN === '' ? 1 : parseInt(jcN);
        const pc = pcN === '' ? 1 : parseInt(pcN);
        // 标签名不得重名（同名的其他帧拒绝并清空）
        let label = (labelIn.value || '').trim();
        if (label) {
            const dup = frameLabels(project).some(l => l.frame !== frame && l.label === label);
            if (dup) { label = ''; labelIn.value = ''; }
        }
        setFrameAction(project, frame, jt, jc, pt, pc, stopCb.checked, label, resumeCb.checked);
        if (this.cb.onChange) this.cb.onChange();
    }

    // 清除指定目标的跳转/播放（保留该帧其他动作）
    _clearTarget(which) {
        const input = this.container.querySelector(which === 'jump' ? '#sb-jump' : '#sb-play');
        if (input) {
            input.value = '';
            this._commitFrameAction();
        }
    }

    // 目标帧的回显名：真实标签名优先；否则开始帧/结束帧保持虚拟名称；最后退回帧号
    _targetName(project, frame) {
        const label = labelAtFrame(project, frame);
        if (label) return label;
        if (frame === 0) return '开始帧';
        if (frame === endFrame(project)) return '结束帧';
        return String(frame);
    }

    // 给跳转/播放输入框挂上自定义下拉（每项一行：标签名 · 帧号 · 时间秒）
    _initTargetCombo(input) {
        // 抑制浏览器原生自动填充/建议下拉（白/灰底），避免与自定义深色下拉叠加
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('spellcheck', 'false');
        input.readOnly = true;   // 只读占位：聚焦时才恢复可编辑，进一步阻断自动填充
        input.addEventListener('focus', () => {
            input.readOnly = false;
            this._openTargetCombo(input);
        });
        input.addEventListener('click', () => this._openTargetCombo(input));
        input.addEventListener('blur', () => {
            // 延迟到 change 提交之后；若已重新聚焦则不改
            setTimeout(() => {
                if (document.activeElement !== input) input.readOnly = true;
            }, 0);
        });
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'ArrowDown') { ev.preventDefault(); this._openTargetCombo(input); }
        });
        // 点击组合框本体的空白/箭头区域也聚焦输入框（触发 focus → 打开下拉）
        const wrap = input.closest('.sb-combo');
        if (wrap) wrap.addEventListener('click', () => input.focus());
    }

    _openTargetCombo(input) {
        this._closeTargetCombo();
        const { project } = this.getState();
        // 虚拟标签「开始帧 / 结束帧」始终可用，与用户命名帧合并后按帧号排序
        const end = endFrame(project);
        const items = [
            { frame: 0, label: '开始帧', virtual: true },
            { frame: end, label: '结束帧', virtual: true },
            ...frameLabels(project).map(l => ({ frame: l.frame, label: l.label, virtual: false })),
        ].sort((a, b) => a.frame - b.frame);

        const list = document.createElement('div');
        list.className = 'sb-combo-list';
        for (const l of items) {
            const item = document.createElement('div');
            item.className = 'sb-combo-item';
            const sec = (frameToMs(project, l.frame) / 1000).toFixed(3);
            item.innerHTML =
                `<span class="ci-label"></span>` +
                `<span class="ci-frame">帧 ${l.frame}</span>` +
                `<span class="ci-time">${sec}秒</span>`;
            item.querySelector('.ci-label').textContent = l.label;   // 文本节点，避免注入
            item.addEventListener('mousedown', (ev) => {
                ev.preventDefault();   // 保持焦点，避免 blur 抢先关闭
                // 选中后保持标签名（用户命名帧与虚拟标签「开始帧/结束帧」都保留名称）
                input.value = l.label;
                this._closeTargetCombo();
                this._commitFrameAction();
            });
            list.appendChild(item);
        }
        document.body.appendChild(list);

        // 以组合框本体（wrapper）为锚点定位；打开期间高亮本体边框（对齐缓动菜单触发按钮）
        const wrap = input.closest('.sb-combo') || input;
        wrap.classList.add('open');
        const rect = wrap.getBoundingClientRect();
        list.style.left = rect.left + 'px';
        list.style.top = (rect.bottom + 2) + 'px';
        list.style.width = Math.max(rect.width, 200) + 'px';
        // 底部空间不足时向上弹出
        if (rect.bottom + 2 + list.offsetHeight > window.innerHeight - 8) {
            list.style.top = (rect.top - list.offsetHeight - 2) + 'px';
        }

        const onDocDown = (ev) => {
            if (list.contains(ev.target) || wrap.contains(ev.target)) return;
            this._closeTargetCombo();
        };
        const onKey = (ev) => { if (ev.key === 'Escape') this._closeTargetCombo(); };
        // 延迟绑定，避免当前 focus/click 立即触发关闭
        setTimeout(() => {
            document.addEventListener('mousedown', onDocDown);
            window.addEventListener('keydown', onKey);
        }, 0);

        this._targetCombo = {
            input, list, wrap,
            cleanup: () => {
                document.removeEventListener('mousedown', onDocDown);
                window.removeEventListener('keydown', onKey);
            },
        };
    }

    _closeTargetCombo() {
        if (this._targetCombo) {
            if (this._targetCombo.cleanup) this._targetCombo.cleanup();
            if (this._targetCombo.wrap) this._targetCombo.wrap.classList.remove('open');
            this._targetCombo.list.remove();
            this._targetCombo = null;
        }
    }

    // 原地同步数值（帧变化 / 编辑后调用，避免重建取色器）
    sync() {
        const { project, frame, selection } = this.getState();
        const sec = project.sections[selection];
        if (!sec || !this._numInputs.x) return;

        const all = {};
        for (const p of NUM_PROPS) all[p] = evalProp(sec, p, frame);

        // 列 1：值 + 关键帧边框高亮（整数属性在中间帧四舍五入显示）
        for (const p of Object.keys(this._numInputs)) {
            const inp = this._numInputs[p];
            const isKey = this._isKeyframe(sec, p, frame);
            // 通道被禁用（取消「启用」复选框）：输入框置灰并显示起点值
            const enRow = this._enRowsByProp[p];
            const disabled = enRow && !sec[enRow.enable];
            inp.disabled = !!disabled;
            if (document.activeElement !== inp) {
                const v = disabled ? all[enRow.startProp] : all[p];
                const vv = (INTEGER_PROPS.includes(p) && !isKey) ? cRound(v) : v;
                inp.value = (Math.round(vv * 100) / 100).toString();
            }
            inp.classList.toggle('is-key', isKey);
        }

        // 列 2：过渡缓动
        for (const p of EASE_PROPS) {
            const menu = this._easeMenus[p];
            if (menu) {
                menu.setValue(sec[p]);
                menu.setS(sec[this._easeSMap[p]]);
            }
        }

        // 列 3：间补缓动（中间帧禁用）
        for (const p of Object.keys(this._tweenMenus)) {
            const menu = this._tweenMenus[p];
            const k = keyframeAt(sec, p, frame);
            menu.setEnabled(!!k);
            menu.setValue(k ? k.ease : 'linear');
            menu.setS(k ? k.easeS : 1.70158);
        }

        // 启用复选框
        for (const [en, cb] of Object.entries(this._enInputs)) {
            cb.checked = !!sec[en];
        }

        // 色相逆时针
        for (const [ccwProp, input] of Object.entries(this._ccwInputs)) {
            input.checked = !!sec[ccwProp];
        }

        // 色块（仅 #RRGGBB）
        const updColor = (channel, h, s, v) => {
            const btn = this._colorBtns[channel];
            if (!btn) return;
            const [r, g, b] = hsv2rgb(h, s, v);
            const hex = rgbToHex(r, g, b);
            btn.querySelector('.sw').style.background = hex;
            btn.querySelector('.txt').textContent = hex.toUpperCase();
        };
        for (const [channel, ch] of Object.entries(this._colorChannels)) {
            updColor(channel, all[ch.h], all[ch.s], all[ch.v]);
        }

        // 选中帧信息 + 帧动作
        const info = this.container.querySelector('.sb-frame-info');
        if (info) {
            let badge = '';
            if (hasRealKeyframe(sec, frame)) badge += ' · <span class="sb-kf-badge">关键帧</span>';
            if (hasEmptyKeyframe(sec, frame)) badge += ' · <span class="sb-kf-badge">空关键帧</span>';
            info.innerHTML = `帧 ${frame} · ${(frameToMs(project, frame) / 1000).toFixed(3)} 秒${badge}`;
        }
        const act = frameActionAt(project, frame);
        const jump = this.container.querySelector('#sb-jump');
        const jumpc = this.container.querySelector('#sb-jumpc');
        const play = this.container.querySelector('#sb-play');
        const playc = this.container.querySelector('#sb-playc');
        const stopCb = this.container.querySelector('#sb-stop');
        const resumeCb = this.container.querySelector('#sb-resume');
        const labelIn = this.container.querySelector('#sb-label');
        // 当前正在编辑的输入框不覆盖，避免与用户输入冲突（与属性值输入框一致）
        const hasJump = !!(act && act.jumpTo >= 0);
        const hasPlay = !!(act && act.playTo >= 0);
        if (jump && document.activeElement !== jump) jump.value = hasJump ? this._targetName(project, act.jumpTo) : '';
        if (jumpc) {
            jumpc.disabled = !hasJump;   // 未设跳转目标时禁用，次数随之无效
            if (document.activeElement !== jumpc) jumpc.value = hasJump ? act.jumpCount : 1;
        }
        if (play && document.activeElement !== play) play.value = hasPlay ? this._targetName(project, act.playTo) : '';
        if (playc) {
            playc.disabled = !hasPlay;
            if (document.activeElement !== playc) playc.value = hasPlay ? act.playCount : 1;
        }
        if (stopCb) stopCb.checked = !!(act && act.stop);
        if (resumeCb) {
            resumeCb.disabled = !hasPlay;   // 无播放目标时「然后继续」无效
            resumeCb.checked = hasPlay && !!(act && act.resume);
        }
        if (labelIn && document.activeElement !== labelIn) labelIn.value = (act && act.label) ? act.label : '';
    }

    // 某属性在当前帧是否为「有效关键帧」：帧 0 恒为原点；帧>0 需该帧有关键帧且其值与前一个关键帧不同
    _isKeyframe(sec, prop, frame) {
        return isDistinctKeyframe(sec, prop, frame);
    }

    _setTweenEase(sec, prop, name, s) {
        const { frame } = this.getState();
        setKeyframeEase(sec, prop, frame, name, s);
        if (this.cb.onChange) this.cb.onChange();
    }

    _writeKeyframe(sec, prop, value) {
        const frame = (this._editFrame != null) ? this._editFrame : this.getState().frame;
        const existing = keyframeAt(sec, prop, frame);
        setKeyframe(sec, prop, frame, value, existing ? existing.ease : 'linear', existing ? existing.easeS : 1.70158);
        this._updateAfterEdit(sec);
    }

    _writeColor(sec, channel, h, s, v) {
        const ch = this._colorChannels[channel];
        if (!ch) return;
        const { frame } = this.getState();
        const vals = { [ch.h]: h, [ch.s]: s, [ch.v]: v };
        for (const [prop, value] of Object.entries(vals)) {
            const existing = keyframeAt(sec, prop, frame);
            setKeyframe(sec, prop, frame, value, existing ? existing.ease : 'linear', existing ? existing.easeS : 1.70158);
        }
        this._updateAfterEdit(sec);
    }

    _updateAfterEdit(sec) {
        // 更新关键帧指示，刷新预览/时间轴（不重建侧边）
        this.sync();
        if (this.cb.onChange) this.cb.onChange();
    }
}
