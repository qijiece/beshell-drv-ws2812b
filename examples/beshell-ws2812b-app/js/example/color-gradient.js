import { WS2812B } from "ws2812b"

// LED 配置
const LED_PIN = 8
const LED_COUNT = 16

// 颜色插值函数
function lerp(start, end, t) {
    return start + (end - start) * t
}

function lerpColor(color1, color2, t) {
    return [
        Math.floor(lerp(color1[0], color2[0], t)),
        Math.floor(lerp(color1[1], color2[1], t)),
        Math.floor(lerp(color1[2], color2[2], t))
    ]
}

async function main() {
    console.log("\n=== WS2812B Color Gradient Effect ===\n")
    
    let strip = new WS2812B()
    strip.setup({
        pin: LED_PIN,
        length: LED_COUNT
    })
    
    console.log("Color gradient effect starting...")
    console.log("Press Ctrl+C to stop\n")
    
    // 定义颜色序列
    const colors = [
        [255, 0, 0],      // Red
        [255, 127, 0],    // Orange
        [255, 255, 0],    // Yellow
        [0, 255, 0],      // Green
        [0, 255, 255],    // Cyan
        [0, 0, 255],      // Blue
        [127, 0, 255],    // Purple
        [255, 0, 255],    // Magenta
    ]
    
    let colorIndex = 0
    let progress = 0
    
    while (true) {
        let color1 = colors[colorIndex]
        let color2 = colors[(colorIndex + 1) % colors.length]
        
        // 计算当前渐变颜色
        let currentColor = lerpColor(color1, color2, progress)
        
        // 应用到所有 LED
        for (let i = 0; i < LED_COUNT; i++) {
            strip.setPixel(i, currentColor[0], currentColor[1], currentColor[2])
        }
        strip.flush()
        
        // 更新进度
        progress += 0.01
        if (progress >= 1) {
            progress = 0
            colorIndex = (colorIndex + 1) % colors.length
        }
        
        await sleep(30)
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

main()
