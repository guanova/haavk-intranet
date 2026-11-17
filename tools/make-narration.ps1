$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "video"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$lines = @(
  "还记得骇爪的网上冲浪吗？我们把游戏里的哈夫克内网，做成了一座能逛、能发帖、也能投稿的网站。",
  "首页按活动截图逐项还原。这里不是一张长图，而是可以注册、登录、回帖的完整社区。",
  "员工论坛、注意力点数、入职审核、管理员后台，也都做成了真正能用的功能。",
  "解决方案商城同样保留了装备轮播和商品陈列。",
  "现在最需要的是你的存档：活动截图、帖子原文、彩蛋触发方式，或者一句你还记得的台词。打开资料征集页，免注册就能上传截图。",
  "审核收录后会进入鸣谢墙，图片同步保存到网盘。演示账号 claire，密码 Haavk 井号二零二六。网站由 AI 辅助开发，是非官方粉丝项目。链接就在简介，欢迎来补完这段活动档案。"
)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo }
$zh = $voices | Where-Object { $_.Culture.Name -like "zh-*" } | Select-Object -First 1
if ($zh) { $synth.SelectVoice($zh.Name) }
$synth.Rate = 1
$synth.Volume = 100
for ($i = 0; $i -lt $lines.Count; $i++) {
  $path = Join-Path $out ("voice-" + $i + ".wav")
  $synth.SetOutputToWaveFile($path)
  $synth.Speak($lines[$i])
  Write-Output ("voice-" + $i + ".wav")
}
$synth.Dispose()
