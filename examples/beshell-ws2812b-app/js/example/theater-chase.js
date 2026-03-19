import { WS2812B } from "ws2812b"

// LED 配置
const LED_PIN = 8
const LED_COUNT = 16

// 效果配置
const CHASE_SIZE = 3      // 每组追逐灯的数量
const GAP_SIZE = 3        // 间隔
const SPEED = 150         // 速度 (ms)

// 颜色
const COLOR = [255, 0, 0]  // 红色

async function main() {
    console.log("\n=== WS2812B Theater Chase Effect ===\n")
    
    let strip = new WS2812B()
    strip.setup({
        pin: LED_PIN,
        length: LED_COUNT
    })
    
    console.log("Theater chase effect starting...")
    console.log("Press Ctrl+C to stop\n")
    
    let offset = 0
    
    while (true) {
        strip.clear()
        
        // 绘制追逐灯
        for (let i = offset; i < LED_COUNT; i += CHASE_SIZE + GAP_SIZE) {
            for (let j = 0; j < CHASE_SIZE; j++) {
                let pos = i + j
                if (pos < LED_COUNT) {
                    strip.setPixel(pos, COLOR[0], COLOR[1], COLOR[2])
                }
            }
        }
        
        strip.flush()
        
        // 移动偏移
        offset++
        if (offset >= CHASE_SIZE + GAP_SIZE) {
            offset = 0
        }
        
        await sleep(SPEED)
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

main()
