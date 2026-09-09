#include <stdio.h>
#include <beshell/BeShell.hpp>
#include <beshell/driver/ws2812b/WS2812B.hpp>

using namespace std ;
using namespace be ;
using namespace be::driver::ws2812b ;


#ifdef __cplusplus
extern "C" {
#endif

void app_main(void)
{
    BeShell beshell;

    // 启用 BeShell 模块
    beshell.use<FS>() ;
    beshell.use<Serial>() ;
    beshell.use<NVS>() ;
    
    // 启用 ws2812b 驱动模块（级联注册 Strip / Section / Rainbow）
    beshell.use<WS2812B>() ;

    // 挂载 js 分区到文件的根目录
    FS::mount("/", new LittleFS("js", true)) ;

    // 启动 BeShell
    beshell.main("/main.js");
}

#ifdef __cplusplus
}
#endif
