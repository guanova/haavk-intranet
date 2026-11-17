$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "video"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$lines = @(
  "三角洲行动的活动里，藏着一个哈夫克内网。满屏企业黑话，连标语都写着，进步，始于认知。",
  "我把这些截图一张张拆下来，做成了一个真的能打开的网站。版式、字体、那句天空属于哈夫克，都对得上。",
  "进去先办入职手续，选部门和岗位。每天能领五百点注意力，发帖扣五十、回帖扣二十，花超了会被系统拦住。",
  "最有意思的是艾特高管。先过首席高级秘书办的职级和价值审核，通过才给你回执，还会自动算出高管该花几分钟回答你。",
  "德穆兰、哈德森这些高管不是摆设。他们会自己发帖、自己回你，口气跟游戏里一模一样。",
  "网站素材还差很多，所以我开了资料征集。活动截图、设定考据、文案都能投，用得上就挂进站里。",
  "站是我用 AI 一点点搭起来的，非官方，纯爱好。想逛就搜，哈夫克内网。"
)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo }
$zh = $voices | Where-Object { $_.Culture.Name -like "zh-*" } | Select-Object -First 1
if ($zh) { $synth.SelectVoice($zh.Name) }
$synth.Rate = 2
$synth.Volume = 100
for ($i = 0; $i -lt $lines.Count; $i++) {
  $path = Join-Path $out ("pvoice-" + $i + ".wav")
  $synth.SetOutputToWaveFile($path)
  $synth.Speak($lines[$i])
  "pvoice-$i.wav"
}
$synth.Dispose()
