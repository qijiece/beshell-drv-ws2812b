#include "Section.hpp"
#include "Rainbow.hpp"
#include <cmath>
#include <cstring>

using namespace std ;

namespace be::driver::ws2812b{

    namespace tween = be::animator::tween ;

    // 可动画数值属性表（getProp/setProp 的 magic 即下标）——「间补」属性。
    // 数值成员分两类：平铺成员（x/len/shadowFront/shadowBack，flat）与
    // 过渡内成员（body/front/back 内的 h0/s0/v0/h1/s1/v1，经 trans + tMember 两级定位）。
    // C++ 无法用 `double Section::*` 直接表达「成员之成员」，故用两级成员指针 + 求址函数。
    typedef struct {
        const char * name ;
        Transition Section::* trans ;    // 非 null = 过渡内成员；null = 平铺成员
        double Transition::* tMember ;   // 过渡内 double 成员（trans 非 null 时使用）
        double Section::* flat ;         // 平铺 double 成员（trans 为 null 时使用）
        double def ;                     // 引擎默认值（导出时等于该值即省略）
        bool derived ;                   // true = 派生别名（前/后阴影起点，绘制时重算，导出始终省略）
    } NumPropDef ;
    static const NumPropDef numProps[] = {
        {"x",           nullptr, nullptr,              &Section::x,           0,   false},
        {"len",         nullptr, nullptr,              &Section::len,         1,   false},
        {"shadowFront", nullptr, nullptr,              &Section::shadowFront, 0,   false},
        {"shadowBack",  nullptr, nullptr,              &Section::shadowBack,  0,   false},
        {"h0",          &Section::body,  &Transition::h0,  nullptr,  0,   false},
        {"s0",          &Section::body,  &Transition::s0,  nullptr,  100, false},
        {"v0",          &Section::body,  &Transition::v0,  nullptr,  100, false},
        {"h1",          &Section::body,  &Transition::h1,  nullptr,  0,   false},
        {"s1",          &Section::body,  &Transition::s1,  nullptr,  100, false},
        {"v1",          &Section::body,  &Transition::v1,  nullptr,  100, false},
        {"frontH0",     &Section::front, &Transition::h0,  nullptr,  0,   true},
        {"frontS0",     &Section::front, &Transition::s0,  nullptr,  100, true},
        {"frontV0",     &Section::front, &Transition::v0,  nullptr,  100, true},
        {"frontH1",     &Section::front, &Transition::h1,  nullptr,  0,   false},
        {"frontS1",     &Section::front, &Transition::s1,  nullptr,  100, false},
        {"frontV1",     &Section::front, &Transition::v1,  nullptr,  0,   false},
        {"backH0",      &Section::back,  &Transition::h0,  nullptr,  0,   true},
        {"backS0",      &Section::back,  &Transition::s0,  nullptr,  100, true},
        {"backV0",      &Section::back,  &Transition::v0,  nullptr,  100, true},
        {"backH1",      &Section::back,  &Transition::h1,  nullptr,  0,   false},
        {"backS1",      &Section::back,  &Transition::s1,  nullptr,  100, false},
        {"backV1",      &Section::back,  &Transition::v1,  nullptr,  0,   false},
    } ;
    #define NUM_PROP_COUNT (sizeof(numProps)/sizeof(numProps[0]))

    // 求某个可动画数值属性的 double 地址（含嵌套成员）
    static inline double * numPropAddr(Section * sec, const NumPropDef & d) {
        if(d.trans) {
            return &((sec->*d.trans).*d.tMember) ;
        }
        return &(sec->*d.flat) ;
    }

    // 缓动配置属性表（magic = NUM_PROP_COUNT + 下标）——「过渡」静态缓动（全部为过渡内成员）
    typedef struct {
        const char * name ;
        Transition Section::* trans ;
        tween::TweenEaseType Transition::* member ;
    } EasePropDef ;
    static const EasePropDef easeProps[] = {
        {"easeH",       &Section::body,  &Transition::easeH},
        {"easeS",       &Section::body,  &Transition::easeS},
        {"easeV",       &Section::body,  &Transition::easeV},
        {"frontEaseH",  &Section::front, &Transition::easeH},
        {"frontEaseS",  &Section::front, &Transition::easeS},
        {"frontEaseV",  &Section::front, &Transition::easeV},
        {"backEaseH",   &Section::back,  &Transition::easeH},
        {"backEaseS",   &Section::back,  &Transition::easeS},
        {"backEaseV",   &Section::back,  &Transition::easeV},
    } ;
    #define EASE_PROP_COUNT (sizeof(easeProps)/sizeof(easeProps[0]))

    static inline tween::TweenEaseType & easeMember(Section * sec, const EasePropDef & d) {
        return (sec->*d.trans).*d.member ;
    }

    // 色相方向布尔属性表（magic = NUM_PROP_COUNT + EASE_PROP_COUNT + 下标）
    typedef struct {
        const char * name ;
        Transition Section::* trans ;
        bool Transition::* member ;
    } BoolPropDef ;
    static const BoolPropDef boolProps[] = {
        {"h_ccw",     &Section::body,  &Transition::h_ccw},
        {"frontCcw",  &Section::front, &Transition::h_ccw},
        {"backCcw",   &Section::back,  &Transition::h_ccw},
    } ;
    #define BOOL_PROP_COUNT (sizeof(boolProps)/sizeof(boolProps[0]))

    static inline bool & boolMember(Section * sec, const BoolPropDef & d) {
        return (sec->*d.trans).*d.member ;
    }

    // 缓动 S 参数表（不暴露为 JS 属性，仅 applyConfig/exportConfig 序列化）
    typedef struct {
        const char * name ;
        Transition Section::* trans ;
        double Transition::* member ;
    } SPropDef ;
    static const SPropDef sProps[] = {
        {"easeHS",      &Section::body,  &Transition::easeHS},
        {"easeSS",      &Section::body,  &Transition::easeSS},
        {"easeVS",      &Section::body,  &Transition::easeVS},
        {"frontEaseHS", &Section::front, &Transition::easeHS},
        {"frontEaseSS", &Section::front, &Transition::easeSS},
        {"frontEaseVS", &Section::front, &Transition::easeVS},
        {"backEaseHS",  &Section::back,  &Transition::easeHS},
        {"backEaseSS",  &Section::back,  &Transition::easeSS},
        {"backEaseVS",  &Section::back,  &Transition::easeVS},
    } ;
    #define S_PROP_COUNT (sizeof(sProps)/sizeof(sProps[0]))

    static inline double & sMember(Section * sec, const SPropDef & d) {
        return (sec->*d.trans).*d.member ;
    }

    // 解析 easeName/easeParams：ease 省略时返回 TWEEN_EASE_UNKNOWN（表示"未提供"）
    // 与 animator 模块 Timeline 的 JS 接口行为一致
    static bool parseEase(JSContext *ctx, JSValueConst jsEase, JSValueConst jsParams, tween::TweenEaseType & ease, double & easeS) {
        ease = tween::TWEEN_EASE_UNKNOWN ;
        easeS = 1.70158 ;
        if(JS_IsString(jsEase)) {
            const char * cstr = JS_ToCString(ctx, jsEase) ;
            std::string name = cstr ;
            JS_FreeCString(ctx, cstr) ;
            ease = tween::map_name_to_id(name.c_str()) ;
            if(ease==tween::TWEEN_EASE_UNKNOWN) {
                JS_ThrowReferenceError(ctx, "unknown ease name: %s", name.c_str()) ;
                return false ;
            }
        }
        else if(JS_IsNumber(jsEase)) {
            int32_t id ;
            if(JS_ToInt32(ctx, &id, jsEase)!=0) {
                JS_ThrowReferenceError(ctx, "invalid easeName") ;
                return false ;
            }
            ease = (tween::TweenEaseType) id ;
        }
        else if(!JS_IsNone(jsEase)) {
            JS_ThrowReferenceError(ctx, "easeName must be a string or number") ;
            return false ;
        }
        if(JS_IsNumber(jsParams)) {
            JS_ToFloat64(ctx, &easeS, jsParams) ;
        }
        return true ;
    }

    static inline const char * easeName(tween::TweenEaseType id) {
        if(id<0 || id>=tween::TWEEN_EASE_COUNT) {
            return "linear" ;
        }
        return tween::jsNames[id] ;
    }

    // quickjs.h 的 JS_CGETSET_MAGIC_DEF 在 C++ 下混用指定/非指定初始化会报错，
    // 这里去掉 .u 指定符（与 JS_CGETSET_DEF 相同写法）
    #define CGETSET_MAGIC_DEF_CPP(name, fgetter, fsetter, magic) \
        { name, JS_PROP_CONFIGURABLE, JS_DEF_CGETSET_MAGIC, magic, { .getset = { .get = { .getter_magic = fgetter }, .set = { .setter_magic = fsetter } } } }

    /**
     * 灯带分段
     *
     * 描述灯带上的一段：起始位置、主体长度、起/终点 HSV 颜色、各分量的过渡缓动，
     * 以及前驱（索引减小方向）/后续（索引增大方向）明度衰减的阴影。主体上色相默认沿顺时针（增大方向）
     * 从 h0 过渡到 h1（`h_ccw: true` 改为逆时针），三个分量（H/S/V）
     * 可分别指定缓动类型；`len` 为 1 时退化为点（仅使用起点色）。
     *
     * h0/h1 允许超出 0-360（可为负或多圈值），用于表达跨圈/多圈过渡，
     * 实际显示时对 360 取模；Rainbow 关键帧动画驱动 h0/h1 时同样生效
     * （如关键帧 0 → 720 表示随时间顺时针绕色相环两圈）。
     *
     * 全部数值属性既可由 JS 直接读写，也可被 Rainbow 的关键帧动画逐帧驱动；
     * 回环（loop）灯带上 x 超出灯带长度时自动取模套圈。
     *
     * Section 不提供 JS 构造函数，实例由 Rainbow 创建：
     * ```javascript
     * import { Strip, Rainbow } from "ws2812b"
     *
     * const strip = new Strip()
     * strip.setup({ pin: 8, length: 30 })
     *
     * const rainbow = new Rainbow(strip)
     * const sec = rainbow.addSection({
     *     x: 0, len: 8,
     *     h0: 0, s0: 100, v0: 100,   // 起点：红
     *     h1: 360, s1: 100, v1: 100, // 终点：顺时针绕色相环一圈（默认方向）
     *     easeH: "inOutSine",
     *     shadowFront: 3, shadowFrontEase: "outQuad",
     *     shadowBack: 2
     * })
     *
     * rainbow.draw()
     * ```
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Section
     * @extends NativeClass
     */
    DEFINE_NCLASS_META(Section, DriverClass)
    std::vector<JSCFunctionListEntry> Section::methods = {
        JS_CFUNC_DEF("set", 1, Section::set),
        JS_CFUNC_DEF("setKeyFrame", 2, Section::setKeyFrame),
        JS_CFUNC_DEF("setKeyFrameMS", 2, Section::setKeyFrameMS),
        JS_CFUNC_DEF("unset", 1, Section::unset),
        JS_CFUNC_DEF("draw", 1, Section::draw),
        JS_CFUNC_DEF("exportConfig", 0, Section::exportConfig),
        JS_CFUNC_DEF("importConfig", 1, Section::importConfig),
        CGETSET_MAGIC_DEF_CPP("x",           Section::getProp, Section::setProp, 0),
        CGETSET_MAGIC_DEF_CPP("len",         Section::getProp, Section::setProp, 1),
        CGETSET_MAGIC_DEF_CPP("shadowFront", Section::getProp, Section::setProp, 2),
        CGETSET_MAGIC_DEF_CPP("shadowBack",  Section::getProp, Section::setProp, 3),
        CGETSET_MAGIC_DEF_CPP("h0",          Section::getProp, Section::setProp, 4),
        CGETSET_MAGIC_DEF_CPP("s0",          Section::getProp, Section::setProp, 5),
        CGETSET_MAGIC_DEF_CPP("v0",          Section::getProp, Section::setProp, 6),
        CGETSET_MAGIC_DEF_CPP("h1",          Section::getProp, Section::setProp, 7),
        CGETSET_MAGIC_DEF_CPP("s1",          Section::getProp, Section::setProp, 8),
        CGETSET_MAGIC_DEF_CPP("v1",          Section::getProp, Section::setProp, 9),
        CGETSET_MAGIC_DEF_CPP("frontH0",     Section::getProp, Section::setProp, 10),
        CGETSET_MAGIC_DEF_CPP("frontS0",     Section::getProp, Section::setProp, 11),
        CGETSET_MAGIC_DEF_CPP("frontV0",     Section::getProp, Section::setProp, 12),
        CGETSET_MAGIC_DEF_CPP("frontH1",     Section::getProp, Section::setProp, 13),
        CGETSET_MAGIC_DEF_CPP("frontS1",     Section::getProp, Section::setProp, 14),
        CGETSET_MAGIC_DEF_CPP("frontV1",     Section::getProp, Section::setProp, 15),
        CGETSET_MAGIC_DEF_CPP("backH0",      Section::getProp, Section::setProp, 16),
        CGETSET_MAGIC_DEF_CPP("backS0",      Section::getProp, Section::setProp, 17),
        CGETSET_MAGIC_DEF_CPP("backV0",      Section::getProp, Section::setProp, 18),
        CGETSET_MAGIC_DEF_CPP("backH1",      Section::getProp, Section::setProp, 19),
        CGETSET_MAGIC_DEF_CPP("backS1",      Section::getProp, Section::setProp, 20),
        CGETSET_MAGIC_DEF_CPP("backV1",      Section::getProp, Section::setProp, 21),
        CGETSET_MAGIC_DEF_CPP("easeH",       Section::getProp, Section::setProp, 22),
        CGETSET_MAGIC_DEF_CPP("easeS",       Section::getProp, Section::setProp, 23),
        CGETSET_MAGIC_DEF_CPP("easeV",       Section::getProp, Section::setProp, 24),
        CGETSET_MAGIC_DEF_CPP("frontEaseH",  Section::getProp, Section::setProp, 25),
        CGETSET_MAGIC_DEF_CPP("frontEaseS",  Section::getProp, Section::setProp, 26),
        CGETSET_MAGIC_DEF_CPP("frontEaseV",  Section::getProp, Section::setProp, 27),
        CGETSET_MAGIC_DEF_CPP("backEaseH",   Section::getProp, Section::setProp, 28),
        CGETSET_MAGIC_DEF_CPP("backEaseS",   Section::getProp, Section::setProp, 29),
        CGETSET_MAGIC_DEF_CPP("backEaseV",   Section::getProp, Section::setProp, 30),
        CGETSET_MAGIC_DEF_CPP("h_ccw",       Section::getProp, Section::setProp, 31),
        CGETSET_MAGIC_DEF_CPP("frontCcw",    Section::getProp, Section::setProp, 32),
        CGETSET_MAGIC_DEF_CPP("backCcw",     Section::getProp, Section::setProp, 33),
    } ;

    Section::Section(JSContext * ctx, JSValue _jsobj)
        : DriverClass(ctx,build(ctx,_jsobj))
    {
        // 阴影默认淡出到黑（body 起点/终点默认全彩 100；shadow 的 v1 覆盖为 0）
        front.v1 = 0 ;
        back.v1 = 0 ;
    }

    Section::~Section() {
        // rainbowObj 为弱引用（不持有计数，由 Rainbow 析构/removeSection 时清为 JS_UNDEFINED），
        // 避免与 Rainbow.sections 形成循环引用导致双方都无法 GC
    }

    Rainbow * Section::rainbow() {
        if(!JS_IsObject(rainbowObj)) {
            return nullptr ;
        }
        return (Rainbow*) NativeClass::fromJS(rainbowObj) ;
    }

    double * Section::propMember(Section * sec, const char * name) {
        for(size_t i=0; i<NUM_PROP_COUNT; i++) {
            if(strcmp(numProps[i].name, name)==0) {
                return numPropAddr(sec, numProps[i]) ;
            }
        }
        return nullptr ;
    }

    const char * Section::propName(Section * sec, const double * cptr) {
        for(size_t i=0; i<NUM_PROP_COUNT; i++) {
            if(numPropAddr(sec, numProps[i])==cptr) {
                return numProps[i].name ;
            }
        }
        return nullptr ;
    }

    // 可动画、非派生属性的个数（关键帧分组键集合大小）
    size_t Section::propCount() {
        size_t n = 0 ;
        for(size_t i=0; i<NUM_PROP_COUNT; i++) {
            if(!numProps[i].derived) n++ ;
        }
        return n ;
    }

    // 第 idx 个可动画、非派生属性的全名（idx < propCount()）
    const char * Section::propNameAt(size_t idx) {
        for(size_t i=0; i<NUM_PROP_COUNT; i++) {
            if(numProps[i].derived) continue ;
            if(idx==0) return numProps[i].name ;
            idx-- ;
        }
        return nullptr ;
    }

    // 属性名的引擎默认值（未知属性返回 0）
    double Section::propDefault(const char * name) {
        for(size_t i=0; i<NUM_PROP_COUNT; i++) {
            if(strcmp(numProps[i].name, name)==0) {
                return numProps[i].def ;
            }
        }
        return 0 ;
    }

    /**
     * 构造函数（禁用）
     *
     * Section 实例只能由 Rainbow 创建：`rainbow.addSection(config)`。
     *
     * @module ws2812b
     * @class Section
     * @method constructor
     * @throws 始终抛出异常
     */
    JSValue Section::constructor(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        JSTHROW("Section cannot be constructed directly, use rainbow.addSection(config) instead")
    }

    // ---------- 属性读写 ----------

    /**
     * 分段起始位置（像素索引，可为小数，绘制时四舍五入）
     *
     * 回环（loop）灯带上绘制时自动对灯带长度取模套圈。
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Section
     * @property x:number
     */
    /**
     * 主体长度（像素数，>=1），为 1 时退化为点（终点 HSV 无意义）
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Section
     * @property len:number
     */
    /**
     * 起点色相（0-360，绘制时自动回卷；允许超出范围表达跨圈/多圈过渡）
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Section
     * @property h0:number
     */
    /**
     * 起点饱和度（0-100）
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Section
     * @property s0:number
     */
    /**
     * 起点明度（0-100）
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Section
     * @property v0:number
     */
    /**
     * 终点色相（0-360，允许超出范围），主体内从 h0 沿顺时针（默认，h_ccw=true 时逆时针）过渡到 h1
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Section
     * @property h1:number
     */
    /**
     * 终点饱和度（0-100）
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Section
     * @property s1:number
     */
    /**
     * 终点明度（0-100）
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Section
     * @property v1:number
     */
    /**
     * 前驱阴影长度（像素数）：索引减小方向（x 之前），取起点色、明度衰减至 0
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Section
     * @property shadowFront:number
     */
    /**
     * 后续阴影长度（像素数）：索引增大方向（主体末尾之后），取终点色、明度衰减至 0
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Section
     * @property shadowBack:number
     */
    /**
     * 色相过渡缓动类型名称（如 "linear"、"inOutSine"），见 animator 模块 tween 库
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Section
     * @property easeH:string
     */
    /**
     * 饱和度过渡缓动类型名称
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Section
     * @property easeS:string
     */
    /**
     * 明度过渡缓动类型名称
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Section
     * @property easeV:string
     */
    /**
     * 前驱阴影（索引减小方向）的明度衰减缓动类型名称
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Section
     * @property shadowFrontEase:string
     */
    /**
     * 后续阴影（索引增大方向）的明度衰减缓动类型名称
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Section
     * @property shadowBackEase:string
     */

    /**
     * 色相过渡方向：false=顺时针（色相增大，默认），true=逆时针（色相减小）
     *
     * h1-h0 与方向不符时归一化到方向所在的一圈内（如顺时针下 0→360 走一整圈）；
     * 与方向一致的多圈差值（如 0→720）原样保留。显示时对 360 取模。
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Section
     * @property h_ccw:boolean
     */

    JSValue Section::getProp(JSContext *ctx, JSValueConst this_val, int magic) {
        THIS_NCLASS(Section, that)
        if(magic<(int)NUM_PROP_COUNT) {
            return JS_NewFloat64(ctx, *numPropAddr(that, numProps[magic])) ;
        }
        magic -= NUM_PROP_COUNT ;
        if(magic<(int)EASE_PROP_COUNT) {
            return JS_NewString(ctx, easeName(easeMember(that, easeProps[magic]))) ;
        }
        magic -= EASE_PROP_COUNT ;
        if(magic<(int)BOOL_PROP_COUNT) {
            return JS_NewBool(ctx, boolMember(that, boolProps[magic])) ;
        }
        return JS_UNDEFINED ;
    }

    JSValue Section::setProp(JSContext *ctx, JSValueConst this_val, JSValueConst val, int magic) {
        THIS_NCLASS(Section, that)
        if(magic<(int)NUM_PROP_COUNT) {
            double v ;
            if(JS_ToFloat64(ctx, &v, val)!=0) {
                JSTHROW("property %s must be a number", numProps[magic].name)
            }
            *numPropAddr(that, numProps[magic]) = v ;
            return JS_UNDEFINED ;
        }
        magic -= NUM_PROP_COUNT ;
        if(magic<(int)EASE_PROP_COUNT) {
            if(JS_IsString(val)) {
                const char * cstr = JS_ToCString(ctx, val) ;
                tween::TweenEaseType e = tween::map_name_to_id(cstr) ;
                JS_FreeCString(ctx, cstr) ;
                if(e==tween::TWEEN_EASE_UNKNOWN) {
                    JSTHROW("unknown ease name for %s", easeProps[magic].name)
                }
                easeMember(that, easeProps[magic]) = e ;
            }
            else if(JS_IsNumber(val)) {
                int32_t id ;
                if(JS_ToInt32(ctx, &id, val)!=0 || id<0 || id>=tween::TWEEN_EASE_COUNT) {
                    JSTHROW("invalid ease id for %s", easeProps[magic].name)
                }
                easeMember(that, easeProps[magic]) = (tween::TweenEaseType) id ;
            }
            else {
                JSTHROW("property %s must be an ease name string", easeProps[magic].name)
            }
            return JS_UNDEFINED ;
        }
        magic -= EASE_PROP_COUNT ;
        if(magic<(int)BOOL_PROP_COUNT) {
            boolMember(that, boolProps[magic]) = JS_ToBool(ctx, val) ;
            return JS_UNDEFINED ;
        }
        return JS_UNDEFINED ;
    }

    // ---------- 绘制 ----------

    // 渲染一种过渡：从 startIdx 起、按 step 方向、共 count 颗，第 i 颗的 t=(tOffset+i)/tDenom
    //（tDenom<=0 时 t 恒 0，即只用起点色）。三种过渡（主体/前阴影/后阴影）共用，结构完全一致。
    static void drawTransition(Strip * strip, int startIdx, int count, int step,
                               double tOffset, double tDenom, const Transition & tr) {
        if(count<=0) {
            return ;
        }
        // 色相方向归一（h1==h0 时 dh=0，纯色不整圈）；与方向一致的多圈差值（如 0→720）原样保留
        double dh = tr.h1 - tr.h0 ;
        if(tr.h_ccw) {
            if(dh>0) {
                dh = fmod(dh, 360.0) ;
                if(dh>=0) {
                    dh -= 360.0 ;
                }
            }
        }
        else {
            if(dh<0) {
                dh = fmod(dh, 360.0) ;
                if(dh<=0) {
                    dh += 360.0 ;
                }
            }
        }
        for(int i=0; i<count; i++) {
            double t = tDenom>0 ? (tOffset + i) / tDenom : 0 ;
            if(t>1) {
                t = 1 ;
            }
            if(t<0) {
                t = 0 ;
            }
            double h = tr.h0 + dh * tween::ease(tr.easeH, (float)t, 0, 1, 1, (float)tr.easeHS) ;
            double s = tr.s0 + (tr.s1 - tr.s0) * tween::ease(tr.easeS, (float)t, 0, 1, 1, (float)tr.easeSS) ;
            double v = tr.v0 + (tr.v1 - tr.v0) * tween::ease(tr.easeV, (float)t, 0, 1, 1, (float)tr.easeVS) ;
            strip->setPixelHSV(startIdx + i*step, h, s, v) ;
        }
    }

    void Section::drawTo(Strip * strip) {
        if(!strip || !strip->isReady()) {
            return ;
        }
        int stripLen = strip->pixelCount() ;
        if(stripLen<1) {
            return ;
        }

        // 套圈归一化：回环 strip 上 x 超出范围时对长度取模（非回环不取模）
        if(strip->isLoop()) {
            x = fmod(x, (double)stripLen) ;
            if(x<0) {
                x += stripLen ;
            }
        }

        int n = (int)(len + 0.5) ;
        if(n<1) {
            n = 1 ;
        }
        int xi = (int)(x + 0.5) ;

        // 主体终点：长度仅 1 颗灯珠时折叠到起点（无渐变空间），后阴影据此作为起点
        double bodyH1 = (n>1) ? body.h1 : body.h0 ;
        double bodyS1 = (n>1) ? body.s1 : body.s0 ;
        double bodyV1 = (n>1) ? body.v1 : body.v0 ;

        // 主体过渡：起点 → 终点（len==1 时退化为点，只用起点色）
        drawTransition(strip, xi, n, +1, 0, n>1 ? (double)(n-1) : 0, body) ;

        // 前阴影过渡：起点向前（索引减小），起点色 = 主体起点色（4 色模型，无独立 frontH0）
        if(shadowFront>0) {
            Transition ft = front ;
            ft.h0 = body.h0 ; ft.s0 = body.s0 ; ft.v0 = body.v0 ;
            drawTransition(strip, xi-1, (int)(shadowFront+0.5), -1, 1, shadowFront, ft) ;
        }

        // 后阴影过渡：起点向后（索引增大），起点色 = 主体有效终点色
        //（无主体过渡时终点==起点，等同从起点属性值过渡；长度仅 1 颗时终点折叠到起点）
        if(shadowBack>0) {
            Transition bt = back ;
            bt.h0 = bodyH1 ; bt.s0 = bodyS1 ; bt.v0 = bodyV1 ;
            drawTransition(strip, xi+n, (int)(shadowBack+0.5), +1, 1, shadowBack, bt) ;
        }
    }

    // ---------- 关键帧 ----------

    int Section::setOne(uint32_t frame, const char * prop, JSValueConst jsValue, JSValueConst jsEase, JSValueConst jsParams) {
        double * member = Section::propMember(this, prop) ;
        if(!member) {
            JS_ThrowReferenceError(ctx, "unknown section property: %s", prop) ;
            return -1 ;
        }
        double value ;
        if(JS_ToFloat64(ctx, &value, jsValue)!=0) {
            JS_ThrowReferenceError(ctx, "keyframe value of %s must be a number", prop) ;
            return -1 ;
        }
        tween::TweenEaseType ease ;
        double easeS ;
        if(!parseEase(ctx, jsEase, jsParams, ease, easeS)) {
            return -1 ;
        }
        // C++ 指针轨道：直接绑定成员变量，本分段 jsobj 作 guard 防止 GC
        Rainbow * r = rainbow() ;
        if(!r) {
            JS_ThrowReferenceError(ctx, "section is not attached to a rainbow") ;
            return -1 ;
        }
        r->ensureTimeline()->set(frame, member, value, ease, easeS, jsobj) ;
        return 0 ;
    }

    // 处理属性表 {prop: value | [value, easeName?, easeParams?], ..., ease?, easeS?}，出错返回 -1
    // 表级 ease/easeS 键为该帧全部属性的默认缓动（数组形式内可单独覆盖）
    int Section::setPropMap(uint32_t frame, JSValueConst map) {
        int ret = 0 ;
        JSValue mapEase = JS_GetPropertyStr(ctx, map, "ease") ;
        JSValue mapEaseS = JS_GetPropertyStr(ctx, map, "easeS") ;
        JSPropertyEnum * ptab = nullptr ;
        uint32_t plen = 0 ;
        if(JS_GetOwnPropertyNames(ctx, &ptab, &plen, map, JS_GPN_STRING_MASK|JS_GPN_ENUM_ONLY)!=0) {
            js_std_dump_error(ctx) ;
            JS_FreeValue(ctx, mapEase) ;
            JS_FreeValue(ctx, mapEaseS) ;
            return -1 ;
        }
        for(uint32_t i=0; i<plen && ret==0; i++) {
            const char * pname = JS_AtomToCString(ctx, ptab[i].atom) ;
            if(strcmp(pname, "ease")==0 || strcmp(pname, "easeS")==0) {
                JS_FreeCString(ctx, pname) ;
                continue ;    // 表级缓动键，不是分段属性
            }
            JSValue v = JS_GetProperty(ctx, map, ptab[i].atom) ;
            if(JS_IsArray(ctx, v)) {
                // [value, easeName?, easeParams?]，未提供的项回落到表级 ease/easeS
                JSValue jv0 = JS_GetPropertyUint32(ctx, v, 0) ;
                JSValue jv1 = JS_GetPropertyUint32(ctx, v, 1) ;
                JSValue jv2 = JS_GetPropertyUint32(ctx, v, 2) ;
                ret = setOne(frame, pname, jv0
                    , JS_IsNone(jv1) ? mapEase : jv1
                    , JS_IsNone(jv2) ? mapEaseS : jv2) ;
                JS_FreeValue(ctx, jv0) ;
                JS_FreeValue(ctx, jv1) ;
                JS_FreeValue(ctx, jv2) ;
            } else {
                ret = setOne(frame, pname, v, mapEase, mapEaseS) ;
            }
            JS_FreeValue(ctx, v) ;
            JS_FreeCString(ctx, pname) ;
        }
        JS_FreeValue(ctx, mapEase) ;
        JS_FreeValue(ctx, mapEaseS) ;
        // 该版本 QuickJS 无 JS_FreePropertyEnum，手动释放
        for(uint32_t i=0; i<plen; i++) {
            JS_FreeAtom(ctx, ptab[i].atom) ;
        }
        js_free(ctx, ptab) ;
        return ret ;
    }

    /**
     * 在游标帧设置关键帧
     *
     * 在所属 Rainbow 的游标帧（`rainbow.cursor` / `rainbow.setCursorMS()` 定位）上
     * 写入属性关键帧：
     * ```javascript
     * rainbow.cursor = 0
     * sec.set({ x: 0 })                              // 0 帧关键帧
     * rainbow.setCursorMS(10000)                     // 游标移动到 10 秒
     * sec.set({ x: 16, ease: "linear" })             // 10 秒处关键帧（表级 ease 为该帧全部属性的默认缓动）
     * ```
     *
     * 属性表接受可动画属性（x/len/起终点 HSV/前后阴影长度）与表级 `ease`/`easeS` 键
     * （该帧全部属性的默认缓动，数组形式 `[value, easeName?, easeS?]` 可单独覆盖）。
     * 超出总帧数时自动扩展总长。静态（无动画）设置请用 `addSection(config)`
     * 或直接属性赋值（`sec.x = 5`）。
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Section
     * @method set
     * @param props:object 属性表
     * @return undefined
     * @throws 分段未加入 Rainbow 或属性名无效时抛出异常
     */
    JSValue Section::set(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Section, that)
        CHECK_ARGC(1)
        if(!JS_IsObject(argv[0]) || JS_IsArray(ctx, argv[0])) {
            JSTHROW("props must be an object")
        }
        Rainbow * r = that->rainbow() ;
        if(!r) {
            JSTHROW("section is not attached to a rainbow")
        }
        if(that->setPropMap(r->getCursor(), argv[0])<0) {
            return JS_EXCEPTION ;
        }
        return JS_UNDEFINED ;
    }

    /**
     * 在指定帧设置关键帧
     *
     * ```javascript
     * sec.setKeyFrame(300, { x: 16, ease: "linear" })
     * ```
     * 属性表形式同 set()。超出总帧数时自动扩展总长。
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Section
     * @method setKeyFrame
     * @param frame:number 帧号（>=0）
     * @param props:object 属性表
     * @return undefined
     * @throws 分段未加入 Rainbow 或属性名无效时抛出异常
     */
    JSValue Section::setKeyFrame(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Section, that)
        CHECK_ARGC(2)
        ARGV_TO_INT32(0, frame)
        if(frame<0) {
            JSTHROW("frame must be >= 0")
        }
        if(!JS_IsObject(argv[1]) || JS_IsArray(ctx, argv[1])) {
            JSTHROW("props must be an object")
        }
        Rainbow * r = that->rainbow() ;
        if(!r) {
            JSTHROW("section is not attached to a rainbow")
        }
        if(that->setPropMap((uint32_t)frame, argv[1])<0) {
            return JS_EXCEPTION ;
        }
        return JS_UNDEFINED ;
    }

    /**
     * 在指定时间（毫秒）设置关键帧
     *
     * 由所属 Rainbow 按 fps 换算为帧号（`rainbow.timeToFrame(ms)`），其余同 setKeyFrame()：
     * ```javascript
     * sec.setKeyFrameMS(10000, { x: 16, ease: "linear" })   // 10 秒处关键帧
     * ```
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Section
     * @method setKeyFrameMS
     * @param time:number 时间（毫秒，>=0）
     * @param props:object 属性表
     * @return undefined
     * @throws 分段未加入 Rainbow 或属性名无效时抛出异常
     */
    JSValue Section::setKeyFrameMS(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Section, that)
        CHECK_ARGC(2)
        double ms = 0 ;
        if(JS_ToFloat64(ctx, &ms, argv[0])!=0 || ms<0) {
            JSTHROW("time must be a number >= 0")
        }
        if(!JS_IsObject(argv[1]) || JS_IsArray(ctx, argv[1])) {
            JSTHROW("props must be an object")
        }
        Rainbow * r = that->rainbow() ;
        if(!r) {
            JSTHROW("section is not attached to a rainbow")
        }
        if(that->setPropMap(r->timeToFrame(ms), argv[1])<0) {
            return JS_EXCEPTION ;
        }
        return JS_UNDEFINED ;
    }

    /**
     * 移除关键帧
     *
     * ```javascript
     * sec.unset(5000)          // 移除 5 秒处此分段的全部属性关键帧
     * sec.unset("x")           // 移除 x 属性的全部关键帧（所有时间）
     * sec.unset("x", 5000)     // 移除 x 属性在 5 秒处的关键帧（参数顺序与 set 一致）
     * ```
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Section
     * @method unset
     * @param prop:string= 属性名（可选，缺省时按时间移除全部属性轨道）
     * @param time:number= 时间（毫秒），与 prop 至少提供一个
     * @return undefined
     */
    JSValue Section::unset(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Section, that)
        CHECK_ARGC(1)
        // 参数形式：unset([prop,] timeMs?)，与 set(props, time) 顺序一致
        const char * prop = nullptr ;
        double ms = -1 ;
        int ai = 0 ;
        if(JS_IsString(argv[0])) {
            prop = JS_ToCString(ctx, argv[0]) ;
            ai = 1 ;
        }
        if(argc>ai && JS_IsNumber(argv[ai])) {
            JS_ToFloat64(ctx, &ms, argv[ai]) ;
        }
        if(!prop && ms<0) {
            JSTHROW("usage: sec.unset([prop,] timeMs)")
        }
        Rainbow * r = that->rainbow() ;
        if(!r) {
            if(prop) JS_FreeCString(ctx, prop) ;
            JSTHROW("section is not attached to a rainbow")
        }
        if(!r->timeline) {
            if(prop) JS_FreeCString(ctx, prop) ;
            return JS_UNDEFINED ;    // 时间线未创建，无关键帧可删
        }
        if(prop) {
            double * member = Section::propMember(that, prop) ;
            JS_FreeCString(ctx, prop) ;
            if(!member) {
                JSTHROW("unknown section property")
            }
            void * cptr = (void*)member ;
            if(ms>=0) {
                r->timeline->unset(r->timeToFrame(ms), cptr) ;   // 该属性在指定帧
            } else {
                r->timeline->unset(cptr) ;                       // 该属性整轨
            }
        } else {
            // 仅时间：移除该帧此分段的全部可动画属性轨道
            uint32_t frame = r->timeToFrame(ms) ;
            for(size_t i=0; i<NUM_PROP_COUNT; i++) {
                r->timeline->unset(frame, (void*)numPropAddr(that, numProps[i])) ;
            }
        }
        return JS_UNDEFINED ;
    }

    /**
     * 绘制分段
     *
     * 将分段绘制到 strip（内部调用 strip.setPixelHSV，不含 clear/flush）。
     * 通常不需要手动调用——加入 Rainbow 后由 timeline 的 change 事件自动驱动重绘。
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Section
     * @method draw
     * @param strip:Strip= 目标灯带，缺省为 Rainbow 绑定的 strip
     * @return undefined
     * @throws 分段未绑定 strip 且未显式传入时抛出异常
     */
    JSValue Section::draw(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Section, that)
        Strip * strip = that->strip ;
        if(argc>0 && !JS_IsUndefined(argv[0]) && !JS_IsNull(argv[0])) {
            JSVALUE_TO_NCLASS(Strip, argv[0], explicitStrip)
            strip = explicitStrip ;
        }
        if(!strip) {
            JSTHROW("section is not bound to a strip, please call draw(strip) explicitly")
        }
        that->drawTo(strip) ;
        return JS_UNDEFINED ;
    }

    // ---------- 配置导入/导出 ----------

    void Section::applyConfig(JSValueConst cfg) {
        if(!JS_IsObject(cfg)) {
            return ;
        }
        for(size_t i=0; i<NUM_PROP_COUNT; i++) {
            JSValue v = JS_GetPropertyStr(ctx, cfg, numProps[i].name) ;
            if(JS_IsNumber(v)) {
                double d ;
                if(JS_ToFloat64(ctx, &d, v)==0) {
                    *numPropAddr(this, numProps[i]) = d ;
                }
            }
            JS_FreeValue(ctx, v) ;
        }
        for(size_t i=0; i<EASE_PROP_COUNT; i++) {
            JSValue v = JS_GetPropertyStr(ctx, cfg, easeProps[i].name) ;
            if(JS_IsString(v)) {
                const char * cstr = JS_ToCString(ctx, v) ;
                tween::TweenEaseType e = tween::map_name_to_id(cstr) ;
                JS_FreeCString(ctx, cstr) ;
                if(e!=tween::TWEEN_EASE_UNKNOWN) {
                    easeMember(this, easeProps[i]) = e ;
                }
            }
            else if(JS_IsNumber(v)) {
                int32_t id ;
                if(JS_ToInt32(ctx, &id, v)==0 && id>=0 && id<tween::TWEEN_EASE_COUNT) {
                    easeMember(this, easeProps[i]) = (tween::TweenEaseType) id ;
                }
            }
            JS_FreeValue(ctx, v) ;
        }
        for(size_t i=0; i<BOOL_PROP_COUNT; i++) {
            JSValue v = JS_GetPropertyStr(ctx, cfg, boolProps[i].name) ;
            if(JS_IsBool(v)) {
                boolMember(this, boolProps[i]) = JS_ToBool(ctx, v) ;
            }
            JS_FreeValue(ctx, v) ;
        }
        for(size_t i=0; i<S_PROP_COUNT; i++) {
            JSValue v = JS_GetPropertyStr(ctx, cfg, sProps[i].name) ;
            if(JS_IsNumber(v)) {
                double d ;
                if(JS_ToFloat64(ctx, &d, v)==0) {
                    sMember(this, sProps[i]) = d ;
                }
            }
            JS_FreeValue(ctx, v) ;
        }
    }

    JSValue Section::exportConfig(bool includeNumProps) {
        JSValue obj = JS_NewObject(ctx) ;
        if(includeNumProps) {
            for(size_t i=0; i<NUM_PROP_COUNT; i++) {
                if(numProps[i].derived) continue ;               // 派生别名（前/后阴影起点）不导出
                double v = *numPropAddr(this, numProps[i]) ;
                if(v == numProps[i].def) continue ;              // 默认值不导出
                JS_SetPropertyStr(ctx, obj, numProps[i].name, JS_NewFloat64(ctx, v)) ;
            }
        }
        for(size_t i=0; i<EASE_PROP_COUNT; i++) {
            tween::TweenEaseType e = easeMember(this, easeProps[i]) ;
            if(e == tween::TWEEN_LINEAR) continue ;          // 默认线性缓动不导出
            JS_SetPropertyStr(ctx, obj, easeProps[i].name, JS_NewString(ctx, easeName(e))) ;
        }
        for(size_t i=0; i<BOOL_PROP_COUNT; i++) {
            bool b = boolMember(this, boolProps[i]) ;
            if(!b) continue ;                                // 默认 false 不导出
            JS_SetPropertyStr(ctx, obj, boolProps[i].name, JS_NewBool(ctx, b)) ;
        }
        for(size_t i=0; i<S_PROP_COUNT; i++) {
            double s = sMember(this, sProps[i]) ;
            if(s == 1.70158) continue ;                      // 默认 S 参数不导出
            JS_SetPropertyStr(ctx, obj, sProps[i].name, JS_NewFloat64(ctx, s)) ;
        }
        return obj ;
    }

    /**
     * 导出分段配置
     *
     * 返回可 JSON 序列化的配置对象（含全部数值属性、缓动名与 h_ccw）。
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Section
     * @method exportConfig
     * @return object 配置对象
     */
    JSValue Section::exportConfig(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Section, that)
        return that->exportConfig() ;
    }

    /**
     * 导入分段配置
     *
     * 从配置对象恢复属性（缺省字段保持当前值）。
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Section
     * @method importConfig
     * @param config:object 配置对象
     * @return undefined
     */
    JSValue Section::importConfig(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Section, that)
        CHECK_ARGC(1)
        if(!JS_IsObject(argv[0])) {
            JSTHROW("config must be an object")
        }
        that->applyConfig(argv[0]) ;
        return JS_UNDEFINED ;
    }
}
