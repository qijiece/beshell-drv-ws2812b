# BeShell-WS2812B Example App

这是一个演示 BeShell-WS2812B (WS2812B RGB LED 驱动) 用法的示例工程。

## 功能特性

本示例工程演示了以下功能：

### LED 效果

| 示例文件 | 说明 |
|---------|------|
| `basic-control.js` | 基础控制：设置颜色、清除、刷新 |
| `rainbow.js` | 彩虹流动效果 |
| `breathing.js` | 呼吸灯效果 |
| `running-light.js` | 跑马灯效果 |
| `color-gradient.js` | 颜色渐变效果 |
| `random-sparkle.js` | 随机闪烁效果 |
| `music-visual.js` | 音乐可视化效果 (模拟) |
| `theater-chase.js` | 剧院追逐灯效果 |
| `comet.js` | 彗星拖尾效果 |

## 项目结构

```
beshell-ws2812b-app/
├── CMakeLists.txt          # 项目 CMake 配置
├── sdkconfig.defaults      # 默认 SDK 配置
├── README.md               # 本文件
├── main/
│   ├── main.cpp            # C++ 入口文件
│   ├── CMakeLists.txt      # main 组件 CMake 配置
│   └── idf_component.yml   # 组件依赖配置
├── img/
│   ├── partitions-4MB.csv  # 4MB Flash 分区表
│   ├── partitions-8MB.csv  # 8MB Flash 分区表
│   └── partitions-16MB.csv # 16MB Flash 分区表
└── js/
    ├── main.js             # JS 入口文件
    └── example/            # 示例脚本目录
        ├── basic-control.js
        ├── rainbow.js
        ├── breathing.js
        ├── running-light.js
        ├── color-gradient.js
        ├── random-sparkle.js
        ├── music-visual.js
        ├── theater-chase.js
        └── comet.js
```

## 硬件要求

- ESP32 / ESP32-S3 / ESP32-C3 等芯片
- WS2812B RGB LED 灯带
- 至少 4MB Flash
- USB 转串口用于烧录和调试

### 硬件连接

```
ESP32 GPIO8  -->  WS2812B DIN
ESP32 GND    -->  WS2812B GND
ESP32 5V     -->  WS2812B VCC (或通过外部电源供电)
```

**注意**：如果 LED 数量较多，建议使用外部 5V 电源为 LED 供电。

## 快速开始

### 1. 修改配置

根据你的硬件修改示例中的配置：

```javascript
const LED_PIN = 8        // GPIO 引脚
const LED_COUNT = 16     // LED 数量
```

### 2. 构建项目

```bash
idf.py build
```

### 3. 烧录固件

```bash
idf.py flash
```

### 4. 查看串口输出

```bash
idf.py monitor
```

### 5. 运行示例

在串口终端中，输入以下命令运行示例：

```
run /example/rainbow.js
```

## 示例详解

### 基础控制

```javascript
import { WS2812B } from "ws2812b"

let strip = new WS2812B()
strip.setup({
    pin: 8,
    length: 16
})

// 设置单个像素颜色
strip.setPixel(0, 255, 0, 0)  // 红色

// 刷新显示
strip.flush()

// 清除所有
strip.clear()
strip.flush()
```

### 彩虹效果

```javascript
// HSL 转 RGB 函数
function hueToRgb(hue) {
    // hue: 0-360
    // 返回 [r, g, b]
}

// 彩虹流动
let offset = 0
while (true) {
    for (let i = 0; i < LED_COUNT; i++) {
        let hue = ((i * 360 / LED_COUNT) + offset) % 360
        let rgb = hueToRgb(hue)
        strip.setPixel(i, rgb[0], rgb[1], rgb[2])
    }
    strip.flush()
    offset += 5
}
```

### 呼吸灯

```javascript
let phase = 0
while (true) {
    let brightness = (Math.sin(phase) + 1) / 2
    let r = Math.floor(255 * brightness)
    let g = Math.floor(127 * brightness)
    let b = Math.floor(0 * brightness)
    
    for (let i = 0; i < LED_COUNT; i++) {
        strip.setPixel(i, r, g, b)
    }
    strip.flush()
    
    phase += 0.05
}
```

## API 参考

### WS2812B 类

#### constructor()
创建 WS2812B 对象。

#### setup(config)
初始化 LED 灯带。
- `config.pin`: GPIO 引脚号
- `config.length`: LED 数量 (1-1024)

#### setPixel(index, r, g, b)
设置单个像素颜色。
- `index`: 像素索引 (0 到 length-1)
- `r`, `g`, `b`: 红、绿、蓝分量 (0-255)

#### clear()
清除所有像素（设置为黑色）。

#### flush()
刷新显示，将缓冲区数据发送到 LED 灯带。

## 依赖组件

- [beshell](https://github.com/become-cool/beshell) - BeShell 核心框架
- [beshell-drv-ws2812b](https://github.com/become-cool/beshell-drv-ws2812b) - WS2812B 驱动组件

## 许可证

LGPL

## 相关链接

- [BeShell 文档](https://beshell.become.cool)
- [ESP-IDF 文档](https://docs.espressif.com/projects/esp-idf/)
- [WS2812B 数据手册](https://cdn-shop.adafruit.com/datasheets/WS2812B.pdf)
