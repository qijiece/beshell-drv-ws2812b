import { WS2812B } from "ws2812b"

// LED 配置
const LED_PIN = 8           // GPIO 引脚
const LED_COUNT = 16        // LED 数量

// HSL 转 RGB
function hslToRgb(h, s, l) {
    let r, g, b
    
    if (s === 0) {
        r = g = b = l
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1
            if (t > 1) t -= 1
            if (t < 1/6) return p + (q - p) * 6 * t
            if (t < 1/2) return q
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
            return p
        }
        
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s
        const p = 2 * l - q
        r = hue2rgb(p, q, h + 1/3)
        g = hue2rgb(p, q, h)
        b = hue2rgb(p, q, h - 1/3)
    }
    
    return [
        Math.round(r * 255),
        Math.round(g * 255),
        Math.round(b * 255)
    ]
}

// 色相转 RGB (彩虹色)
function hueToRgb(hue) {
    // hue: 0-360
    let h = hue / 360
    return hslToRgb(h, 1, 0.5)
}

async function main() {
    console.log("\n=== WS2812B Rainbow Effect ===\n")
    
    let strip = new WS2812B()
    strip.setup({
        pin: LED_PIN,
        length: LED_COUNT
    })
    
    console.log("Rainbow effect starting...")
    console.log("Press Ctrl+C to stop\n")
    
    let offset = 0
    
    while (true) {
        // 为每个 LED 设置彩虹色
        for (let i = 0; i < LED_COUNT; i++) {
            // 计算色相 (0-360)
            let hue = ((i * 360 / LED_COUNT) + offset) % 360
            let rgb = hueToRgb(hue)
            strip.setPixel(i, rgb[0], rgb[1], rgb[2])
        }
        
        strip.flush()
        
        // 增加偏移量，产生流动效果
        offset += 5
        if (offset >= 360) {
            offset = 0
        }
        
        await sleep(50)
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

main()
