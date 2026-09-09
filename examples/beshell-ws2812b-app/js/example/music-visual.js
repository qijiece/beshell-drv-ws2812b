import { Strip } from "ws2812b"

// LED 配置
const LED_PIN = 8
const LED_COUNT = 16

// 可视化配置
const BAR_COUNT = 8           // 条形数量 (每 2 个 LED 一个条形)
const DECAY_SPEED = 0.05      // 衰减速度

// 颜色映射 (低频率到高频率)
function getBarColor(index, total) {
    // 从绿色渐变到红色
    let t = index / (total - 1)
    let r = Math.floor(lerp(0, 255, t))
    let g = Math.floor(lerp(255, 0, t))
    let b = 0
    return [r, g, b]
}

function lerp(start, end, t) {
    return start + (end - start) * t
}

class MusicVisualizer {
    constructor(ledCount) {
        this.ledCount = ledCount
        this.barCount = Math.floor(ledCount / 2)
        this.barLevels = new Array(this.barCount).fill(0)
        this.targetLevels = new Array(this.barCount).fill(0)
    }
    
    // 模拟音频数据
    simulateAudio() {
        for (let i = 0; i < this.barCount; i++) {
            // 模拟音乐节奏 (低音部分通常更强)
            let baseLevel = (this.barCount - i) / this.barCount
            let randomFactor = Math.random()
            let beat = Math.sin(Date.now() / 200) * 0.5 + 0.5  // 模拟节拍
            
            this.targetLevels[i] = baseLevel * randomFactor * beat * 1.5
            if (this.targetLevels[i] > 1) this.targetLevels[i] = 1
        }
    }
    
    update() {
        // 平滑过渡
        for (let i = 0; i < this.barCount; i++) {
            if (this.barLevels[i] < this.targetLevels[i]) {
                this.barLevels[i] = this.targetLevels[i]
            } else {
                this.barLevels[i] -= DECAY_SPEED
                if (this.barLevels[i] < 0) this.barLevels[i] = 0
            }
        }
    }
    
    render(strip) {
        strip.clear()
        
        for (let i = 0; i < this.barCount; i++) {
            let level = this.barLevels[i]
            let height = Math.floor(level * 2)  // 每个条形最多 2 个 LED
            let color = getBarColor(i, this.barCount)
            
            // 从底部向上点亮
            let baseIndex = i * 2
            for (let j = 0; j < 2; j++) {
                let ledIndex = baseIndex + j
                if (ledIndex >= this.ledCount) break
                
                if (j < height) {
                    strip.setPixel(ledIndex, color[0], color[1], color[2])
                } else if (j === height && level > 0) {
                    // 部分亮度
                    let partial = (level * 2) - Math.floor(level * 2)
                    strip.setPixel(ledIndex, 
                        Math.floor(color[0] * partial),
                        Math.floor(color[1] * partial),
                        Math.floor(color[2] * partial)
                    )
                }
            }
        }
        
        strip.flush()
    }
}

async function main() {
    console.log("\n=== WS2812B Music Visualization Effect ===\n")
    
    let strip = new Strip()
    strip.setup({
        pin: LED_PIN,
        length: LED_COUNT
    })
    
    let visualizer = new MusicVisualizer(LED_COUNT)
    
    console.log("Music visualization effect starting...")
    console.log("(Simulated audio data)")
    console.log("Press Ctrl+C to stop\n")
    
    while (true) {
        visualizer.simulateAudio()
        visualizer.update()
        visualizer.render(strip)
        
        await sleep(30)
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

main()
