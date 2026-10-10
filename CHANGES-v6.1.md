# beshell-drv-ws2812b 适配 ESP-IDF v6.1 / esp32s31 变更说明

## 概述

本文档记录 beshell-drv-ws2812b 从 ESP-IDF v5.x 适配到 **ESP-IDF v6.1** / **esp32s31** 芯片所需的改动。

## 改动清单

| 文件 | 改动 | 原因 |
|------|------|------|
| `CMakeLists.txt` | PRIV_REQUIRES 增加 `esp_driver_rmt` | v6 中 RMT 独立成组件 |
| `src/beshell-drv-ws2812b/led_strip_rmt_dev_idf4.c` | `#include "driver/rmt.h"` 移入 `#if ESP_IDF_VERSION < 5.0` 守卫内 | v6 移除 legacy RMT 头，仅 idf4 分支需要 |
| `src/beshell-drv-ws2812b/led_strip_spi_dev.c` | 增加 `#include "esp_heap_caps.h"` | `MALLOC_CAP_*` 宏需显式包含 |

## 兼容性说明

以上改动为依赖声明、版本守卫与新增 include，在 ESP-IDF v5.x 下仍可正常编译。
