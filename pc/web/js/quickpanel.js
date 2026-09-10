// 预览区快捷小面板：点击分段首/末灯珠（或前/后阴影末端灯珠）弹出，
// 快速编辑该端点的色相/饱和/明度，写入当前帧关键帧（帧 0 写基准值）。
// 端点键与 model.js ENDPOINTS 对齐：body-start / body-end / front-end / back-end。
import { ENDPOINTS, evalProp, keyframeAt, setKeyframe } from './model.js';
import { hsv2rgb, rgbToHex } from './color.js';

export class QuickPanel {
    constructor(container, getState, cb) {
        this.container = container;     // #preview（position:relative，面板绝对定位锚点）
        this.getState = getState;       // () => { project, frame, selection }
        this.cb = cb || {};             // { onChange() }
        this.sectionIndex = -1;
        this.endpointKey = null;        // ENDPOINTS 键或 null（null=关闭）
        this._cleanup = null;
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
            <div class="qp-swatch-row"><span class="qp-swatch"></span><span class="qp-hex"></span></div>
            <label class="qp-field">色相 <input class="qp-h" type="number" step="1"></label>
            <label class="qp-field">饱和 <input class="qp-s" type="number" step="0.01"></label>
            <label class="qp-field">明度 <input class="qp-v" type="number" step="0.01"></label>`;
        this.container.appendChild(this.root);

        this._title = this.root.querySelector('.qp-title');
        this._swatch = this.root.querySelector('.qp-swatch');
        this._hex = this.root.querySelector('.qp-hex');
        this._h = this.root.querySelector('.qp-h');
        this._s = this.root.querySelector('.qp-s');
        this._v = this.root.querySelector('.qp-v');

        this.root.querySelector('.qp-close').addEventListener('click', () => this.close());
        for (const inp of [this._h, this._s, this._v]) {
            inp.addEventListener('change', () => this._commit());
        }
    }

    // 打开面板：锚点 (ax, ay) 为预览区（canvas）内坐标
    open(sectionIndex, endpointKey, ax, ay) {
        this.close();                    // 关闭旧面板并解绑文档监听
        this.sectionIndex = sectionIndex;
        this.endpointKey = endpointKey;
        this._title.textContent = ENDPOINTS[endpointKey].label;
        this.root.style.display = 'block';
        this.sync();

        const rect = this.container.getBoundingClientRect();
        const pw = this.root.offsetWidth, ph = this.root.offsetHeight;
        let left = ax + 14, top = ay + 14;
        if (left + pw > rect.width - 8) left = Math.max(8, ax - pw - 8);
        if (top + ph > rect.height - 8) top = Math.max(8, ay - ph - 8);
        this.root.style.left = left + 'px';
        this.root.style.top = top + 'px';

        // 延迟绑定文档点击，避免「当前点击」立即触发关闭（与侧边栏取色器同法）
        const onDocDown = (ev) => {
            if (this.root.contains(ev.target)) return;
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
    }

    close() {
        if (this._cleanup) { this._cleanup(); this._cleanup = null; }
        this.endpointKey = null;
        if (this.root) this.root.style.display = 'none';
    }

    // 原地刷新（帧变化时同步插补值与色块）
    sync() {
        if (!this.isOpen) return;
        const { project, frame } = this.getState();
        const sec = project.sections[this.sectionIndex];
        if (!sec) { this.close(); return; }
        const ep = ENDPOINTS[this.endpointKey];
        const h = evalProp(sec, ep.h, frame);
        const s = evalProp(sec, ep.s, frame);
        const v = evalProp(sec, ep.v, frame);
        if (document.activeElement !== this._h) this._h.value = (Math.round(h * 100) / 100).toString();
        if (document.activeElement !== this._s) this._s.value = (Math.round(s * 1000) / 1000).toString();
        if (document.activeElement !== this._v) this._v.value = (Math.round(v * 1000) / 1000).toString();
        const [r, g, b] = hsv2rgb(h, s, v);
        const hex = rgbToHex(r, g, b);
        this._swatch.style.background = hex;
        this._hex.textContent = hex.toUpperCase();
    }

    // 编辑 H/S/V → 写入当前帧关键帧（保留已有关键帧的间补缓动）
    _commit() {
        if (!this.isOpen) return;
        const { project, frame } = this.getState();
        const sec = project.sections[this.sectionIndex];
        if (!sec) return;
        const ep = ENDPOINTS[this.endpointKey];
        for (const [prop, inp] of [[ep.h, this._h], [ep.s, this._s], [ep.v, this._v]]) {
            const value = parseFloat(inp.value);
            if (!isFinite(value)) continue;
            const ex = keyframeAt(sec, prop, frame);
            setKeyframe(sec, prop, frame, value, ex ? ex.ease : 'linear', ex ? ex.easeS : 1.70158);
        }
        this.sync();
        if (this.cb.onChange) this.cb.onChange();
    }
}
