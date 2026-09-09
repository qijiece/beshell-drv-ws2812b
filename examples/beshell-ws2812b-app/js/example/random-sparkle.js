import { Strip } from "ws2812b"

// LED 配置
const LED_PIN = 8
const LED_COUNT = 16

// 效果配置
const SPARKLE_COUNT = 3     // 同时闪烁的 LED 数量
const FADE_SPEED = 0.1      // 淡出速度

class Sparkle {
    constructor(index) {
        this.index = index
        this.brightness = 0
        this.active = false
        this.color = [0, 0, 0]
    }
    
    activate() {
        this.active = true
        this.brightness = 1
        // 随机颜色
        this.color = [
            Math.floor(Math.random() * 256),
            Math.floor(Math.random() * 256),
            Math.floor(Math.random() * 256)
        ]
    }
    
    update() {
        if (!this.active) return
        
        this.brightness -= FADE_SPEED
        if (this.brightness <= 0) {
            this.brightness = 0
            this.active = false
        }
    }
    
    getColor() {
        return [
            Math.floor(this.color[0] * this.brightness),
            Math.floor(this.color[1] * this.brightness),
            Math.floor(this.color[2] * this.brightness)
        ]
    }
}

async function main() {
    console.log("\n=== WS2812B Random Sparkle Effect ===\n")
    
    let strip = new Strip()
    strip.setup({
        pin: LED_PIN,
        length: LED_COUNT
    })
    
    console.log("Random sparkle effect starting...")
    console.log("Press Ctrl+C to stop\n")
    
    // 创建 sparkle 数组
    let sparkles = []
    for (let i = 0; i < LED_COUNT; i++) {
        sparkles.push(new Sparkle(i))
    }
    
    while (true) {
        // 随机激活一些 sparkle
        let activeCount = sparkles.filter(s => s.active).length
        if (activeCount < SPARKLE_COUNT) {
            // 找一个不活跃的 sparkle
            let inactive = sparkles.filter(s => !s.active)
            if (inactive.length > 0) {
                let random = inactive[Math.floor(Math.random() * inactive.length)]
                random.activate()
            }
        }
        
        // 更新所有 sparkle
        for (let sparkle of sparkles) {
            sparkle.update()
        }
        
        // 渲染到 LED
        strip.clear()
        for (let sparkle of sparkles) {
            if (sparkle.active) {
                let color = sparkle.getColor()
                strip.setPixel(sparkle.index, color[0], color[1], color[2])
            }
        }
        strip.flush()
        
        await sleep(50)
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

main()
