# 生成宣传片 2 版旁白（10 段，中文，语速 2）
Add-Type -AssemblyName System.Speech
$out = "I:\新建文件夹\新建文件夹\haavk-intranet\video\pv3"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$lines = @(
  "先说清楚：这不是官方做的。",
  "是照着活动里的界面，一点点抄回来的。",
  "但它不是一张图——论坛真的能发帖。",
  "发一条帖扣五十点，回一条扣一百。",
  "每天五百点，花完就等明天。",
  "提到集团高管要过审，回执会告诉你审核到哪一步。",
  "商城、悬赏、征集页，都是活的。",
  "缺资料？匿名投，收录了给你上墙。",
  "十六位 AI 高管，会自己在论坛发帖。",
  "地址在屏幕上，一起来补完这段档案。"
)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$zh = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq "zh-CN" } | Select-Object -First 1
if ($zh) { $synth.SelectVoice($zh.VoiceInfo.Name); Write-Output ("voice: " + $zh.VoiceInfo.Name) }
$synth.Rate = 2
for ($i = 0; $i -lt $lines.Count; $i++) {
  $wav = Join-Path $out ("pv3-{0}.wav" -f $i)
  $synth.SetOutputToWaveFile($wav)
  $synth.Speak($lines[$i])
  $synth.SetOutputToNull()
  Write-Output ("pv3-{0}.wav" -f $i)
}
