#include "Strip.hpp"
#ifdef ESP_PLATFORM
#include "led_strip_rmt.h"
#else
#include "led_strip_pc.h"
#endif
#include <cmath>

using namespace std ;

namespace be::driver::ws2812b{

    void hsv2rgb(double h, double s, double v, uint8_t & red, uint8_t & green, uint8_t & blue) {
        h = fmod(h, 360.0) ;
        if(h<0) {
            h += 360.0 ;
        }
        if(s<0) s = 0 ; else if(s>100) s = 100 ;
        if(v<0) v = 0 ; else if(v>100) v = 100 ;
        s /= 100.0 ;
        v /= 100.0 ;

        double c = v * s ;
        double x = c * (1 - fabs(fmod(h/60.0, 2.0) - 1)) ;
        double m = v - c ;
        double rf, gf, bf ;
        if(h<60)       { rf=c; gf=x; bf=0; }
        else if(h<120) { rf=x; gf=c; bf=0; }
        else if(h<180) { rf=0; gf=c; bf=x; }
        else if(h<240) { rf=0; gf=x; bf=c; }
        else if(h<300) { rf=x; gf=0; bf=c; }
        else           { rf=c; gf=0; bf=x; }

        red   = (uint8_t)((rf+m)*255 + 0.5) ;
        green = (uint8_t)((gf+m)*255 + 0.5) ;
        blue  = (uint8_t)((bf+m)*255 + 0.5) ;
    }

    /**
     * WS2812B LED 灯带驱动类
     * 
     * 用于控制 WS2812B 全彩 LED 灯带，支持设置单个像素颜色、清空灯带和刷新显示。
     * 使用 RMT 硬件模块实现精确的时序控制。
     * 
     * 示例：
     * ```javascript
     * import { Strip } from "ws2812b"
     * 
     * // 创建 Strip 实例（30个LED，回环）
     * const strip = new Strip()
     * 
     * // 初始化配置
     * strip.setup({
     *     pin: 18,    // 数据引脚
     *     length: 30, // LED 数量
     *     loop: true  // 首尾相接（可选，默认 false）
     * })
     * 
     * // 设置第一个 LED 为红色
     * strip.setPixel(0, 255, 0, 0)
     * 
     * // HSV 方式设置第二个 LED 为绿色
     * strip.setPixelHSV(1, 120, 100, 100)
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
     * @class Strip
     * @module ws2812b
     * @extends NativeClass
     */
    DEFINE_NCLASS_META(Strip, DriverClass)
    std::vector<JSCFunctionListEntry> Strip::methods = {
        JS_CFUNC_DEF("setup", 1, Strip::setup),
        JS_CFUNC_DEF("setPixel", 4, Strip::setPixel),
        JS_CFUNC_DEF("setPixelHSV", 4, Strip::setPixelHSV),
        JS_CFUNC_DEF("clear", 0, Strip::clear),
        JS_CFUNC_DEF("flush", 0, Strip::flush),
        JS_CFUNC_DEF("exportConfig", 0, Strip::exportConfig),
        JS_CFUNC_DEF("importConfig", 1, Strip::importConfig),
        JS_CGETSET_DEF("loop", Strip::getLoop, Strip::setLoop),
    } ;

    Strip::Strip(JSContext * ctx, JSValue _jsobj)
        : DriverClass(ctx,build(ctx,_jsobj))
    {
    }
    Strip::~Strip() {
        if(led_strip) {
            led_strip_del(led_strip) ;
            led_strip = nullptr ;
        }
    }

    /**
     * 构造函数
     * 
     * 创建一个新的 Strip 实例。
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Strip
     * @method constructor
     * @return Strip 返回 Strip 实例
     */
    JSValue Strip::constructor(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        auto obj = new Strip(ctx) ;
        obj->shared() ;
        return obj->jsobj ;
    }

    // 按当前 pin/length 成员（重）建 led_strip 句柄
    esp_err_t Strip::initStrip() {
        if(led_strip) {
            led_strip_del(led_strip) ;
            led_strip = nullptr ;
        }
        if(pin<0 || length<1) {
            return ESP_ERR_INVALID_STATE ;
        }

        // LED strip general initialization, according to your led board design
        led_strip_config_t strip_config = {
            .strip_gpio_num = pin,   // The GPIO that connected to the LED strip's data line
            .max_leds = (uint32_t)length,       // The number of LEDs in the strip,
            .led_pixel_format = LED_PIXEL_FORMAT_GRB, // Pixel format of your LED strip
            .led_model = LED_MODEL_WS2812,            // LED strip model
            // .flags.invert_out = false,             // whether to invert the output signal
        };
        strip_config.flags.invert_out = false ;

#ifdef ESP_PLATFORM
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

        return led_strip_new_rmt_device(&strip_config, &rmt_config, &led_strip) ;
#else
        // PC 端：软件帧缓冲后端
        return led_strip_new_pc_device(&strip_config, &led_strip) ;
#endif
    }

    /**
     * 初始化 WS2812B LED 灯带
     * 
     * 配置 LED 灯带的数据引脚和 LED 数量。可重复调用（重复调用时先释放旧配置）。
     * 
     * 配置参数说明：
     * - pin: 连接 LED 灯带数据线的 GPIO 引脚号
     * - length: LED 灯带上的 LED 数量（1-1024）
     * - loop: 是否首尾相接（回环），默认 false
     * 
     * 示例：
     * ```javascript
     * strip.setup({
     *     pin: 18,
     *     length: 30,
     *     loop: true
     * })
     * ```
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Strip
     * @method setup
     * @param config:object 配置对象
     *     {
     *         pin: number,           // 数据引脚 GPIO 号
     *         length: number,        // LED 数量（1-1024）
     *         loop?: boolean         // 是否回环，默认 false
     *     }
     * @return undefined
     * @throws LED 数量必须在 1-1024 范围内
     * @throws LED 灯带初始化失败
     */
    JSValue Strip::setup(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Strip, that)
        CHECK_ARGC(1)

        uint32_t GET_UINT32_PROP(argv[0], "length", length, )
        if(length<1 || length>1024) {
            JSTHROW("length must be between 1 and 1024")
        }
        that->length = (int)length ;
        int32_t GET_INT32_PROP(argv[0], "pin", pin,  )
        that->pin = (int)pin ;
        GET_BOOL_PROP_OPT(argv[0], "loop", that->loop, false)

        if(that->initStrip()!= ESP_OK) {
            JSTHROW("Failed to initialize LED strip")
        }

        return JS_UNDEFINED ;
    }

    // ---------- C++ 侧绘制接口 ----------

    void Strip::clear() {
        if(led_strip) {
            led_strip_clear(led_strip) ;
        }
    }

    void Strip::flush() {
        if(led_strip) {
            led_strip_refresh(led_strip) ;
        }
    }

    void Strip::setPixel(int idx, uint8_t red, uint8_t green, uint8_t blue) {
        if(!led_strip || length<1) {
            return ;
        }
        if(loop) {
            // 回环：越界索引取模回卷
            idx %= length ;
            if(idx<0) {
                idx += length ;
            }
        }
        else if(idx<0 || idx>=length) {
            // 非回环：裁剪丢弃
            return ;
        }
        led_strip_set_pixel(led_strip, idx, red, green, blue) ;
    }

    void Strip::setPixelHSV(int idx, double h, double s, double v) {
        uint8_t r, g, b ;
        hsv2rgb(h, s, v, r, g, b) ;
        setPixel(idx, r, g, b) ;
    }

    /**
     * 设置单个像素的颜色
     * 
     * 设置指定索引位置的 LED 颜色。颜色值使用 RGB 格式，每个通道范围为 0-255。
     * 注意：调用此方法后需要调用 flush() 才能将颜色数据发送到灯带。
     * 
     * 示例：
     * ```javascript
     * strip.setPixel(0, 255, 0, 0)  // 第 0 个 LED 为红色
     * strip.flush()
     * ```
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Strip
     * @method setPixel
     * @param idx:number 像素索引（从 0 开始；回环模式下越界索引取模回卷）
     * @param red:number 红色通道值（0-255）
     * @param green:number 绿色通道值（0-255）
     * @param blue:number 蓝色通道值（0-255）
     * @return undefined
     * @throws 请先调用 setup()
     * @throws 无效的像素索引（非回环模式）
     */
    JSValue Strip::setPixel(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Strip, that)
        CHECK_ARGC(4)
        if(!that->led_strip) {
            JSTHROW("Please call setup() first")
        }

        int32_t idx, red, green, blue;
        if (JS_ToInt32(ctx, &idx, argv[0])) {
            JSTHROW("Invalid pixel index")
        }
        if (!that->loop && (idx < 0 || idx >= that->length)) {
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

        that->setPixel(idx, (uint8_t)red, (uint8_t)green, (uint8_t)blue) ;

        return JS_UNDEFINED ;
    }

    /**
     * 以 HSV 方式设置单个像素的颜色
     * 
     * HSV 到 RGB 的转换在 C++ 侧完成。h 自动取模回卷，s/v 自动截断到 0-100。
     * 注意：调用此方法后需要调用 flush() 才能将颜色数据发送到灯带。
     * 
     * 示例：
     * ```javascript
     * strip.setPixelHSV(0, 0, 100, 100)     // 第 0 个 LED 为红色
     * strip.setPixelHSV(1, 120, 100, 100)   // 第 1 个 LED 为绿色
     * strip.flush()
     * ```
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Strip
     * @method setPixelHSV
     * @param idx:number 像素索引（从 0 开始；回环模式下越界索引取模回卷）
     * @param h:number 色相（0-360，自动回卷）
     * @param s:number 饱和度（0-100）
     * @param v:number 明度（0-100）
     * @return undefined
     * @throws 请先调用 setup()
     */
    JSValue Strip::setPixelHSV(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Strip, that)
        CHECK_ARGC(4)
        if(!that->led_strip) {
            JSTHROW("Please call setup() first")
        }

        int32_t idx ;
        if (JS_ToInt32(ctx, &idx, argv[0])) {
            JSTHROW("Invalid pixel index")
        }
        if (!that->loop && (idx < 0 || idx >= that->length)) {
            JSTHROW("Invalid pixel index (must be between 0 and length-1)")
        }
        ARGV_TO_DOUBLE(1, h)
        ARGV_TO_DOUBLE(2, s)
        ARGV_TO_DOUBLE(3, v)

        that->setPixelHSV(idx, h, s, v) ;

        return JS_UNDEFINED ;
    }
    
    /**
     * 清空灯带
     * 
     * 将所有 LED 的颜色设置为关闭（黑色）。
     * 注意：调用此方法后需要调用 flush() 才能将数据发送到灯带。
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Strip
     * @method clear
     * @return undefined
     * @throws 请先调用 setup()
     */
    JSValue Strip::clear(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Strip, that)
        if(!that->led_strip) {
            JSTHROW("Please call setup() first")
        }
        that->clear() ;
        return JS_UNDEFINED ;
    }
    
    /**
     * 刷新显示
     * 
     * 将设置的颜色数据发送到 LED 灯带。在调用 setPixel() 或 clear() 后，
     * 必须调用此方法才能将更改应用到实际的 LED 灯带上。
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Strip
     * @method flush
     * @return undefined
     * @throws 请先调用 setup()
     */
    JSValue Strip::flush(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Strip, that)
        if(!that->led_strip) {
            JSTHROW("Please call setup() first")
        }
        that->flush() ;
        return JS_UNDEFINED ;
    }

    /**
     * 回环开关
     *
     * 读写 strip 是否首尾相接。回环模式下越界像素索引取模回卷。
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Strip
     * @property loop:boolean
     */
    JSValue Strip::getLoop(JSContext *ctx, JSValueConst this_val) {
        THIS_NCLASS(Strip, that)
        return JS_NewBool(ctx, that->loop) ;
    }
    JSValue Strip::setLoop(JSContext *ctx, JSValueConst this_val, JSValueConst val) {
        THIS_NCLASS(Strip, that)
        that->loop = JS_ToBool(ctx, val) ;
        return JS_UNDEFINED ;
    }

    // ---------- 配置导入/导出 ----------

    JSValue Strip::exportConfig() {
        JSValue obj = JS_NewObject(ctx) ;
        if(pin >= 0) JS_SetPropertyStr(ctx, obj, "pin", JS_NewInt32(ctx, (int32_t)pin)) ;
        if(length > 0) JS_SetPropertyStr(ctx, obj, "length", JS_NewInt32(ctx, length)) ;
        if(loop) JS_SetPropertyStr(ctx, obj, "loop", JS_NewBool(ctx, loop)) ;
        return obj ;
    }

    void Strip::importConfig(JSValueConst cfg) {
        JSValue v ;
        int32_t tmp ;
        v = JS_GetPropertyStr(ctx, cfg, "pin") ;
        if(JS_IsNumber(v) && JS_ToInt32(ctx, &tmp, v)==0) {
            pin = tmp ;
        }
        JS_FreeValue(ctx, v) ;
        v = JS_GetPropertyStr(ctx, cfg, "length") ;
        if(JS_IsNumber(v) && JS_ToInt32(ctx, &tmp, v)==0 && tmp>=1 && tmp<=1024) {
            length = tmp ;
        }
        JS_FreeValue(ctx, v) ;
        v = JS_GetPropertyStr(ctx, cfg, "loop") ;
        if(!JS_IsUndefined(v)) {
            loop = JS_ToBool(ctx, v) ;
        }
        JS_FreeValue(ctx, v) ;
        if(pin>=0 && length>0) {
            initStrip() ;
        }
    }

    /**
     * 导出配置
     *
     * 导出当前驱动层配置 `{pin, length, loop}`，返回可 JSON 序列化的对象。
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Strip
     * @method exportConfig
     * @return object 配置对象
     *     {
     *         pin: number,      // 数据引脚 GPIO 号
     *         length: number,   // LED 数量
     *         loop: boolean     // 是否回环
     *     }
     */
    JSValue Strip::exportConfig(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Strip, that)
        return that->exportConfig() ;
    }

    /**
     * 导入配置
     *
     * 从配置对象恢复驱动层设置（缺省字段保持当前值），并重建硬件。
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Strip
     * @method importConfig
     * @param config:object 配置对象（缺省字段保持当前值）
     *     {
     *         pin?: number,     // 数据引脚 GPIO 号
     *         length?: number,  // LED 数量（1-1024）
     *         loop?: boolean    // 是否回环
     *     }
     * @return undefined
     */
    JSValue Strip::importConfig(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Strip, that)
        CHECK_ARGC(1)
        if(!JS_IsObject(argv[0])) {
            JSTHROW("config must be an object")
        }
        that->importConfig(argv[0]) ;
        return JS_UNDEFINED ;
    }
}
