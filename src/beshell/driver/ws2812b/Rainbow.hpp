#pragma once

#include <beshell/driver/DriverClass.hpp>
#include <beshell/module/animator/Timeline.hpp>
#include "Strip.hpp"
#include "Section.hpp"


namespace be::driver::ws2812b{

    // 彩虹动画主控
    //
    // 时间线（animator::Timeline）为可选能力，按需惰性创建：
    // 仅静态绘制时（addSection + draw）不会创建 Timeline；
    // 首次使用动画功能（Section.set 带时间参数/play/nextFrame/getTimeline）时
    // 才按构造参数创建。分段（Section）的可动画属性通过 Timeline 的
    // C++ 指针轨道直接驱动；订阅 Timeline 的 C++ 侧 change 事件，
    // 在有属性实际变更的帧自动重绘灯带：
    // strip.clear() → 各分段 drawTo() → strip.flush()。
    //（文档注释见 Rainbow.cpp）
    class Rainbow: public be::driver::DriverClass {
        DECLARE_NCLASS_META
        friend class Section ;                                  // Section 关键帧路径需访问 timeline
    private:
        static std::vector<JSCFunctionListEntry> methods ;

        JSValue stripObj = JS_UNDEFINED ;                       // 目标 Strip（JS_DupValue 持有）
        be::animator::Timeline * timeline = nullptr ;           // 内建时间线（惰性创建，可为空）
        std::shared_ptr<NativeClass> timelineRef = nullptr ;    // 时间线 C++ 侧引用
        double tlFps = 60 ;                                     // 时间线帧率（创建时生效）
        uint64_t tlFrames = 0 ;                                 // 时间线总帧数（创建时生效）
        bool tlRepeat = false ;                                 // 时间线是否循环（创建时生效）
        int64_t tlRepeatCount = -1 ;                            // 额外重播次数（-1=无限；创建时生效）
        std::vector<JSValue> sections ;                         // 分段列表（持有 jsobj 计数）

        // 播放期间的自锚（与 Timeline::loopRef/loopObjRef 同款模式）：
        // 模块顶层未被捕获/导出的绑定在 eval 结束后即被释放，若播放中 Rainbow 被 GC，
        // 析构会 stop 时间线导致动画立即终止。play() 时锚定，stop 事件时释放。
        std::shared_ptr<NativeClass> playRef = nullptr ;        // 播放期间自引用（C++ 侧引用计数+1）
        JSValue playObjRef = JS_UNDEFINED ;                     // 播放期间对 jsobj 的强引用（JS_DupValue），与 playRef 配对进出

        uint32_t cursorFrame = 0 ;                              // 游标帧号（时间线惰性创建前的暂存；
                                                                // 时间线存在时经 playAt 同步到 timeline）

        void createTimeline(double fps, uint64_t frames, bool repeat, int64_t repeatCount=-1) ;
        void destroyTimeline() ;

        void redraw() ;
        static void onTimelineChange(be::animator::Timeline * tl, be::animator::Timeline::EventType evt, uint32_t frame, void * opaque) ;
        static void onTimelineStop(be::animator::Timeline * tl, be::animator::Timeline::EventType evt, uint32_t frame, void * opaque) ;
        void releasePlayAnchor() ;

    public:
        be::animator::Timeline * ensureTimeline() ;             // timeline 为空时惰性创建（供 Section 关键帧路径使用）
        // 时间(毫秒) → 帧号换算（按构造时的 fps，四舍五入）
        uint32_t timeToFrame(double ms) ;

        // 游标（帧号）；setCursor 在时间线存在时同时 playAt 预览（应用各分段在该帧的插补值并重绘）
        uint32_t getCursor() const { return cursorFrame ; }
        void setCursor(uint32_t frame) ;

    private:
        // 从配置对象恢复一个关键帧（导入用，不抛异常）
        void restoreKeyframe(JSValueConst jkf) ;
        // 从配置对象恢复一个帧动作（jumpTo/playTo，导入用，不抛异常）
        void restoreFrameAction(JSValueConst jact) ;

    public:
        Rainbow(JSContext * ctx, JSValue _jsobj=JS_NULL) ;
        ~Rainbow() ;

        static JSValue constructor(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;

        static JSValue addSection(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue removeSection(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;

        static JSValue timeToFrame(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue setCursorMS(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue getCursor(JSContext *ctx, JSValueConst this_val) ;
        static JSValue setCursor(JSContext *ctx, JSValueConst this_val, JSValueConst val) ;

        static JSValue play(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue stop(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue pause(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue resume(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue nextFrame(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;

        static JSValue getTimeline(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue draw(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;

        static JSValue exportConfig(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
        static JSValue importConfig(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) ;
    } ;
}
