// 生成 beshell（ws2812b 模块）运行时代码：strip.setup + rainbow.importConfig，与编辑器往返一致。
// importConfig 接受 toEngineConfig 产出的完整配置（不含 strip，strip 走 strip.setup）。
import { toEngineConfig } from './model.js';

const DEFAULT_SETUP = { pin: 8, length: 16, loop: false };

// setup: { pin, length, loop }（缺省用工程 strip.length / 默认 pin / 默认 loop）
export function generateCode(project, setup = {}) {
    const cfg = toEngineConfig(project);
    const length = setup.length != null
        ? setup.length
        : ((project.strip && project.strip.length) || DEFAULT_SETUP.length);
    const pin = setup.pin != null ? setup.pin : DEFAULT_SETUP.pin;
    const loop = setup.loop != null ? !!setup.loop : !!DEFAULT_SETUP.loop;

    const { strip: _strip, ...rest } = cfg;
    // JSON 键均为合法标识符，去掉引号得到 JS 对象字面量
    const body = JSON.stringify(rest, null, 2).replace(/"([a-zA-Z0-9_]+)":/g, '$1:');

    return [
        '// WS2812B 灯效 — 由 beshell 编辑器导出',
        'import { Strip, Rainbow } from "ws2812b"',
        '',
        'const strip = new Strip()',
        `strip.setup({ pin: ${pin}, length: ${length}, loop: ${loop} })`,
        '',
        'const rainbow = new Rainbow(strip)',
        'rainbow.importConfig(' + body + ')',
        'rainbow.draw()',
        'rainbow.play()',
        '',
    ].join('\n');
}
