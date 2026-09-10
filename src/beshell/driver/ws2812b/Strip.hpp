#pragma once

#include <beshell/driver/DriverClass.hpp>
#include <cstdint>
#include "led_strip.h"


namespace be::driver::ws2812b{

    /**
     * HSV 转 RGB（C++ 侧共享 helper）
     * @param h 色相 0-360（自动取模回卷）
     * @param s 饱和度 0-1（自动截断）
     * @param v 明度 0-1（自动截断）
     */
    void hsv2rgb(double h, double s, double v, uint8_t & red, uint8_t & green, uint8_t & blue) ;

    // WS2812B LED 灯带驱动类
    //
    // 用于控制 WS2812B 全彩 LED 灯带，支持设置单个像素颜色、清空灯带和刷新显示。
    // 使用 RMT 硬件模块实现精确的时序控制。
    //（文档注释见 Strip.cpp）
    class Strip: public be::driver::DriverClass {
        DECLARE_NCLASS_META
    private:
        led_strip_handle_t led_strip = nullptr;
        int length = 0 ;
        int pin = -1 ;
        bool loop = false ;             // 首尾相接（回环），setPixel 越界索引取模回卷

        static std::vector<JSCFunctionListEntry> methods ;

        // 按当前 pin/length 成员（重）建 led_strip 句柄，已存在时先销毁
        esp_err_t initStrip() ;

    public:
        Strip(JSContext * ctx, JSValue _jsobj=JS_NULL) ;
        ~Strip() ;

        // C++ 侧绘制接口（与 JS 侧同名）
        void clear() ;
        void flush() ;
        void setPixel(int idx, uint8_t red, uint8_t green, uint8_t blue) ;
        void setPixelHSV(int idx, double h, double s, double v) ;

        bool isReady() const { return led_strip!=nullptr ; }
        int pixelCount() const { return length ; }
        bool isLoop() const { return loop ; }

        // C++ 侧配置导入/导出（JS 同名方法转调）
        JSValue exportConfig() ;
        void importConfig(JSValueConst cfg) ;

        static JSValue constructor(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;

        static JSValue setup(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue setPixel(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue setPixelHSV(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue clear(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue flush(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue exportConfig(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue importConfig(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;

        static JSValue getLoop(JSContext *ctx, JSValueConst this_val) ;
        static JSValue setLoop(JSContext *ctx, JSValueConst this_val, JSValueConst val) ;
    } ;
}
