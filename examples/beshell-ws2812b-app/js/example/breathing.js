import { Strip } from "ws2812b"

// LED 配置
const LED_PIN = 8
const LED_COUNT = 16

// 颜色配置
const COLOR = [0, 127, 255]  // 蓝色

async function main() {
    console.log("\n=== WS2812B Breathing Light Effect ===\n")
    
    let strip = new Strip()
    strip.setup({
        pin: LED_PIN,
        length: LED_COUNT
    })
    
    console.log("Breathing effect starting...")
    console.log("Color: RGB(" + COLOR.join(", ") + ")")
    console.log("Press Ctrl+C to stop\n")
    
    let phase = 0  // 0 - 2*PI
    
    while (true) {
        // 使用正弦函数计算亮度 (0-1)
        let brightness = (Math.sin(phase) + 1) / 2
        
        // 应用亮度到颜色
        let r = Math.floor(COLOR[0] * brightness)
        let g = Math.floor(COLOR[1] * brightness)
        let b = Math.floor(COLOR[2] * brightness)
        
        // 设置所有 LED
        for (let i = 0; i < LED_COUNT; i++) {
            strip.setPixel(i, r, g, b)
        }
        strip.flush()
        
        // 增加相位
        phase += 0.05
        if (phase >= 2 * Math.PI) {
            phase = 0
        }
        
        await sleep(30)
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

main()
