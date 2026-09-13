#include "Rainbow.hpp"
#include <cstring>
#include <cstdio>
#include <cstdlib>

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
     * 支持 exportConfig()/importConfig() 整体导出/导入动画配置（全部分段与
     * 关键帧；不含 strip 驱动层配置，后者由 strip.setup() 单独维护），供编辑器等工具使用。
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
    DEFINE_NCLASS_META(Rainbow, DriverClass)
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
        : DriverClass(ctx,build(ctx,_jsobj))
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
            createTimeline(tlFps, tlFrames, tlRepeat, tlRepeatCount) ;
        }
        return timeline ;
    }

    uint32_t Rainbow::timeToFrame(double ms) {
        if(ms<=0) {
            return 0 ;
        }
        return (uint32_t)(ms * tlFps / 1000.0 + 0.5) ;    // 四舍五入
    }

    void Rainbow::createTimeline(double fps, uint64_t frames, bool repeat, int64_t repeatCount) {
        timeline = new Timeline(ctx, JS_NULL, fps, frames, repeat, repeatCount) ;
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
     * 返回可 JSON 序列化的完整动画配置（供编辑器等工具使用）：
     * ```javascript
     * {
     *   fps, frames, repeat, repeatCount,
     *   sections: [ ... ],                                   // 仅静态过渡配置（可省略：单段且全默认）
     *   keyframes: { [frame]: { [si]: { [prop]: 值|三元组 } } },   // 帧 0 = 各分段基准值，非 0 帧 = 间补目标值
     *   frameActions: [ ... ]
     * }
     * ```
     * 注：不含 strip 驱动层配置（pin/length/loop 由 strip.setup() 单独维护）。
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
        if(that->tlFps != 60) JS_SetPropertyStr(ctx, obj, "fps", JS_NewFloat64(ctx, that->tlFps)) ;
        if(that->tlFrames != 0) JS_SetPropertyStr(ctx, obj, "frames", JS_NewFloat64(ctx, (double)that->tlFrames)) ;
        if(that->tlRepeat) JS_SetPropertyStr(ctx, obj, "repeat", JS_NewBool(ctx, that->tlRepeat)) ;
        if(that->tlRepeatCount != -1) JS_SetPropertyStr(ctx, obj, "repeatCount", JS_NewInt64(ctx, that->tlRepeatCount)) ;

        size_t nsec = that->sections.size() ;

        // 取（或建）子对象并返回一个新引用（调用方负责 JS_FreeValue）
        auto childObj = [&](JSValue parent, const char * key) -> JSValue {
            JSValue o = JS_GetPropertyStr(ctx, parent, key) ;
            if(JS_IsObject(o)) {
                return o ;
            }
            JS_FreeValue(ctx, o) ;
            o = JS_NewObject(ctx) ;
            JS_SetPropertyStr(ctx, parent, key, o) ;   // 转移所有权给 parent
            return JS_DupValue(ctx, o) ;
        } ;

        // 分段：仅静态过渡配置（数值基准值已移入 keyframes["0"]）
        JSValue arrSecs = JS_NewArray(ctx) ;
        size_t staticNonDefault = 0 ;
        for(size_t i=0; i<nsec; i++) {
            Section * sec = (Section*) NativeClass::fromJS(that->sections[i]) ;
            if(!sec) continue ;
            JSValue cfg = sec->exportConfig(false) ;
            JS_SetPropertyUint32(ctx, arrSecs, i, cfg) ;
            JSPropertyEnum * ptab = nullptr ;
            uint32_t plen = 0 ;
            if(JS_GetOwnPropertyNames(ctx, &ptab, &plen, cfg, JS_GPN_STRING_MASK|JS_GPN_ENUM_ONLY)==0) {
                if(plen>0) staticNonDefault++ ;
                for(uint32_t j=0; j<plen; j++) JS_FreeAtom(ctx, ptab[j].atom) ;
                js_free(ctx, ptab) ;
            }
        }
        // sections 省略规则：仅当「只有 1 段且静态配置全默认」时省略；0 段/多段始终写
        if(nsec==1 && staticNonDefault==0) {
            JS_FreeValue(ctx, arrSecs) ;
        } else {
            JS_SetPropertyStr(ctx, obj, "sections", arrSecs) ;
        }

        // 关键帧：按帧号聚合 { [frame]: { [si]: { [prop]: 值|三元组 } } }
        JSValue objKfs = JS_NewObject(ctx) ;

        // 帧 0：各分段非默认基准值（单值；对照 propDefault 省略默认）
        for(size_t si=0; si<nsec; si++) {
            Section * sec = (Section*) NativeClass::fromJS(that->sections[si]) ;
            if(!sec) continue ;
            JSValue s0 = JS_UNDEFINED ;
            for(size_t pi=0; pi<Section::propCount(); pi++) {
                const char * pname = Section::propNameAt(pi) ;
                double * member = Section::propMember(sec, pname) ;
                if(!member) continue ;
                double v = *member ;
                if(v == Section::propDefault(pname)) continue ;
                if(JS_IsUndefined(s0)) {
                    char skey[24] ;
                    snprintf(skey, sizeof(skey), "%zu", si) ;
                    JSValue f0 = childObj(objKfs, "0") ;
                    s0 = childObj(f0, skey) ;
                    JS_FreeValue(ctx, f0) ;
                }
                JS_SetPropertyStr(ctx, s0, pname, JS_NewFloat64(ctx, v)) ;
            }
            if(!JS_IsUndefined(s0)) JS_FreeValue(ctx, s0) ;
        }

        // 帧 > 0：遍历时间线轨道关键帧（跳过帧 0 基准）
        if(that->timeline) {
            for(auto track : that->timeline->allTracks()) {
                if(track->type!=be::animator::Track::C_DOUBLE || !track->cptr) continue ;
                for(size_t si=0; si<nsec; si++) {
                    Section * sec = (Section*) NativeClass::fromJS(that->sections[si]) ;
                    if(!sec) continue ;
                    const char * pname = Section::propName(sec, (const double*)track->cptr) ;
                    if(!pname) continue ;
                    for(auto & kf : track->keyframes) {
                        if(kf.frame==0) continue ;
                        char fkey[24] ;
                        snprintf(fkey, sizeof(fkey), "%u", (unsigned)kf.frame) ;
                        char skey[24] ;
                        snprintf(skey, sizeof(skey), "%zu", si) ;
                        JSValue fobj = childObj(objKfs, fkey) ;
                        JSValue s0 = childObj(fobj, skey) ;
                        JSValue jv ;
                        if(kf.ease==tween::TWEEN_LINEAR && kf.easeS==1.70158) {
                            jv = JS_NewFloat64(ctx, kf.value) ;
                        } else if(kf.easeS==1.70158) {
                            jv = JS_NewArray(ctx) ;
                            JS_SetPropertyUint32(ctx, jv, 0, JS_NewFloat64(ctx, kf.value)) ;
                            JS_SetPropertyUint32(ctx, jv, 1, JS_NewString(ctx, easeName(kf.ease))) ;
                        } else {
                            jv = JS_NewArray(ctx) ;
                            JS_SetPropertyUint32(ctx, jv, 0, JS_NewFloat64(ctx, kf.value)) ;
                            JS_SetPropertyUint32(ctx, jv, 1, JS_NewString(ctx, easeName(kf.ease))) ;
                            JS_SetPropertyUint32(ctx, jv, 2, JS_NewFloat64(ctx, kf.easeS)) ;
                        }
                        JS_SetPropertyStr(ctx, s0, pname, jv) ;   // 转移 jv 所有权
                        JS_FreeValue(ctx, s0) ;
                        JS_FreeValue(ctx, fobj) ;
                    }
                    break ;
                }
            }
        }

        // keyframes 空对象时省略
        JSPropertyEnum * kptab = nullptr ;
        uint32_t kplen = 0 ;
        bool kfsEmpty = true ;
        if(JS_GetOwnPropertyNames(ctx, &kptab, &kplen, objKfs, JS_GPN_STRING_MASK|JS_GPN_ENUM_ONLY)==0) {
            kfsEmpty = (kplen==0) ;
            for(uint32_t j=0; j<kplen; j++) JS_FreeAtom(ctx, kptab[j].atom) ;
            js_free(ctx, kptab) ;
        }
        if(kfsEmpty) JS_FreeValue(ctx, objKfs) ;
        else JS_SetPropertyStr(ctx, obj, "keyframes", objKfs) ;

        // 帧动作（jumpTo/playTo/stop）：帧号制；次数取初始值（play() 复位语义往返一致）
        JSValue arrActs = JS_NewArray(ctx) ;
        uint32_t ai = 0 ;
        if(that->timeline) {
            for(auto & kv : that->timeline->getFrameActions()) {
                const Timeline::FrameAction & act = kv.second ;
                JSValue jact = JS_NewObject(ctx) ;
                JS_SetPropertyStr(ctx, jact, "frame", JS_NewUint32(ctx, kv.first)) ;
                JS_SetPropertyStr(ctx, jact, "jumpTo", JS_NewInt64(ctx, act.jumpTo)) ;
                JS_SetPropertyStr(ctx, jact, "jumpCount", JS_NewInt32(ctx, act.jumpCountInit)) ;
                JS_SetPropertyStr(ctx, jact, "playTo", JS_NewInt64(ctx, act.playTo)) ;
                JS_SetPropertyStr(ctx, jact, "playCount", JS_NewInt32(ctx, act.playCountInit)) ;
                if(act.stop) JS_SetPropertyStr(ctx, jact, "stop", JS_NewBool(ctx, true)) ;
                if(act.resume) JS_SetPropertyStr(ctx, jact, "resume", JS_NewBool(ctx, true)) ;
                if(!act.label.empty()) JS_SetPropertyStr(ctx, jact, "label", JS_NewString(ctx, act.label.c_str())) ;
                JS_SetPropertyUint32(ctx, arrActs, ai++, jact) ;
            }
        }
        JS_SetPropertyStr(ctx, obj, "frameActions", arrActs) ;

        return obj ;
    }

    // 从配置对象恢复某帧的「分段映射」{ si: { prop: 值|三元组 } }（导入用，字段无效时静默跳过）
    void Rainbow::restoreFramePropsMap(uint32_t frame, JSValueConst secMap) {
        JSPropertyEnum * ptab = nullptr ;
        uint32_t plen = 0 ;
        if(JS_GetOwnPropertyNames(ctx, &ptab, &plen, secMap, JS_GPN_STRING_MASK|JS_GPN_ENUM_ONLY)!=0) {
            return ;
        }
        for(uint32_t i=0; i<plen; i++) {
            const char * key = JS_AtomToCString(ctx, ptab[i].atom) ;
            if(!key) {
                JS_FreeAtom(ctx, ptab[i].atom) ;
                continue ;
            }
            uint32_t si = (uint32_t)strtoul(key, nullptr, 10) ;
            if(si<sections.size()) {
                JSValue propMap = JS_GetProperty(ctx, secMap, ptab[i].atom) ;
                if(JS_IsObject(propMap)) {
                    restoreFrameProps(frame, si, propMap) ;
                }
                JS_FreeValue(ctx, propMap) ;
            }
            JS_FreeCString(ctx, key) ;
            JS_FreeAtom(ctx, ptab[i].atom) ;
        }
        js_free(ctx, ptab) ;
    }

    // 从配置对象恢复某帧某分段的属性表 { prop: 值|三元组 }（导入用，字段无效时静默跳过）
    void Rainbow::restoreFrameProps(uint32_t frame, uint32_t si, JSValueConst propMap) {
        if(si>=sections.size()) {
            return ;
        }
        Section * sec = (Section*) NativeClass::fromJS(sections[si]) ;
        if(!sec) {
            return ;
        }

        JSPropertyEnum * ptab = nullptr ;
        uint32_t plen = 0 ;
        if(JS_GetOwnPropertyNames(ctx, &ptab, &plen, propMap, JS_GPN_STRING_MASK|JS_GPN_ENUM_ONLY)!=0) {
            return ;
        }
        for(uint32_t i=0; i<plen; i++) {
            const char * pname = JS_AtomToCString(ctx, ptab[i].atom) ;
            if(!pname) {
                JS_FreeAtom(ctx, ptab[i].atom) ;
                continue ;
            }
            double * member = Section::propMember(sec, pname) ;
            if(!member) {
                JS_FreeCString(ctx, pname) ;
                JS_FreeAtom(ctx, ptab[i].atom) ;
                continue ;
            }

            JSValue jv = JS_GetProperty(ctx, propMap, ptab[i].atom) ;
            double value = 0 ;
            tween::TweenEaseType ease = tween::TWEEN_LINEAR ;
            double easeS = 1.70158 ;
            if(JS_IsArray(ctx, jv)) {
                // 三元组 [value, easeName?, easeS?]
                JSValue e0 = JS_GetPropertyUint32(ctx, jv, 0) ;
                JS_ToFloat64(ctx, &value, e0) ;
                JS_FreeValue(ctx, e0) ;
                JSValue e1 = JS_GetPropertyUint32(ctx, jv, 1) ;
                if(JS_IsString(e1)) {
                    const char * cstr = JS_ToCString(ctx, e1) ;
                    tween::TweenEaseType e = tween::map_name_to_id(cstr) ;
                    JS_FreeCString(ctx, cstr) ;
                    if(e!=tween::TWEEN_EASE_UNKNOWN) {
                        ease = e ;
                    }
                }
                JS_FreeValue(ctx, e1) ;
                JSValue e2 = JS_GetPropertyUint32(ctx, jv, 2) ;
                if(JS_IsNumber(e2)) {
                    JS_ToFloat64(ctx, &easeS, e2) ;
                }
                JS_FreeValue(ctx, e2) ;
            } else if(JS_IsNumber(jv)) {
                JS_ToFloat64(ctx, &value, jv) ;
            }
            JS_FreeValue(ctx, jv) ;

            if(frame==0) {
                *member = value ;   // 帧 0：基准值直落成员（无间补语义，ensureOrigin 据此捕获）
            } else {
                timeline->set(frame, member, value, ease, easeS, sec->jsobj) ;
            }

            JS_FreeCString(ctx, pname) ;
            JS_FreeAtom(ctx, ptab[i].atom) ;
        }
        js_free(ctx, ptab) ;
    }

    // 从配置对象恢复一个帧动作（导入用，字段无效时静默跳过）
    void Rainbow::restoreFrameAction(JSValueConst jact) {
        JSValue jv ;
        uint32_t frame = 0 ;
        int64_t jumpTo = -1, playTo = -1 ;
        int32_t jumpCount = 1, playCount = 1 ;
        bool stop = false ;
        bool resume = false ;
        std::string label ;
        uint8_t mask = 0 ;

        jv = JS_GetPropertyStr(ctx, jact, "frame") ;
        JS_ToUint32(ctx, &frame, jv) ;
        JS_FreeValue(ctx, jv) ;

        jv = JS_GetPropertyStr(ctx, jact, "jumpTo") ;
        if(JS_IsNumber(jv)) {
            JS_ToInt64(ctx, &jumpTo, jv) ;
            if(jumpTo>=0) {
                mask |= Timeline::ACTION_JUMP ;
            }
        }
        JS_FreeValue(ctx, jv) ;
        jv = JS_GetPropertyStr(ctx, jact, "jumpCount") ;
        if(JS_IsNumber(jv)) {
            JS_ToInt32(ctx, &jumpCount, jv) ;
        }
        JS_FreeValue(ctx, jv) ;

        jv = JS_GetPropertyStr(ctx, jact, "playTo") ;
        if(JS_IsNumber(jv)) {
            JS_ToInt64(ctx, &playTo, jv) ;
            if(playTo>=0) {
                mask |= Timeline::ACTION_PLAY ;
            }
        }
        JS_FreeValue(ctx, jv) ;
        jv = JS_GetPropertyStr(ctx, jact, "playCount") ;
        if(JS_IsNumber(jv)) {
            JS_ToInt32(ctx, &playCount, jv) ;
        }
        JS_FreeValue(ctx, jv) ;

        jv = JS_GetPropertyStr(ctx, jact, "stop") ;
        if(JS_IsBool(jv) && JS_ToBool(ctx, jv)) {
            stop = true ;
            mask |= Timeline::ACTION_STOP ;
        }
        JS_FreeValue(ctx, jv) ;

        jv = JS_GetPropertyStr(ctx, jact, "resume") ;
        if(JS_IsBool(jv) && JS_ToBool(ctx, jv)) {
            resume = true ;
            mask |= Timeline::ACTION_RESUME ;
        }
        JS_FreeValue(ctx, jv) ;

        jv = JS_GetPropertyStr(ctx, jact, "label") ;
        if(JS_IsString(jv)) {
            const char * s = JS_ToCString(ctx, jv) ;
            if(s) {
                label = s ;
                JS_FreeCString(ctx, s) ;
            }
            mask |= Timeline::ACTION_LABEL ;
        }
        JS_FreeValue(ctx, jv) ;

        if(mask) {
            timeline->setFrameAction(frame, mask, jumpTo, jumpCount, playTo, playCount, stop, resume, label.c_str()) ;
        }
    }

    // 计算 keyframes 中各帧分段下标的最大值（sections 省略时据此推断段数）
    static uint32_t maxSectionIndex(JSContext *ctx, JSValueConst kfs) {
        uint32_t maxSi = 0 ;
        JSPropertyEnum * fptab = nullptr ;
        uint32_t fplen = 0 ;
        if(JS_GetOwnPropertyNames(ctx, &fptab, &fplen, kfs, JS_GPN_STRING_MASK|JS_GPN_ENUM_ONLY)!=0) {
            return 0 ;
        }
        for(uint32_t i=0; i<fplen; i++) {
            JSValue secMap = JS_GetProperty(ctx, kfs, fptab[i].atom) ;
            if(JS_IsObject(secMap)) {
                JSPropertyEnum * sptab = nullptr ;
                uint32_t splen = 0 ;
                if(JS_GetOwnPropertyNames(ctx, &sptab, &splen, secMap, JS_GPN_STRING_MASK|JS_GPN_ENUM_ONLY)==0) {
                    for(uint32_t j=0; j<splen; j++) {
                        const char * key = JS_AtomToCString(ctx, sptab[j].atom) ;
                        if(key) {
                            uint32_t si = (uint32_t)strtoul(key, nullptr, 10) ;
                            if(si>maxSi) {
                                maxSi = si ;
                            }
                            JS_FreeCString(ctx, key) ;
                        }
                        JS_FreeAtom(ctx, sptab[j].atom) ;
                    }
                    js_free(ctx, sptab) ;
                }
            }
            JS_FreeValue(ctx, secMap) ;
            JS_FreeAtom(ctx, fptab[i].atom) ;
        }
        js_free(ctx, fptab) ;
        return maxSi ;
    }

    /**
     * 导入配置
     *
     * 应用 exportConfig() 产出的配置对象：更新时间线参数（fps/frames/repeat）、
     * 替换全部分段（sections 可省略，按 keyframes 最大分段下标推断段数）、
     * 恢复全部关键帧（按帧聚合；帧 0 基准值直落成员，非 0 帧为间补目标值，
     * 仅当存在非 0 关键帧或帧动作时才创建时间线），最后绘制一帧。
     * 驱动层 strip 配置不在 config 内，由 strip.setup() 单独维护。
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
        int64_t itmp ;

        // 1. 更新时间线参数（fps/frames/repeat 缺省沿用当前值）并销毁旧时间线；
        //    新时间线仅在存在非 0 关键帧或帧动作时创建
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
        v = JS_GetPropertyStr(ctx, argv[0], "repeatCount") ;
        if(JS_IsNumber(v) && JS_ToInt64(ctx, &itmp, v)==0) {
            that->tlRepeatCount = itmp ;
        }
        JS_FreeValue(ctx, v) ;
        that->destroyTimeline() ;

        // 2. 关键帧对象（可缺省）：先取引用，供推断段数与恢复用
        JSValue kfs = JS_GetPropertyStr(ctx, argv[0], "keyframes") ;
        bool hasKfs = JS_IsObject(kfs) ;

        // 3. 替换全部分段：sections 存在取其 length；否则按 keyframes 最大分段下标 +1 推断
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

        uint32_t secCount = 1 ;
        v = JS_GetPropertyStr(ctx, argv[0], "sections") ;
        if(JS_IsArray(ctx, v)) {
            JSValue jslen = JS_GetPropertyStr(ctx, v, "length") ;
            JS_ToUint32(ctx, &secCount, jslen) ;
            JS_FreeValue(ctx, jslen) ;
            for(uint32_t i=0; i<secCount; i++) {
                JSValue secCfg = JS_GetPropertyUint32(ctx, v, i) ;
                Section * sec = new Section(ctx, JS_NULL) ;
                sec->shared() ;
                sec->applyConfig(secCfg) ;
                sec->strip = strip ;
                sec->rainbowObj = that->jsobj ;             // 弱引用（不 DupValue，避免循环引用）
                that->sections.push_back(sec->jsobj) ;      // 转移 build() 的计数所有权，不再 DupValue（避免泄漏）
                JS_FreeValue(ctx, secCfg) ;
            }
        } else {
            if(hasKfs) {
                secCount = maxSectionIndex(ctx, kfs) + 1 ;
            }
            for(uint32_t i=0; i<secCount; i++) {
                Section * sec = new Section(ctx, JS_NULL) ;
                sec->shared() ;
                sec->strip = strip ;
                sec->rainbowObj = that->jsobj ;             // 弱引用（不 DupValue，避免循环引用）
                that->sections.push_back(sec->jsobj) ;      // 转移 build() 的计数所有权
            }
        }
        JS_FreeValue(ctx, v) ;

        // 4. 恢复关键帧（按帧聚合 { [frame]: { [si]: { [prop]: 值|三元组 } } }）。
        //    先处理帧 0（基准值直落成员），再处理其余帧（间补目标值，ensureOrigin 据此捕获正确基准）。
        if(hasKfs) {
            JSPropertyEnum * fptab = nullptr ;
            uint32_t fplen = 0 ;
            if(JS_GetOwnPropertyNames(ctx, &fptab, &fplen, kfs, JS_GPN_STRING_MASK|JS_GPN_ENUM_ONLY)==0) {
                // 第一遍：帧 0（基准值）
                for(uint32_t i=0; i<fplen; i++) {
                    const char * fkey = JS_AtomToCString(ctx, fptab[i].atom) ;
                    uint32_t frame = 0 ;
                    if(fkey) {
                        frame = (uint32_t)strtoul(fkey, nullptr, 10) ;
                        JS_FreeCString(ctx, fkey) ;
                    }
                    if(frame!=0) {
                        continue ;
                    }
                    JSValue secMap = JS_GetProperty(ctx, kfs, fptab[i].atom) ;
                    if(JS_IsObject(secMap)) {
                        that->restoreFramePropsMap(0, secMap) ;
                    }
                    JS_FreeValue(ctx, secMap) ;
                }
                // 第二遍：帧 > 0（间补目标值）
                for(uint32_t i=0; i<fplen; i++) {
                    const char * fkey = JS_AtomToCString(ctx, fptab[i].atom) ;
                    uint32_t frame = 0 ;
                    if(fkey) {
                        frame = (uint32_t)strtoul(fkey, nullptr, 10) ;
                        JS_FreeCString(ctx, fkey) ;
                    }
                    if(frame==0) {
                        continue ;
                    }
                    that->ensureTimeline() ;
                    JSValue secMap = JS_GetProperty(ctx, kfs, fptab[i].atom) ;
                    if(JS_IsObject(secMap)) {
                        that->restoreFramePropsMap(frame, secMap) ;
                    }
                    JS_FreeValue(ctx, secMap) ;
                }
                for(uint32_t i=0; i<fplen; i++) {
                    JS_FreeAtom(ctx, fptab[i].atom) ;
                }
                js_free(ctx, fptab) ;
            }
        }
        JS_FreeValue(ctx, kfs) ;

        // 5. 恢复帧动作（jumpTo/playTo；有帧动作时也需创建时间线）
        v = JS_GetPropertyStr(ctx, argv[0], "frameActions") ;
        if(JS_IsArray(ctx, v)) {
            JSValue jslen = JS_GetPropertyStr(ctx, v, "length") ;
            uint32_t count = 0 ;
            JS_ToUint32(ctx, &count, jslen) ;
            JS_FreeValue(ctx, jslen) ;
            if(count>0) {
                that->ensureTimeline() ;
            }
            for(uint32_t i=0; i<count; i++) {
                JSValue jact = JS_GetPropertyUint32(ctx, v, i) ;
                if(JS_IsObject(jact)) {
                    that->restoreFrameAction(jact) ;
                }
                JS_FreeValue(ctx, jact) ;
            }
        }
        JS_FreeValue(ctx, v) ;

        // 6. 初始绘制
        that->redraw() ;

        return JS_UNDEFINED ;
    }
}
