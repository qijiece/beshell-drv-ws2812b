cmake_minimum_required(VERSION 3.24)


# 源码目录
file(GLOB_RECURSE src_beshell_component
        src/beshell/driver/ws2812b/*.c
        src/beshell/driver/ws2812b/*.cpp
    )

# js/ 下的 .c 是 JS 胶水层生成的内嵌字节数组，已被对应模块 .cpp #include，不参与独立编译
list(FILTER src_beshell_component EXCLUDE REGEX ".*/js/.*\\.c$")



idf_component_register(
        SRCS
            ${src_beshell_component}
        INCLUDE_DIRS 
            ./src
        PRIV_REQUIRES
            beshell
)

target_include_directories(${COMPONENT_LIB} PRIVATE src/beshell/driver/ws2812b)

set(CMAKE_CXX_STANDARD 11)

add_definitions(-DCONFIG_FREERTOS_USE_TRACE_FACILITY)
add_definitions(-DCONFIG_FREERTOS_USE_STATS_FORMATTING_FUNCTIONS)

# for c
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wno-implicit-function-declaration")
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wno-incompatible-pointer-types")
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wno-discarded-qualifiers")
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wno-int-conversion")
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wno-error=maybe-uninitialized")
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wno-pointer-arith")
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wno-cast-function-type")


# -mlongcalls
target_compile_options(${COMPONENT_LIB} PRIVATE -fno-stack-protector -ffunction-sections -fdata-sections -fstrict-volatile-bitfields -nostdlib -Wpointer-arith -Wno-error=unused-value -Wno-error=unused-label -Wno-error=unused-function -Wno-error=unused-but-set-variable -Wno-error=unused-variable -Wno-error=deprecated-declarations -Wno-error=char-subscripts -Wno-error=maybe-uninitialized -Wno-unused-parameter -Wno-sign-compare -Wno-error=misleading-indentation -Wno-error=stringop-truncation)
target_compile_options(${COMPONENT_LIB} PRIVATE -Wno-cast-function-type)

# for c++
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wno-missing-field-initializers")
# set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wno-permissive")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wno-conversion")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wno-unused-variable")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wno-unused-value")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wno-missing-brace")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wno-deprecated-enum-enum-conversion")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wno-error=comment")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wno-pointer-arith")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fpermissive")

if (COMMAND component_compile_options)
    # both c and c++
    component_compile_options(-Wno-missing-braces)
    component_compile_options(-Wno-error=format)
    component_compile_options(-Wno-format)
    component_compile_options(-Wno-unused-function)
    component_compile_options(-Wno-unused-variable)
    component_compile_options(-Wno-unused-but-set-variable)
    component_compile_options(-Wno-cast-function-type)
    component_compile_options(-Wno-implicit-fallthrough)
    component_compile_options(-Wno-cpp)
    component_compile_options(-Wno-type-limits)
    component_compile_options(-Wno-int-to-pointer-cast)
    component_compile_options(-Wno-error=switch)
    component_compile_options(-Wno-switch)
    component_compile_options(-Wno-missing-field-initializers)
    component_compile_options(-Wno-pointer-arith)
endif ()
