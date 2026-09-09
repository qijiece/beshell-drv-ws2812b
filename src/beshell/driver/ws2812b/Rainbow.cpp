#include "Rainbow.hpp"
#include <cstring>

extern "C" {
#include <beshell/deps/quickjs/quickjs-libc.h>
}

using namespace std ;

namespace be::driver::ws2812b{

    namespace tween = be::animator::tween ;
    using animator::Timeline ;

    static inline const char * easeName(tween::TweenEaseType id) {
        if(id<0 || id>=tween::TWEEN_EASE_COUNT) {
            return "linear" ;
        }
        return tween::jsNames[id] ;
    }

    /**
     * 彩虹动画主控
     *
     * 管理若干 Section（灯带分段），draw() 时按顺序绘制到目标灯带
     * （clear → 逐段绘制 → flush）。时间线（animator Timeline）为可选能力，
     * 首次使用动画功能（sec.set(props, time)/play/nextFrame/getTimeline）时按构造
     * 参数惰性创建；播放时 Timeline 逐帧插值分段的可动画属性（x/len/起终点
     * HSV/前后阴影长度），并在有属性实际变更的帧自动重绘灯带，无需 JS 侧参与。
     *
     * 纯静态绘制不需要时间线，addSection 后 draw() 即可。
     *
     * 支持 exportConfig()/importConfig() 整体导出/导入配置（含 strip 驱动层
     * 配置、全部分段与关键帧），供编辑器等工具使用。
     *
     * 动画示例：
     * ```javascript
     * import { Strip, Rainbow } from "ws2812b"
     *
     * const strip = new Strip()
     * strip.setup({ pin: 8, length: 16, loop: true })
     *
     * const rainbow = new Rainbow(strip, { fps: 30, repeat: true })
     *
     * const sec = rainbow.addSection({ x: 0, len: 8, h0: 0, h1: 360 })
     * sec.setKeyFrameMS(10000, { x: 16, ease: "linear" })   // 10 秒绕回环灯带一圈
     *
     * // 也可以用游标方式写关键帧：
     * // rainbow.cursor = 0 ; sec.set({ x: 0 })
     * // rainbow.setCursorMS(10000) ; sec.set({ x: 16, ease: "linear" })
     *
     * rainbow.draw()      // 初始帧
     * rainbow.play()
     * ```
     *
     * 静态示例（无动画）：
     * ```javascript
     * const rainbow = new Rainbow(strip)
     * rainbow.addSection({ x: 0, len: 8, h0: 0, h1: 120 })
     * rainbow.addSection({ x: 8, len: 8, h0: 120, h1: 240 })
     * rainbow.draw()
     * ```
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Rainbow
     * @extends NativeClass
     */
    DEFINE_NCLASS_META(Rainbow, NativeClass)
    std::vector<JSCFunctionListEntry> Rainbow::methods = {
        JS_CFUNC_DEF("addSection", 0, Rainbow::addSection),
        JS_CFUNC_DEF("removeSection", 1, Rainbow::removeSection),
        JS_CFUNC_DEF("timeToFrame", 1, Rainbow::timeToFrame),
        JS_CFUNC_DEF("setCursorMS", 1, Rainbow::setCursorMS),
        JS_CGETSET_DEF("cursor", Rainbow::getCursor, Rainbow::setCursor),
        JS_CFUNC_DEF("play", 0, Rainbow::play),
        JS_CFUNC_DEF("stop", 0, Rainbow::stop),
        JS_CFUNC_DEF("pause", 0, Rainbow::pause),
        JS_CFUNC_DEF("resume", 0, Rainbow::resume),
        JS_CFUNC_DEF("nextFrame", 0, Rainbow::nextFrame),
        JS_CFUNC_DEF("getTimeline", 0, Rainbow::getTimeline),
        JS_CFUNC_DEF("draw", 0, Rainbow::draw),
        JS_CFUNC_DEF("exportConfig", 0, Rainbow::exportConfig),
        JS_CFUNC_DEF("importConfig", 1, Rainbow::importConfig),
    } ;

    Rainbow::Rainbow(JSContext * ctx, JSValue _jsobj)
        : NativeClass(ctx,build(ctx,_jsobj))
    {
    }

    Rainbow::~Rainbow() {
        destroyTimeline() ;
        JS_FreeValue(ctx, playObjRef) ;     // 防御：正常播放到析构必经 stop 事件，此时应为 JS_UNDEFINED
        for(auto & secObj : sections) {
            Section * sec = (Section*) NativeClass::fromJS(secObj) ;
            if(sec) {
                sec->rainbowObj = JS_UNDEFINED ;    // rainbowObj 为弱引用，解除回指
                sec->strip = nullptr ;
            }
            JS_FreeValue(ctx, secObj) ;
        }
        JS_FreeValue(ctx, stripObj) ;
    }

    Timeline * Rainbow::ensureTimeline() {
        if(!timeline) {
            createTimeline(tlFps, tlFrames, tlRepeat) ;
        }
        return timeline ;
    }

    uint32_t Rainbow::timeToFrame(double ms) {
        if(ms<=0) {
            return 0 ;
        }
        return (uint32_t)(ms * tlFps / 1000.0 + 0.5) ;    // 四舍五入
    }

    void Rainbow::createTimeline(double fps, uint64_t frames, bool repeat) {
        timeline = new Timeline(ctx, JS_NULL, fps, frames, repeat) ;
        timelineRef = timeline->shared() ;
        // C++ 侧事件订阅：有轨道值实际变更的帧重绘灯带（避免 QuickJS 事件分发开销）
        timeline->on(Timeline::EVENT_CHANGE, &Rainbow::onTimelineChange, this) ;
        // 停止（手动/播完自动）时释放播放自锚，之后 Rainbow 可被 GC
        timeline->on(Timeline::EVENT_STOP, &Rainbow::onTimelineStop, this) ;
        timeline->setCursor(cursorFrame) ;      // 同步惰性创建前暂存的游标
    }

    void Rainbow::setCursor(uint32_t frame) {
        cursorFrame = frame ;
        if(timeline) {
            // 预览该帧：应用各分段插补值（change 事件驱动重绘）；playAt 内部同步 timeline 游标
            timeline->playAt(frame) ;
        }
    }

    void Rainbow::destroyTimeline() {
        if(timeline) {
            JSValue jstl = timeline->jsobj ;
            timeline->off(Timeline::EVENT_CHANGE, &Rainbow::onTimelineChange, this) ;
            timeline->off(Timeline::EVENT_STOP, &Rainbow::onTimelineStop, this) ;
            timeline->stop() ;          // 停止播放并退出主循环（同步触发 EVENT_STOP → 释放播放自锚）
            timelineRef = nullptr ;     // 释放引用，此后 timeline 可能已析构，不得再访问
            timeline = nullptr ;
            JS_FreeValue(ctx, jstl) ;   // 释放 build() 时 C++ 侧持有的 jsobj 计数（可能触发 ~Timeline）
        }
    }

    void Rainbow::onTimelineChange(Timeline * tl, Timeline::EventType evt, uint32_t frame, void * opaque) {
        (void)tl; (void)evt;
        ((Rainbow*)opaque)->redraw() ;
    }

    void Rainbow::onTimelineStop(Timeline * tl, Timeline::EventType evt, uint32_t frame, void * opaque) {
        (void)tl; (void)evt; (void)frame;
        ((Rainbow*)opaque)->releasePlayAnchor() ;
    }

    // 释放播放自锚：先清成员再 JS_FreeValue——FreeValue 可能使 jsobj 计数归 0
    // 触发 finalizer 进而析构本对象，此后不得再访问任何成员
    void Rainbow::releasePlayAnchor() {
        playRef = nullptr ;
        JSValue ref = playObjRef ;
        playObjRef = JS_UNDEFINED ;
        JS_FreeValue(ctx, ref) ;
    }

    // 重绘：清空 → 逐段绘制 → 刷新
    void Rainbow::redraw() {
        if(JS_IsUndefined(stripObj)) {
            return ;
        }
        Strip * strip = (Strip*) NativeClass::fromJS(stripObj) ;
        if(!strip || !strip->isReady()) {
            return ;
        }
        strip->clear() ;
        for(auto & secObj : sections) {
            Section * sec = (Section*) NativeClass::fromJS(secObj) ;
            if(sec) {
                sec->drawTo(strip) ;
            }
        }
        strip->flush() ;
    }

    /**
     * 构造函数
     *
     * 创建彩虹动画主控并绑定目标灯带。时间线选项此时仅作记录，
     * 首次使用动画功能时才惰性创建时间线；纯静态绘制不会产生时间线开销。
     *
     * 示例：
     * ```javascript
     * const rainbow = new Rainbow(strip, { fps: 30, frames: 300, repeat: true })
     * ```
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Rainbow
     * @method constructor
     * @param strip:Strip 目标灯带
     * @param options:object= 时间线选项（动画用，可省略）
     *     {
     *         fps?: number,        // 帧率，默认 60
     *         frames?: number,     // 总帧数，省略时自动以最后一个关键帧帧号为总长，默认省略
     *         repeat?: boolean     // 是否循环播放，默认 false
     *     }
     * @return Rainbow 实例
     */
    JSValue Rainbow::constructor(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        CHECK_ARGC(1)
        JSVALUE_TO_NCLASS(Strip, argv[0], strip)

        double fps = 60 ;
        double frames = 0 ;
        bool repeat = false ;
        if(argc>1 && JS_IsObject(argv[1])) {
            GET_FLOAT_PROP_OPT(argv[1], "fps", fps, 60)
            GET_FLOAT_PROP_OPT(argv[1], "frames", frames, 0)
            GET_BOOL_PROP_OPT(argv[1], "repeat", repeat, false)
        }
        if(fps<=0) {
            JSTHROW("fps must be > 0")
        }

        auto obj = new Rainbow(ctx) ;
        obj->stripObj = JS_DupValue(ctx, argv[0]) ;
        obj->tlFps = fps ;
        obj->tlFrames = frames>0 ? (uint64_t)frames : 0 ;
        obj->tlRepeat = repeat ;
        obj->shared() ;
        return obj->jsobj ;
    }

    /**
     * 添加分段
     *
     * 创建分段（Section 无 JS 构造函数，只能由此创建），应用可选的初始配置，
     * 加入 Rainbow 管理并绑定到目标 strip，返回该分段。
     *
     * ```javascript
     * const sec = rainbow.addSection({ x: 0, len: 8, h0: 0, h1: 360, easeH: "inOutSine" })
     * ```
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Rainbow
     * @method addSection
     * @param config:object= 分段初始配置（同 Section 属性，可省略）
     * @return Section 新分段
     */
    JSValue Rainbow::addSection(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Rainbow, that)
        Section * sec = new Section(ctx, JS_NULL) ;
        sec->shared() ;
        if(argc>0 && JS_IsObject(argv[0])) {
            sec->applyConfig(argv[0]) ;
        }
        sec->strip = (Strip*) NativeClass::fromJS(that->stripObj) ;
        sec->rainbowObj = that->jsobj ;                 // 弱引用（不 DupValue，避免循环引用）
        that->sections.push_back(JS_DupValue(ctx, sec->jsobj)) ;
        return sec->jsobj ;                             // build() 的计数所有权转交 JS 侧
    }

    /**
     * 移除分段
     *
     * 将分段从 Rainbow 移除，解除 strip 绑定与所属关系。
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Rainbow
     * @method removeSection
     * @param section:Section 分段
     * @return undefined
     */
    JSValue Rainbow::removeSection(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Rainbow, that)
        CHECK_ARGC(1)
        JSVALUE_TO_NCLASS(Section, argv[0], sec)
        for(size_t i=0; i<that->sections.size(); i++) {
            if(JS_VALUE_GET_PTR(that->sections[i])==JS_VALUE_GET_PTR(argv[0])) {
                JS_FreeValue(ctx, that->sections[i]) ;
                that->sections.erase(that->sections.begin()+i) ;
                break ;
            }
        }
        sec->strip = nullptr ;
        if(JS_VALUE_GET_PTR(sec->rainbowObj)==JS_VALUE_GET_PTR(that->jsobj)) {
            sec->rainbowObj = JS_UNDEFINED ;            // 弱引用，直接清空
        }
        return JS_UNDEFINED ;
    }

    /**
     * 时间（毫秒）换算为帧号
     *
     * 按构造时的 fps 四舍五入换算：`round(ms * fps / 1000)`。
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Rainbow
     * @method timeToFrame
     * @param time:number 时间（毫秒）
     * @return number 帧号
     */
    JSValue Rainbow::timeToFrame(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Rainbow, that)
        CHECK_ARGC(1)
        double ms = 0 ;
        if(JS_ToFloat64(ctx, &ms, argv[0])!=0) {
            JSTHROW("time must be a number")
        }
        return JS_NewUint32(ctx, that->timeToFrame(ms)) ;
    }

    /**
     * 游标帧号
     *
     * 关键帧编辑与预览的当前位置：`sec.set(props)` 写入关键帧的缺省帧；
     * 赋值时若时间线已创建，同步把各分段在该帧的插补值应用到灯带并重绘
     * （编辑器拖动进度条实时预览）。
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Rainbow
     * @property cursor:number 游标帧号（默认 0）
     */
    JSValue Rainbow::getCursor(JSContext *ctx, JSValueConst this_val) {
        THIS_NCLASS(Rainbow, that)
        return JS_NewUint32(ctx, that->getCursor()) ;
    }

    JSValue Rainbow::setCursor(JSContext *ctx, JSValueConst this_val, JSValueConst val) {
        THIS_NCLASS(Rainbow, that)
        uint32_t frame = 0 ;
        if(JS_ToUint32(ctx, &frame, val)!=0) {
            JSTHROW("cursor must be a frame number >= 0")
        }
        that->setCursor(frame) ;
        return JS_UNDEFINED ;
    }

    /**
     * 以毫秒设置游标
     *
     * 等价于 `rainbow.cursor = rainbow.timeToFrame(ms)`。
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Rainbow
     * @method setCursorMS
     * @param time:number 时间（毫秒）
     * @return undefined
     */
    JSValue Rainbow::setCursorMS(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Rainbow, that)
        CHECK_ARGC(1)
        double ms = 0 ;
        if(JS_ToFloat64(ctx, &ms, argv[0])!=0 || ms<0) {
            JSTHROW("time must be a number >= 0")
        }
        that->setCursor(that->timeToFrame(ms)) ;
        return JS_UNDEFINED ;
    }

    // ---------- 播放控制（直接转调 Timeline 的 C++ 方法） ----------

    /**
     * 开始播放
     *
     * 从头（第 0 帧）开始播放时间线。建议播放前先调用一次 draw() 绘制初始帧。
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Rainbow
     * @method play
     * @return undefined
     */
    JSValue Rainbow::play(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Rainbow, that)
        that->ensureTimeline()->play() ;
        // 播放期间自锚：防止模块 eval 结束/JS 侧丢引用后 Rainbow 被 GC 导致动画终止
        if(!that->playRef) {
            that->playRef = that->shared() ;
            JS_FreeValue(ctx, that->playObjRef) ;            // 配对不变式下为 JS_UNDEFINED，防御性释放
            that->playObjRef = JS_DupValue(ctx, that->jsobj) ;
        }
        return JS_UNDEFINED ;
    }
    /**
     * 停止播放
     *
     * 停止时间线并回到第 0 帧（播完自动停止与手动停止效果相同）。
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Rainbow
     * @method stop
     * @return undefined
     */
    JSValue Rainbow::stop(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Rainbow, that)
        if(that->timeline) {
            that->timeline->stop() ;
        }
        return JS_UNDEFINED ;
    }
    /**
     * 暂停播放
     *
     * 暂停在当前帧，可用 resume() 继续。
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Rainbow
     * @method pause
     * @return undefined
     */
    JSValue Rainbow::pause(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Rainbow, that)
        if(that->timeline) {
            that->timeline->pause() ;
        }
        return JS_UNDEFINED ;
    }
    /**
     * 继续播放
     *
     * 从暂停的帧继续播放。
     *
     * @component beshell-drv-ws2812b
     * @module ws2812b
     * @class Rainbow
     * @method resume
     * @return undefined
     */
    JSValue Rainbow::resume(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Rainbow, that)
        if(that->timeline) {
            that->timeline->resume() ;
        }
        return JS_UNDEFINED ;
    }

    /**
     * 等待下一帧（转发内建 Timeline 的 nextFrame）
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Rainbow
     * @method nextFrame
     * @return Promise\<number\> 当前帧序号
     */
    JSValue Rainbow::nextFrame(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Rainbow, that)
        JSValue jstl = that->ensureTimeline()->jsobj ;
        JSValue fn = JS_GetPropertyStr(ctx, jstl, "nextFrame") ;
        JSValue ret = JS_Call(ctx, fn, jstl, 0, nullptr) ;
        JS_FreeValue(ctx, fn) ;
        return ret ;
    }

    /**
     * 获取内建 Timeline 对象（高级用法：监听 stop/pause 事件等）
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Rainbow
     * @method getTimeline
     * @return [Timeline](../animator/Timeline.html) 内建时间线
     */
    JSValue Rainbow::getTimeline(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Rainbow, that)
        return JS_DupValue(ctx, that->ensureTimeline()->jsobj) ;
    }

    /**
     * 手动重绘一帧
     *
     * 通常在 play() 前调用一次作为初始帧；播放期间由 change 事件自动重绘。
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Rainbow
     * @method draw
     */
    JSValue Rainbow::draw(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Rainbow, that)
        that->redraw() ;
        return JS_UNDEFINED ;
    }

    // ---------- 配置导入/导出 ----------

    /**
     * 导出配置
     *
     * 返回可 JSON 序列化的完整配置（供编辑器等工具使用）：
     * ```javascript
     * {
     *   fps, frames, repeat,
     *   strip: { pin, length, loop },
     *   sections: [ ... ],
     *   keyframes: [ { time, section, prop, value, ease, easeS }, ... ]   // time 为毫秒
     * }
     * ```
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Rainbow
     * @method exportConfig
     * @return object 配置对象
     */
    JSValue Rainbow::exportConfig(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Rainbow, that)

        JSValue obj = JS_NewObject(ctx) ;
        JS_SetPropertyStr(ctx, obj, "fps", JS_NewFloat64(ctx, that->tlFps)) ;
        JS_SetPropertyStr(ctx, obj, "frames", JS_NewFloat64(ctx, (double)that->tlFrames)) ;
        JS_SetPropertyStr(ctx, obj, "repeat", JS_NewBool(ctx, that->tlRepeat)) ;

        // strip 驱动层配置
        Strip * strip = (Strip*) NativeClass::fromJS(that->stripObj) ;
        if(strip) {
            JS_SetPropertyStr(ctx, obj, "strip", strip->exportConfig()) ;
        }

        // 分段
        JSValue arrSecs = JS_NewArray(ctx) ;
        for(size_t i=0; i<that->sections.size(); i++) {
            Section * sec = (Section*) NativeClass::fromJS(that->sections[i]) ;
            if(sec) {
                JS_SetPropertyUint32(ctx, arrSecs, i, sec->exportConfig()) ;
            }
        }
        JS_SetPropertyStr(ctx, obj, "sections", arrSecs) ;

        // 关键帧（时间线未创建时为空数组；仅 C_DOUBLE 轨道，且 cptr 可反查到分段成员）
        JSValue arrKfs = JS_NewArray(ctx) ;
        uint32_t ki = 0 ;
        if(that->timeline) {
            for(auto track : that->timeline->allTracks()) {
                if(track->type!=be::animator::Track::C_DOUBLE || !track->cptr) {
                    continue ;
                }
                for(size_t si=0; si<that->sections.size(); si++) {
                    Section * sec = (Section*) NativeClass::fromJS(that->sections[si]) ;
                    if(!sec) {
                        continue ;
                    }
                    const char * pname = Section::propName(sec, (const double*)track->cptr) ;
                    if(!pname) {
                        continue ;
                    }
                    for(auto & kf : track->keyframes) {
                        JSValue jkf = JS_NewObject(ctx) ;
                        // 帧号 → 毫秒（对外接口一律时间制）
                        JS_SetPropertyStr(ctx, jkf, "time", JS_NewFloat64(ctx, kf.frame*1000.0/that->tlFps)) ;
                        JS_SetPropertyStr(ctx, jkf, "section", JS_NewUint32(ctx, (uint32_t)si)) ;
                        JS_SetPropertyStr(ctx, jkf, "prop", JS_NewString(ctx, pname)) ;
                        JS_SetPropertyStr(ctx, jkf, "value", JS_NewFloat64(ctx, kf.value)) ;
                        JS_SetPropertyStr(ctx, jkf, "ease", JS_NewString(ctx, easeName(kf.ease))) ;
                        JS_SetPropertyStr(ctx, jkf, "easeS", JS_NewFloat64(ctx, kf.easeS)) ;
                        JS_SetPropertyUint32(ctx, arrKfs, ki++, jkf) ;
                    }
                    break ;
                }
            }
        }
        JS_SetPropertyStr(ctx, obj, "keyframes", arrKfs) ;

        return obj ;
    }

    // 从配置对象恢复一个关键帧（导入用，字段无效时静默跳过）
    void Rainbow::restoreKeyframe(JSValueConst jkf) {
        JSValue jv ;

        jv = JS_GetPropertyStr(ctx, jkf, "time") ;     // 毫秒 → 帧号
        double ms = 0 ;
        JS_ToFloat64(ctx, &ms, jv) ;
        JS_FreeValue(ctx, jv) ;
        uint32_t frame = timeToFrame(ms) ;

        jv = JS_GetPropertyStr(ctx, jkf, "section") ;
        uint32_t si = 0 ;
        JS_ToUint32(ctx, &si, jv) ;
        JS_FreeValue(ctx, jv) ;
        if(si>=sections.size()) {
            return ;
        }
        Section * sec = (Section*) NativeClass::fromJS(sections[si]) ;
        if(!sec) {
            return ;
        }

        jv = JS_GetPropertyStr(ctx, jkf, "prop") ;
        if(!JS_IsString(jv)) {
            JS_FreeValue(ctx, jv) ;
            return ;
        }
        const char * prop = JS_ToCString(ctx, jv) ;
        JS_FreeValue(ctx, jv) ;
        double Section::* member = Section::propMember(prop) ;
        JS_FreeCString(ctx, prop) ;
        if(!member) {
            return ;
        }

        jv = JS_GetPropertyStr(ctx, jkf, "value") ;
        double value = 0 ;
        JS_ToFloat64(ctx, &value, jv) ;
        JS_FreeValue(ctx, jv) ;

        tween::TweenEaseType ease = tween::TWEEN_LINEAR ;
        jv = JS_GetPropertyStr(ctx, jkf, "ease") ;
        if(JS_IsString(jv)) {
            const char * cstr = JS_ToCString(ctx, jv) ;
            tween::TweenEaseType e = tween::map_name_to_id(cstr) ;
            JS_FreeCString(ctx, cstr) ;
            if(e!=tween::TWEEN_EASE_UNKNOWN) {
                ease = e ;
            }
        }
        JS_FreeValue(ctx, jv) ;

        double easeS = 1.70158 ;
        jv = JS_GetPropertyStr(ctx, jkf, "easeS") ;
        if(JS_IsNumber(jv)) {
            JS_ToFloat64(ctx, &easeS, jv) ;
        }
        JS_FreeValue(ctx, jv) ;

        timeline->set(frame, &(sec->*member), value, ease, easeS, sec->jsobj) ;
    }

    /**
     * 导入配置
     *
     * 应用 exportConfig() 产出的配置对象：重建 strip 驱动层配置、
     * 更新时间线参数（fps/frames/repeat）、替换全部分段、恢复全部关键帧
     * （仅当配置含关键帧时才创建时间线），最后绘制一帧。
     *
     * @component beshell-drv-ws2812b
     *
     * @module ws2812b
     * @class Rainbow
     * @method importConfig
     * @param config:object 配置对象
     * @return undefined
     */
    JSValue Rainbow::importConfig(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
        THIS_NCLASS(Rainbow, that)
        CHECK_ARGC(1)
        if(!JS_IsObject(argv[0])) {
            JSTHROW("config must be an object")
        }
        JSValue v ;
        double dtmp ;

        // 1. strip 驱动层配置
        v = JS_GetPropertyStr(ctx, argv[0], "strip") ;
        if(JS_IsObject(v)) {
            Strip * strip = (Strip*) NativeClass::fromJS(that->stripObj) ;
            if(strip) {
                strip->importConfig(v) ;
            }
        }
        JS_FreeValue(ctx, v) ;

        // 2. 更新时间线参数（fps/frames/repeat 缺省沿用当前值）并销毁旧时间线；
        //    新时间线仅在存在关键帧时创建
        v = JS_GetPropertyStr(ctx, argv[0], "fps") ;
        if(JS_IsNumber(v) && JS_ToFloat64(ctx, &dtmp, v)==0 && dtmp>0) {
            that->tlFps = dtmp ;
        }
        JS_FreeValue(ctx, v) ;
        v = JS_GetPropertyStr(ctx, argv[0], "frames") ;
        if(JS_IsNumber(v) && JS_ToFloat64(ctx, &dtmp, v)==0 && dtmp>=0) {
            that->tlFrames = (uint64_t)dtmp ;
        }
        JS_FreeValue(ctx, v) ;
        v = JS_GetPropertyStr(ctx, argv[0], "repeat") ;
        if(!JS_IsUndefined(v)) {
            that->tlRepeat = JS_ToBool(ctx, v) ;
        }
        JS_FreeValue(ctx, v) ;
        that->destroyTimeline() ;

        // 3. 替换全部分段
        for(auto & secObj : that->sections) {
            Section * sec = (Section*) NativeClass::fromJS(secObj) ;
            if(sec) {
                sec->strip = nullptr ;
                sec->rainbowObj = JS_UNDEFINED ;
            }
            JS_FreeValue(ctx, secObj) ;
        }
        that->sections.clear() ;
        Strip * strip = (Strip*) NativeClass::fromJS(that->stripObj) ;
        v = JS_GetPropertyStr(ctx, argv[0], "sections") ;
        if(JS_IsArray(ctx, v)) {
            JSValue jslen = JS_GetPropertyStr(ctx, v, "length") ;
            uint32_t count = 0 ;
            JS_ToUint32(ctx, &count, jslen) ;
            JS_FreeValue(ctx, jslen) ;
            for(uint32_t i=0; i<count; i++) {
                JSValue secCfg = JS_GetPropertyUint32(ctx, v, i) ;
                Section * sec = new Section(ctx, JS_NULL) ;
                sec->shared() ;
                sec->applyConfig(secCfg) ;
                sec->strip = strip ;
                sec->rainbowObj = that->jsobj ;             // 弱引用（不 DupValue，避免循环引用）
                that->sections.push_back(sec->jsobj) ;      // 转移 build() 的计数所有权，不再 DupValue（避免泄漏）
                JS_FreeValue(ctx, secCfg) ;
            }
        }
        JS_FreeValue(ctx, v) ;

        // 4. 恢复关键帧（有内容时才创建时间线）
        v = JS_GetPropertyStr(ctx, argv[0], "keyframes") ;
        if(JS_IsArray(ctx, v)) {
            JSValue jslen = JS_GetPropertyStr(ctx, v, "length") ;
            uint32_t count = 0 ;
            JS_ToUint32(ctx, &count, jslen) ;
            JS_FreeValue(ctx, jslen) ;
            if(count>0) {
                that->ensureTimeline() ;
            }
            for(uint32_t i=0; i<count; i++) {
                JSValue jkf = JS_GetPropertyUint32(ctx, v, i) ;
                if(JS_IsObject(jkf)) {
                    that->restoreKeyframe(jkf) ;
                }
                JS_FreeValue(ctx, jkf) ;
            }
        }
        JS_FreeValue(ctx, v) ;

        // 5. 初始绘制
        that->redraw() ;

        return JS_UNDEFINED ;
    }
}
