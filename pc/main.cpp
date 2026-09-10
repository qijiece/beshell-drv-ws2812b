// beshell-drv-ws2812b PC 平台入口示例
#include <stdio.h>
#include <string>
#include <cstring>
#include <beshell/BeShell.hpp>
#include <beshell/fs/FS.hpp>
#include <beshell/module/NVS.hpp>
#include <beshell/driver/ws2812b/WS2812B.hpp>

#ifdef BESHELL_PLATFORM_PC_WASM
#include <emscripten.h>
#include <beshell/basic/Console.hpp>
#endif

using namespace be ;

#ifdef BESHELL_PLATFORM_PC_WASM

// WASM 入口：浏览器/Node 环境中由 emscripten 主循环驱动，
// JS 侧通过 beshell_eval(code) 执行脚本（标准输出自动映射到 console.log）

static BeShell beshell ;

// WASM 专用 REPL 通道：命令/求值输出经 sendData 转发到 stdout（Emscripten 映射到
// 浏览器 console.log）。WASM 下 REPLStdIO 不实例化，此通道专供 beshell_eval 桥接。
class WasmChannel : public REPLChannel {
public:
    WasmChannel(REPL * repl) : REPLChannel(repl) { disableEcho = true ; }
    void sendData(const char * data, size_t datalen) override {
        fwrite(data, 1, datalen, stdout) ;
        fflush(stdout) ;
    }
} ;

static WasmChannel wasmChannel(beshell.repl) ;

// WASM 下无 REPL 通道，console.write 的 writeHandler 转发到 stdout
static void wasmConsoleWrite(const char * buff, size_t len) {
    fwrite(buff, 1, len, stdout) ;
    fflush(stdout) ;
}

extern "C" {

// 供 JS 侧 ccall('beshell_eval', ...) 调用：与原生 REPL 一致
EMSCRIPTEN_KEEPALIVE
void beshell_eval(const char * code) {
    if(!code || !code[0]) {
        return ;
    }
    Package pkg(0, LINE, (uint8_t *)code, strlen(code)) ;
    beshell.cammonds->input(pkg, &wasmChannel) ;
}

}

static void wasm_loop() {
    beshell.loop() ;
}

int main() {

    // 启用 FS + NVS；ws2812b 模块（级联注册 Animator + Strip，导出
    // Strip/Section/Rainbow/hsv2rgb），硬件后端为软件帧缓冲。
    beshell.use<FS>() ;
    beshell.use<NVS>() ;
    beshell.use<driver::ws2812b::WS2812B>() ;

    // JS console.log 经 writeHandler 转发到 stdout
    Console::writeHandler = wasmConsoleWrite ;
    // stdout 无缓冲，保证输出实时（浏览器控制台逐条可见）
    setvbuf(stdout, NULL, _IONBF, 0) ;

    // WASM 虚拟文件系统（MEMFS）以 "/" 为根，main.js 由 --preload-file 打包进去
    FS::setPrefix("/") ;

    beshell.setup() ;
    beshell.evalMain("/main.js") ;

    // while(1) 主循环交给 emscripten 逐帧驱动
    emscripten_set_main_loop(wasm_loop, 0, 0) ;

    return 0 ;
}

#else

int main(int argc, char * argv[]) {

    // 重定向到管道/文件时默认全缓冲，强制无缓冲便于日志实时输出
    setvbuf(stdout, NULL, _IONBF, 0) ;

    BeShell beshell ;

    // 启用 FS + NVS；ws2812b 模块（级联注册 Animator + Strip）
    beshell.use<FS>() ;
    beshell.use<NVS>() ;
    beshell.use<driver::ws2812b::WS2812B>() ;

    // PC 上使用本地目录作为 VFS 根："/xxx" 映射到 "./fs/xxx"
    FS::setPrefix("./fs") ;

    // 启动 BeShell：先执行 main 脚本，再进入主循环（REPL 走标准输入输出）
    beshell.main(argc>1 ? argv[1] : "/main.js") ;

    return 0 ;
}

#endif
