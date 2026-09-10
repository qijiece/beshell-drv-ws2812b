cmake_minimum_required(VERSION 3.16)

# beshell-drv-ws2812b 延伸组件的 PC 平台构建工程（独立 CMake 工程，不经由 ESP-IDF）
# 支持 Windows(MinGW/MSVC)、Linux、macOS，以及 Emscripten(WASM)
#
# 与 beshell/pc 同构：include 公共片段把 beshell 核心源码并入本 target，
# 再追加本组件 PC 可移植子集（Strip/Rainbow/Section/WS2812B + led_strip_api + 软件帧缓冲）。
#
# 用法（MinGW 示例）：
#   cd pc
#   cmake -B build -G "MinGW Makefiles"
#   cmake --build build
#   ./build/beshell-ws2812b-pc.exe        # 运行 ./fs/main.js 并进入 REPL

project(beshell-ws2812b-pc C CXX)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

# 公共构建片段：定义 beshell_pc_setup(TARGET)，把 beshell 核心源码 + quickjs + 编译选项并入 target
include(${CMAKE_CURRENT_LIST_DIR}/../../beshell/pc/beshell-pc-common.cmake)

add_executable(beshell-ws2812b-pc
    main.cpp
)

beshell_pc_setup(beshell-ws2812b-pc)

# ---- ws2812b 组件自身源码（PC 可移植子集）----
set(_WS2812B_SRC_DIR "${CMAKE_CURRENT_LIST_DIR}/../src/beshell/driver/ws2812b")

file(GLOB _ws2812b_src
    "${_WS2812B_SRC_DIR}/*.cpp"
    "${_WS2812B_SRC_DIR}/*.c"
)
# 排除 ESP 专属 RMT/SPI 后端（软件帧缓冲后端 led_strip_pc_dev.c 保留）
list(FILTER _ws2812b_src EXCLUDE REGEX "/(led_strip_rmt_dev|led_strip_rmt_dev_idf4|led_strip_rmt_encoder|led_strip_spi_dev)\\.c$")

target_sources(beshell-ws2812b-pc PRIVATE ${_ws2812b_src})

target_include_directories(beshell-ws2812b-pc PRIVATE
    ${CMAKE_CURRENT_LIST_DIR}/../src
    ${_WS2812B_SRC_DIR}
)

# ---- MinGW 原生构建：静态链接 C/C++ 运行时，产物自包含 ----
# （用 MinGW-w64 GCC>=8 编译时其 libstdc++-6.dll 等运行时未必在 PATH 上，静态链接避免随行 DLL）
if(WIN32 AND NOT CMAKE_SYSTEM_NAME STREQUAL "Emscripten")
    target_link_options(beshell-ws2812b-pc PRIVATE -static)
endif()

# ---- Emscripten (WASM) ----
if(CMAKE_SYSTEM_NAME STREQUAL "Emscripten")
    # 体积优先
    target_compile_options(beshell-ws2812b-pc PRIVATE -Oz)
    target_link_options(beshell-ws2812b-pc PRIVATE
        -Oz
        # 导出 C 接口供 JS 调用（beshell_eval 见 main.cpp）
        "-sEXPORTED_FUNCTIONS=_main,_beshell_eval"
        "-sEXPORTED_RUNTIME_METHODS=ccall,cwrap"
        # 允许内存增长（QuickJS 堆按需扩张）
        "-sALLOW_MEMORY_GROWTH=1"
        # main.js 打包进 MEMFS 根目录
        "--preload-file" "${CMAKE_CURRENT_SOURCE_DIR}/fs/main.js@/main.js"
        # 同时支持浏览器与 node 运行
        "-sENVIRONMENT=web,node"
        # 模块化：导出 createBeShell 工厂函数
        "-sMODULARIZE=1"
        "-sEXPORT_NAME=createBeShell"
    )
    # 产物为 beshell-ws2812b-wasm.js + beshell-ws2812b-wasm.wasm
    set_target_properties(beshell-ws2812b-pc PROPERTIES OUTPUT_NAME beshell-ws2812b-wasm SUFFIX ".js")

    # 同步产物到 web/（网页编辑器本地引用，避免服务器根目录依赖）
    add_custom_command(TARGET beshell-ws2812b-pc POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${CMAKE_CURRENT_BINARY_DIR}/beshell-ws2812b-wasm.js"
            "${CMAKE_CURRENT_BINARY_DIR}/beshell-ws2812b-wasm.wasm"
            "${CMAKE_CURRENT_BINARY_DIR}/beshell-ws2812b-wasm.data"
            "${CMAKE_CURRENT_SOURCE_DIR}/web/"
        COMMENT "同步 WASM 产物到 web/"
    )
endif()
