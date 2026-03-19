# BeShell-WS2812B Example App

This is an example project demonstrating the usage of BeShell-WS2812B (WS2812B RGB LED driver).

## Features

This example project demonstrates the following features:

### LED Effects

| Example File | Description |
|---------|------|
| `basic-control.js` | Basic control: set colors, clear, flush |
| `rainbow.js` | Flowing rainbow effect |
| `breathing.js` | Breathing light effect |
| `running-light.js` | Running light effect |
| `color-gradient.js` | Color gradient effect |
| `random-sparkle.js` | Random sparkle effect |
| `music-visual.js` | Music visualization effect (simulated) |
| `theater-chase.js` | Theater chase light effect |
| `comet.js` | Comet tail effect |

## Project Structure

```
beshell-ws2812b-app/
├── CMakeLists.txt          # Project CMake configuration
├── sdkconfig.defaults      # Default SDK configuration
├── README.md               # This file
├── main/
│   ├── main.cpp            # C++ entry file
│   ├── CMakeLists.txt      # main component CMake config
│   └── idf_component.yml   # Component dependencies
├── img/
│   ├── partitions-4MB.csv  # 4MB Flash partition table
│   ├── partitions-8MB.csv  # 8MB Flash partition table
│   └── partitions-16MB.csv # 16MB Flash partition table
└── js/
    ├── main.js             # JS entry file
    └── example/            # Example scripts directory
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

## Hardware Requirements

- ESP32 / ESP32-S3 / ESP32-C3 or other chips
- WS2812B RGB LED strip
- At least 4MB Flash
- USB-to-Serial for flashing and debugging

### Hardware Connection

```
ESP32 GPIO8  -->  WS2812B DIN
ESP32 GND    -->  WS2812B GND
ESP32 5V     -->  WS2812B VCC (or use external power supply)
```

**Note**: If you have many LEDs, it's recommended to use an external 5V power supply.

## Quick Start

### 1. Modify Configuration

Modify the configuration in examples according to your hardware:

```javascript
const LED_PIN = 8        // GPIO pin
const LED_COUNT = 16     // Number of LEDs
```

### 2. Build the Project

```bash
idf.py build
```

### 3. Flash the Firmware

```bash
idf.py flash
```

### 4. View Serial Output

```bash
idf.py monitor
```

### 5. Run Examples

In the serial terminal, enter the following command to run an example:

```
run /example/rainbow.js
```

## Example Details

### Basic Control

```javascript
import { WS2812B } from "ws2812b"

let strip = new WS2812B()
strip.setup({
    pin: 8,
    length: 16
})

// Set single pixel color
strip.setPixel(0, 255, 0, 0)  // Red

// Refresh display
strip.flush()

// Clear all
strip.clear()
strip.flush()
```

### Rainbow Effect

```javascript
// HSL to RGB function
function hueToRgb(hue) {
    // hue: 0-360
    // returns [r, g, b]
}

// Rainbow flow
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

### Breathing Light

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

## API Reference

### WS2812B Class

#### constructor()
Create a WS2812B object.

#### setup(config)
Initialize the LED strip.
- `config.pin`: GPIO pin number
- `config.length`: Number of LEDs (1-1024)

#### setPixel(index, r, g, b)
Set single pixel color.
- `index`: Pixel index (0 to length-1)
- `r`, `g`, `b`: Red, green, blue components (0-255)

#### clear()
Clear all pixels (set to black).

#### flush()
Refresh display, send buffer data to LED strip.

## Dependencies

- [beshell](https://github.com/become-cool/beshell) - BeShell core framework
- [beshell-drv-ws2812b](https://github.com/become-cool/beshell-drv-ws2812b) - WS2812B driver component

## License

LGPL

## Links

- [BeShell Documentation](https://beshell.become.cool)
- [ESP-IDF Documentation](https://docs.espressif.com/projects/esp-idf/)
- [WS2812B Datasheet](https://cdn-shop.adafruit.com/datasheets/WS2812B.pdf)
