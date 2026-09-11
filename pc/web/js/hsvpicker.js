// 自定义 HSV 取色器：色相条 + 饱和度/明度方块，联动 RGB。
// 输出/输入均为 [h(0..360), s(0..100), v(0..100)]。
import { hsv2rgb, rgb2hsv, rgbToHex } from './color.js';

const STYLE = `
.beshell-hsvpick{display:inline-flex;gap:8px;align-items:flex-start;padding:4px;
  background:var(--bg2,#1b1f27);border:1px solid var(--border,#333a45);border-radius:8px;
  font:12px/1.4 var(--mono,ui-monospace,Consolas,monospace);user-select:none}
.beshell-hsvpick .sv{position:relative;width:180px;height:120px;cursor:crosshair;
  border-radius:4px;overflow:hidden;border:1px solid var(--border,#333a45)}
.beshell-hsvpick .sv .dot{position:absolute;width:8px;height:8px;margin:-4px 0 0 -4px;
  border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 1px #0008;pointer-events:none}
.beshell-hsvpick .hue{position:relative;width:18px;height:120px;cursor:ns-resize;
  border-radius:4px;border:1px solid var(--border,#333a45)}
.beshell-hsvpick .hue .dot{position:absolute;left:-2px;width:22px;height:5px;margin-top:-2px;
  border:1px solid #fff;border-radius:2px;box-shadow:0 0 0 1px #0008;pointer-events:none}
.beshell-hsvpick .vals{display:flex;flex-direction:column;gap:3px;min-width:76px}
.beshell-hsvpick .vals label{display:flex;align-items:center;gap:4px;color:var(--fg2,#9aa4b2)}
.beshell-hsvpick .vals input{width:44px;background:var(--bg,#11141a);color:var(--fg,#e6e9ef);
  border:1px solid var(--border,#333a45);border-radius:3px;padding:1px 3px;font:inherit}
.beshell-hsvpick .vals .sw{width:100%;height:18px;border-radius:3px;border:1px solid var(--border,#333a45)}
.beshell-hsvpick .vals .hex{width:70px}
`;

let _styleInjected = false;
function ensureStyle() {
    if (_styleInjected) return;
    const styleEl = document.createElement('style');
    styleEl.textContent = STYLE;
    document.head.appendChild(styleEl);
    _styleInjected = true;
}

export class HSVPicker {
    constructor(container, onChange) {
        this.onChange = onChange || (() => {});
        this.h = 0; this.s = 100; this.v = 100;
        ensureStyle();
        this.root = document.createElement('div');
        this.root.className = 'beshell-hsvpick';
        container.appendChild(this.root);

        this.root.innerHTML = `
            <div class="sv"><div class="dot"></div></div>
            <div class="hue"><div class="dot"></div></div>
            <div class="vals">
                <label>H<input type="number" min="0" max="360" step="1"></label>
                <label>S<input type="number" min="0" max="100" step="1"></label>
                <label>V<input type="number" min="0" max="100" step="1"></label>
                <label>R<input type="number" min="0" max="255" step="1"></label>
                <label>G<input type="number" min="0" max="255" step="1"></label>
                <label>B<input type="number" min="0" max="255" step="1"></label>
                <div class="sw"></div>
                <input class="hex" type="text" spellcheck="false">
            </div>`;
        this.sv = this.root.querySelector('.sv');
        this.svDot = this.root.querySelector('.sv .dot');
        this.hue = this.root.querySelector('.hue');
        this.hueDot = this.root.querySelector('.hue .dot');
        this.sw = this.root.querySelector('.sw');
        const inputs = this.root.querySelectorAll('.vals input');
        this.inH = inputs[0]; this.inS = inputs[1]; this.inV = inputs[2];
        this.inR = inputs[3]; this.inG = inputs[4]; this.inB = inputs[5];
        this.hex = this.root.querySelector('.hex');

        this._bind();
        this._setHueGradient();
        this.set(this.h, this.s, this.v, true);
    }

    _setHueGradient() {
        this.hue.style.background =
            'linear-gradient(to bottom, #f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)';
    }

    set(h, s, v, silent) {
        h = ((h % 360) + 360) % 360;
        s = Math.min(100, Math.max(0, s));
        v = Math.min(100, Math.max(0, v));
        this.h = h; this.s = s; this.v = v;
        this._update();
        if (!silent) this.onChange(this.h, this.s, this.v);
    }

    _update() {
        const [r, g, b] = hsv2rgb(this.h, 100, 100);
        this.sv.style.background =
            `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,rgb(${r},${g},${b}))`;
        this.svDot.style.left = this.s + '%';
        this.svDot.style.top = (100 - this.v) + '%';
        this.hueDot.style.top = ((this.h / 360) * 100) + '%';
        const [rr, gg, bb] = hsv2rgb(this.h, this.s, this.v);
        this.sw.style.background = `rgb(${rr},${gg},${bb})`;
        this.inH.value = Math.round(this.h);
        this.inS.value = Math.round(this.s);
        this.inV.value = Math.round(this.v);
        this.inR.value = rr; this.inG.value = gg; this.inB.value = bb;
        this.hex.value = rgbToHex(rr, gg, bb);
    }

    _bind() {
        const pickSV = (ev) => {
            const rect = this.sv.getBoundingClientRect();
            let x = (ev.clientX - rect.left) / rect.width;
            let y = (ev.clientY - rect.top) / rect.height;
            x = Math.min(1, Math.max(0, x));
            y = Math.min(1, Math.max(0, y));
            this.set(this.h, x * 100, (1 - y) * 100);
        };
        this.sv.addEventListener('mousedown', (ev) => {
            pickSV(ev);
            const mm = (e) => pickSV(e);
            const up = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', up); };
            window.addEventListener('mousemove', mm);
            window.addEventListener('mouseup', up);
        });
        const pickHue = (ev) => {
            const rect = this.hue.getBoundingClientRect();
            let y = (ev.clientY - rect.top) / rect.height;
            y = Math.min(1, Math.max(0, y));
            this.set(y * 360, this.s, this.v);
        };
        this.hue.addEventListener('mousedown', (ev) => {
            pickHue(ev);
            const mm = (e) => pickHue(e);
            const up = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', up); };
            window.addEventListener('mousemove', mm);
            window.addEventListener('mouseup', up);
        });

        const num = (inp, get, set) => {
            inp.addEventListener('change', () => {
                const v = parseFloat(inp.value);
                if (isNaN(v)) { this._update(); return; }
                set(v);
                this._update();
                this.onChange(this.h, this.s, this.v);
            });
        };
        num(this.inH, null, (v) => this.h = v);
        num(this.inS, null, (v) => this.s = v);
        num(this.inV, null, (v) => this.v = v);
        this.inR.addEventListener('change', () => this._fromRGB());
        this.inG.addEventListener('change', () => this._fromRGB());
        this.inB.addEventListener('change', () => this._fromRGB());
        this.hex.addEventListener('change', () => {
            const m = /^#?([0-9a-f]{6})$/i.exec(this.hex.value.trim());
            if (!m) { this._update(); return; }
            const n = parseInt(m[1], 16);
            this._applyRGB([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
        });
    }

    _fromRGB() {
        this._applyRGB([+this.inR.value, +this.inG.value, +this.inB.value]);
    }

    _applyRGB([r, g, b]) {
        if (isNaN(r) || isNaN(g) || isNaN(b)) { this._update(); return; }
        const [h, s, v] = rgb2hsv(Math.min(255, Math.max(0, r)), Math.min(255, Math.max(0, g)), Math.min(255, Math.max(0, b)));
        this.set(h, s, v);
    }

    destroy() { this.root.remove(); }
}
