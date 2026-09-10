// HSV <-> RGB 颜色工具
// hsv2rgb 严格镜像 Strip.cpp 的 be::driver::ws2812b::hsv2rgb

export function hsv2rgb(h, s, v) {
    h = h % 360.0;
    if (h < 0) h += 360.0;
    if (s < 0) s = 0; else if (s > 1) s = 1;
    if (v < 0) v = 0; else if (v > 1) v = 1;

    const c = v * s;
    const x = c * (1 - Math.abs((h / 60.0) % 2.0 - 1));
    const m = v - c;
    let rf, gf, bf;
    if (h < 60)      { rf = c; gf = x; bf = 0; }
    else if (h < 120) { rf = x; gf = c; bf = 0; }
    else if (h < 180) { rf = 0; gf = c; bf = x; }
    else if (h < 240) { rf = 0; gf = x; bf = c; }
    else if (h < 300) { rf = x; gf = 0; bf = c; }
    else             { rf = c; gf = 0; bf = x; }

    return [
        Math.trunc((rf + m) * 255 + 0.5),
        Math.trunc((gf + m) * 255 + 0.5),
        Math.trunc((bf + m) * 255 + 0.5),
    ];
}

// 标准 RGB -> HSV（与常见定义一致；用于把 RGB 输入折算回模型里的 HSV）
export function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0, s = 0, v = max;
    if (d !== 0) {
        s = d / max;
        if (max === r)      h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else                h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return [h, s, v];
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(c => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hsvToHex(h, s, v) {
    const [r, g, b] = hsv2rgb(h, s, v);
    return rgbToHex(r, g, b);
}

// 人类可读格式化（tooltip / 数值框显示用）
export function fmtRGB(r, g, b) {
    return `${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`;
}
export function fmtHSV(h, s, v) {
    return `${h.toFixed(1)}°, ${(s * 100).toFixed(0)}%, ${(v * 100).toFixed(0)}%`;
}
