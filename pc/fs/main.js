// beshell-drv-ws2812b PC/WASM 冒烟脚本：验证软件帧缓冲后端 + 动画逻辑
import { Strip, Rainbow, hsv2rgb } from "ws2812b"

console.log("[ws2812b] main.js running")

// hsv2rgb 纯函数
const c = hsv2rgb(120, 1, 1)
if (c[0] === 0 && c[1] === 255 && c[2] === 0) {
    console.log("[ws2812b] hsv2rgb ok:", JSON.stringify(c))
} else {
    console.log("[ws2812b] hsv2rgb FAIL:", JSON.stringify(c))
}

// Strip：PC 端 pin 仅作占位，后端为软件帧缓冲
const strip = new Strip()
strip.setup({ pin: 5, length: 16, loop: true })
strip.setPixel(0, 255, 0, 0)
strip.setPixelHSV(1, 120, 1, 1)
strip.flush()
console.log("[ws2812b] strip loop =", strip.loop)

// Rainbow 动画主控（依赖 animator，纯逻辑）
const rb = new Rainbow(strip, { fps: 30, repeat: true })
const sec = rb.addSection({ x: 0, len: 8, h0: 0, h1: 360, shadowBack: 2 })
rb.draw()
console.log("[ws2812b] rainbow draw ok")

console.log("[ws2812b] smoke test done")
