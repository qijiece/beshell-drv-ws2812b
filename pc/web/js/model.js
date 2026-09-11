// 数据模型：Project / Section / Keyframe / FrameAction
// 插值规则镜像 Timeline.cpp Track::eval + ensureOrigin，
// 渲染镜像 Section.cpp drawTo（见 computeFrame，三种「过渡」结构一致）。
import { hsv2rgb } from './color.js';
import { ease } from './easing.js';

// Section 的可动画数值属性——「间补」属性。
// 4 色模型：前阴影起点=主体起点(h0)，后阴影起点=主体终点(h1)，不再有独立 frontH0/backH0。
export const NUM_PROPS = [
    "x", "len", "shadowFront", "shadowBack",
    "h0", "s0", "v0", "h1", "s1", "v1",
    "frontH1", "frontS1", "frontV1",
    "backH1", "backS1", "backV1",
];
// 静态缓动配置属性（Section.cpp easeProps）——「过渡」静态缓动
export const EASE_PROPS = [
    "easeH", "easeS", "easeV",
    "frontEaseH", "frontEaseS", "frontEaseV",
    "backEaseH", "backEaseS", "backEaseV",
];
// 静态缓动 S 参数（Back 系列 overshoot；仅 Back 缓动使用，其余忽略）
export const EASE_S_PROPS = [
    "easeHS", "easeSS", "easeVS",
    "frontEaseHS", "frontEaseSS", "frontEaseVS",
    "backEaseHS", "backEaseSS", "backEaseVS",
];
// 色相方向布尔属性（Section.cpp boolProps）
export const CCW_PROPS = ["h_ccw", "frontCcw", "backCcw"];
// 通道「启用」开关（仅前端预览控制渐变；序列化以保留用户开关状态，引擎/WASM 忽略该字段）
export const ENABLED_PROPS = [
    "hEnabled", "sEnabled", "vEnabled",
    "frontHEnabled", "frontSEnabled", "frontVEnabled",
    "backHEnabled", "backSEnabled", "backVEnabled",
];

// 三种渲染过渡，供 UI / 渲染统一遍历。
// 主体：起点 → 终点；前阴影：起点向前（索引减小）；后阴影：起点向后（索引增大）。
// 4 色模型：前阴影起点 = 主体起点（h0），后阴影起点 = 主体终点（h1），
// 因此 front/back 的 h0/s0/v0 别名到主体对应通道，ownStart=false 表示无独立起点色。
export const TRANSITIONS = [
    {
        key: 'body', label: '主体过渡', len: null, ownStart: true,
        h0: 'h0', s0: 's0', v0: 'v0', h1: 'h1', s1: 's1', v1: 'v1',
        easeH: 'easeH', easeS: 'easeS', easeV: 'easeV',
        easeHS: 'easeHS', easeSS: 'easeSS', easeVS: 'easeVS',
        hEn: 'hEnabled', sEn: 'sEnabled', vEn: 'vEnabled',
        ccw: 'h_ccw',
    },
    {
        key: 'front', label: '前阴影过渡', len: 'shadowFront', ownStart: false,
        h0: 'h0', s0: 's0', v0: 'v0', h1: 'frontH1', s1: 'frontS1', v1: 'frontV1',
        easeH: 'frontEaseH', easeS: 'frontEaseS', easeV: 'frontEaseV',
        easeHS: 'frontEaseHS', easeSS: 'frontEaseSS', easeVS: 'frontEaseVS',
        hEn: 'frontHEnabled', sEn: 'frontSEnabled', vEn: 'frontVEnabled',
        ccw: 'frontCcw',
    },
    {
        key: 'back', label: '后阴影过渡', len: 'shadowBack', ownStart: false,
        h0: 'h1', s0: 's1', v0: 'v1', h1: 'backH1', s1: 'backS1', v1: 'backV1',
        easeH: 'backEaseH', easeS: 'backEaseS', easeV: 'backEaseV',
        easeHS: 'backEaseHS', easeSS: 'backEaseSS', easeVS: 'backEaseVS',
        hEn: 'backHEnabled', sEn: 'backSEnabled', vEn: 'backVEnabled',
        ccw: 'backCcw',
    },
];

// 「启用」开关折叠映射：end → { start, en }。未启用时端点跟随起点，
// 使不含「启用」概念的引擎（C++/WASM/硬件）渲染结果与预览一致。
export const FOLD = (() => {
    const m = {};
    for (const tr of TRANSITIONS) {
        m[tr.h1] = { start: tr.h0, en: tr.hEn };
        m[tr.s1] = { start: tr.s0, en: tr.sEn };
        m[tr.v1] = { start: tr.v0, en: tr.vEn };
    }
    return m;
})();

// 未启用通道端点的最终跟随起点（级联解析，如 backH1 → h1 → h0）。
function foldSource(s, end) {
    const f = FOLD[end];
    if (!f || s[f.en]) return end;
    let src = f.start;
    while (FOLD[src] && !s[FOLD[src].en]) src = FOLD[src].start;
    return src;
}

// 可点击编辑的颜色端点（预览区首/末灯珠 → 快捷面板）。
// 4 色模型：起点=主体 h0，终点=主体 h1；前/后阴影终点各自独立。
// 键值与 render.js 命中结果对齐：body-start / body-end / front-end / back-end。
export const ENDPOINTS = {
    'body-start': { label: '起点色', h: 'h0', s: 's0', v: 'v0', tr: TRANSITIONS[0], role: 'start' },
    'body-end':   { label: '终点色', h: 'h1', s: 's1', v: 'v1', tr: TRANSITIONS[0], role: 'end' },
    'front-end':  { label: '前阴影终点', h: 'frontH1', s: 'frontS1', v: 'frontV1', tr: TRANSITIONS[1], role: 'end' },
    'back-end':   { label: '后阴影终点', h: 'backH1', s: 'backS1', v: 'backV1', tr: TRANSITIONS[2], role: 'end' },
};

// 与 C++ (int)(x+0.5) 等价的取整（trunc 向零）
export function cRound(v) { return Math.trunc(v + 0.5); }

let _idSeq = 0;
function nextId() { return 'sec-' + (++_idSeq); }

export function defaultSection() {
    return {
        id: nextId(),
        name: "Section",
        x: 0, len: 1,
        shadowFront: 0, shadowBack: 0,
        // 主体过渡：起点 → 终点（默认顺时针绕色相环一圈）
        h0: 0, s0: 100, v0: 100, h1: 360, s1: 100, v1: 100,
        easeH: "linear", easeS: "linear", easeV: "linear",
        easeHS: 1.70158, easeSS: 1.70158, easeVS: 1.70158,
        h_ccw: false,
        hEnabled: true, sEnabled: true, vEnabled: true,   // 各通道「启用」（仅前端预览生效，状态随配置持久化）
        // 前阴影过渡：起点向前（起点 = 主体起点，默认明度淡出到 0）
        frontH1: 0, frontS1: 100, frontV1: 0,
        frontEaseH: "linear", frontEaseS: "linear", frontEaseV: "linear",
        frontEaseHS: 1.70158, frontEaseSS: 1.70158, frontEaseVS: 1.70158,
        frontCcw: false,
        frontHEnabled: false, frontSEnabled: true, frontVEnabled: true,
        // 后阴影过渡：起点向后（起点 = 主体终点，默认明度淡出到 0）
        backH1: 0, backS1: 100, backV1: 0,
        backEaseH: "linear", backEaseS: "linear", backEaseV: "linear",
        backEaseHS: 1.70158, backEaseSS: 1.70158, backEaseVS: 1.70158,
        backCcw: false,
        backHEnabled: false, backSEnabled: true, backVEnabled: true,
        keyframes: {},   // prop -> [{frame, value, ease, easeS}]，按 frame 升序，frame 恒 > 0
    };
}

export function defaultProject() {
    return {
        fps: 60,
        frames: 0,       // 0 = 自动（以最后关键帧/帧动作为结束）
        repeat: false,
        repeatCount: -1,   // 额外重播次数（-1=无限；0=只播一次；N=额外重播 N 次）
        strip: { pin: 5, length: 16, loop: false },
        sections: [],
        frameActions: [], // {frame, jumpTo, jumpCount, playTo, playCount}
    };
}

// ---------- 关键帧编辑 ----------

export function keyframesOf(section, prop) {
    return section.keyframes[prop] || [];
}

// 写入/覆盖关键帧。frame<=0 时落到基准值（帧 0 的「原点」）。
export function setKeyframe(section, prop, frame, value, easeName = "linear", easeS = 1.70158) {
    if (frame <= 0) {
        section[prop] = value;
        // 0 帧不需要显式关键帧，清除可能存在的 0 帧条目
        if (section.keyframes[prop]) {
            section.keyframes[prop] = section.keyframes[prop].filter(k => k.frame > 0);
        }
        return;
    }
    let kfs = section.keyframes[prop];
    if (!kfs) { section.keyframes[prop] = kfs = []; }
    const existing = kfs.find(k => k.frame === frame);
    if (existing) {
        existing.value = value;
        existing.ease = easeName;
        existing.easeS = easeS;
    } else {
        kfs.push({ frame, value, ease: easeName, easeS });
        kfs.sort((a, b) => a.frame - b.frame);
    }
}

export function removeKeyframe(section, prop, frame) {
    const kfs = section.keyframes[prop];
    if (!kfs) return;
    section.keyframes[prop] = kfs.filter(k => k.frame !== frame);
}

// 该属性在指定帧的关键帧对象（无则返回 null）
export function keyframeAt(section, prop, frame) {
    const kfs = section.keyframes[prop] || [];
    return kfs.find(k => k.frame === frame) || null;
}

// 仅改写已存在关键帧的间补缓动（无关键帧时不动作）
export function setKeyframeEase(section, prop, frame, easeName, easeS) {
    const k = keyframeAt(section, prop, frame);
    if (k) {
        k.ease = easeName;
        k.easeS = easeS;
    }
}

// 移动某帧上该分段「所有属性」的关键帧到目标帧（第 0 帧恒为关键帧=原点，移到 0 即写入基准值；目标帧已有则覆盖值）
export function moveKeyframe(section, fromFrame, toFrame) {
    const target = Math.max(0, Math.round(toFrame));
    if (fromFrame === target) return;
    for (const p of NUM_PROPS) {
        const kfs = section.keyframes[p];
        if (!kfs) continue;
        const moved = kfs.filter(k => k.frame === fromFrame);
        if (!moved.length) continue;
        section.keyframes[p] = kfs.filter(k => k.frame !== fromFrame);
        if (target === 0) {
            // 移到第 0 帧：值成为基准值（原点），不再保留显式关键帧
            section[p] = moved[moved.length - 1].value;
            continue;
        }
        for (const k of moved) {
            k.frame = target;
            const ex = section.keyframes[p].find(e => e.frame === target);
            if (ex) { ex.value = k.value; ex.ease = k.ease; ex.easeS = k.easeS; }
            else section.keyframes[p].push(k);
        }
        section.keyframes[p].sort((a, b) => a.frame - b.frame);
    }
}

// 删除某帧上该分段所有属性的关键帧
export function removeKeyframesAt(section, frame) {
    for (const p of NUM_PROPS) {
        const kfs = section.keyframes[p];
        if (kfs) section.keyframes[p] = kfs.filter(k => k.frame !== frame);
    }
}

// ---------- 插值求值（镜像 Track::eval） ----------

// 有效关键帧列表 = 隐式 0 帧（基准值）+ 显式关键帧（frame>0）
function effectiveKfs(section, prop) {
    const base = section[prop];
    const kfs = (section.keyframes[prop] || []).filter(k => k.frame > 0);
    return [{ frame: 0, value: base, ease: "linear", easeS: 1.70158 }, ...kfs];
}

export function evalProp(section, prop, frame) {
    const kfs = effectiveKfs(section, prop);
    const n = kfs.length;
    if (frame <= kfs[0].frame) return kfs[0].value;
    if (frame >= kfs[n - 1].frame) return kfs[n - 1].value;
    // 二分定位最后满足 kf.frame <= frame 的下标
    let lo = 0, hi = n - 1;
    while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (kfs[mid].frame <= frame) lo = mid; else hi = mid;
    }
    const a = kfs[lo], b = kfs[lo + 1];
    if (b.value === a.value) return b.value;
    const t = (frame - a.frame) / (b.frame - a.frame);
    const k = ease(b.ease, t, b.easeS);
    return a.value + (b.value - a.value) * k;
}

// 某帧所有可动画属性的插补结果
export function evalAll(section, frame) {
    const out = {};
    for (const p of NUM_PROPS) out[p] = evalProp(section, p, frame);
    return out;
}

// 该帧是否为关键帧（任一属性在该帧有显式关键帧）
export function isKeyframeAt(section, frame) {
    for (const p of NUM_PROPS) {
        const kfs = section.keyframes[p];
        if (kfs && kfs.some(k => k.frame === frame)) return true;
    }
    return false;
}

// ---------- 帧 <-> 时间 ----------

export function frameToMs(project, frame) { return frame * 1000 / project.fps; }
export function msToFrame(project, ms) { return cRound(ms * project.fps / 1000); }

// 时间轴显示结束帧：取显式 frames 与所有关键帧/帧动作的最大值
// （镜像 C++ Timeline::set 的 totalFrames 扩展语义）；全空则回退 60。
export function endFrame(project) {
    let last = project.frames > 0 ? project.frames : 0;
    for (const s of project.sections) {
        for (const p of NUM_PROPS) {
            for (const k of keyframesOf(s, p)) last = Math.max(last, k.frame);
        }
    }
    for (const a of project.frameActions) last = Math.max(last, a.frame);
    return last > 0 ? last : 60;
}

// 某帧上的全部关键帧明细（用于悬停 tooltip）：[{section, prop, value}]
export function keyframesAt(project, frame) {
    const out = [];
    for (const s of project.sections) {
        for (const p of NUM_PROPS) {
            for (const k of keyframesOf(s, p)) {
                if (k.frame === frame) out.push({ section: s, prop: p, value: k.value });
            }
        }
    }
    return out;
}

// ---------- 帧动作（jumpTo/playTo） ----------

export function frameActionAt(project, frame) {
    return project.frameActions.find(a => a.frame === frame) || null;
}

// 写入帧动作；jumpTo/playTo <0 表示无；两者均无时删除该帧条目
export function setFrameAction(project, frame, jumpTo, jumpCount, playTo, playCount) {
    project.frameActions = project.frameActions.filter(a => a.frame !== frame);
    jumpTo = (jumpTo === null || jumpTo === undefined || jumpTo < 0) ? -1 : (jumpTo | 0);
    playTo = (playTo === null || playTo === undefined || playTo < 0) ? -1 : (playTo | 0);
    if (jumpTo < 0 && playTo < 0) return;
    project.frameActions.push({
        frame: frame | 0,
        jumpTo,
        jumpCount: (jumpCount === null || jumpCount === undefined) ? 1 : (jumpCount | 0),
        playTo,
        playCount: (playCount === null || playCount === undefined) ? 1 : (playCount | 0),
    });
}

export function removeFrameAction(project, frame) {
    project.frameActions = project.frameActions.filter(a => a.frame !== frame);
}

// ---------- 渲染：把整条灯带在 frame 处计算成像素 RGB（镜像 Rainbow::redraw + Section::drawTo） ----------

export function computeFrame(project, frame) {
    const len = Math.max(0, project.strip.length | 0);
    const px = new Array(len);
    for (let i = 0; i < len; i++) px[i] = null;   // null = 未被任何分段/阴影覆盖（未点亮）

    const loop = !!project.strip.loop;
    const setPx = (idx, r, g, b) => {
        if (loop) { idx = ((idx % len) + len) % len; }
        else if (idx < 0 || idx >= len) return;
        px[idx] = [r, g, b];
    };
    const setPxHSV = (idx, h, s, v) => {
        const [r, g, b] = hsv2rgb(h, s, v);
        setPx(idx, r, g, b);
    };

    // 渲染一种过渡：从 startIdx 起、step 方向、count 颗 LED，第 i 颗的 t = (tOffset+i)/tDenom
    //（denom<=0 时 t 恒 0，即只用起点色）。三种过渡共用，结构完全一致。
    const renderTransition = (s, tr, startIdx, count, step, tOffset, tDenom) => {
        if (count <= 0) return;
        const h0 = evalProp(s, tr.h0, frame), s0 = evalProp(s, tr.s0, frame), v0 = evalProp(s, tr.v0, frame);
        const h1 = evalProp(s, tr.h1, frame), s1 = evalProp(s, tr.s1, frame), v1 = evalProp(s, tr.v1, frame);
        // 色相方向归一（h1==h0 时 dh=0，纯色不整圈）
        let dh = h1 - h0;
        if (s[tr.ccw]) { if (dh > 0) { dh = dh % 360; if (dh >= 0) dh -= 360; } }
        else           { if (dh < 0) { dh = dh % 360; if (dh <= 0) dh += 360; } }
        const eH = s[tr.easeH], eS = s[tr.easeS], eV = s[tr.easeV];
        const sH = s[tr.easeHS], sS = s[tr.easeSS], sV = s[tr.easeVS];
        const enH = s[tr.hEn], enS = s[tr.sEn], enV = s[tr.vEn];
        for (let i = 0; i < count; i++) {
            let t = tDenom > 0 ? (tOffset + i) / tDenom : 0;
            if (t > 1) t = 1;
            if (t < 0) t = 0;
            // 通道被禁用时恒定取起点值（仅前端预览）
            const h = enH ? h0 + dh * ease(eH, t, sH) : h0;
            const sv = enS ? s0 + (s1 - s0) * ease(eS, t, sS) : s0;
            const v = enV ? v0 + (v1 - v0) * ease(eV, t, sV) : v0;
            setPxHSV(startIdx + i * step, h, sv, v);
        }
    };

    for (const s of project.sections) {
        const x = evalProp(s, "x", frame);
        const lenV = evalProp(s, "len", frame);
        const shadowFront = evalProp(s, "shadowFront", frame);
        const shadowBack = evalProp(s, "shadowBack", frame);

        let xw = x;
        if (loop) { xw = xw % len; if (xw < 0) xw += len; }
        const n = Math.max(1, cRound(lenV));
        const xi = cRound(xw);

        // 主体过渡：起点 → 终点
        renderTransition(s, TRANSITIONS[0], xi, n, +1, 0, n > 1 ? n - 1 : 0);
        // 前阴影过渡：起点向前（索引减小）
        if (shadowFront > 0) {
            renderTransition(s, TRANSITIONS[1], xi - 1, cRound(shadowFront), -1, 1, shadowFront);
        }
        // 后阴影过渡：起点向后（索引增大）
        if (shadowBack > 0) {
            renderTransition(s, TRANSITIONS[2], xi + n, cRound(shadowBack), +1, 1, shadowBack);
        }
    }
    return px;
}

// ---------- 序列化（与引擎 Rainbow.exportConfig 对齐） ----------

export function toEngineConfig(project) {
    const keyframes = [];
    project.sections.forEach((s, si) => {
        for (const p of NUM_PROPS) {
            // 未启用的通道端点跟随起点（镜像起点的关键帧，使端点随时间与起点一致）
            const src = foldSource(s, p);
            const kfs = keyframesOf(s, src).filter(k => k.frame > 0);
            if (kfs.length === 0) continue;
            // 帧 0 原点（镜像 C++ Track::ensureOrigin：动画属性都会有一条 0 帧基准关键帧）
            keyframes.push({ time: 0, section: si, prop: p, value: s[src], ease: "linear", easeS: 1.70158 });
            for (const k of kfs) {
                keyframes.push({
                    time: k.frame * 1000 / project.fps,
                    section: si, prop: p, value: k.value, ease: k.ease, easeS: k.easeS,
                });
            }
        }
    });
    return {
        fps: project.fps,
        frames: project.frames,
        repeat: project.repeat,
        repeatCount: project.repeatCount,
        strip: { ...project.strip },
        sections: project.sections.map(s => {
            const c = {};
            for (const p of NUM_PROPS) c[p] = s[p];
            // 4 色模型 → C++ 6 色模型别名：前阴影起点=主体起点，后阴影起点=主体终点
            //（C++/WASM 仍按 6 色序列化，导出时用别名填回，保持往返兼容）
            c.frontH0 = s.h0; c.frontS0 = s.s0; c.frontV0 = s.v0;
            c.backH0 = s.h1; c.backS0 = s.s1; c.backV0 = s.v1;
            for (const p of EASE_PROPS) c[p] = s[p];
            for (const p of EASE_S_PROPS) c[p] = s[p];
            for (const p of CCW_PROPS) c[p] = !!s[p];
            for (const p of ENABLED_PROPS) c[p] = !!s[p];
            // 折叠未启用的通道：端点 = 起点（引擎无「启用」概念，导出时等价化，硬件与预览一致）
            for (const end of Object.keys(FOLD)) {
                const src = foldSource(s, end);
                if (src !== end) c[end] = c[src];
            }
            return c;
        }),
        keyframes,
        frameActions: project.frameActions.map(a => ({ ...a })),
    };
}

export function fromEngineConfig(config) {
    const fps = config.fps > 0 ? config.fps : 60;
    const project = defaultProject();
    project.fps = fps;
    project.frames = config.frames > 0 ? config.frames : 0;
    project.repeat = !!config.repeat;
    project.repeatCount = config.repeatCount != null ? config.repeatCount : -1;
    if (config.strip) Object.assign(project.strip, config.strip);

    project.sections = (config.sections || []).map((sc, i) => {
        const s = defaultSection();
        for (const p of NUM_PROPS) if (typeof sc[p] === 'number') s[p] = sc[p];
        for (const p of EASE_PROPS) if (typeof sc[p] === 'string') s[p] = sc[p];
        for (const p of EASE_S_PROPS) if (typeof sc[p] === 'number') s[p] = sc[p];
        for (const p of CCW_PROPS) if (typeof sc[p] === 'boolean') s[p] = sc[p];
        for (const p of ENABLED_PROPS) if (typeof sc[p] === 'boolean') s[p] = sc[p];
        s.name = `Section ${i + 1}`;
        return s;
    });

    for (const kf of config.keyframes || []) {
        const s = project.sections[kf.section];
        if (!s || !NUM_PROPS.includes(kf.prop)) continue;
        const frame = msToFrame(project, kf.time);
        setKeyframe(s, kf.prop, frame, kf.value, kf.ease || "linear", kf.easeS ?? 1.70158);
    }

    project.frameActions = (config.frameActions || []).map(a => ({
        frame: a.frame | 0,
        jumpTo: typeof a.jumpTo === 'number' ? a.jumpTo : -1,
        jumpCount: typeof a.jumpCount === 'number' ? a.jumpCount : 1,
        playTo: typeof a.playTo === 'number' ? a.playTo : -1,
        playCount: typeof a.playCount === 'number' ? a.playCount : 1,
    }));

    return project;
}
