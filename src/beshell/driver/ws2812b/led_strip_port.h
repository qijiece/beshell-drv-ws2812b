/*
 * led_strip 平台可移植层：屏蔽 esp_err_t 差异
 *
 * ESP 构建（ESP_PLATFORM）直接使用 IDF 的 esp_err.h；
 * PC 构建（BESHELL_PLATFORM_PC）无 IDF，这里给出最小 int 兜底，
 * 使 led_strip 接口层（led_strip_interface.h / led_strip.h / Strip）可两端编译。
 */
#pragma once

#ifdef ESP_PLATFORM

#include "esp_err.h"

#else

typedef int esp_err_t ;

#define ESP_OK                   0
#define ESP_FAIL                 -1
#define ESP_ERR_NO_MEM           0x101
#define ESP_ERR_INVALID_ARG      0x102
#define ESP_ERR_INVALID_STATE    0x103
#define ESP_ERR_INVALID_SIZE     0x104
#define ESP_ERR_NOT_FOUND        0x105
#define ESP_ERR_NOT_SUPPORTED    0x106
#define ESP_ERR_TIMEOUT          0x107

#endif
