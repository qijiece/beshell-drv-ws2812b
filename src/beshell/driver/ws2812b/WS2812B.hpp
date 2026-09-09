#pragma once

#include <beshell/NativeModule.hpp>


namespace be::driver::ws2812b{

    // ws2812b 模块入口
    //
    // 注册时级联启用 Strip / Section / Rainbow 三个驱动类（由 driver 模块导出），
    // 模块本身导出 hsv2rgb() 及 JS 胶水层转挂的三个类：
    //   import { Strip, Section, Rainbow, hsv2rgb } from "ws2812b"
    //（文档注释见 WS2812B.cpp 文件头）
    class WS2812B: public be::NativeModule {
    public:
        static char const * const name ;

        // 级联启用驱动类
        static void use(BeShell * beshell) ;

        WS2812B(JSContext * ctx, const char * name) ;

    protected:
        void exports(JSContext *ctx) override ;

    private:
        static JSValue hsv2rgb(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
    } ;
}
