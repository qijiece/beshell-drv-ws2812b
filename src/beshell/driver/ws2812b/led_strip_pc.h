/*
 * PC 端软件帧缓冲后端（仅 BESHELL_PLATFORM_PC 下实现）
 *
 * 复用 led_strip_t 函数指针接口：像素写入内存数组，refresh 为 no-op，
 * 供 PC/WASM 上运行 Strip/Rainbow/Section 动画逻辑、编辑器预览灯带帧。
 */
#pragma once

#include "led_strip_types.h"
#include "led_strip_port.h"

#ifdef __cplusplus
extern "C" {
#endif

// 创建帧缓冲设备（模拟 led_strip_new_rmt_device）
esp_err_t led_strip_new_pc_device(const led_strip_config_t *led_config, led_strip_handle_t *ret_strip);

// 读回像素缓冲（编辑器预览用）。返回 RGB 顺序字节数组，长度 = max_leds * 3。
// strip 非 PC 后端时返回 NULL。
const uint8_t * led_strip_pc_get_pixels(led_strip_handle_t strip);

#ifdef __cplusplus
}
#endif
