// 预览区渲染：单行灯条 + 滚轮缩放（光标锚点）+ 右键平移 + 悬停 tooltip。
// 灯珠以「世界坐标」布局：第 i 颗占据 x∈[i*(W+spacing), +W]，y∈[-H/2, +H/2]。
// 屏幕 = 世界 * scale + (tx, ty)。
import { hsv2rgb, rgb2hsv, fmtRGB, fmtHSV, rgbToHex } from './color.js';
import { evalProp, cRound } from './model.js';

export class PreviewRenderer {
    constructor(canvas, getState, cb) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.getState = getState;      // () => { project, frame, selection, layout }
        this.cb = cb || {};            // { onSelect(i), onSectionChange(i, prop, value) }
        this.scale = 1;
        this.tx = 0; this.ty = 0;
        this.hover = null;             // { index, x, y } 屏幕坐标
        this.dragging = false;
        this._drag = null;             // 分段拖动状态 {kind:'move'|'resizeStart'|'resizeEnd', ...}
        this._hoverHandle = null;      // 'start' | 'end' | null
        this._hoverShadow = null;      // 'front' | 'back' | null
        this._stripDrag = null;        // 灯带拉伸状态 {startLength, startX, scale, pitch}
        this._hoverStripHandle = false;
        this._hoverLed = null;           // 当前悬停的灯珠下标（端点高亮/图标提示用）
        this._hoverEndpoint = null;      // 悬停端点键（'body-start' 等）或 null

        this.tooltip = document.createElement('div');
        this.tooltip.className = 'preview-tooltip';
        this.tooltip.style.cssText = 'position:absolute;display:none;pointer-events:none;z-index:50;';
        canvas.parentElement.appendChild(this.tooltip);

        this._bind();
    }

    get layout() { return this.getState().layout; }

    // 灯珠在屏幕上的位置
    ledScreenRect(i) {
        const { ledW, ledH, spacing } = this.layout;
        const x0 = i * (ledW + spacing);
        const y0 = -ledH / 2;
        return {
            x: x0 * this.scale + this.tx,
            y: y0 * this.scale + this.ty,
            w: ledW * this.scale,
            h: ledH * this.scale,
        };
    }

    screenToWorld(sx, sy) {
        return { x: (sx - this.tx) / this.scale, y: (sy - this.ty) / this.scale };
    }

    fit() {
        const { project, layout } = this.getState();
        const n = Math.max(1, project.strip.length);
        const totalW = n * (layout.ledW + layout.spacing) - layout.spacing;
        const pad = 40;
        const w = this.canvas.clientWidth || this.canvas.width;
        const h = this.canvas.clientHeight || this.canvas.height;
        this.scale = Math.min((w - pad * 2) / totalW, 6);
        this.scale = Math.max(0.2, Math.min(this.scale, 20));
        this.tx = (w - totalW * this.scale) / 2;
        this.ty = h / 2;
        this.render();
    }

    render() {
        const ctx = this.ctx;
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.clientWidth || this.canvas.width;
        const h = this.canvas.clientHeight || this.canvas.height;
        if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
            this.canvas.width = w * dpr;
            this.canvas.height = h * dpr;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const { project, frame } = this.getState();
        const px = this.getState().framePixels; // computeFrame(project, frame)
        const n = px ? px.length : 0;
        const { ledW, ledH, spacing } = this.layout;
        // 「播放时隐藏灯带 UI」：勾选且播放中时不绘制分段框/handle/端点图标/灯珠序号
        const hideUi = !!(this.getState().hideUiWhenPlaying && this.getState().playing);

        // 背景网格（世界坐标）
        this._drawGrid(w, h);

        for (let i = 0; i < n; i++) {
            const r = this.ledScreenRect(i);
            const col = px[i];
            // null = 未被分段/阴影覆盖（或未计算出颜色）→ 纯黑（与真实灯珠灭灯一致）；
            // 仅保留极淡描边示意灯珠位置，其余按实际颜色绘制（含 v=0 的纯黑）
            const lit = col !== null;
            const [rr, gg, bb] = col || [0, 0, 0];
            ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
            ctx.strokeStyle = lit ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            const rad = Math.min(3 * this.scale, ledH * this.scale * 0.3);
            this._roundRect(ctx, r.x, r.y, r.w, r.h, rad);
            ctx.fill();
            ctx.stroke();

            // 灯珠序号（0 计数）：间距足够时绘制在灯珠下方，小字号、留出间隔、弱化不抢注意力
            const pitch = ledW + spacing;
            if (!hideUi && pitch * this.scale >= 14) {
                ctx.fillStyle = 'rgba(255,255,255,0.28)';
                ctx.font = `${Math.max(7, Math.round(7 * this.scale))}px ui-monospace,Consolas,monospace`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(String(i), r.x + r.w / 2, r.y + r.h + 5);
            }
        }
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';

        if (!hideUi) {
            this._drawSectionOverlay(ctx, frame);
            this._drawStripHandle(ctx);
            this._drawEndpointIcons(ctx, frame);
            this._drawEndpointHover(ctx);
        }
    }

    _drawGrid(w, h) {
        const ctx = this.ctx;
        const step = 40;
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        const startX = this.screenToWorld(0, 0).x;
        const endX = this.screenToWorld(w, 0).x;
        const startY = this.screenToWorld(0, 0).y;
        const endY = this.screenToWorld(0, h).y;
        ctx.beginPath();
        for (let gx = Math.floor(startX / step) * step; gx <= endX; gx += step) {
            const sx = gx * this.scale + this.tx;
            ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
        }
        for (let gy = Math.floor(startY / step) * step; gy <= endY; gy += step) {
            const sy = gy * this.scale + this.ty;
            ctx.moveTo(0, sy); ctx.lineTo(w, sy);
        }
        ctx.stroke();
    }

    _roundRect(ctx, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    _ledAt(sx, sy) {
        const { project, layout } = this.getState();
        const n = project.strip.length;
        const wl = this.screenToWorld(sx, sy);
        const pitch = layout.ledW + layout.spacing;
        const i = Math.floor(wl.x / pitch);
        if (i < 0 || i >= n) return null;
        const r = this.ledScreenRect(i);
        if (sx < r.x || sx > r.x + r.w || sy < r.y || sy > r.y + r.h) return null;
        return i;
    }

    // ---------- 分段拖动 / 调长度 ----------

    // 选中分段在当前帧的屏幕范围（body 带 + 两端 + 前后阴影外缘）
    _sectionMetrics(sec, frame) {
        const { layout } = this.getState();
        const pitch = layout.ledW + layout.spacing;
        const x = evalProp(sec, 'x', frame);
        const len = evalProp(sec, 'len', frame);
        const shadowFront = evalProp(sec, 'shadowFront', frame);
        const shadowBack = evalProp(sec, 'shadowBack', frame);
        const xi = cRound(x);                 // 首个渲染 LED 下标
        const n = Math.max(1, cRound(len));   // 渲染 LED 数量
        const frontCount = Math.max(0, cRound(shadowFront));
        const backCount = Math.max(0, cRound(shadowBack));
        const leftWorld = xi * pitch;
        const rightWorld = (xi + n - 1) * pitch + layout.ledW;  // 含最后一颗 LED 宽度
        const frontWorld = (xi - frontCount) * pitch;           // 前阴影最外缘
        const backWorld = (xi + n + backCount - 1) * pitch + layout.ledW;  // 后阴影最外缘
        const sxScreen = leftWorld * this.scale + this.tx;
        const exScreen = rightWorld * this.scale + this.tx;
        const frontScreen = frontWorld * this.scale + this.tx;
        const backScreen = backWorld * this.scale + this.tx;
        const halfH = Math.max(14, layout.ledH * this.scale * 0.5 + 8);
        return { x, len, pitch, xi, n, frontCount, backCount,
            sxScreen, exScreen, frontScreen, backScreen,
            y0: this.ty - halfH, y1: this.ty + halfH };
    }

    _handleAt(mx, my) {
        const st = this.getState();
        const sec = st.project.sections[st.selection];
        if (!sec) return null;
        const m = this._sectionMetrics(sec, st.frame);
        const hw = 9, hh = 30;
        if (my < this.ty - hh || my > this.ty + hh) return null;
        if (Math.abs(mx - m.sxScreen) <= hw) return 'start';
        if (Math.abs(mx - m.exScreen) <= hw) return 'end';
        return null;
    }

    // 前/后阴影长度 handle（均在下方，前、后屏幕 x 不同故互不重叠）
    _shadowHandleAt(mx, my) {
        const st = this.getState();
        const sec = st.project.sections[st.selection];
        if (!sec) return null;
        const m = this._sectionMetrics(sec, st.frame);
        const dy = 36, hw = 8, hh = 7;
        if (my < this.ty + dy - hh || my > this.ty + dy + hh) return null;
        if (Math.abs(mx - m.frontScreen) <= hw) return 'front';
        if (Math.abs(mx - m.backScreen) <= hw) return 'back';
        return null;
    }

    // 命中最上层分段（后绘制者优先），返回下标；无命中返回 -1
    _bodyHit(mx, my) {
        const st = this.getState();
        for (let i = st.project.sections.length - 1; i >= 0; i--) {
            const m = this._sectionMetrics(st.project.sections[i], st.frame);
            if (mx >= m.sxScreen && mx <= m.exScreen && my >= m.y0 && my <= m.y1) return i;
        }
        return -1;
    }

    // 某灯珠下标是否为该分段的可编辑端点（主体首/末、前/后阴影末端）
    _sectionEndpoint(sec, frame, ledIdx) {
        const x = evalProp(sec, 'x', frame);
        const lenV = evalProp(sec, 'len', frame);
        const shadowFront = evalProp(sec, 'shadowFront', frame);
        const shadowBack = evalProp(sec, 'shadowBack', frame);
        const xi = cRound(x);
        const n = Math.max(1, cRound(lenV));
        const frontCount = Math.max(0, cRound(shadowFront));
        const backCount = Math.max(0, cRound(shadowBack));
        if (ledIdx === xi) return 'body-start';
        if (ledIdx === xi + n - 1) return 'body-end';
        if (frontCount > 0 && ledIdx === xi - frontCount) return 'front-end';
        if (backCount > 0 && ledIdx === xi + n + backCount - 1) return 'back-end';
        return null;
    }

    // 命中最上层分段的端点灯珠，返回 { index, endpoint } 或 null
    _endpointAt(mx, my) {
        const st = this.getState();
        const idx = this._ledAt(mx, my);
        if (idx === null) return null;
        for (let i = st.project.sections.length - 1; i >= 0; i--) {
            const ep = this._sectionEndpoint(st.project.sections[i], st.frame, idx);
            if (ep) return { index: i, endpoint: ep };
        }
        return null;
    }

    // 悬停可点击端点灯珠：一圈亮色描边（轻微悬停样式，任何分段端点均可）
    _drawEndpointHover(ctx) {
        if (this._hoverEndpoint === null || this._hoverLed === null) return;
        const r = this.ledScreenRect(this._hoverLed);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        const g = 2;
        this._roundRect(ctx, r.x - g, r.y - g, r.w + g * 2, r.h + g * 2, 4 * this.scale);
        ctx.stroke();
    }

    // 选中分段各端点灯珠 { idx, endpoint }
    _endpointLeds(sec, frame) {
        const x = evalProp(sec, 'x', frame);
        const lenV = evalProp(sec, 'len', frame);
        const sf = evalProp(sec, 'shadowFront', frame);
        const sb = evalProp(sec, 'shadowBack', frame);
        const xi = cRound(x);
        const n = Math.max(1, cRound(lenV));
        const frontCount = Math.max(0, cRound(sf));
        const backCount = Math.max(0, cRound(sb));
        const out = [];
        out.push({ idx: xi, endpoint: 'body-start' });
        if (n > 1) out.push({ idx: xi + n - 1, endpoint: 'body-end' });
        if (frontCount > 0) out.push({ idx: xi - frontCount, endpoint: 'front-end' });
        if (backCount > 0) out.push({ idx: xi + n + backCount - 1, endpoint: 'back-end' });
        return out;
    }

    // 端点灯珠：头顶位置小图标 + 悬停轻微高亮（仅选中分段）
    _drawEndpointIcons(ctx, frame) {
        const st = this.getState();
        const sec = st.project.sections[st.selection];
        if (!sec) return;
        const eps = this._endpointLeds(sec, frame);
        const size = 5;
        for (const ep of eps) {
            const r = this.ledScreenRect(ep.idx);
            const cx = r.x + r.w / 2;
            // 头顶倒三角小图标（指向灯珠，颜色表端点类型）
            const yTop = r.y - size - 3;
            ctx.fillStyle = '#4d9fff';   // 端点图标统一主强调色
            ctx.beginPath();
            ctx.moveTo(cx, yTop + size);
            ctx.lineTo(cx - size, yTop);
            ctx.lineTo(cx + size, yTop);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }

    _drawSectionOverlay(ctx, frame) {
        const st = this.getState();
        const sec = st.project.sections[st.selection];
        if (!sec) return;
        const m = this._sectionMetrics(sec, frame);

        // 前/后阴影范围（半透明底色，区分阴影与主体）
        if (m.frontCount > 0) {
            ctx.fillStyle = 'rgba(77,159,255,0.10)';
            ctx.fillRect(m.frontScreen, m.y0, m.sxScreen - m.frontScreen, m.y1 - m.y0);
        }
        if (m.backCount > 0) {
            ctx.fillStyle = 'rgba(77,159,255,0.10)';
            ctx.fillRect(m.exScreen, m.y0, m.backScreen - m.exScreen, m.y1 - m.y0);
        }

        // 选中分段虚线轮廓
        ctx.strokeStyle = 'rgba(77,159,255,0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(m.sxScreen, m.y0, m.exScreen - m.sxScreen, m.y1 - m.y0);
        ctx.setLineDash([]);

        // 长 handle：仅悬停两端或拖拽调长时显示
        const active = (which) =>
            this._hoverHandle === which ||
            (this._drag && this._drag.kind === (which === 'start' ? 'resizeStart' : 'resizeEnd'));
        const hw = 3, hh = 30;
        const handle = (x, hot) => {
            ctx.fillStyle = hot ? '#b388ff' : '#c9b0ff';
            ctx.fillRect(x - hw, this.ty - hh, hw * 2, hh * 2);
            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x - hw, this.ty - hh, hw * 2, hh * 2);
        };
        if (active('start')) handle(m.sxScreen, true);
        if (active('end')) handle(m.exScreen, true);

        // 阴影长度 handle（均在下方，颜色区分），始终显示以便从 0 拖出阴影
        const shadowHot = (which) =>
            this._hoverShadow === which ||
            (this._drag && this._drag.kind === (which === 'front' ? 'resizeFront' : 'resizeBack'));
        const sDy = 36, sW = 3, sH = 7;
        const shadowHandle = (x, y, hot, color) => {
            ctx.strokeStyle = 'rgba(255,255,255,0.18)';
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x, this.ty);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = hot ? '#b388ff' : color;
            ctx.fillRect(x - sW, y - sH, sW * 2, sH * 2);
            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x - sW, y - sH, sW * 2, sH * 2);
        };
        shadowHandle(m.frontScreen, this.ty + sDy, shadowHot('front'), '#c9b0ff');
        shadowHandle(m.backScreen, this.ty + sDy, shadowHot('back'), '#c9b0ff');
    }

    // ---------- 灯带拉伸（右端 handle 改变 strip.length） ----------

    _stripRightScreen() {
        const { project, layout } = this.getState();
        const pitch = layout.ledW + layout.spacing;
        const n = Math.max(1, project.strip.length | 0);
        const rightWorld = (n - 1) * pitch + layout.ledW;   // 最后一颗 LED 右边缘
        return rightWorld * this.scale + this.tx;
    }

    _stripHandleAt(mx, my) {
        const hw = 9, hh = 34;
        if (my < this.ty - hh || my > this.ty + hh) return false;
        return Math.abs(mx - this._stripRightScreen()) <= hw;
    }

    _drawStripHandle(ctx) {
        const x = this._stripRightScreen();
        const hw = 3, hh = 34;
        const hot = this._hoverStripHandle || this._stripDrag;
        ctx.fillStyle = hot ? '#b388ff' : 'rgba(179,136,255,0.55)';
        ctx.fillRect(x - hw, this.ty - hh, hw * 2, hh * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - hw, this.ty - hh, hw * 2, hh * 2);
    }

    _stripDragMove(ev) {
        if (!this._stripDrag) return;
        const rect = this.canvas.getBoundingClientRect();
        const mx = ev.clientX - rect.left;
        const d = this._stripDrag;
        const delta = (mx - d.startX) / d.scale / d.pitch;
        const n = Math.max(1, Math.min(1024, Math.round(d.startLength + delta)));
        if (this.cb.onStripLengthChange) this.cb.onStripLengthChange(n);
        this._showTextTip(`灯带长度: ${n}`, ev.clientX, ev.clientY);
    }

    _sectionMouseDown(ev) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
        const st = this.getState();

        // 灯带右端拉伸 handle
        if (this._stripHandleAt(mx, my)) {
            const pitch = st.layout.ledW + st.layout.spacing;
            this._stripDrag = { startLength: st.project.strip.length, startX: mx, scale: this.scale, pitch };
            return;
        }

        // 前/后阴影长度 handle
        const shadowHandle = this._shadowHandleAt(mx, my);
        if (shadowHandle) {
            const sec = st.project.sections[st.selection];
            const m = this._sectionMetrics(sec, st.frame);
            this._drag = {
                kind: shadowHandle === 'front' ? 'resizeFront' : 'resizeBack',
                index: st.selection,
                startX: mx, startXi: m.xi, startNi: m.n,
                startFront: m.frontCount, startBack: m.backCount,
                scale: this.scale, pitch: m.pitch,
            };
            return;
        }

        const handle = this._handleAt(mx, my);
        if (handle) {
            const sec = st.project.sections[st.selection];
            const m = this._sectionMetrics(sec, st.frame);
            this._drag = {
                kind: handle === 'start' ? 'resizeStart' : 'resizeEnd',
                index: st.selection,
                startX: mx, startXi: cRound(m.x), startNi: Math.max(1, cRound(m.len)),
                scale: this.scale, pitch: m.pitch,
            };
            return;
        }

        // 端点灯珠（首/末/阴影末端）→ 快捷面板
        const ep = this._endpointAt(mx, my);
        if (ep) {
            if (this.cb.onSelect && ep.index !== st.selection) this.cb.onSelect(ep.index);
            if (this.cb.onEndpointEdit) this.cb.onEndpointEdit(ep.index, ep.endpoint, mx, my);
            return;
        }

        const hit = this._bodyHit(mx, my);
        if (hit >= 0) {
            if (this.cb.onSelect && hit !== st.selection) this.cb.onSelect(hit);
            const sec = st.project.sections[hit];
            const m = this._sectionMetrics(sec, st.frame);
            this._drag = {
                kind: 'move',
                index: hit,
                startX: mx, startXi: cRound(m.x), startNi: Math.max(1, cRound(m.len)),
                scale: this.scale, pitch: m.pitch,
            };
            return;
        }

        // 空白处左键拖动 = 平移（与右键一致）
        this.dragging = true;
        this._lastX = ev.clientX; this._lastY = ev.clientY;
        this.canvas.style.cursor = 'grabbing';
    }

    _sectionDrag(ev) {
        if (!this._drag) return;
        const rect = this.canvas.getBoundingClientRect();
        const mx = ev.clientX - rect.left;
        const d = this._drag;
        const delta = (mx - d.startX) / d.scale / d.pitch;   // LED 单位（浮点）
        const dI = Math.round(delta);                        // 对齐到整数 LED 步进
        let tip = '';
        if (d.kind === 'move') {
            const x = d.startXi + dI;
            this._emit(d.index, 'x', x);
            tip = `位置: ${x}`;
        } else if (d.kind === 'resizeEnd') {
            const len = Math.max(1, d.startNi + dI);
            this._emit(d.index, 'len', len);
            tip = `长度: ${len}`;
        } else if (d.kind === 'resizeFront') {
            // 前阴影向左延伸：向左拖（dI<0）增大长度
            const sf = Math.max(0, d.startFront - dI);
            this._emit(d.index, 'shadowFront', sf);
            tip = `前阴影长度: ${sf}`;
        } else if (d.kind === 'resizeBack') {
            // 后阴影向右延伸：向右拖（dI>0）增大长度
            const sb = Math.max(0, d.startBack + dI);
            this._emit(d.index, 'shadowBack', sb);
            tip = `后阴影长度: ${sb}`;
        } else { // resizeStart：右端固定，起点移动
            const right = d.startXi + d.startNi;             // 右端（LED 计数）不变
            let newXi = d.startXi + dI;
            if (newXi > right - 1) newXi = right - 1;        // 至少保留 1 颗
            const len = Math.max(1, right - newXi);
            this._emit(d.index, 'x', newXi);
            this._emit(d.index, 'len', len);
            tip = `起点: ${newXi} · 长度: ${len}`;
        }
        this._showTextTip(tip, ev.clientX, ev.clientY);
    }

    _emit(index, prop, value) {
        if (this.cb.onSectionChange) this.cb.onSectionChange(index, prop, value);
    }

    _bind() {
        const cv = this.canvas;
        cv.addEventListener('wheel', (ev) => {
            ev.preventDefault();
            const rect = cv.getBoundingClientRect();
            const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
            const before = this.screenToWorld(mx, my);
            const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
            this.scale = Math.min(20, Math.max(0.2, this.scale * factor));
            this.tx = mx - before.x * this.scale;
            this.ty = my - before.y * this.scale;
            this.render();
        }, { passive: false });

        cv.addEventListener('mousedown', (ev) => {
            if (ev.button === 2) {
                this.dragging = true;
                this._lastX = ev.clientX; this._lastY = ev.clientY;
                cv.style.cursor = 'grabbing';
                ev.preventDefault();
            } else if (ev.button === 0) {
                this._sectionMouseDown(ev);
            }
        });
        window.addEventListener('mousemove', (ev) => {
            if (this.dragging) {
                this.tx += ev.clientX - this._lastX;
                this.ty += ev.clientY - this._lastY;
                this._lastX = ev.clientX; this._lastY = ev.clientY;
                this.render();
                return;
            }
            if (this._stripDrag) { this._stripDragMove(ev); return; }
            if (this._drag) { this._sectionDrag(ev); return; }
            const rect = cv.getBoundingClientRect();
            const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;

            // 依次判定悬停目标（优先级：灯带拉伸 > 阴影长度 > 长 handle > 端点灯珠 > LED > body）
            const stripHandle = this._stripHandleAt(mx, my);
            const sh = stripHandle ? null : this._shadowHandleAt(mx, my);
            const handle = (stripHandle || sh !== null) ? null : this._handleAt(mx, my);
            const idx = (stripHandle || sh !== null || handle !== null) ? null : this._ledAt(mx, my);
            const epHit = (idx !== null) ? this._endpointAt(mx, my) : null;
            const epKey = epHit ? epHit.endpoint : null;

            // 统一提交悬停态（有变化才重绘）
            if (this._hoverStripHandle !== stripHandle ||
                this._hoverShadow !== sh ||
                this._hoverHandle !== handle ||
                this._hoverLed !== idx ||
                this._hoverEndpoint !== epKey) {
                this._hoverStripHandle = stripHandle;
                this._hoverShadow = sh;
                this._hoverHandle = handle;
                this._hoverLed = idx;
                this._hoverEndpoint = epKey;
                this.render();
            }

            // 0) 灯带右端拉伸 handle
            if (stripHandle) {
                this._showTextTip(`灯带长度: ${this.getState().project.strip.length}`, ev.clientX, ev.clientY);
                cv.style.cursor = 'ew-resize';
                return;
            }

            // 0.5) 前/后阴影长度 handle
            if (sh !== null) {
                const sst = this.getState();
                const ssec = sst.project.sections[sst.selection];
                const sm = ssec && this._sectionMetrics(ssec, sst.frame);
                const sname = sh === 'front' ? '前阴影长度' : '后阴影长度';
                const scount = sm ? (sh === 'front' ? sm.frontCount : sm.backCount) : 0;
                this._showTextTip(`${sname}: ${scount}`, ev.clientX, ev.clientY);
                cv.style.cursor = 'ew-resize';
                return;
            }

            // 1) 选中分段两端长 handle（调长度）
            if (handle !== null) {
                this._showTextTip(handle === 'start' ? '起点（拖动调整位置/长度）' : '终点（拖动调整长度）', ev.clientX, ev.clientY);
                cv.style.cursor = 'ew-resize';
                return;
            }

            // 2) LED 悬停 tooltip（端点可点击 → pointer；body 上可拖动 → move；body 外 → pointer）
            if (idx !== null) {
                cv.style.cursor = (epKey !== null || this._bodyHit(mx, my) < 0) ? 'pointer' : 'move';
                const px = this.getState().framePixels;
                this._showTooltip(idx, px[idx], ev.clientX, ev.clientY);
                return;
            }

            // 3) 分段 body 悬停（可拖动位置，未覆盖 LED tooltip）
            if (this._bodyHit(mx, my) >= 0) {
                this.tooltip.style.display = 'none';
                cv.style.cursor = 'move';
                return;
            }

            this.tooltip.style.display = 'none';
            cv.style.cursor = 'default';
        });
        window.addEventListener('mouseup', () => {
            if (this.dragging) { this.dragging = false; this.canvas.style.cursor = 'default'; }
            if (this._stripDrag) {
                this._stripDrag = null;
                this.tooltip.style.display = 'none';
                if (this._hoverStripHandle) { this._hoverStripHandle = false; this.render(); }
            }
            if (this._drag) {
                this._drag = null;
                this.tooltip.style.display = 'none';
                if (this._hoverHandle) { this._hoverHandle = null; this.render(); }
                if (this._hoverShadow) { this._hoverShadow = null; this.render(); }
            }
            if (this._hoverLed !== null) { this._hoverLed = null; this._hoverEndpoint = null; this.render(); }
        });
        cv.addEventListener('contextmenu', (ev) => ev.preventDefault());
        cv.addEventListener('mouseleave', () => {
            this.tooltip.style.display = 'none';
            if (this._hoverHandle !== null || this._hoverShadow !== null ||
                this._hoverStripHandle || this._hoverLed !== null) {
                this._hoverHandle = null;
                this._hoverShadow = null;
                this._hoverStripHandle = false;
                this._hoverLed = null;
                this._hoverEndpoint = null;
                this.render();
            }
        });
    }

    _showTooltip(idx, rgb, cx, cy) {
        let inner;
        if (rgb) {
            const [r, g, b] = rgb;
            const [h, s, v] = rgb2hsv(r, g, b);
            const hex = rgbToHex(r, g, b);
            inner = `
                <div class="tt-title">LED #${idx}</div>
                <div class="tt-row"><span class="tt-swatch" style="background:${hex}"></span>${hex.toUpperCase()}</div>
                <div class="tt-row">RGB ${fmtRGB(r, g, b)}</div>
                <div class="tt-row">HSV ${fmtHSV(h, s, v)}</div>`;
        } else {
            inner = `<div class="tt-title">LED #${idx}</div><div class="tt-row">未点亮</div>`;
        }
        this.tooltip.innerHTML = inner;
        this.tooltip.style.display = 'block';
        const rect = this.canvas.getBoundingClientRect();
        let left = cx - rect.left + 14, top = cy - rect.top + 14;
        const tw = this.tooltip.offsetWidth, th = this.tooltip.offsetHeight;
        if (left + tw > rect.width) left = cx - rect.left - tw - 8;
        if (top + th > rect.height) top = cy - rect.top - th - 8;
        this.tooltip.style.left = left + 'px';
        this.tooltip.style.top = top + 'px';
    }

    // 各类 handle 的悬停提示（纯文本单行）
    _showTextTip(text, cx, cy) {
        this.tooltip.innerHTML = `<div class="tt-title">${text}</div>`;
        this.tooltip.style.display = 'block';
        const rect = this.canvas.getBoundingClientRect();
        let left = cx - rect.left + 14, top = cy - rect.top + 14;
        const tw = this.tooltip.offsetWidth, th = this.tooltip.offsetHeight;
        if (left + tw > rect.width) left = cx - rect.left - tw - 8;
        if (top + th > rect.height) top = cy - rect.top - th - 8;
        this.tooltip.style.left = left + 'px';
        this.tooltip.style.top = top + 'px';
    }
}
