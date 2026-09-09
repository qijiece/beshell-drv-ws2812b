# 1.1.0

New Feature :

* 新增 `Section`（灯带分段）与 `Rainbow`（动画主控）类：Rainbow 管理分段并按序绘制灯带，时间线（animator.Timeline）按需惰性创建——首次使用动画功能（sec.set(props, time)/play 等）时才创建，纯静态绘制不产生时间线开销；构造参数 `frames` 可省略，省略时自动以最后一个关键帧为总帧数；分段的可动画属性（x/len/起终点 HSV/前后阴影长度）通过 Timeline 的 C++ 指针轨道直接驱动，订阅 Timeline 的 C++ 侧 change 事件自动重绘灯带
* `Section` 无 JS 构造函数，由 `rainbow.addSection(config)` 创建；关键帧通过 `sec.setKeyFrame(frame, props)` / `sec.setKeyFrameMS(ms, props)` 显式设置，或移动游标后 `sec.set(props)` 写在游标帧上；`sec.unset([prop,] timeMs)` 移除；`rainbow.timeToFrame(ms)` 提供毫秒→帧号换算
* `Rainbow` 新增游标：`cursor` 属性（帧号）与 `setCursorMS(ms)` 毫秒版本；赋值游标时应用各分段在该帧的插补值并重绘灯带（编辑器拖动进度条实时预览），分段关键帧不受影响
* `Section` 支持 HSV 三分量独立过渡缓动、前驱/后续明度衰减阴影（长度/缓动可配；前驱=索引减小方向、取起点色，后续=索引增大方向、取终点色），len=1 时退化为点；回环 strip 上 x 自动对长度取模套圈
* `Strip` 新增 `loop` 回环字段（setup 配置或 loop 属性），回环模式下像素索引取模回卷、非回环裁剪；新增 `setPixelHSV`（C++ 侧 HSV→RGB）；setup 可重复调用；新增 `exportConfig()/importConfig()` 配置导入导出
* `Strip` 新增与 JS 侧同名的 C++ 实例绘制方法 `setPixel/setPixelHSV/clear/flush`
* 新增 `ws2812b` 模块入口类 `WS2812B`（`beshell.use<WS2812B>()` 级联注册 Strip/Section/Rainbow），JS 胶水层将三个类转挂到 ws2812b 模块，并导出 `hsv2rgb(h,s,v)` 函数
* `Rainbow`/`Section` 支持 `exportConfig()/importConfig()` 整体导入导出（含 strip 驱动层配置、分段、时间线关键帧；关键帧 `time` 字段为毫秒），供编辑器使用
* `sec.set` 属性表形式支持表级 `ease`/`easeS` 键，作为该帧全部属性的默认缓动（如 `{ x: 16, ease: "linear" }`），数组形式 `[value, easeName, easeS]` 可单独覆盖
* `Section` 新增 `h_ccw` 属性指定主体内 h0→h1 的色相过渡方向（默认顺时针即色相增大方向，h_ccw=true 为逆时针）；h0/h1 允许超出 0-360（可为负或多圈值，显示时对 360 取模）表达跨圈/多圈过渡（如 h0=0、h1=360 走整圈彩虹）；关键帧驱动 h0/h1 时同样生效（如 0→720 表示随时间顺时针绕两圈）

Fix :

* 修复 `Rainbow` 动画在模块脚本 eval 结束后立即停止：QuickJS 将模块顶层未被捕获/导出的绑定编译为栈局部变量，eval 结束即释放，导致 Rainbow 实例被 GC 析构进而 stop 时间线；现播放期间 Rainbow 自锚（C++ 侧引用 + jsobj 强引用，与 Timeline::loopRef/loopObjRef 同款模式），停止（手动/播完自动）时经 EVENT_STOP 释放
* 修复 `Rainbow` 销毁/重建时间线时 Timeline 对象泄漏（未释放 C++ 侧持有的 jsobj 计数）；修复 `importConfig` 创建 Section 时的重复计数泄漏

# 1.0.2

Refact :

* 命名空间 `be::driver::led` 更名为 `be::driver::ws2812b`，源码目录同步调整为 `src/beshell/driver/ws2812b/`
* 类 `WS2812B` 更名为 `Strip`（JS 侧同步为 `import { Strip } from "ws2812b"`）

# 1.0.1 2026/5/13

Refact :

* 按命名空间组织源代码目录

