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

// 引擎（C++/WASM）默认值：序列化时等于该值即省略（与 Section.cpp numProps 的 def 字段一致）。
// 注意 h1 引擎默认 0（JS 默认 360），故 h1=360 会写出、h1=0 被省略。
const ENGINE_DEFAULTS = {
    x: 0, len: 1, shadowFront: 0, shadowBack: 0,
    h0: 0, s0: 100, v0: 100, h1: 0, s1: 100, v1: 100,
    frontH1: 0, frontS1: 100, frontV1: 0,
    backH1: 0, backS1: 100, backV1: 0,
};
// 通道「启用」开关默认值（仅前端预览；非默认时才写出，保留用户开关状态）
const ENABLED_DEFAULTS = {
    hEnabled: true, sEnabled: true, vEnabled: true,
    frontHEnabled: false, frontSEnabled: true, frontVEnabled: true,
    backHEnabled: false, backSEnabled: true, backVEnabled: true,
};

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
        emptyKeyframes: [],   // 空关键帧标记（时间轴双击普通帧生成，无任何属性值，仅前端编辑器概念），帧号升序
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
        frameActions: [], // {frame, jumpTo, jumpCount, playTo, playCount, stop?, label?}
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
    // 写入真实关键帧后，同帧的空关键帧标记冗余，移除
    if (section.emptyKeyframes) {
        section.emptyKeyframes = section.emptyKeyframes.filter(f => f !== frame);
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
    // 空关键帧标记随真实关键帧一并平移（移到 0 帧则丢弃，帧 0 恒为原点）
    const earr = section.emptyKeyframes;
    if (earr) {
        const ei = earr.indexOf(fromFrame);
        if (ei >= 0) {
            earr.splice(ei, 1);
            if (target > 0 && !earr.includes(target)) {
                earr.push(target);
                earr.sort((a, b) => a - b);
            }
        }
    }
}

// 删除某帧上该分段所有属性的关键帧（含空关键帧标记）
export function removeKeyframesAt(section, frame) {
    for (const p of NUM_PROPS) {
        const kfs = section.keyframes[p];
        if (kfs) section.keyframes[p] = kfs.filter(k => k.frame !== frame);
    }
    if (section.emptyKeyframes) {
        section.emptyKeyframes = section.emptyKeyframes.filter(f => f !== frame);
    }
}

// ---------- 空关键帧（时间轴双击普通帧生成，不含任何属性值，仅前端编辑器概念） ----------

// 该帧是否有真实关键帧（任一属性在该帧有显式关键帧）
export function hasRealKeyframe(section, frame) {
    for (const p of NUM_PROPS) {
        const kfs = section.keyframes[p];
        if (kfs && kfs.some(k => k.frame === frame)) return true;
    }
    return false;
}

export function hasEmptyKeyframe(section, frame) {
    return (section.emptyKeyframes || []).includes(frame | 0);
}

// 切换空关键帧：普通帧 <-> 空关键帧标记。帧 0 恒为原点、已有真实关键帧的帧不适用。
// 返回是否发生变化（供调用方决定是否刷新）。
export function toggleEmptyKeyframe(section, frame) {
    frame = frame | 0;
    if (frame <= 0) return false;
    // 已有真实关键帧时该帧已是关键帧，无需空标记
    if (hasRealKeyframe(section, frame)) return false;
    const arr = section.emptyKeyframes || (section.emptyKeyframes = []);
    const i = arr.indexOf(frame);
    if (i >= 0) { arr.splice(i, 1); return true; }
    arr.push(frame);
    arr.sort((a, b) => a - b);
    return true;
}

// ---------- 插值求值（镜像 Track::eval） ----------

// 有效关键帧列表 = 隐式 0 帧（基准值）+ 显式关键帧（frame>0）
function effectiveKfs(section, prop) {
    const base = section[prop];
    const kfs = (section.keyframes[prop] || []).filter(k => k.frame > 0);
    return [{ frame: 0, value: base, ease: "linear", easeS: 1.70158 }, ...kfs];
}

// 该属性在指定帧是否为「有效（改变值）」的关键帧——右侧面板紫色高亮依据。
// 帧 0 恒为原点；帧>0 需该帧有关键帧，且其值与前一个有效关键帧（含帧 0 基准值）不同。
export function isDistinctKeyframe(section, prop, frame) {
    if (frame <= 0) return true;
    const kfs = effectiveKfs(section, prop);
    const i = kfs.findIndex(k => k.frame === frame);
    if (i <= 0) return false;
    return kfs[i].value !== kfs[i - 1].value;
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

// 该帧是否为关键帧（任一属性在该帧有显式关键帧，或为空关键帧标记）
export function isKeyframeAt(section, frame) {
    return hasEmptyKeyframe(section, frame) || hasRealKeyframe(section, frame);
}

// ---------- 帧 <-> 时间 ----------

export function frameToMs(project, frame) { return frame * 1000 / project.fps; }
export function msToFrame(project, ms) { return cRound(ms * project.fps / 1000); }

// 输入格式归一：全角→半角（数字、标点、空格）；纯数字去前导零（保留单个 0）。
// 供各数值输入框（值/帧号/次数/fps/时长）解析前调用，避免「０１００」「0。5」等被误解析。
export function normalizeInputText(v) {
    let s = String(v == null ? '' : v);
    s = s.replace(/　/g, ' ');                                       // 全角空格 → 半角
    s = s.replace(/。/g, '.');                                       // 中文句号 → 半角句点
    s = s.replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)); // 全角 ASCII → 半角
    s = s.trim();
    if (/^\d+$/.test(s)) s = s.replace(/^0+(?=\d)/, '');                 // 去前导零
    return s;
}

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

// 某帧上的全部关键帧明细（用于悬停 tooltip）：[{section, prop, value}]，空关键帧为 [{section, empty:true}]
export function keyframesAt(project, frame) {
    const out = [];
    for (const s of project.sections) {
        for (const p of NUM_PROPS) {
            for (const k of keyframesOf(s, p)) {
                if (k.frame === frame) out.push({ section: s, prop: p, value: k.value });
            }
        }
        if (hasEmptyKeyframe(s, frame)) out.push({ section: s, empty: true });
    }
    return out;
}

// ---------- 帧动作（jumpTo/playTo） ----------

export function frameActionAt(project, frame) {
    return project.frameActions.find(a => a.frame === frame) || null;
}

// 写入帧动作；jumpTo/playTo <0 表示无；stop/label/resume 可选；全部无效时删除该帧条目
// resume = playTo 到达目标后继续原顺序播放（否则停止）；仅当有播放目标时才有意义
export function setFrameAction(project, frame, jumpTo, jumpCount, playTo, playCount, stop, label, resume) {
    project.frameActions = project.frameActions.filter(a => a.frame !== frame);
    jumpTo = (jumpTo === null || jumpTo === undefined || jumpTo < 0) ? -1 : (jumpTo | 0);
    playTo = (playTo === null || playTo === undefined || playTo < 0) ? -1 : (playTo | 0);
    const hasStop = !!stop;
    const labelText = (typeof label === 'string' ? label : '').trim();
    const hasResume = !!(resume && playTo >= 0);
    if (jumpTo < 0 && playTo < 0 && !hasStop && !labelText && !hasResume) return;
    const action = {
        frame: frame | 0,
        jumpTo,
        jumpCount: (jumpCount === null || jumpCount === undefined) ? 1 : (jumpCount | 0),
        playTo,
        playCount: (playCount === null || playCount === undefined) ? 1 : (playCount | 0),
    };
    if (hasStop) action.stop = true;
    if (labelText) action.label = labelText;
    if (hasResume) action.resume = true;
    project.frameActions.push(action);
}

// 全部已标记帧（label 非空），按帧号升序，供 jumpTo/playTo 下拉选择
export function frameLabels(project) {
    return project.frameActions
        .filter(a => typeof a.label === 'string' && a.label.trim() !== '')
        .map(a => ({ frame: a.frame, label: a.label.trim() }))
        .sort((a, b) => a.frame - b.frame);
}

export function removeFrameAction(project, frame) {
    project.frameActions = project.frameActions.filter(a => a.frame !== frame);
}

// 指定帧的标签名（无则返回空串）；供 jumpTo/playTo 输入框把帧号回显为标签名
export function labelAtFrame(project, frame) {
    const a = project.frameActions.find(a => a.frame === frame);
    return a && typeof a.label === 'string' ? a.label.trim() : '';
}

// 把标签从 fromFrame 移动到 toFrame（保留目标帧已有的 jump/play/stop，仅搬移 label）。
// 目标帧已有标签时拒绝（一帧一个标签）；源帧动作只剩标签时删除该条目。返回是否成功。
export function moveFrameLabel(project, fromFrame, toFrame) {
    fromFrame = fromFrame | 0;
    toFrame = toFrame | 0;
    if (fromFrame === toFrame) return false;
    const src = project.frameActions.find(a => a.frame === fromFrame);
    if (!src || !(typeof src.label === 'string' && src.label.trim())) return false;
    const dst = project.frameActions.find(a => a.frame === toFrame);
    if (dst && dst.label) return false;
    const label = src.label.trim();
    delete src.label;
    if (src.jumpTo < 0 && src.playTo < 0 && !src.stop && !src.resume) {
        project.frameActions = project.frameActions.filter(a => a !== src);
    }
    if (dst) {
        dst.label = label;
    } else {
        project.frameActions.push({ frame: toFrame, jumpTo: -1, jumpCount: 1, playTo: -1, playCount: 1, label });
    }
    return true;
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
        // 颜色分量不可计算（NaN/Infinity）时按纯黑处理
        px[idx] = (isFinite(r) && isFinite(g) && isFinite(b)) ? [r, g, b] : [0, 0, 0];
    };
    const setPxHSV = (idx, h, s, v) => {
        const [r, g, b] = hsv2rgb(h, s, v);
        setPx(idx, r, g, b);
    };

    // 渲染一种过渡：从 startIdx 起、step 方向、count 颗 LED，第 i 颗的 t = (tOffset+i)/tDenom
    //（denom<=0 时 t 恒 0，即只用起点色）。三种过渡共用，结构完全一致。
    // start/end 为已按「启用」与长度折叠的通道值 {h,s,v}；后阴影起点 = 主体有效终点，故显式传入。
    const renderTransition = (s, tr, startIdx, count, step, tOffset, tDenom, start, end) => {
        if (count <= 0) return;
        // 色相方向归一（h1==h0 时 dh=0，纯色不整圈）
        let dh = end.h - start.h;
        if (s[tr.ccw]) { if (dh > 0) { dh = dh % 360; if (dh >= 0) dh -= 360; } }
        else           { if (dh < 0) { dh = dh % 360; if (dh <= 0) dh += 360; } }
        const eH = s[tr.easeH], eS = s[tr.easeS], eV = s[tr.easeV];
        const sH = s[tr.easeHS], sS = s[tr.easeSS], sV = s[tr.easeVS];
        for (let i = 0; i < count; i++) {
            let t = tDenom > 0 ? (tOffset + i) / tDenom : 0;
            if (t > 1) t = 1;
            if (t < 0) t = 0;
            const h = start.h + dh * ease(eH, t, sH);
            const sv = start.s + (end.s - start.s) * ease(eS, t, sS);
            const v = start.v + (end.v - start.v) * ease(eV, t, sV);
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

        const body = TRANSITIONS[0], front = TRANSITIONS[1], back = TRANSITIONS[2];

        // 主体起点（永不折叠）；主体终点：通道未启用或仅 1 颗灯珠时折叠到起点
        const h0 = evalProp(s, body.h0, frame), s0 = evalProp(s, body.s0, frame), v0 = evalProp(s, body.v0, frame);
        const h1 = (s[body.hEn] && n > 1) ? evalProp(s, body.h1, frame) : h0;
        const s1 = (s[body.sEn] && n > 1) ? evalProp(s, body.s1, frame) : s0;
        const v1 = (s[body.vEn] && n > 1) ? evalProp(s, body.v1, frame) : v0;

        // 主体过渡：起点 → 终点
        renderTransition(s, body, xi, n, +1, 0, n > 1 ? n - 1 : 0,
            { h: h0, s: s0, v: v0 }, { h: h1, s: s1, v: v1 });

        // 前阴影过渡：起点 = 主体起点（向前），终点按前阴影「启用」折叠到主体起点
        if (shadowFront > 0) {
            const fh1 = s[front.hEn] ? evalProp(s, front.h1, frame) : h0;
            const fs1 = s[front.sEn] ? evalProp(s, front.s1, frame) : s0;
            const fv1 = s[front.vEn] ? evalProp(s, front.v1, frame) : v0;
            renderTransition(s, front, xi - 1, cRound(shadowFront), -1, 1, shadowFront,
                { h: h0, s: s0, v: v0 }, { h: fh1, s: fs1, v: fv1 });
        }
        // 后阴影过渡：起点 = 主体有效终点（向后），终点按后阴影「启用」折叠到该起点
        if (shadowBack > 0) {
            const bh1 = s[back.hEn] ? evalProp(s, back.h1, frame) : h1;
            const bs1 = s[back.sEn] ? evalProp(s, back.s1, frame) : s1;
            const bv1 = s[back.vEn] ? evalProp(s, back.v1, frame) : v1;
            renderTransition(s, back, xi + n, cRound(shadowBack), +1, 1, shadowBack,
                { h: h1, s: s1, v: v1 }, { h: bh1, s: bs1, v: bv1 });
        }
    }
    return px;
}

// ---------- 序列化（与引擎 Rainbow.exportConfig 对齐） ----------

export function toEngineConfig(project) {
    // 关键帧按帧号聚合：{ [frame]: { [sectionIdx]: { [prop]: 值|三元组 } } }。
    // 帧 0 = 各分段非默认基准值（单值）；非 0 帧 = 间补目标值（单值 或 [值, 缓动] / [值, 缓动, s]）。
    // 省略默认 ease("linear")/easeS(1.70158)；未启用通道端点经 foldSource 折叠到源属性。
    const keyframes = {};
    const frameMap = (f) => { const m = keyframes[f] || (keyframes[f] = {}); return m; };
    const propMap = (f, si) => {
        const fm = frameMap(f);
        const pm = fm[si] || (fm[si] = {});
        return pm;
    };
    project.sections.forEach((s, si) => {
        for (const p of NUM_PROPS) {
            // 未启用的通道端点跟随起点（镜像起点的基准值/关键帧，使端点随时间与起点一致）
            const src = foldSource(s, p);
            const base = s[src];
            // 帧 0 基准值：非引擎默认才写（对照目标属性 ENGINE_DEFAULTS[p]）
            if (base !== ENGINE_DEFAULTS[p]) propMap(0, si)[p] = base;
            for (const k of keyframesOf(s, src)) {
                if (k.frame <= 0) continue;
                const defS = k.easeS === 1.70158;
                if (k.ease === "linear" && defS) propMap(k.frame, si)[p] = k.value;
                else if (defS) propMap(k.frame, si)[p] = [k.value, k.ease];
                else propMap(k.frame, si)[p] = [k.value, k.ease, k.easeS];
            }
        }
    });

    // sections 只保留静态过渡配置；NUM_PROPS 基准值已移入 keyframes[0]。
    const sections = project.sections.map(s => {
        const c = {};
        for (const p of EASE_PROPS) if (s[p] !== "linear") c[p] = s[p];
        for (const p of EASE_S_PROPS) if (s[p] !== 1.70158) c[p] = s[p];
        for (const p of CCW_PROPS) if (s[p]) c[p] = true;
        for (const p of ENABLED_PROPS) if (!!s[p] !== ENABLED_DEFAULTS[p]) c[p] = !!s[p];
        // 空关键帧标记：随配置持久化（引擎/WASM 忽略该字段，仅前端编辑器使用）
        if (s.emptyKeyframes && s.emptyKeyframes.length) c.emptyKeyframes = [...s.emptyKeyframes];
        return c;
    });
    // sections 省略规则：仅当「只有 1 段且该段静态配置全默认」时省略整字段；0 段/多段始终写（保住段数）。
    const omitSections = sections.length === 1 && Object.keys(sections[0]).length === 0;

    const out = {
        ...(project.fps !== 60 ? { fps: project.fps } : {}),
        ...(project.frames !== 0 ? { frames: project.frames } : {}),
        ...(project.repeat ? { repeat: true } : {}),
        ...(project.repeatCount !== -1 ? { repeatCount: project.repeatCount } : {}),
    };
    if (!omitSections) out.sections = sections;
    if (Object.keys(keyframes).length) out.keyframes = keyframes;
    out.frameActions = project.frameActions.map(a => ({ ...a }));
    return out;
}

export function fromEngineConfig(config) {
    const fps = config.fps > 0 ? config.fps : 60;
    const project = defaultProject();
    project.fps = fps;
    project.frames = config.frames > 0 ? config.frames : 0;
    project.repeat = !!config.repeat;
    project.repeatCount = config.repeatCount != null ? config.repeatCount : -1;

    // 段数：sections 数组优先，否则按 keyframes 里最大分段 idx 推断（sections 可省略）。
    let sectionCount = 1;
    if (config.sections) {
        sectionCount = config.sections.length;
    } else if (config.keyframes) {
        let max = -1;
        for (const secMap of Object.values(config.keyframes)) {
            for (const si of Object.keys(secMap || {})) max = Math.max(max, Number(si));
        }
        sectionCount = Math.max(1, max + 1);
    }

    project.sections = Array.from({ length: sectionCount }, (_, i) => {
        const sc = config.sections ? config.sections[i] : null;
        const s = defaultSection();
        // h1 引擎默认 0（JS 默认 360 仅用于「新建分段」的彩虹起点）；导入时缺失该字段即回落引擎默认 0。
        s.h1 = 0;
        if (sc) {
            for (const p of EASE_PROPS) if (typeof sc[p] === 'string') s[p] = sc[p];
            for (const p of EASE_S_PROPS) if (typeof sc[p] === 'number') s[p] = sc[p];
            for (const p of CCW_PROPS) if (typeof sc[p] === 'boolean') s[p] = sc[p];
            for (const p of ENABLED_PROPS) if (typeof sc[p] === 'boolean') s[p] = sc[p];
            if (Array.isArray(sc.emptyKeyframes)) {
                s.emptyKeyframes = sc.emptyKeyframes.filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
            }
        }
        s.name = `Section ${i + 1}`;
        return s;
    });

    // 关键帧：新格式按帧聚合 { frame: { si: { prop: 值|三元组 } } }；旧格式 per-property 数组兼容。
    const kfEntries = Object.entries(config.keyframes || {});
    const isNewFormat = kfEntries.length === 0
        || kfEntries.every(([, v]) => v && typeof v === 'object' && !Array.isArray(v));
    if (isNewFormat) {
        for (const [frameStr, secMap] of kfEntries) {
            const frame = Number(frameStr);
            if (!Number.isInteger(frame) || frame < 0) continue;
            for (const [siStr, propMap] of Object.entries(secMap || {})) {
                const si = Number(siStr);
                const s = Number.isInteger(si) ? project.sections[si] : null;
                if (!s) continue;
                for (const [prop, v] of Object.entries(propMap || {})) {
                    if (!NUM_PROPS.includes(prop)) continue;
                    let value, ease = "linear", easeS = 1.70158;
                    if (Array.isArray(v)) {
                        value = v[0];
                        if (typeof v[1] === 'string') ease = v[1];
                        if (typeof v[2] === 'number') easeS = v[2];
                    } else {
                        value = v;
                    }
                    if (typeof value !== 'number') continue;
                    setKeyframe(s, prop, frame, value, ease, easeS);
                }
            }
        }
    } else {
        // 旧格式：{ prop: [{frame, value, section?, ease?, easeS?}] }
        for (const [prop, arr] of kfEntries) {
            if (!NUM_PROPS.includes(prop) || !Array.isArray(arr)) continue;
            for (const kf of arr) {
                const s = project.sections[kf.section ?? 0];
                if (!s) continue;
                setKeyframe(s, prop, kf.frame, kf.value, kf.ease || "linear", kf.easeS ?? 1.70158);
            }
        }
    }

    project.frameActions = (config.frameActions || []).map(a => {
        const act = {
            frame: a.frame | 0,
            jumpTo: typeof a.jumpTo === 'number' ? a.jumpTo : -1,
            jumpCount: typeof a.jumpCount === 'number' ? a.jumpCount : 1,
            playTo: typeof a.playTo === 'number' ? a.playTo : -1,
            playCount: typeof a.playCount === 'number' ? a.playCount : 1,
        };
        if (a.stop) act.stop = true;
        if (a.resume) act.resume = true;
        if (typeof a.label === 'string' && a.label) act.label = a.label;
        return act;
    });

    return project;
}
