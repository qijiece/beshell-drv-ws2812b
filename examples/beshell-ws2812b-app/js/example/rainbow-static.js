import { Strip, Rainbow } from "ws2812b"

// Rainbow 静态示例：不创建时间线、无动画，仅由分段静态绘制灯带
// 16 个 LED 分为两段彩虹渐变，只绘制一次

const LED_PIN = 8           // GPIO 引脚 (根据你的硬件修改)
const LED_COUNT = 16        // LED 数量

// 创建并初始化灯带
const strip = new Strip()
strip.setup({
    pin: LED_PIN,
    length: LED_COUNT,
})

// 创建主控：不传时间线选项，纯静态使用时不会创建 Timeline
const rainbow = new Rainbow(strip)

// 前半段：红 → 绿 渐变（Section 只能由 addSection 创建）
rainbow.addSection({
    x: 0, len: 8,
    h0: 0,   s0: 1, v0: 1,
    h1: 120, s1: 1, v1: 1,
})

// 后半段：绿 → 蓝 渐变
rainbow.addSection({
    x: 8, len: 8,
    h0: 120, s0: 1, v0: 1,
    h1: 240, s1: 1, v1: 1,
})

// 绘制一次即完成（修改分段属性后再次调用 draw() 即可刷新）
rainbow.draw()

console.log("Rainbow static draw done!")
