/*
 * PC 端软件帧缓冲实现（仅 BESHELL_PLATFORM_PC 下编译出内容）
 *
 * 结构与 led_strip_rmt_dev.c 同款：一个 led_strip_t 基类 + 像素缓冲。
 * set_pixel 把 (r,g,b) 按 RGB 顺序写入内存（区别于 RMT 后端为匹配 WS2812
 * 线上协议而存的 GRB）；refresh 为空操作；clear 清零；del 释放。
 */
#ifdef BESHELL_PLATFORM_PC

#include <stdlib.h>
#include <string.h>
#include "led_strip_pc.h"
#include "led_strip_interface.h"

typedef struct {
    led_strip_t base ;
    uint32_t strip_len ;
    uint8_t *pixel_buf ;       // RGB 每像素 3 字节
} led_strip_pc_obj ;

static esp_err_t led_strip_pc_set_pixel(led_strip_t *strip, uint32_t index, uint32_t red, uint32_t green, uint32_t blue)
{
    led_strip_pc_obj *pc = (led_strip_pc_obj *)strip ;
    if(index >= pc->strip_len) {
        return ESP_ERR_INVALID_ARG ;
    }
    uint8_t *p = pc->pixel_buf + index * 3 ;
    p[0] = (uint8_t)(red & 0xFF) ;
    p[1] = (uint8_t)(green & 0xFF) ;
    p[2] = (uint8_t)(blue & 0xFF) ;
    return ESP_OK ;
}

static esp_err_t led_strip_pc_set_pixel_rgbw(led_strip_t *strip, uint32_t index, uint32_t red, uint32_t green, uint32_t blue, uint32_t white)
{
    // RGB 帧缓冲无独立白通道，忽略 white
    (void)white ;
    return led_strip_pc_set_pixel(strip, index, red, green, blue) ;
}

static esp_err_t led_strip_pc_refresh(led_strip_t *strip)
{
    (void)strip ;
    return ESP_OK ;
}

static esp_err_t led_strip_pc_clear(led_strip_t *strip)
{
    led_strip_pc_obj *pc = (led_strip_pc_obj *)strip ;
    memset(pc->pixel_buf, 0, pc->strip_len * 3) ;
    return ESP_OK ;
}

static esp_err_t led_strip_pc_del(led_strip_t *strip)
{
    led_strip_pc_obj *pc = (led_strip_pc_obj *)strip ;
    free(pc->pixel_buf) ;
    free(pc) ;
    return ESP_OK ;
}

esp_err_t led_strip_new_pc_device(const led_strip_config_t *led_config, led_strip_handle_t *ret_strip)
{
    led_strip_pc_obj *pc = (led_strip_pc_obj *)calloc(1, sizeof(led_strip_pc_obj)) ;
    if(!pc) {
        return ESP_ERR_NO_MEM ;
    }
    pc->strip_len = led_config->max_leds ;
    pc->pixel_buf = (uint8_t *)calloc(led_config->max_leds, 3) ;
    if(!pc->pixel_buf) {
        free(pc) ;
        return ESP_ERR_NO_MEM ;
    }

    pc->base.set_pixel       = led_strip_pc_set_pixel ;
    pc->base.set_pixel_rgbw  = led_strip_pc_set_pixel_rgbw ;
    pc->base.refresh         = led_strip_pc_refresh ;
    pc->base.clear           = led_strip_pc_clear ;
    pc->base.del             = led_strip_pc_del ;

    *ret_strip = (led_strip_handle_t)pc ;
    return ESP_OK ;
}

const uint8_t * led_strip_pc_get_pixels(led_strip_handle_t strip)
{
    if(!strip) {
        return NULL ;
    }
    return ((led_strip_pc_obj *)strip)->pixel_buf ;
}

#endif // BESHELL_PLATFORM_PC
