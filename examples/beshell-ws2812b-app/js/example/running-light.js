import { WS2812B } from "ws2812b"

// LED 配置
const LED_PIN = 8
const LED_COUNT = 16

// 效果配置
const TRAIL_LENGTH = 5      // 拖尾长度
const SPEED = 100           // 移动速度 (ms)

// 颜色
const HEAD_COLOR = [255, 255, 255]  // 头部白色
const TRAIL_COLOR = [255, 0, 0]     // 拖尾红色

async function main() {
    console.log("\n=== WS2812B Running Light Effect ===\n")
    
    let strip = new WS2812B()
    strip.setup({
        pin: LED_PIN,
        length: LED_COUNT
    })
    
    console.log("Running light effect starting...")
    console.log("Press Ctrl+C to stop\n")
    
    let position = 0
    
    while (true) {
        // 清除所有
        strip.clear()
        
        // 绘制拖尾
        for (let i = 0; i < TRAIL_LENGTH; i++) {
            let pos = position - i
            if (pos >= 0 && pos < LED_COUNT) {
                // 计算亮度 (头部最亮，尾部渐暗)
                let brightness = 1 - (i / TRAIL_LENGTH)
                let r = Math.floor(TRAIL_COLOR[0] * brightness)
                let g = Math.floor(TRAIL_COLOR[1] * brightness)
                let b = Math.floor(TRAIL_COLOR[2] * brightness)
                strip.setPixel(pos, r, g, b)
            }
        }
        
        // 绘制头部
        if (position >= 0 && position < LED_COUNT) {
            strip.setPixel(position, HEAD_COLOR[0], HEAD_COLOR[1], HEAD_COLOR[2])
        }
        
        strip.flush()
        
        // 移动位置
        position++
        if (position >= LED_COUNT + TRAIL_LENGTH) {
            position = -TRAIL_LENGTH
        }
        
        await sleep(SPEED)
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

main()
