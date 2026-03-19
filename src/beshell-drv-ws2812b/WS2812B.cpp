#include "WS2812B.hpp"
#include "hal/gpio_types.h"
#include "led_strip.h"
#include "led_strip_rmt.h"
#include <cstdint>

using namespace std ;

namespace be::driver::light{
    /**
     * WS2812B LED 灯带驱动类
     * 
     * 用于控制 WS2812B 全彩 LED 灯带，支持设置单个像素颜色、清空灯带和刷新显示。
     * 使用 RMT 硬件模块实现精确的时序控制。
     * 
     * 示例：
     * ```javascript
     * import { WS2812B } from "ws2812b"
     * 
     * // 创建 WS2812B 实例（30个LED）
     * const strip = new WS2812B()
     * 
     * // 初始化配置
     * strip.setup({
     *     pin: 18,    // 数据引脚
     *     length: 30  // LED 数量
     * })
     * 
     * // 设置第一个 LED 为红色
     * strip.setPixel(0, 255, 0, 0)
     * 
     * // 设置第二个 LED 为绿色
     * strip.setPixel(1, 0, 255, 0)
     * 
     * // 刷新显示（将数据发送到灯带）
     * strip.flush()
     * 
     * // 清空灯带（所有 LED 熄灭）
     * strip.clear()
     * strip.flush()
     * ```
     *
     * @component beshell-drv-ws2812b
     *
     * @class WS2812B
     * @module ws2812b
     * @extends NativeClass
     */
    DEFINE_NCLASS_META(WS2812B, NativeClass)
    std::vector<JSCFunctionListEntry> WS2812B::methods = {
        JS_CFUNC_DEF("setup", 1, WS2812B::setup),
        JS_CFUNC_DEF("setPixel", 1, WS2812B::setPixel),
        JS_CFUNC_DEF("clear", 1, WS2812B::clear),
        JS_CFUNC_DEF("flush", 1, WS2812B::flush),
    } ;

    WS2812B::WS2812B(JSContext * ctx, JSValue _jsobj)
        : NativeClass(ctx,build(ctx,_jsobj))
    {
    }
    WS2812B::~WS2812B() {
        if(led_strip) {
            led_strip_del(led_strip) ;
            led_strip = nullptr ;
        }
    }

    /**
     * 构造函数
     * 
     * 创建一个新的 WS2812B 实例。
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class WS2812B
     * @method constructor
     * @return WS2812B 返回 WS2812B 实例
     */
    JSValue WS2812B::constructor(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        auto obj = new WS2812B(ctx) ;
        obj->shared() ;
        return obj->jsobj ;
    }

    /**
     * 初始化 WS2812B LED 灯带
     * 
     * 配置 LED 灯带的数据引脚和 LED 数量。
     * 
     * 配置参数说明：
     * - pin: 连接 LED 灯带数据线的 GPIO 引脚号
     * - length: LED 灯带上的 LED 数量（1-1024）
     * 
     * 示例：
     * ```javascript
     * // 基本配置
     * strip.setup({
     *     pin: 18,
     *     length: 30
     * })
     * ```
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class WS2812B
     * @method setup
     * @param config:object 配置对象
     * @param config.pin:number 数据引脚 GPIO 号
     * @param config.length:number LED 数量（1-1024）
     * @return undefined
     * @throws LED 数量必须在 1-1024 范围内
     * @throws LED 灯带初始化失败
     */
    JSValue WS2812B::setup(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(WS2812B, that)
        CHECK_ARGC(1)

        // 配置RMT
        GET_UINT32_PROP(argv[0], "length", that->length, )
        if(that->length<1 && that->length>1024) {
            JSTHROW("length must be between 1 and 1024")
        }
        gpio_num_t GET_GPIO_PROP(argv[0], "pin", pin,  )

        // LED strip general initialization, according to your led board design
        led_strip_config_t strip_config = {
            .strip_gpio_num = pin,   // The GPIO that connected to the LED strip's data line
            .max_leds = (uint32_t)that->length,        // The number of LEDs in the strip,
            .led_pixel_format = LED_PIXEL_FORMAT_GRB, // Pixel format of your LED strip
            .led_model = LED_MODEL_WS2812,            // LED strip model
            // .flags.invert_out = false,                // whether to invert the output signal
        };
        strip_config.flags.invert_out = false ;

        // LED strip backend configuration: RMT
        led_strip_rmt_config_t rmt_config = {
#if ESP_IDF_VERSION < ESP_IDF_VERSION_VAL(5, 0, 0)
            .rmt_channel = 0,
#else
            .clk_src = RMT_CLK_SRC_DEFAULT,        // different clock source can lead to different power consumption
            .resolution_hz = 10 * 1000 * 1000,     // RMT counter clock frequency
#endif
        };
        // DMA feature is available on ESP target like ESP32-S3
        rmt_config.flags.with_dma = false ;

        // LED Strip object handle
        if(led_strip_new_rmt_device(&strip_config, &rmt_config, &that->led_strip)!= ESP_OK) {
            JSTHROW("Failed to initialize LED strip")
        }

        return JS_UNDEFINED ;
    }

    
    /**
     * 设置单个像素的颜色
     * 
     * 设置指定索引位置的 LED 颜色。颜色值使用 RGB 格式，每个通道范围为 0-255。
     * 注意：调用此方法后需要调用 flush() 才能将颜色数据发送到灯带。
     * 
     * 示例：
     * ```javascript
     * // 设置第 0 个 LED 为红色
     * strip.setPixel(0, 255, 0, 0)
     * 
     * // 设置第 1 个 LED 为绿色
     * strip.setPixel(1, 0, 255, 0)
     * 
     * // 设置第 2 个 LED 为蓝色
     * strip.setPixel(2, 0, 0, 255)
     * 
     * // 设置第 3 个 LED 为白色（低亮度）
     * strip.setPixel(3, 50, 50, 50)
     * 
     * // 刷新显示
     * strip.flush()
     * ```
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class WS2812B
     * @method setPixel
     * @param idx:number 像素索引（从 0 开始）
     * @param red:number 红色通道值（0-255）
     * @param green:number 绿色通道值（0-255）
     * @param blue:number 蓝色通道值（0-255）
     * @return undefined
     * @throws 请先调用 setup()
     * @throws 无效的像素索引
     * @throws 无效的红色值
     * @throws 无效的绿色值
     * @throws 无效的蓝色值
     */
    JSValue WS2812B::setPixel(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(WS2812B, that)
        CHECK_ARGC(4)
        if(!that->led_strip) {
            JSTHROW("Please call setup() first")
        }

        int32_t idx, red, green, blue;
        if (JS_ToInt32(ctx, &idx, argv[0]) || idx < 0 || idx >= that->length) {
            JSTHROW("Invalid pixel index (must be between 0 and length-1)")
        }
        if (JS_ToInt32(ctx, &red, argv[1]) || red < 0 || red > 255) {
            JSTHROW("Invalid red value (must be between 0 and 255)")
        }
        if (JS_ToInt32(ctx, &green, argv[2]) || green < 0 || green > 255) {
            JSTHROW("Invalid green value (must be between 0 and 255)")
        }
        if (JS_ToInt32(ctx, &blue, argv[3]) || blue < 0 || blue > 255) {
            JSTHROW("Invalid blue value (must be between 0 and 255)")
        }

        led_strip_set_pixel(that->led_strip, idx, red, green, blue);

        return JS_UNDEFINED ;
    }
    
    /**
     * 清空灯带
     * 
     * 将所有 LED 的颜色设置为关闭（黑色）。
     * 注意：调用此方法后需要调用 flush() 才能将数据发送到灯带。
     * 
     * 示例：
     * ```javascript
     * // 清空灯带
     * strip.clear()
     * 
     * // 刷新显示
     * strip.flush()
     * ```
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class WS2812B
     * @method clear
     * @return undefined
     * @throws 请先调用 setup()
     */
    JSValue WS2812B::clear(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(WS2812B, that)
        if(!that->led_strip) {
            JSTHROW("Please call setup() first")
        }
        led_strip_clear(that->led_strip) ;
        return JS_UNDEFINED ;
    }
    
    /**
     * 刷新显示
     * 
     * 将设置的颜色数据发送到 LED 灯带。在调用 setPixel() 或 clear() 后，
     * 必须调用此方法才能将更改应用到实际的 LED 灯带上。
     * 
     * 示例：
     * ```javascript
     * // 设置颜色
     * strip.setPixel(0, 255, 0, 0)
     * strip.setPixel(1, 0, 255, 0)
     * 
     * // 刷新显示（必须调用）
     * strip.flush()
     * ```
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class WS2812B
     * @method flush
     * @return undefined
     * @throws 请先调用 setup()
     */
    JSValue WS2812B::flush(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(WS2812B, that)
        if(!that->led_strip) {
            JSTHROW("Please call setup() first")
        }
        led_strip_refresh(that->led_strip) ;
        return JS_UNDEFINED ;
    }
}