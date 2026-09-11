import { Strip, Rainbow } from "ws2812b"

// Rainbow 示例：Timeline 驱动的彩虹分段动画
// 灯带首尾相接（回环），一个彩虹分段绕圈跑动

const LED_PIN = 8           // GPIO 引脚 (根据你的硬件修改)
const LED_COUNT = 16        // LED 数量

// 创建并初始化灯带（回环模式）
const strip = new Strip()
strip.setup({
    pin: LED_PIN,
    length: LED_COUNT,
    loop: true,
})

// 创建主控：30fps，循环播放；frames 省略，自动以最后关键帧（10000ms → 300 帧）为总长
const rainbow = new Rainbow(strip, { fps: 30, repeat: true })

// 分段：8 个像素的彩虹渐变，前后各带 2 像素阴影（Section 只能由 addSection 创建）
const sec = rainbow.addSection({
    x: 0,
    len: 8,
    h0: 0, s0: 100, v0: 100,      // 起点：红
    h1: 360, s1: 100, v1: 100,    // 终点：绕色相环一圈
    shadowFront: 2, shadowFrontEase: "outQuad",
    shadowBack: 2,  shadowBackEase: "outQuad",
})

// 关键帧：10 秒内 x 从 0 移动到 16（正好绕回环灯带一圈，自动取模套圈）
// 起始状态 x=0 已在 addSection 配置中（自动捕获为 0 帧原点）
sec.setKeyFrameMS(10000, { x: LED_COUNT, ease: "linear" })

// 也可以用游标方式写关键帧（编辑器场景）：
// rainbow.cursor = 0 ; sec.set({ x: 0 })
// rainbow.setCursorMS(10000) ; sec.set({ x: LED_COUNT, ease: "linear" })

// 初始帧 + 播放
rainbow.draw()
rainbow.play()

console.log("Rainbow is running!")
console.log("导出配置示例：")
console.log(JSON.stringify(rainbow.exportConfig()))
