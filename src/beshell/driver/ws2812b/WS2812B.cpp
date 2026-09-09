/**
 * WS2812B 全彩 LED 灯带模块
 *
 * 提供 WS2812B 灯带的驱动与动画能力：
 *
 * - [Strip](Strip.html)：灯带驱动类，像素级 RGB/HSV 颜色设置，支持首尾相接的回环模式
 * - [Section](Section.html)：灯带分段，描述一段带起终点 HSV 渐变、过渡缓动与前后阴影的区段
 * - [Rainbow](Rainbow.html)：动画主控，管理分段并绘制灯带；时间线按需惰性创建，可用关键帧驱动分段属性动画，也可纯静态绘制
 * - `hsv2rgb()`：HSV 到 RGB 的颜色转换函数
 *
 * 使用前需在 C++ 侧注册模块（级联注册 Strip / Section / Rainbow）：
 * ```cpp
 * #include <beshell/driver/ws2812b/WS2812B.hpp>
 * beshell.use<be::driver::ws2812b::WS2812B>() ;
 * ```
 *
 * 示例：
 * ```javascript
 * import { Strip, Rainbow } from "ws2812b"
 *
 * // 创建灯带（16 个 LED，回环模式）
 * const strip = new Strip()
 * strip.setup({ pin: 8, length: 16, loop: true })
 *
 * // 创建动画主控：30fps，循环播放（frames 省略，自动以最后关键帧为总长）
 * const rainbow = new Rainbow(strip, { fps: 30, repeat: true })
 *
 * // 一个彩虹分段绕圈跑动（Section 只能由 addSection 创建）
 * const sec = rainbow.addSection({
 *     x: 0, len: 8, h0: 0, h1: 360, shadowBack: 2
 * })
 * sec.setKeyFrameMS(10000, { x: 16 })     // 10 秒处绕回环灯带一圈
 *
 * rainbow.draw()
 * rainbow.play()
 * ```
 *
 * @component beshell-drv-ws2812b
 * @module ws2812b
 */

#include "WS2812B.hpp"
#include "Strip.hpp"
#include "Section.hpp"
#include "Rainbow.hpp"
#include <beshell/BeShell.class.hpp>
#include <beshell/fs/FS.hpp>
#include <beshell/module/animator/Animator.hpp>


namespace be::driver::ws2812b{

    char const * const WS2812B::name = "ws2812b" ;

    void WS2812B::use(BeShell * beshell) {
        beshell->use<be::animator::Animator>() ;
        beshell->use<be::driver::ws2812b::Strip>() ;
    }

    WS2812B::WS2812B(JSContext * ctx, const char * name)
        : NativeModule(ctx, name, 0)
    {
        EXPORT_FUNCTION(hsv2rgb) ;

        exportClass<Strip>() ;
        exportClass<Section>() ;
        exportClass<Rainbow>() ;
    }

    void WS2812B::exports(JSContext *ctx) {
    }

    /**
     * HSV 转 RGB
     *
     * C++ 侧完成转换，供 JS 侧/编辑器预览颜色换算。
     *
     * 示例：
     * ```javascript
     * import { hsv2rgb } from "ws2812b"
     * console.log(hsv2rgb(120, 1, 1))   // [0, 255, 0]
     * ```
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @function hsv2rgb
     * @param h:number 色相（0-360，自动回卷）
     * @param s:number 饱和度（0-1）
     * @param v:number 明度（0-1）
     * @return Array\<number\> [r, g, b]，各通道范围 0-255
     */
    JSValue WS2812B::hsv2rgb(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        CHECK_ARGC(3)
        ARGV_TO_DOUBLE(0, h)
        ARGV_TO_DOUBLE(1, s)
        ARGV_TO_DOUBLE(2, v)

        uint8_t r, g, b ;
        be::driver::ws2812b::hsv2rgb(h, s, v, r, g, b) ;

        JSValue arr = JS_NewArray(ctx) ;
        JS_SetPropertyUint32(ctx, arr, 0, JS_NewUint32(ctx, r)) ;
        JS_SetPropertyUint32(ctx, arr, 1, JS_NewUint32(ctx, g)) ;
        JS_SetPropertyUint32(ctx, arr, 2, JS_NewUint32(ctx, b)) ;
        return arr ;
    }
}
