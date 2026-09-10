// 缓动函数集：严格镜像 beshell/src/beshell/module/animator/Tween.cpp
// 签名与 C++ 一致：f(t, b, c, d, s)，t=当前时刻 b=起点 c=变化量 d=总时长 s=缓动参数
// 关键帧插值与 Section 渐变均以 b=0, c=1, d=1 调用（easeS 由关键帧/默认 1.70158 提供）。

const PI = Math.PI;

function Linear(t, b, c, d, s) { return c * t / d + b; }

function InQuad(t, b, c, d, s) { t /= d; return c * t * t + b; }
function OutQuad(t, b, c, d, s) { t /= d; return -c * t * (t - 2) + b; }
function InOutQuad(t, b, c, d, s) {
    t /= d;
    if ((t / 2) < 1) return c / 2 * t * t + b;
    t -= 1;
    return -c / 2 * (t * (t - 2) - 1) + b;
}

function InCubic(t, b, c, d, s) { t /= d; return c * t * t * t + b; }
function OutCubic(t, b, c, d, s) { t = t / d - 1; return c * (t * t * t + 1) + b; }
function InOutCubic(t, b, c, d, s) {
    t /= d / 2;
    if (t < 1) return c / 2 * t * t * t + b;
    t -= 2;
    return c / 2 * (t * t * t + 2) + b;
}

function InQuart(t, b, c, d, s) { t /= d; return c * t * t * t * t + b; }
function OutQuart(t, b, c, d, s) { t = t / d - 1; return -c * (t * t * t * t - 1) + b; }
function InOutQuart(t, b, c, d, s) {
    t /= d / 2;
    if (t < 1) return c / 2 * t * t * t * t + b;
    t -= 2;
    return -c / 2 * (t * t * t * t - 2) + b;
}

function InQuint(t, b, c, d, s) { t /= d; return c * t * t * t * t * t + b; }
function OutQuint(t, b, c, d, s) { t = t / d - 1; return c * (t * t * t * t * t + 1) + b; }
function InOutQuint(t, b, c, d, s) {
    t /= d / 2;
    if (t < 1) return c / 2 * t * t * t * t * t + b;
    t -= 2;
    return c / 2 * (t * t * t * t * t + 2) + b;
}

function InSine(t, b, c, d, s) { return -c * Math.cos(t / d * (PI / 2)) + c + b; }
function OutSine(t, b, c, d, s) { return c * Math.sin(t / d * (PI / 2)) + b; }
function InOutSine(t, b, c, d, s) { return -c / 2 * (Math.cos(PI * t / d) - 1) + b; }

function InExpo(t, b, c, d, s) { return (t === 0) ? b : c * Math.pow(2, 10 * (t / d - 1)) + b; }
function OutExpo(t, b, c, d, s) { return (t === d) ? b + c : c * (-Math.pow(2, -10 * t / d) + 1) + b; }
function InOutExpo(t, b, c, d, s) {
    if (t === 0) return b;
    if (t === d) return b + c;
    t /= d / 2;
    if (t < 1) return c / 2 * Math.pow(2, 10 * (t - 1)) + b;
    t -= 1;
    return c / 2 * (-Math.pow(2, -10 * t) + 2) + b;
}

function InCirc(t, b, c, d, s) { t /= d; return -c * (Math.sqrt(1 - t * t) - 1) + b; }
function OutCirc(t, b, c, d, s) { t = t / d - 1; return c * Math.sqrt(1 - t * t) + b; }
function InOutCirc(t, b, c, d, s) {
    t /= d / 2;
    if (t < 1) return -c / 2 * (Math.sqrt(1 - t * t) - 1) + b;
    t -= 2;
    return c / 2 * (Math.sqrt(1 - t * t) + 1) + b;
}

function InElastic(t, b, c, d, s) {
    if (t === 0) return b;
    t /= d;
    if (t === 1) return b + c;
    const p = d * 0.3;
    const a = c;          // C++ 中 a 恒为 0 触发 a=c
    const ss = p / 4;     // 覆盖传入 s
    t -= 1;
    return -(a * Math.pow(2, 10 * t) * Math.sin((t * d - ss) * (2 * PI) / p)) + b;
}
function OutElastic(t, b, c, d, s) {
    if (t === 0) return b;
    t /= d;
    if (t === 1) return b + c;
    const p = d * 0.3;
    const a = c;
    const ss = p / 4;
    return a * Math.pow(2, -10 * t) * Math.sin((t * d - ss) * (2 * PI) / p) + c + b;
}
function InOutElastic(t, b, c, d, s) {
    if (t === 0) return b;
    t /= d / 2;
    if (t === 2) return b + c;
    const p = d * (0.3 * 1.5);
    const a = c;
    const ss = p / 4;
    t -= 1;
    if (t < 1) return -0.5 * (a * Math.pow(2, 10 * t) * Math.sin((t * d - ss) * (2 * PI) / p)) + b;
    return a * Math.pow(2, -10 * t) * Math.sin((t * d - ss) * (2 * PI) / p) * 0.5 + c + b;
}

function InBack(t, b, c, d, s) { t /= d; return c * t * t * ((s + 1) * t - s) + b; }
function OutBack(t, b, c, d, s) { t = t / d - 1; return c * (t * t * ((s + 1) * t + s) + 1) + b; }
function InOutBack(t, b, c, d, s) {
    t /= d / 2;
    s *= 1.525;
    if (t < 1) return c / 2 * (t * t * ((s + 1) * t - s)) + b;
    t -= 2;
    return c / 2 * (t * t * ((s + 1) * t + s) + 2) + b;
}

function OutBounce(t, b, c, d, s) {
    if ((t /= d) < (1 / 2.75)) return c * (7.5625 * t * t) + b;
    else if (t < (2 / 2.75)) { t -= 1.5 / 2.75; return c * (7.5625 * t * t + 0.75) + b; }
    else if (t < (2.5 / 2.75)) { t -= 2.25 / 2.75; return c * (7.5625 * t * t + 0.9375) + b; }
    else { t -= 2.625 / 2.75; return c * (7.5625 * t * t + 0.984375) + b; }
}
function InBounce(t, b, c, d, s) { return c - OutBounce(d - t, 0, c, d, 0) + b; }
function InOutBounce(t, b, c, d, s) {
    if (t < d / 2) return InBounce(t * 2, 0, c, d, 0) * 0.5 + b;
    else return OutBounce(t * 2 - d, 0, c, d, 0) * 0.5 + c * 0.5 + b;
}

// 名字表：顺序与 TweenEaseType 枚举一致（jsNames）
export const EASE_NAMES = [
    "linear",
    "inSine", "outSine", "inOutSine",
    "inQuad", "outQuad", "inOutQuad",
    "inCubic", "outCubic", "inOutCubic",
    "inQuart", "outQuart", "inOutQuart",
    "inQuint", "outQuint", "inOutQuint",
    "inExpo", "outExpo", "inOutExpo",
    "inCirc", "outCirc", "inOutCirc",
    "inBounce", "outBounce", "inOutBounce",
    "inBack", "outBack", "inOutBack",
    "inElastic", "outElastic", "inOutElastic",
];

const FUNCS = {
    linear: Linear,
    inSine: InSine, outSine: OutSine, inOutSine: InOutSine,
    inQuad: InQuad, outQuad: OutQuad, inOutQuad: InOutQuad,
    inCubic: InCubic, outCubic: OutCubic, inOutCubic: InOutCubic,
    inQuart: InQuart, outQuart: OutQuart, inOutQuart: InOutQuart,
    inQuint: InQuint, outQuint: OutQuint, inOutQuint: InOutQuint,
    inExpo: InExpo, outExpo: OutExpo, inOutExpo: InOutExpo,
    inCirc: InCirc, outCirc: OutCirc, inOutCirc: InOutCirc,
    inBounce: InBounce, outBounce: OutBounce, inOutBounce: InOutBounce,
    inBack: InBack, outBack: OutBack, inOutBack: InOutBack,
    inElastic: InElastic, outElastic: OutElastic, inOutElastic: InOutElastic,
};

// 归一化求值：t∈[0,1] → 0..1，b=0 c=1 d=1
export function ease(name, t, s = 1.70158) {
    const f = FUNCS[name] || Linear;
    return f(t, 0, 1, 1, s);
}
