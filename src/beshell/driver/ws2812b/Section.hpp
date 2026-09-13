#pragma once

#include <beshell/driver/DriverClass.hpp>
#include <beshell/module/animator/Tween.hpp>
#include "Strip.hpp"


namespace be::driver::ws2812b{

    class Rainbow ;     // 前向声明（所属主控，addSection 时建立关联）

    // 渲染过渡（帧内 HSV 渐变）：三种过渡（主体/前阴影/后阴影）参数与结构完全一致。
    // 「过渡」为静态、与时间轴无关、在单帧渲染内发生的颜色渐变；
    // 随时间轴变化的动画插补另称「间补」（由 Timeline 驱动，见 Rainbow）。
    struct Transition {
        double h0 = 0, s0 = 100, v0 = 100 ;    // 起点 HSV（h:0-360，s/v:0-100）
        double h1 = 0, s1 = 100, v1 = 100 ;    // 终点 HSV（阴影默认 v1=0 完全淡出）
        be::animator::tween::TweenEaseType easeH = be::animator::tween::TWEEN_LINEAR ;
        be::animator::tween::TweenEaseType easeS = be::animator::tween::TWEEN_LINEAR ;
        be::animator::tween::TweenEaseType easeV = be::animator::tween::TWEEN_LINEAR ;
        double easeHS = 1.70158 ;          // H 缓动参数 s（仅 Back 系列使用，其余忽略）
        double easeSS = 1.70158 ;          // S 缓动参数 s
        double easeVS = 1.70158 ;          // V 缓动参数 s
        bool h_ccw = false ;               // 色相过渡方向：false=顺时针（色相增大），true=逆时针
    } ;

    // 灯带分段
    //
    // 描述灯带上的一段：位置、长度、起终点 HSV 及过渡缓动、前后阴影。
    // 数值属性存放为 C++ double 成员，由 Rainbow 内部的 Timeline
    // 通过 C++ 指针轨道直接驱动（跳过 QuickJS 属性读写开销）。
    //（文档注释见 Section.cpp）
    class Section: public be::driver::DriverClass {
        DECLARE_NCLASS_META
    private:
        static std::vector<JSCFunctionListEntry> methods ;

    public:
        // ---- 可动画属性（Rainbow 的 timeline 以 C++ 指针轨道直接写入，即「间补」）----
        double x = 0 ;                  // 起始位置（像素索引，可为小数，绘制时四舍五入）
        double len = 1 ;                // 主体长度（>=1），为 1 时退化为点
        double shadowFront = 0 ;        // 前阴影长度（索引减小方向），0 = 无前阴影
        double shadowBack = 0 ;         // 后阴影长度（索引增大方向），0 = 无后阴影

        // ---- 三种渲染过渡（结构完全一致）----
        Transition body ;               // 主体过渡：起点 → 终点
        Transition front ;              // 前阴影过渡：起点向前
        Transition back ;               // 后阴影过渡：起点向后

        Strip * strip = nullptr ;       // 绑定的 strip，由 Rainbow::addSection/removeSection 维护
        // 所属 Rainbow 的弱引用（不持有计数，避免与 Rainbow.sections 循环引用；
        // 由 addSection 建立，removeSection 与 ~Rainbow 清为 JS_UNDEFINED）
        JSValue rainbowObj = JS_UNDEFINED ;

        Section(JSContext * ctx, JSValue _jsobj=JS_NULL) ;
        ~Section() ;

        // 所属 Rainbow（未加入或已被 GC 时返回 nullptr）
        Rainbow * rainbow() ;

        // 绘制到 strip（内部调用 strip->setPixelHSV，不做 clear/flush）
        void drawTo(Strip * strip) ;

        // 配置导入/导出（C++ 侧，JS 同名方法转调）
        void applyConfig(JSValueConst cfg) ;
        // includeNumProps=false 时仅导出静态过渡配置（数值基准值由 Rainbow 写入 keyframes["0"]）
        JSValue exportConfig(bool includeNumProps = true) ;

        // 属性名 -> 可动画成员的 double 地址（非可动画属性返回 nullptr）
        static double * propMember(Section * sec, const char * name) ;
        // 成员地址 -> 属性名（供 Rainbow 导出关键帧时反查）
        static const char * propName(Section * sec, const double * cptr) ;
        // 可动画、非派生属性枚举（关键帧分组键遍历用）
        static size_t propCount() ;
        static const char * propNameAt(size_t idx) ;
        // 属性名的引擎默认值（供 Rainbow 导出帧 0 基准值时省略默认）
        static double propDefault(const char * name) ;

        // 关键帧写入（frame 已由 Rainbow 换算）；出错返回 -1 且已抛出异常
        int setOne(uint32_t frame, const char * prop, JSValueConst jsValue, JSValueConst jsEase, JSValueConst jsParams) ;
        // 属性表形式批量设置关键帧：{prop: value | [value, easeName?, easeS?], ..., ease?, easeS?}
        int setPropMap(uint32_t frame, JSValueConst map) ;

        static JSValue constructor(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue set(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue setKeyFrame(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue setKeyFrameMS(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue unset(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue draw(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue exportConfig(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue importConfig(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;

        static JSValue getProp(JSContext *ctx, JSValueConst this_val, int magic) ;
        static JSValue setProp(JSContext *ctx, JSValueConst this_val, JSValueConst val, int magic) ;
    } ;
}
