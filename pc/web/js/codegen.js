// 生成 beshell（ws2812b 模块）运行时代码：strip.setup + rainbow.importConfig，与编辑器往返一致。
// importConfig 接受 toEngineConfig 产出的配置（不含 strip，strip 走 strip.setup）。
import { toEngineConfig, endFrame, frameLabels } from './model.js';

const DEFAULT_SETUP = { pin: 8, length: 16, loop: false };

// 生成代码里已有的顶层标识符：具名帧常量不能与之冲突
const GENERATED_NAMES = new Set(['strip', 'rainbow', 'Strip', 'Rainbow']);

// JS 保留字：具名帧若撞名则加前缀，避免生成非法代码
const RESERVED = new Set([
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
    'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
    'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
    'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with',
    'yield', 'let', 'static', 'implements', 'interface', 'package', 'private', 'protected',
    'public', 'await',
]);

// 帧名 → 合法 JS 常量名（大写约定）：Unicode 字母/数字保留（中文可用），其余字符转下划线，数字开头加前缀
function frameIdentifier(label) {
    let s = String(label).trim().replace(/[^\p{L}\p{N}_$]/gu, '_');
    if (!/^[\p{L}_$]/u.test(s)) s = '_' + s;
    if (!s) s = '_';
    if (RESERVED.has(s) || GENERATED_NAMES.has(s)) s = 'f_' + s;
    return s.toUpperCase();
}

// 具名帧映射（帧号 → 常量名）：真实标签优先，虚拟锚点（FRAME_START=0 / FRAME_END=endFrame）兜底；
// 大写化后可能撞名（如用户标签「frame_start」与锚点），撞名加 `_` 前缀去重。
function namedFrameMap(project) {
    const end = endFrame(project);
    const map = new Map();
    const used = new Set();
    const claim = (frame, base) => {
        let name = frameIdentifier(base);
        while (used.has(name)) name = '_' + name;
        used.add(name);
        map.set(frame, name);
    };
    for (const l of frameLabels(project)) claim(l.frame, l.label);
    if (!map.has(0)) claim(0, 'frame_start');
    if (!map.has(end)) claim(end, 'frame_end');
    return map;
}

// 精简用于代码生成的配置：代码只需「显式关键帧」，其余冗余由引擎默认补齐。
// - 新格式 keyframes 已按帧聚合；帧 0 基准值需保留（无 sections 时是分段基准的唯一来源）
// - 空 keyframes / frameActions 省略；sections 为空省略
// - 空关键帧标记 emptyKeyframes 是编辑器概念，不含任何属性值，不写入生成代码
function slimConfig(cfg) {
    const out = {};
    for (const key of ['fps', 'frames', 'repeat', 'repeatCount']) {
        if (cfg[key] !== undefined) out[key] = cfg[key];
    }
    if (cfg.sections && cfg.sections.length) {
        out.sections = cfg.sections.map(({ emptyKeyframes, ...s }) => s);
    }
    const kfs = {};
    for (const [frame, secMap] of Object.entries(cfg.keyframes || {})) {
        const cleaned = {};
        for (const [si, propMap] of Object.entries(secMap || {})) {
            if (propMap && Object.keys(propMap).length) cleaned[si] = propMap;
        }
        if (Object.keys(cleaned).length) kfs[frame] = cleaned;
    }
    if (Object.keys(kfs).length) out.keyframes = kfs;
    if (cfg.frameActions.length) out.frameActions = cfg.frameActions.map(a => ({ ...a }));
    return out;
}

// setup: { pin, length, loop }（缺省用工程 strip.length / 默认 pin / 默认 loop）
export function generateCode(project, setup = {}) {
    const cfg = toEngineConfig(project);
    const length = setup.length != null
        ? setup.length
        : ((project.strip && project.strip.length) || DEFAULT_SETUP.length);
    const pin = setup.pin != null ? setup.pin : DEFAULT_SETUP.pin;
    const loop = setup.loop != null ? !!setup.loop : !!DEFAULT_SETUP.loop;

    const importCfg = slimConfig(cfg);

    // 具名帧：收集所有引用到具名帧的帧号（帧动作 frame/jumpTo/playTo 及关键帧的帧键）
    const frameToName = namedFrameMap(project);
    const used = new Map();   // 常量名 → 帧号（去重，按帧号排序输出）
    const mark = (v) => {
        const name = frameToName.get(v);
        if (name !== undefined && !used.has(name)) used.set(name, v);
    };
    for (const a of importCfg.frameActions || []) {
        mark(a.frame); mark(a.jumpTo); mark(a.playTo);
    }
    for (const frameStr of Object.keys(importCfg.keyframes || {})) mark(+frameStr);

    // 关键帧单独序列化（紧凑格式，减少行数）：帧号作为键，具名帧用计算属性 [NAME]，其余用数字字面量；
    // 每段属性表一行（prop 名不引号），属性值三元组 [值, 缓动, 缓动s] 同行不换行。整体按层级 2 空格缩进。
    const fmtVal = (v) => Array.isArray(v)
        ? '[' + v.map(x => JSON.stringify(x)).join(', ') + ']'
        : JSON.stringify(v);
    const fmtPropMap = (pm) => '{ ' + Object.entries(pm).map(([k, v]) => `${k}: ${fmtVal(v)}`).join(', ') + ' }';
    const kfsLines = [];
    for (const [frameStr, secMap] of Object.entries(importCfg.keyframes || {})) {
        const frame = +frameStr;
        const name = frameToName.get(frame);
        const key = name !== undefined ? `[${name}]` : frameStr;
        const inner = Object.entries(secMap).map(([si, pm]) => `      ${si}: ${fmtPropMap(pm)}`).join(',\n');
        kfsLines.push(`    ${key}: {\n${inner}\n    }`);
    }

    // 其余字段拼 JS 对象字面量（去引号，多行值续行补缩进），再把 frameActions 里引用到具名帧的帧号替换为常量名
    const unquote = (s) => s.replace(/"([a-zA-Z0-9_]+)":/g, '$1:');
    const indentTail = (s) => s.replace(/\n/g, '\n  ');
    const fields = [];
    for (const key of ['fps', 'frames', 'repeat', 'repeatCount']) {
        if (importCfg[key] !== undefined) fields.push(`  ${key}: ${JSON.stringify(importCfg[key])}`);
    }
    if (importCfg.sections && importCfg.sections.length) {
        fields.push('  sections: ' + indentTail(unquote(JSON.stringify(importCfg.sections, null, 2))));
    }
    if (kfsLines.length) fields.push('  keyframes: {\n' + kfsLines.join(',\n') + '\n  }');
    if (importCfg.frameActions && importCfg.frameActions.length) {
        let fa = unquote(JSON.stringify(importCfg.frameActions, null, 2));
        fa = fa.replace(/(frame|jumpTo|playTo):\s*(-?\d+)/g, (m, k, num) => {
            const name = frameToName.get(+num);
            return name !== undefined ? `${k}: ${name}` : m;
        });
        fields.push('  frameActions: ' + indentTail(fa));
    }

    const body = fields.length ? '{\n' + fields.join(',\n') + '\n}' : '{}';

    const constLines = [...used.entries()]
        .sort((x, y) => x[1] - y[1])
        .map(([name, frame]) => `const ${name} = ${frame}`);

    const setupFields = [`pin: ${pin}`, `length: ${length}`];
    if (loop) setupFields.push('loop: true');

    const out = [
        '// WS2812B 灯效 — 由 beshell 编辑器导出',
        'import { Strip, Rainbow } from "ws2812b"',
        '',
        'const strip = new Strip()',
        `strip.setup({ ${setupFields.join(', ')} })`,
        '',
        'const rainbow = new Rainbow(strip)',
    ];
    if (constLines.length) out.push('', '// 具名帧常量', ...constLines);
    out.push('', 'rainbow.importConfig(' + body + ')', 'rainbow.draw()', 'rainbow.play()', '');

    return out.join('\n');
}
