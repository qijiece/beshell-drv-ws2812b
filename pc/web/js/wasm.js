// WASM 桥：载入 createBeShell，经 beshell_eval 驱动引擎做 importConfig/exportConfig 往返校验。
// 编辑器本身用纯 JS 镜像渲染；WASM 仅作为「权威引擎」用于往返验证（Strip 无读像素接口）。
// 模块经 REPL 的 `import ws2812b` 命令注册为全局命名空间 ws2812b（beshell_eval 为 LINE 脚本通道，
// 不支持 ESM import 语句，须用命名空间访问 ws2812b.Strip / ws2812b.Rainbow / ws2812b.hsv2rgb）。
// createBeShell 由 index.html 以 <script> 载入（MODULARIZE，导出全局 createBeShell）。

const EXPORT_MARKER = '__BE_EXPORT__';
const READY_MARKER = '__BE_READY__';

export async function loadWasm(wasmJsUrl) {
    if (typeof createBeShell !== 'function') {
        throw new Error('createBeShell 未加载（请确认 index.html 已引入 beshell-ws2812b-wasm.js）');
    }
    const captured = [];
    const Module = await createBeShell({
        print: (s) => { captured.push(String(s)); },
        printErr: (s) => { captured.push(String(s)); },
    });

    function evalCode(code) {
        captured.length = 0;
        Module.ccall('beshell_eval', null, ['string'], [code]);
        return captured.slice();
    }

    // 一次性导入 ws2812b 命名空间（REPL import 命令）
    const importLines = evalCode('import ws2812b');
    if (!importLines.some(l => l.indexOf('imported module') >= 0)) {
        throw new Error('ws2812b 模块导入失败');
    }

    // 就绪探测：执行一条依赖 ws2812b 模块的脚本，观察标记输出
    function probe() {
        const lines = evalCode(
            `const _s = new ws2812b.Strip();
             _s.setup({ pin: 5, length: 16 });
             console.log("${READY_MARKER}");`
        );
        return lines.some(l => l.indexOf(READY_MARKER) >= 0);
    }

    // 自包含往返：编辑器配置 -> 引擎 -> 引擎导出结果
    function roundtrip(config) {
        const json = JSON.stringify(config);
        const stripJson = JSON.stringify(config.strip || { pin: 5, length: 16, loop: false });
        const lines = evalCode(
            `const _strip = new ws2812b.Strip();
             _strip.setup(${stripJson});
             const _rb = new ws2812b.Rainbow(_strip, { fps: ${Number(config.fps) || 60} });
             _rb.importConfig(${json});
             console.log("${EXPORT_MARKER}" + JSON.stringify(_rb.exportConfig()));`
        );
        for (const line of lines) {
            const idx = line.indexOf(EXPORT_MARKER);
            if (idx >= 0) {
                const out = line.slice(idx + EXPORT_MARKER.length);
                try { return JSON.parse(out); } catch (e) { throw new Error('引擎导出 JSON 解析失败: ' + e.message); }
            }
        }
        throw new Error('引擎未返回导出结果');
    }

    return { Module, evalCode, probe, roundtrip };
}
