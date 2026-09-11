// 预览区快捷小面板：点击分段首/末灯珠（或前/后阴影末端灯珠）弹出，
// 复制侧边栏该端点色行的完整编辑控件与三列布局：
// 色块（点击弹出取色器，不直接显示色盘）+ H/S/V 数值 + 过渡/间补缓动 + 启用/色相逆时针。
import {
    ENDPOINTS, evalProp, setKeyframe, keyframeAt, setKeyframeEase,
} from './model.js';
import { EaseMenu } from './easemenu.js';
import { HSVPicker } from './hsvpicker.js';
import { hsv2rgb, rgbToHex } from './color.js';

export class QuickPanel {
    constructor(container, getState, cb) {
        this.container = container;      // #preview（position:relative，面板绝对定位锚点）
        this.getState = getState;        // () => { project, frame, selection }
        this.cb = cb || {};              // { onChange() }
        this.sectionIndex = -1;
        this.endpointKey = null;         // ENDPOINTS 键或 null（null=关闭）
        this._ep = null;                 // 当前 ENDPOINTS 描述 { label, h, s, v, tr, role }
        this._cleanup = null;            // 面板文档监听清理
        this._colorPop = null;           // 弹出取色器 { pop, cleanup }
        this._numInputs = {};            // prop -> value input
        this._easeMenus = {};            // easeProp -> EaseMenu（列 2 过渡缓动）
        this._tweenMenus = {};           // prop -> EaseMenu（列 3 间补缓动）
        this._enInputs = {};             // enableProp -> checkbox
        this._easeSMap = {};             // easeProp -> easeSProp
        this._colorBtn = null;           // 色块按钮
        this._ccwInput = null;           // 色相逆时针 checkbox
        this._build();
    }

    get isOpen() { return !!this.endpointKey; }

    _build() {
        this.root = document.createElement('div');
        this.root.className = 'qp-panel';
        this.root.style.display = 'none';
        this.root.innerHTML = `
            <div class="qp-head">
                <span class="qp-title"></span>
                <button class="qp-close" type="button" title="关闭">×</button>
            </div>
            <div class="qp-body"></div>`;
        this.container.appendChild(this.root);
        this._title = this.root.querySelector('.qp-title');
        this._body = this.root.querySelector('.qp-body');
        this.root.querySelector('.qp-close').addEventListener('click', () => this.close());
    }

    _sec() {
        const { project } = this.getState();
        return project.sections[this.sectionIndex] || null;
    }

    // 打开面板：锚点 (ax, ay) 为预览区（canvas）内坐标
    open(sectionIndex, endpointKey, ax, ay) {
        this.close();                    // 关闭旧面板并解绑文档监听
        this.sectionIndex = sectionIndex;
        this.endpointKey = endpointKey;
        this._ep = ENDPOINTS[endpointKey];
        this._title.textContent = this._ep.label;
        this.root.style.display = 'block';

        this._buildBody();

        const rect = this.container.getBoundingClientRect();
        const pw = this.root.offsetWidth, ph = this.root.offsetHeight;
        let left = ax + 14, top = ay + 14;
        if (left + pw > rect.width - 8) left = Math.max(8, ax - pw - 8);
        if (top + ph > rect.height - 8) top = Math.max(8, ay - ph - 8);
        this.root.style.left = left + 'px';
        this.root.style.top = top + 'px';

        // 延迟绑定文档点击，避免「当前点击」立即触发关闭（与侧边栏取色器同法）
        // 同时忽略落在弹出取色器内的点击，避免取色时整面板被关掉
        const onDocDown = (ev) => {
            if (this.root.contains(ev.target)) return;
            if (this._colorPop && this._colorPop.pop.contains(ev.target)) return;
            this.close();
        };
        const onKey = (ev) => { if (ev.key === 'Escape') this.close(); };
        setTimeout(() => {
            document.addEventListener('mousedown', onDocDown);
            window.addEventListener('keydown', onKey);
        }, 0);
        this._cleanup = () => {
            document.removeEventListener('mousedown', onDocDown);
            window.removeEventListener('keydown', onKey);
        };
        this.sync();
    }

    _buildBody() {
        this._body.innerHTML = '';
        this._numInputs = {};
        this._easeMenus = {};
        this._tweenMenus = {};
        this._enInputs = {};
        this._easeSMap = {};
        this._colorBtn = null;
        this._ccwInput = null;

        const sec = this._sec();
        const ep = this._ep;
        if (!sec || !ep) return;

        // 三列列头（渲染过渡 | 动画间补），与侧边栏一致
        const colHead = document.createElement('div');
        colHead.className = 'sb-col-head';
        colHead.innerHTML = '<span></span><span></span><span>渲染过渡</span><span>动画间补</span>';
        this._body.appendChild(colHead);

        // 色块行（点击弹出取色器，不直接显示色盘）
        const colorRow = document.createElement('div');
        colorRow.className = 'sb-color-row';
        const lab = document.createElement('span');
        lab.className = 'sb-color-label';
        lab.textContent = ep.role === 'start' ? '起点色' : '终点色';
        this._colorBtn = this._makeColorBtn();
        colorRow.appendChild(lab);
        colorRow.appendChild(this._colorBtn);
        this._body.appendChild(colorRow);

        // 该端点所属过渡块：起点用 h0/s0/v0，终点用 h1/s1/v1
        const tr = ep.tr;
        const isEnd = ep.role === 'end';
        const hProp = isEnd ? tr.h1 : tr.h0;
        const sProp = isEnd ? tr.s1 : tr.s0;
        const vProp = isEnd ? tr.v1 : tr.v0;

        this._propRow(this._body, { label: '色相', prop: hProp, step: 1, indent: true,
            enable: isEnd ? tr.hEn : null,
            transitionEase: isEnd ? { easeProp: tr.easeH, easeSProp: tr.easeHS } : null });
        this._propRow(this._body, { label: '饱和', prop: sProp, step: 1, min: 0, max: 100, indent: true,
            enable: isEnd ? tr.sEn : null,
            transitionEase: isEnd ? { easeProp: tr.easeS, easeSProp: tr.easeSS } : null });
        this._propRow(this._body, { label: '明度', prop: vProp, step: 1, min: 0, max: 100, indent: true,
            enable: isEnd ? tr.vEn : null,
            transitionEase: isEnd ? { easeProp: tr.easeV, easeSProp: tr.easeVS } : null });

        // 色相逆时针（仅终点端点，与侧边栏一致）
        if (isEnd) {
            const ccw = document.createElement('label');
            ccw.className = 'sb-check sb-mid';
            const ccwInput = document.createElement('input');
            ccwInput.type = 'checkbox';
            ccw.appendChild(ccwInput);
            ccw.appendChild(document.createTextNode(' 色相逆时针'));
            ccwInput.addEventListener('change', () => {
                const s2 = this._sec();
                if (!s2) return;
                s2[tr.ccw] = ccwInput.checked;
                if (this.cb.onChange) this.cb.onChange();
            });
            this._body.appendChild(ccw);
            this._ccwInput = ccwInput;
        }
    }

    // 一行属性：标签(+启用) | 值 | 过渡缓动(可选) | 间补缓动（与侧边栏 _propRow 同构）
    _propRow(parent, opts) {
        const sec = this._sec();
        if (!sec) return;
        const row = document.createElement('div');
        row.className = 'sb-prop-row';

        const lab = document.createElement('span');
        lab.className = 'sb-prop-label';
        if (opts.enable) {
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!sec[opts.enable];
            cb.addEventListener('change', () => {
                const s2 = this._sec();
                if (!s2) return;
                s2[opts.enable] = cb.checked;
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
        inp.addEventListener('change', () => {
            const v = parseFloat(inp.value);
            if (isNaN(v)) { this.sync(); return; }
            this._writeKeyframe(opts.prop, v);
        });
        row.appendChild(inp);
        this._numInputs[opts.prop] = inp;

        // 列 2：过渡缓动（仅终点行）
        const easeCell = document.createElement('div');
        easeCell.className = 'sb-prop-ease';
        if (opts.transitionEase) {
            const te = opts.transitionEase;
            const menu = new EaseMenu(sec[te.easeProp], (name) => {
                const s2 = this._sec();
                if (!s2) return;
                s2[te.easeProp] = name;
                if (this.cb.onChange) this.cb.onChange();
            }, sec[te.easeSProp], (v) => {
                const s2 = this._sec();
                if (!s2) return;
                s2[te.easeSProp] = v;
                if (this.cb.onChange) this.cb.onChange();
            });
            easeCell.appendChild(menu.el);
            this._easeMenus[te.easeProp] = menu;
            this._easeSMap[te.easeProp] = te.easeSProp;
        }
        row.appendChild(easeCell);

        // 列 3：间补缓动（当前帧关键帧的 ease/easeS，中间帧禁用）
        const tweenCell = document.createElement('div');
        tweenCell.className = 'sb-prop-ease';
        const tmenu = new EaseMenu('linear', (name) => {
            this._setTweenEase(opts.prop, name, tmenu.sVal);
        }, 1.70158, (v) => {
            this._setTweenEase(opts.prop, tmenu.value, v);
        });
        tweenCell.appendChild(tmenu.el);
        this._tweenMenus[opts.prop] = tmenu;
        row.appendChild(tweenCell);

        parent.appendChild(row);
    }

    _makeColorBtn() {
        const btn = document.createElement('button');
        btn.className = 'sb-color';
        btn.title = '点击弹出取色器';
        btn.innerHTML = '<span class="sw"></span><span class="txt"></span>';
        btn.addEventListener('click', () => this._openColorPopup(btn));
        return btn;
    }

    // ---------- 弹出取色器（同侧边栏 _openColorPopup） ----------

    _openColorPopup(btn) {
        this._closeColorPopup();
        const sec = this._sec();
        const ep = this._ep;
        if (!sec || !ep) return;

        const pop = document.createElement('div');
        pop.className = 'sb-color-pop';
        document.body.appendChild(pop);

        const picker = new HSVPicker(pop, (h, s, v) => this._writeColor(h, s, v));
        const frame = this.getState().frame;
        picker.set(evalProp(sec, ep.h, frame), evalProp(sec, ep.s, frame), evalProp(sec, ep.v, frame), true);

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

    close() {
        if (this._cleanup) { this._cleanup(); this._cleanup = null; }
        this._closeColorPopup();
        this.endpointKey = null;
        this._ep = null;
        if (this.root) this.root.style.display = 'none';
    }

    // 原地同步（帧变化 / 编辑后调用，不重建面板）
    sync() {
        if (!this.isOpen) return;
        const { frame } = this.getState();
        const sec = this._sec();
        if (!sec) { this.close(); return; }
        const ep = this._ep;
        if (!ep) return;

        // 值 + 关键帧边框高亮
        for (const p of Object.keys(this._numInputs)) {
            const inp = this._numInputs[p];
            const isKey = this._isKeyframe(sec, p, frame);
            if (document.activeElement !== inp) {
                inp.value = (Math.round(evalProp(sec, p, frame) * 100) / 100).toString();
            }
            inp.classList.toggle('is-key', isKey);
        }

        // 过渡缓动
        for (const p of Object.keys(this._easeMenus)) {
            this._easeMenus[p].setValue(sec[p]);
            this._easeMenus[p].setS(sec[this._easeSMap[p]]);
        }

        // 间补缓动（中间帧禁用）
        for (const p of Object.keys(this._tweenMenus)) {
            const menu = this._tweenMenus[p];
            const k = keyframeAt(sec, p, frame);
            menu.setEnabled(!!k);
            menu.setValue(k ? k.ease : 'linear');
            menu.setS(k ? k.easeS : 1.70158);
        }

        // 启用复选框
        for (const [en, cb] of Object.entries(this._enInputs)) cb.checked = !!sec[en];
        // 色相逆时针
        if (this._ccwInput) this._ccwInput.checked = !!sec[ep.tr.ccw];
        // 色块（仅 #RRGGBB）
        if (this._colorBtn) {
            const [r, g, b] = hsv2rgb(evalProp(sec, ep.h, frame), evalProp(sec, ep.s, frame), evalProp(sec, ep.v, frame));
            const hex = rgbToHex(r, g, b);
            this._colorBtn.querySelector('.sw').style.background = hex;
            this._colorBtn.querySelector('.txt').textContent = hex.toUpperCase();
        }
    }

    _isKeyframe(sec, prop, frame) {
        if (frame <= 0) return true;
        const kfs = sec.keyframes[prop];
        return !!(kfs && kfs.some((k) => k.frame === frame));
    }

    _setTweenEase(prop, name, s) {
        const sec = this._sec();
        if (!sec) return;
        setKeyframeEase(sec, prop, this.getState().frame, name, s);
        if (this.cb.onChange) this.cb.onChange();
    }

    _writeKeyframe(prop, value) {
        const sec = this._sec();
        if (!sec) return;
        const frame = this.getState().frame;
        const existing = keyframeAt(sec, prop, frame);
        setKeyframe(sec, prop, frame, value, existing ? existing.ease : 'linear', existing ? existing.easeS : 1.70158);
        this.sync();
        if (this.cb.onChange) this.cb.onChange();
    }

    // 取色器变化 → 写入当前帧关键帧（保留已有关键帧的间补缓动）
    _writeColor(h, s, v) {
        if (!this.isOpen) return;
        const sec = this._sec();
        const ep = this._ep;
        if (!sec || !ep) return;
        const frame = this.getState().frame;
        const vals = { [ep.h]: h, [ep.s]: s, [ep.v]: v };
        for (const [prop, value] of Object.entries(vals)) {
            const existing = keyframeAt(sec, prop, frame);
            setKeyframe(sec, prop, frame, value, existing ? existing.ease : 'linear', existing ? existing.easeS : 1.70158);
        }
        this.sync();
        if (this.cb.onChange) this.cb.onChange();
    }
}
