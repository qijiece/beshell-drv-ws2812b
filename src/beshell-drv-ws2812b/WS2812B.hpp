#pragma once

#include <beshell/NativeClass.hpp>
#include <cstdint>
#include "led_strip.h"


namespace be::driver::light{
    /**
     * WS2812B LED 灯带驱动类
     * 
     * 用于控制 WS2812B 全彩 LED 灯带，支持设置单个像素颜色、清空灯带和刷新显示。
     * 使用 RMT 硬件模块实现精确的时序控制。
     *
     * @component beshell-drv-ws2812b
     *
     * @class WS2812B
     * @module ws2812b
     * @extends NativeClass
     */
    class WS2812B: public be::NativeClass {
        DECLARE_NCLASS_META
    private:
        led_strip_handle_t led_strip = nullptr;
        int length = 0 ;

        static std::vector<JSCFunctionListEntry> methods ;
        // static std::vector<JSCFunctionListEntry> staticMethods ;

    public:
        WS2812B(JSContext * ctx, JSValue _jsobj=JS_NULL) ;
        ~WS2812B() ;
        
        static JSValue constructor(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;

        static JSValue setup(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue setPixel(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue clear(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue flush(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
    
    } ;
}