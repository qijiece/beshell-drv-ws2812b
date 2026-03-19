import * as fs from "fs"

let examples = fs.listDirSync("/example")
  .sort((a,b)=>a.localeCompare(b))
  .reduce((lst,filename)=>{
      return lst + `    run /example/${filename}\n`
  },'')


console.log(`
  ============================================
   BeShell-WS2812B LED Example App
  ============================================

  This is a demo for WS2812B RGB LED control:
  
  * Basic Control   - Set pixel colors, clear, flush
  * Rainbow Effect  - Flowing rainbow animation
  * Breathing Light - Smooth brightness transition
  * Running Light   - Moving light effect
  * Color Gradient  - Smooth color transitions
  * Random Sparkle  - Random twinkling effect
  * Music Visual    - Simulated music visualization

  Available Examples:
  ${examples}
  
  Commands:
  * Enter \`ls /example\` to list all examples
  * Enter \`run <full example path>\` to run example
  * Enter \`reboot\` to restart
  * Enter \`help\` or \`?\` to list all commands
  * Enter JavaScript code to run in interactive mode
`)

console.log(`
  ============================================
   BeShell-WS2812B LED 示例程序
  ============================================

  本示例演示 WS2812B RGB LED 控制功能：
  
  * 基础控制    - 设置像素颜色、清除、刷新
  * 彩虹效果    - 流动的彩虹动画
  * 呼吸灯      - 平滑的亮度过渡
  * 跑马灯      - 移动的灯光效果
  * 颜色渐变    - 平滑的颜色过渡
  * 随机闪烁    - 随机闪烁效果
  * 音乐可视化  - 模拟音乐可视化

  可用示例：
  ${examples}
  
  命令：
  * 输入 \`ls /example\` 列出所有示例
  * 输入 \`run <完整路径>\` 运行示例
  * 输入 \`reboot\` 重启
  * 输入 \`help\` 或 \`?\` 列出所有命令
  * 输入 JavaScript 代码进入交互模式
`)
