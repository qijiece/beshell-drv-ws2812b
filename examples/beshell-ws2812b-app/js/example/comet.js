import { WS2812B } from "ws2812b"

// LED 配置
const LED_PIN = 8
const LED_COUNT = 16

// 效果配置
const TAIL_LENGTH = 8       // 彗星尾巴长度
const SPEED = 50            // 移动速度 (ms)

// 彗星颜色
const HEAD_COLOR = [255, 255, 255]  // 白色头部
const TAIL_COLOR = [0, 0, 255]      // 蓝色尾巴

async function main() {
    console.log("\n=== WS2812B Comet Effect ===\n")
    
    let strip = new WS2812B()
    strip.setup({
        pin: LED_PIN,
        length: LED_COUNT
    })
    
    console.log("Comet effect starting...")
    console.log("Press Ctrl+C to stop\n")
    
    let position = -TAIL_LENGTH
    let direction = 1  // 1 = 正向, -1 = 反向
    
    while (true) {
        strip.clear()
        
        // 绘制彗星尾巴
        for (let i = 0; i < TAIL_LENGTH; i++) {
            let pos = position - (i * direction)
            
            if (pos >= 0 && pos < LED_COUNT) {
                // 计算亮度 (头部最亮)
                let brightness = 1 - (i / TAIL_LENGTH)
                brightness = brightness * brightness  // 平方使衰减更自然
                
                // 混合头部和尾部颜色
                let r = Math.floor(
                    HEAD_COLOR[0] * brightness * (1 - i/TAIL_LENGTH) +
                    TAIL_COLOR[0] * brightness * (i/TAIL_LENGTH)
                )
                let g = Math.floor(
                    HEAD_COLOR[1] * brightness * (1 - i/TAIL_LENGTH) +
                    TAIL_COLOR[1] * brightness * (i/TAIL_LENGTH)
                )
                let b = Math.floor(
                    HEAD_COLOR[2] * brightness * (1 - i/TAIL_LENGTH) +
                    TAIL_COLOR[2] * brightness * (i/TAIL_LENGTH)
                )
                
                strip.setPixel(pos, r, g, b)
            }
        }
        
        strip.flush()
        
        // 移动位置
        position += direction
        
        // 到达边界时反弹
        if (position >= LED_COUNT + TAIL_LENGTH) {
            direction = -1
            position = LED_COUNT + TAIL_LENGTH - 1
        } else if (position < -TAIL_LENGTH) {
            direction = 1
            position = -TAIL_LENGTH + 1
        }
        
        await sleep(SPEED)
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

main()
