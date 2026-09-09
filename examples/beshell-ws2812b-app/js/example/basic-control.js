import { Strip } from "ws2812b"

// LED 配置
const LED_PIN = 8           // GPIO 引脚 (根据你的硬件修改)
const LED_COUNT = 16        // LED 数量

async function main() {
    console.log("\n=== WS2812B Basic Control Example ===\n")
    
    // 创建 WS2812B 对象
    let strip = new Strip()
    
    // 初始化 LED 灯带
    console.log(`Initializing ${LED_COUNT} LEDs on GPIO ${LED_PIN}...`)
    strip.setup({
        pin: LED_PIN,
        length: LED_COUNT
    })
    
    console.log("LED strip initialized!")
    console.log("\nDemo sequence starting...")
    console.log("Press Ctrl+C to stop\n")
    
    // 1. 全部红色
    console.log("1. All Red")
    for (let i = 0; i < LED_COUNT; i++) {
        strip.setPixel(i, 255, 0, 0)  // R, G, B
    }
    strip.flush()
    await sleep(1000)
    
    // 2. 全部绿色
    console.log("2. All Green")
    for (let i = 0; i < LED_COUNT; i++) {
        strip.setPixel(i, 0, 255, 0)
    }
    strip.flush()
    await sleep(1000)
    
    // 3. 全部蓝色
    console.log("3. All Blue")
    for (let i = 0; i < LED_COUNT; i++) {
        strip.setPixel(i, 0, 0, 255)
    }
    strip.flush()
    await sleep(1000)
    
    // 4. 全部白色
    console.log("4. All White")
    for (let i = 0; i < LED_COUNT; i++) {
        strip.setPixel(i, 255, 255, 255)
    }
    strip.flush()
    await sleep(1000)
    
    // 5. 逐个显示不同颜色
    console.log("5. Individual Colors")
    strip.clear()
    strip.flush()
    
    const colors = [
        [255, 0, 0],    // Red
        [255, 127, 0],  // Orange
        [255, 255, 0],  // Yellow
        [0, 255, 0],    // Green
        [0, 255, 255],  // Cyan
        [0, 0, 255],    // Blue
        [127, 0, 255],  // Purple
        [255, 0, 255],  // Magenta
    ]
    
    for (let i = 0; i < LED_COUNT; i++) {
        let color = colors[i % colors.length]
        strip.setPixel(i, color[0], color[1], color[2])
        strip.flush()
        await sleep(100)
    }
    await sleep(1000)
    
    // 6. 清除所有
    console.log("6. Clear All")
    strip.clear()
    strip.flush()
    
    console.log("\nDemo completed!")
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

main()
