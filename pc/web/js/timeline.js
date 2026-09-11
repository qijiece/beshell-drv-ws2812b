// 时间轴：刻度尺 + 帧动作 lane + 每分段一条 lane（关键帧菱形标记）+ 播放头。
// 交互：左键拖动 scrub；滚轮横向滚动；Ctrl+滚轮 缩放（光标锚点）。
// 悬停 tooltip：第几帧 / 按 fps 算出的时间 / 若为关键帧则列出「哪些段落的哪些属性」。
import { keyframesAt, endFrame, frameToMs, isKeyframeAt, NUM_PROPS, keyframesOf } from './model.js';

const RULER_H = 32;
const RULER_SPLIT = 16;   // 刻度尺上下分界：上半帧序号 / 下半秒
const ACT_H = 16;
const LANE_H = 24;
const PAD_LEFT = 120;

export class TimelineView {
    constructor(container, getState, cb) {
        this.getState = getState;   // () => { project, frame }
        this.cb = cb || {};
        this.pxPerFrame = 8;
        this.scrollX = 0;
        this.playing = false;
        this._raf = null;
        this._lastTick = 0;
        this._repeatRemaining = -1;   // 预览循环剩余次数（-1=无限）
        this._hoverFrame = null;      // 悬停帧竖线（帧对齐）

        this.root = container;
        this._buildDOM();
        this._bind();
        this.render();
    }

    _buildDOM() {
        this.root.classList.add('timeline');
        this.root.innerHTML = `
            <div class="tl-toolbar">
                <button class="tbtn" data-act="start" title="回到首帧">⏮</button>
                <button class="tbtn" data-act="stepBack" title="上一帧">◀</button>
                <button class="tbtn primary" data-act="play" title="播放/暂停">▶</button>
                <button class="tbtn" data-act="stepFwd" title="下一帧">▶</button>
                <button class="tbtn" data-act="end" title="跳到末帧">⏭</button>
                <label class="tl-field" title="循环重播：播完回到首帧"><input type="checkbox" id="tl-repeat"> 循环</label>
                <label class="tl-field" id="tl-repeat-count-wrap" title="重播次数（额外重播 N 次，总播放 = N+1；留空 = 无限循环）">次数 <input type="number" id="tl-repeat-count" min="0" step="1" placeholder="∞"></label>
                <label class="tl-field">fps <input type="number" id="tl-fps" min="1" max="240" step="1"></label>
                <label class="tl-field" title="动画时长（秒，支持小数）；清空/留空为自动">时长(秒) <input type="number" id="tl-length" min="0" step="0.1" placeholder="自动"></label>
                <button class="tbtn" data-act="zoomOut" title="缩小时间轴（Ctrl＋−）">缩小</button>
                <button class="tbtn" data-act="zoomIn" title="放大时间轴（Ctrl＋＝）">放大</button>
                <span class="tl-info" id="tl-info"></span>
            </div>
            <canvas class="tl-canvas"></canvas>`;
        this.canvas = this.root.querySelector('.tl-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.fpsInput = this.root.querySelector('#tl-fps');
        this.lenInput = this.root.querySelector('#tl-length');
        this.info = this.root.querySelector('#tl-info');
        this.repeatInput = this.root.querySelector('#tl-repeat');
        this.repeatCountInput = this.root.querySelector('#tl-repeat-count');
        this.repeatCountWrap = this.root.querySelector('#tl-repeat-count-wrap');

        this.tooltip = document.createElement('div');
        this.tooltip.className = 'tl-tooltip';
        this.tooltip.style.cssText = 'position:absolute;display:none;pointer-events:none;z-index:50;';
        this.root.appendChild(this.tooltip);

        // 初始时：自动适配宽度
        this._autoFit = true;
    }

    _bind() {
        this.root.querySelectorAll('.tbtn').forEach(btn => {
            btn.addEventListener('click', () => this._act(btn.dataset.act));
        });
        this.fpsInput.addEventListener('change', () => {
            const v = Math.max(1, Math.min(240, parseInt(this.fpsInput.value) || 60));
            this.fpsInput.value = v;
            if (this.cb.onFpsChange) this.cb.onFpsChange(v);
        });
        this.lenInput.addEventListener('change', () => {
            const { project } = this.getState();
            const raw = this.lenInput.value.trim();
            if (raw === '') {
                if (this.cb.onLengthChange) this.cb.onLengthChange(0);  // 清空 = 自动
                return;
            }
            const secs = parseFloat(raw);
            if (isNaN(secs)) { this.render(); return; }
            const frames = Math.max(0, Math.round(secs * project.fps));
            if (this.cb.onLengthChange) this.cb.onLengthChange(frames);
        });
        this.repeatInput.addEventListener('change', () => {
            const { project } = this.getState();
            project.repeat = this.repeatInput.checked;
            this.render();
        });
        this.repeatCountInput.addEventListener('change', () => {
            const { project } = this.getState();
            const raw = this.repeatCountInput.value.trim();
            project.repeatCount = raw === '' ? -1 : Math.max(0, parseInt(raw, 10) || 0);
            this.render();
        });

        const cv = this.canvas;
        cv.addEventListener('wheel', (ev) => {
            ev.preventDefault();
            const rect = cv.getBoundingClientRect();
            const mx = ev.clientX - rect.left;
            if (ev.ctrlKey) {
                const anchor = this._xToFrame(mx);
                const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
                this.pxPerFrame = Math.min(120, Math.max(1, this.pxPerFrame * factor));
                this._autoFit = false;
                this.scrollX = PAD_LEFT + anchor * this.pxPerFrame - mx;
            } else {
                this.scrollX += ev.deltaY;
                this._autoFit = false;
            }
            this.render();
        }, { passive: false });

        // 左键：关键帧上按下 = 拖动移动；否则 scrub。右键：删除关键帧。
        this._drag = null;   // null | {type:'scrub'} | {type:'kf', si, from, cur}
        cv.addEventListener('mousedown', (ev) => {
            if (ev.button !== 0) return;
            this._hoverFrame = null;   // 拖动时隐藏悬停竖线
            const rect = cv.getBoundingClientRect();
            const hit = this._keyframeHit(ev.clientX - rect.left, ev.clientY - rect.top);
            if (hit) {
                this._drag = { type: 'kf', si: hit.si, from: hit.frame, cur: hit.frame };
                this.canvas.style.cursor = 'grabbing';
                this.render();
            } else {
                this._drag = { type: 'scrub' };
                this._scrubTo(ev);
            }
        });
        window.addEventListener('mousemove', (ev) => {
            if (!this._drag) { this._hover(ev); return; }
            if (this._drag.type === 'scrub') { this._scrubTo(ev); return; }
            // 拖动关键帧：该分段在此帧的全部关键帧一起平移（增量源 = 当前所在帧）
            const rect = cv.getBoundingClientRect();
            const f = Math.max(0, Math.round(this._xToFrame(ev.clientX - rect.left)));
            if (f !== this._drag.cur && this.cb.onMoveKeyframe) {
                const from = this._drag.cur;
                this._drag.cur = f;   // 先更新，重绘时高亮才能跟随到新帧
                this.cb.onMoveKeyframe(this._drag.si, from, f);
            }
        });
        window.addEventListener('mouseup', () => {
            if (this._drag) {
                this._drag = null;
                this.canvas.style.cursor = 'default';
                this.render();
            }
        });
        cv.addEventListener('mouseleave', () => {
            this.tooltip.style.display = 'none';
            if (this._hoverKF || this._hoverFrame != null) {
                this._hoverKF = null;
                this._hoverFrame = null;
                this.render();
            }
        });
        cv.addEventListener('contextmenu', (ev) => {
            const rect = cv.getBoundingClientRect();
            const hit = this._keyframeHit(ev.clientX - rect.left, ev.clientY - rect.top);
            if (hit) {
                ev.preventDefault();
                if (this.cb.onDeleteKeyframe) this.cb.onDeleteKeyframe(hit.si, hit.frame);
            }
        });

        // 缩放快捷键：Ctrl+＝ 放大，Ctrl+− 缩小（输入框聚焦时不拦截）
        window.addEventListener('keydown', (ev) => {
            if (!(ev.ctrlKey || ev.metaKey)) return;
            const tag = ev.target && ev.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            if (ev.key === '=' || ev.key === '+') { ev.preventDefault(); this._zoom(1.25); }
            else if (ev.key === '-') { ev.preventDefault(); this._zoom(1 / 1.25); }
        });
    }

    _scrubTo(ev) {
        const rect = this.canvas.getBoundingClientRect();
        const f = Math.max(0, Math.round(this._xToFrame(ev.clientX - rect.left)));
        if (this.cb.onScrub) this.cb.onScrub(f);
    }

    _xToFrame(x) { return (x - PAD_LEFT + this.scrollX) / this.pxPerFrame; }
    _frameToX(f) { return PAD_LEFT + f * this.pxPerFrame - this.scrollX; }

    _act(a) {
        const { project, frame } = this.getState();
        const end = endFrame(project);
        switch (a) {
            case 'start': this.cb.onScrub && this.cb.onScrub(0); break;
            case 'end': this.cb.onScrub && this.cb.onScrub(end); break;
            case 'stepBack': this.cb.onScrub && this.cb.onScrub(Math.max(0, frame - 1)); break;
            case 'stepFwd': this.cb.onScrub && this.cb.onScrub(Math.min(end, frame + 1)); break;
            case 'play': this._togglePlay(); break;
            case 'zoomIn': this._zoom(1.25); break;
            case 'zoomOut': this._zoom(1 / 1.25); break;
        }
    }

    // 以画布中心为锚缩放（与 Ctrl+滚轮一致的能力，提供按键入口）
    _zoom(factor) {
        const rect = this.canvas.getBoundingClientRect();
        const cx = rect.width / 2;
        const anchor = this._xToFrame(cx);
        this.pxPerFrame = Math.min(120, Math.max(1, this.pxPerFrame * factor));
        this._autoFit = false;
        this.scrollX = PAD_LEFT + anchor * this.pxPerFrame - cx;
        this.render();
    }

    _togglePlay() {
        this.playing = !this.playing;
        this.root.querySelector('[data-act="play"]').textContent = this.playing ? '⏸' : '▶';
        if (this.playing) {
            const { project, frame } = this.getState();
            // 停在最后一帧（或之后）时，直接从第一帧开始播放
            if (frame >= endFrame(project)) this.cb.onScrub && this.cb.onScrub(0);
            this._repeatRemaining = project.repeatCount;
            this._lastTick = performance.now();
            this._stepPlay();
        } else if (this._raf) {
            cancelAnimationFrame(this._raf);
            this._raf = null;
        }
    }

    _stepPlay = () => {
        if (!this.playing) return;
        const now = performance.now();
        const dt = now - this._lastTick;
        const { project, frame } = this.getState();
        const msPerFrame = 1000 / project.fps;
        if (dt >= msPerFrame) {
            this._lastTick = now;
            const end = endFrame(project);
            let nf = frame + 1;
            if (nf > end) {
                if (project.repeat && this._repeatRemaining !== 0) {
                    if (this._repeatRemaining > 0) this._repeatRemaining--;
                    nf = 0;
                } else {
                    this._togglePlay();   // 不循环或重播次数用完：停在末帧
                    return;
                }
            }
            this.cb.onScrub && this.cb.onScrub(nf);
        }
        this._raf = requestAnimationFrame(this._stepPlay);
    };

    stop() {
        if (this.playing) this._togglePlay();
    }

    render() {
        const { project, frame } = this.getState();
        const end = endFrame(project);
        // 无限轴：铺满整个可见宽度；动画范围 [0,end] 与空轴以颜色深浅区分
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.clientWidth || this.canvas.width;
        const h = this.canvas.clientHeight || this.canvas.height;
        if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
            this.canvas.width = w * dpr;
            this.canvas.height = h * dpr;
        }
        const ctx = this.ctx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        if (this._autoFit) {
            this.pxPerFrame = Math.max(2, (w - PAD_LEFT - 20) / Math.max(1, Math.max(end, frame)));
            this.scrollX = 0;
            this._autoFit = false;   // 仅首次适配一次，之后不随内容自动缩放
        }

        // 动画结束帧的屏幕位置（缩放/滚动确定后计算）
        const endX = this._frameToX(end);

        const laneCount = project.sections.length;
        const totalH = RULER_H + ACT_H + laneCount * LANE_H;

        // 刻度尺（无限，铺满整个可见宽度）
        this._drawRuler(ctx, w, project);

        // 帧动作 lane
        this._drawActionLane(ctx, project, w);

        // 分段 lane
        project.sections.forEach((s, li) => {
            const y = RULER_H + ACT_H + li * LANE_H;
            this._drawLane(ctx, s, li, y, w);
        });

        // 空轴（动画结束之后）：半透明深色覆盖，与动画范围形成深浅对比
        if (endX < w) {
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fillRect(Math.max(PAD_LEFT, endX), 0, w - Math.max(PAD_LEFT, endX), Math.max(totalH, RULER_H));
        }

        // 动画结束标记：贯穿所有 lane 的虚线 + 顶端「结束」标签
        if (endX >= PAD_LEFT && endX <= w) {
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(endX, RULER_H); ctx.lineTo(endX, Math.max(totalH, RULER_H)); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.font = '10px ui-monospace,Consolas,monospace';
            ctx.textAlign = 'left';
            ctx.fillText('结束', endX + 4, RULER_SPLIT - 6);
            ctx.textAlign = 'start';
        }

        // 悬停帧竖线（帧对齐，随鼠标移动；播放头覆盖在其上）
        if (this._hoverFrame != null) {
            const hx = this._frameToX(this._hoverFrame);
            if (hx >= PAD_LEFT && hx <= w) {
                ctx.strokeStyle = 'rgba(255,255,255,0.32)';
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, Math.max(totalH, RULER_H)); ctx.stroke();
            }
        }

        // 播放头
        const px = this._frameToX(frame);
        if (px >= PAD_LEFT && px <= w) {
            ctx.strokeStyle = '#ff4d4f';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, Math.max(totalH, RULER_H)); ctx.stroke();
            // 顶三角
            ctx.fillStyle = '#ff4d4f';
            ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px - 5, 8); ctx.lineTo(px + 5, 8); ctx.closePath(); ctx.fill();
        }

        // 信息栏
        this.info.textContent = `帧 ${frame} / ${end} · ${frameToMs(project, frame).toFixed(1)} ms`;
        this.fpsInput.value = project.fps;
        this.repeatInput.checked = !!project.repeat;
        this.repeatCountInput.value = project.repeatCount < 0 ? '' : project.repeatCount;
        this.repeatCountInput.disabled = !project.repeat;
        this.repeatCountWrap.classList.toggle('disabled', !project.repeat);
        // 时长以秒显示（支持小数）；自动（frames=0）也显示 endFrame 算出的具体时间
        const effFrames = project.frames > 0 ? project.frames : end;
        this.lenInput.classList.toggle('auto', project.frames === 0);
        if (document.activeElement !== this.lenInput) {
            this.lenInput.value = (Math.round((effFrames / project.fps) * 1000) / 1000).toString();
        }
    }

    _drawRuler(ctx, w, project) {
        const fps = project.fps || 60;
        ctx.fillStyle = '#151920';
        ctx.fillRect(0, 0, w, RULER_H);
        ctx.font = '10px ui-monospace,Consolas,monospace';
        ctx.textAlign = 'center';

        const splitY = RULER_SPLIT;   // 上半：帧序号，下半：秒

        // 可见帧范围（无限轴，铺满整个宽度）
        const f0 = Math.max(0, Math.floor(this._xToFrame(PAD_LEFT)));
        const f1 = Math.ceil(this._xToFrame(w));

        // 上半：帧序号（步长随缩放自适应）
        const step = Math.max(1, Math.ceil(60 / this.pxPerFrame / 5));
        ctx.fillStyle = '#8b93a1';
        for (let f = Math.floor(f0 / step) * step; f <= f1; f += step) {
            const x = this._frameToX(f);
            if (x < PAD_LEFT - 10 || x > w) continue;
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.beginPath(); ctx.moveTo(x, splitY - 4); ctx.lineTo(x, splitY); ctx.stroke();
            ctx.fillText(f, x, splitY - 6);
        }

        // 下半：秒（0.5s 起，间距不足时按 1/2/5/10/30/60 放大）
        const secSteps = [0.5, 1, 2, 5, 10, 30, 60];
        let secStep = 60;
        for (const s of secSteps) {
            if (s * fps * this.pxPerFrame >= 28) { secStep = s; break; }
        }
        ctx.fillStyle = '#7c8695';
        for (let sec = Math.floor(f0 / fps / secStep) * secStep; sec * fps <= f1 + fps; sec += secStep) {
            const x = this._frameToX(sec * fps);
            if (x < PAD_LEFT - 6 || x > w) continue;
            ctx.strokeStyle = 'rgba(255,255,255,0.16)';
            ctx.beginPath(); ctx.moveTo(x, splitY); ctx.lineTo(x, splitY + 4); ctx.stroke();
            ctx.fillText(Number.isInteger(sec) ? String(sec) : sec.toFixed(1), x, RULER_H - 4);
        }

        ctx.textAlign = 'start';       // 恢复，避免影响 lane 名/动作文本
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.beginPath(); ctx.moveTo(0, splitY - 0.5); ctx.lineTo(w, splitY - 0.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, RULER_H - 0.5); ctx.lineTo(w, RULER_H - 0.5); ctx.stroke();
    }

    _drawActionLane(ctx, project, w) {
        const y = RULER_H;
        ctx.fillStyle = '#12161d';
        ctx.fillRect(0, y, w, ACT_H);
        ctx.fillStyle = '#6b7482';
        ctx.font = '10px ui-monospace,Consolas,monospace';
        ctx.fillText('动作', 6, y + 12);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.moveTo(0, y + ACT_H - 0.5); ctx.lineTo(w, y + ACT_H - 0.5); ctx.stroke();

        for (const a of project.frameActions) {
            const x = this._frameToX(a.frame);
            if (x < PAD_LEFT || x > w) continue;
            const hasJump = a.jumpTo >= 0, hasPlay = a.playTo >= 0;
            if (hasJump) { ctx.fillStyle = '#ff9800'; ctx.fillRect(x - 3, y + 3, 6, ACT_H - 6); }
            if (hasPlay) { ctx.fillStyle = '#00bcd4'; ctx.beginPath(); ctx.arc(x, y + ACT_H / 2, 3, 0, 7); ctx.fill(); }
            if (hasJump && hasPlay) { ctx.fillStyle = '#fff'; ctx.fillRect(x - 1, y + 3, 2, ACT_H - 6); }
        }
    }

    _drawLane(ctx, s, li, y, w) {
        ctx.fillStyle = li % 2 ? '#151a22' : '#181e27';
        ctx.fillRect(0, y, w, LANE_H);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.beginPath(); ctx.moveTo(0, y + LANE_H - 0.5); ctx.lineTo(w, y + LANE_H - 0.5); ctx.stroke();

        // 左列名字（sticky）
        ctx.fillStyle = '#c7cfda';
        ctx.font = '11px ui-monospace,Consolas,monospace';
        ctx.fillText(s.name, 6, y + 16);

        // 正在拖动 / 悬停的关键帧（选中 / 悬停样式）
        const draggingFrame =
            (this._drag && this._drag.type === 'kf' && this._drag.si === li) ? this._drag.cur : -1;
        const hoverFrame =
            (this._hoverKF && this._hoverKF.si === li) ? this._hoverKF.frame : -1;

        // 关键帧菱形（任一属性在该帧有关键帧；第 0 帧恒为关键帧=原点）
        const frames = new Set([0]);
        for (const p of NUM_PROPS) {
            for (const k of keyframesOf(s, p)) frames.add(k.frame);
        }
        for (const f of frames) {
            const x = this._frameToX(f);
            if (x < PAD_LEFT || x > w) continue;
            const state = f === draggingFrame ? 'selected' : (f === hoverFrame ? 'hover' : 'normal');
            this._drawKeyframe(ctx, x, y + LANE_H / 2, state);
        }
    }

    _drawKeyframe(ctx, x, cy, state) {
        const r = state === 'normal' ? 5 : 6;   // 悬停/选中略放大
        ctx.beginPath();
        ctx.moveTo(x, cy - r);
        ctx.lineTo(x + r, cy);
        ctx.lineTo(x, cy + r);
        ctx.lineTo(x - r, cy);
        ctx.closePath();
        if (state === 'selected') {
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.strokeStyle = '#b388ff';
            ctx.lineWidth = 2;
            ctx.stroke();
        } else {
            ctx.fillStyle = '#b388ff';
            ctx.fill();
            if (state === 'hover') {
                ctx.strokeStyle = 'rgba(255,255,255,0.9)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        }
    }

    _hover(ev) {
        const rect = this.canvas.getBoundingClientRect();
        const rootRect = this.root.getBoundingClientRect();
        const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
        // mousemove 绑定在 window 上，只在时间轴画布范围内显示 tooltip / 悬停竖线
        if (mx < 0 || my < 0 || mx > rect.width || my > rect.height) {
            this.tooltip.style.display = 'none';
            if (this._hoverKF || this._hoverFrame != null) {
                this._hoverKF = null;
                this._hoverFrame = null;
                this.render();
            }
            return;
        }

        const hit = this._keyframeHit(mx, my);
        const f = Math.round(this._xToFrame(mx));
        const hf = f >= 0 ? f : null;   // 悬停帧（帧对齐；左侧留白区不显示竖线）
        // 更新悬停的关键帧（菱形高亮）与悬停帧竖线，变化时重绘
        const hoverChanged =
            (!!hit !== !!this._hoverKF) ||
            (hit && this._hoverKF && (hit.si !== this._hoverKF.si || hit.frame !== this._hoverKF.frame)) ||
            (hf !== this._hoverFrame);
        if (hoverChanged) { this._hoverKF = hit; this._hoverFrame = hf; this.render(); }
        this.canvas.style.cursor = hit ? 'grab' : 'default';

        const { project } = this.getState();
        if (f < 0) { this.tooltip.style.display = 'none'; return; }

        const kfs = keyframesAt(project, f);
        const ms = frameToMs(project, f);
        let html = `<div class="tt-title">第 ${f} 帧 · ${ms.toFixed(1)} ms</div>`;
        if (kfs.length) {
            html += `<div class="tt-sub">关键帧（${kfs.length}）</div>`;
            for (const k of kfs) {
                html += `<div class="tt-row">${k.section.name}.${k.prop} = ${Number(k.value).toFixed(2)}</div>`;
            }
            html += `<div class="tt-hint">拖动移动 · 右键删除</div>`;
        }
        this.tooltip.innerHTML = html;
        this.tooltip.style.display = 'block';
        // 相对 #timeline（absolute 定位的祖先）定位
        let left = ev.clientX - rootRect.left + 14;
        let top = ev.clientY - rootRect.top + 14;
        if (left + this.tooltip.offsetWidth > rootRect.width) left = ev.clientX - rootRect.left - this.tooltip.offsetWidth - 8;
        this.tooltip.style.left = left + 'px';
        this.tooltip.style.top = top + 'px';
    }

    // 命中检测：返回指针下关键帧（该分段该帧的任一属性关键帧），否则 null
    _keyframeHit(mx, my) {
        const { project } = this.getState();
        const laneY0 = RULER_H + ACT_H;
        for (let si = 0; si < project.sections.length; si++) {
            const y = laneY0 + si * LANE_H;
            if (my < y || my >= y + LANE_H) continue;
            if (mx < PAD_LEFT) return null;
            const s = project.sections[si];
            const frames = new Set();
            for (const p of NUM_PROPS) for (const k of keyframesOf(s, p)) frames.add(k.frame);
            for (const f of frames) {
                const x = this._frameToX(f);
                if (Math.abs(mx - x) <= 7) return { si, frame: f };
            }
            return null;
        }
        return null;
    }
}
