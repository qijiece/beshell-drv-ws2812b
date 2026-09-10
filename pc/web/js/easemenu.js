// 缓动菜单：自定义下拉，每个选项绘制缓动曲线，鼠标悬停时播放一次曲线动画（播完即停）。
// 动画时曲线右侧有一竖向指针随 y 值上下移动；选中 Back 类缓动时出现 s 参数输入框。
// 参考 https://www.xuanfengge.com/easeing/easeing/
import { EASE_NAMES, ease } from './easing.js';

const CW = 72, CH = 40, SAMPLE = 56;   // 曲线画布逻辑尺寸（CSS px）与采样点
const RAIL = 9;                        // 右侧指针轨道宽度（px）
const BACK_EASINGS = ['inBack', 'outBack', 'inOutBack'];

export class EaseMenu {
    constructor(value, onChange, sValue, onSChange) {
        this.value = value;
        this.onChange = onChange || (() => {});
        this.sVal = (typeof sValue === 'number' && isFinite(sValue)) ? sValue : 1.70158;
        this.onSChange = onSChange || (() => {});
        this._open = false;
        this._anim = null;   // { canvas, name, raf }（悬停单次播放）
        this._list = null;
        this._build();
        this._updateSVisibility();
    }

    get el() { return this.root; }

    setValue(name) {
        this.value = name;
        if (this._nameEl) this._nameEl.textContent = name;
        this._updateSVisibility();
    }

    setS(v) {
        this.sVal = v;
        if (this.sInput && document.activeElement !== this.sInput) {
            this.sInput.value = String(v);
        }
    }

    // 启用/禁用（列 3 间补缓动在中间帧禁用）
    setEnabled(enabled) {
        this.trigger.disabled = !enabled;
        if (this.sInput) this.sInput.disabled = !enabled;
        this.root.classList.toggle('disabled', !enabled);
    }

    _build() {
        this.root = document.createElement('div');
        this.root.className = 'ease-menu';

        this.trigger = document.createElement('button');
        this.trigger.type = 'button';
        this.trigger.className = 'ease-menu-trigger';
        this.trigger.innerHTML = '<span class="em-name"></span><span class="em-arrow">▾</span>';
        this.trigger.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this._open ? this._close() : this._openList();
        });
        this.root.appendChild(this.trigger);

        // s 参数输入行（仅 Back 类缓动显示）
        this.sWrap = document.createElement('div');
        this.sWrap.className = 'ease-menu-s';
        const sl = document.createElement('span');
        sl.className = 'ems-label';
        sl.textContent = 's';
        this.sInput = document.createElement('input');
        this.sInput.type = 'number';
        this.sInput.step = '0.1';
        this.sInput.value = String(this.sVal);
        this.sInput.title = 'Back 缓动超调量（越大回弹越强）';
        this.sInput.addEventListener('change', () => {
            const v = parseFloat(this.sInput.value);
            if (!isNaN(v)) this.sVal = v;
            else this.sInput.value = String(this.sVal);
            this.onSChange(this.sVal);
        });
        this.sWrap.appendChild(sl);
        this.sWrap.appendChild(this.sInput);
        this.root.appendChild(this.sWrap);

        this._nameEl = this.trigger.querySelector('.em-name');
        this._nameEl.textContent = this.value;
    }

    _updateSVisibility() {
        if (!this.sWrap) return;
        this.sWrap.style.display = BACK_EASINGS.includes(this.value) ? 'flex' : 'none';
    }

    _openList() {
        if (!this._list) this._buildList();
        document.body.appendChild(this._list);
        this._open = true;
        this.trigger.classList.add('open');

        const rect = this.trigger.getBoundingClientRect();
        this._list.style.left = rect.left + 'px';
        this._list.style.width = Math.max(rect.width, 180) + 'px';
        const listH = this._list.offsetHeight;
        let top = rect.bottom + 4;
        if (top + listH > window.innerHeight - 8) top = Math.max(8, rect.top - listH - 4);
        this._list.style.top = top + 'px';

        this._onDocDown = (ev) => {
            if (this.root.contains(ev.target) || this._list.contains(ev.target)) return;
            this._close();
        };
        this._onKey = (ev) => { if (ev.key === 'Escape') this._close(); };
        // 延迟绑定，避免当前 click 立即触发关闭
        setTimeout(() => {
            document.addEventListener('mousedown', this._onDocDown);
            window.addEventListener('keydown', this._onKey);
        }, 0);
    }

    _close() {
        if (!this._open) return;
        this._open = false;
        this.trigger.classList.remove('open');
        this._stop();
        if (this._list) this._list.remove();
        document.removeEventListener('mousedown', this._onDocDown);
        window.removeEventListener('keydown', this._onKey);
    }

    _buildList() {
        this._list = document.createElement('div');
        this._list.className = 'ease-menu-list';
        for (const name of EASE_NAMES) {
            const item = document.createElement('div');
            item.className = 'ease-menu-item' + (name === this.value ? ' selected' : '');
            item.dataset.name = name;

            const cv = document.createElement('canvas');
            const dpr = window.devicePixelRatio || 1;
            cv.width = CW * dpr;
            cv.height = CH * dpr;
            cv.style.width = CW + 'px';
            cv.style.height = CH + 'px';
            cv.className = 'em-curve';
            this._drawCurve(cv, name, null);

            const label = document.createElement('span');
            label.className = 'em-label';
            label.textContent = name;

            item.appendChild(cv);
            item.appendChild(label);
            item.addEventListener('mouseenter', () => this._play(cv, name));
            item.addEventListener('mouseleave', () => {
                if (this._anim && this._anim.canvas === cv) this._stop();
            });
            item.addEventListener('click', () => this._select(name));

            this._list.appendChild(item);
        }
    }

    _select(name) {
        if (name !== this.value) {
            this.value = name;
            if (this._nameEl) this._nameEl.textContent = name;
            if (this._list) {
                this._list.querySelectorAll('.ease-menu-item').forEach((it) => {
                    it.classList.toggle('selected', it.dataset.name === name);
                });
            }
        }
        this._updateSVisibility();
        this._close();
        this.onChange(name);
    }

    // 绘制曲线；t != null 时叠加动画点与右侧竖向指针（t∈[0,1]）
    _drawCurve(canvas, name, t) {
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, CW, CH);

        // 采样并自适应 y 范围（含 Back/Elastic 的越界）
        const pts = [];
        let mn = 0, mx = 1;
        for (let i = 0; i <= SAMPLE; i++) {
            const v = ease(name, i / SAMPLE, this.sVal);
            pts.push(v);
            if (v < mn) mn = v;
            if (v > mx) mx = v;
        }
        const pad = Math.max(0.02, (mx - mn) * 0.08);
        const lo = mn - pad, hi = mx + pad;
        const span = (hi - lo) || 1;

        const X = (tt) => 2 + tt * (CW - RAIL - 4);
        const Y = (v) => CH - 2 - (v - lo) / span * (CH - 4);
        const rx = CW - RAIL / 2;

        // 0 / 1 参考线（虚线感）
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(2, Y(0)); ctx.lineTo(CW - RAIL - 2, Y(0));
        ctx.moveTo(2, Y(1)); ctx.lineTo(CW - RAIL - 2, Y(1));
        ctx.stroke();
        ctx.setLineDash([]);

        // 曲线
        ctx.strokeStyle = '#4d9fff';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let i = 0; i <= SAMPLE; i++) {
            const tt = i / SAMPLE;
            const x = X(tt), y = Y(pts[i]);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // 右侧竖向指针轨道
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(rx, 2); ctx.lineTo(rx, CH - 2);
        ctx.stroke();

        // 动画点
        if (t != null) {
            const v = ease(name, t, this.sVal);
            ctx.fillStyle = '#ffd166';
            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(X(t), Y(v), 3.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // 右侧指针（随 y 值上下移动）
            const vy = Y(v);
            ctx.fillStyle = '#ffd166';
            ctx.beginPath();
            ctx.moveTo(rx, vy);
            ctx.lineTo(rx - 5, vy - 3.5);
            ctx.lineTo(rx - 5, vy + 3.5);
            ctx.closePath();
            ctx.fill();
        }
    }

    // 悬停某选项时播放一次曲线动画（右侧指针随 y 值上下移动），播完即停在静态，等下次悬停
    _play(canvas, name) {
        this._stop();
        this._anim = { canvas, name, raf: 0 };
        const t0 = performance.now();
        const dur = 1200;   // 单次播放时长（ms）
        const step = (now) => {
            if (!this._anim || this._anim.canvas !== canvas) return;
            const t = (now - t0) / dur;
            if (t >= 1) {                       // 播放完一次即停止，不自动重播
                this._drawCurve(canvas, name, null);
                this._anim = null;
                return;
            }
            this._drawCurve(canvas, name, t);
            this._anim.raf = requestAnimationFrame(step);
        };
        this._anim.raf = requestAnimationFrame(step);
    }

    _stop() {
        if (!this._anim) return;
        cancelAnimationFrame(this._anim.raf);
        this._drawCurve(this._anim.canvas, this._anim.name, null);
        this._anim = null;
    }
}
