# process-images5.ps1 — 首页小件烘焙：红色翻页条 / 刻度行 / 页脚左侧状态簇
# 思路（v9 验收决策）：这些元素结构太精细（复合红条、不规则刻痕、双色电池），
# CSS 重建性价比低 → 直接从参考照片裁切 + 色度/亮度键控转透明背景。
# v11 验收：2x 烘焙再被 CSS 缩回 1x 导致笔画覆盖率减半（偏薄偏淡）→ 改 1x 直出。
# 输出：band-pager.png(42x85) band-ticks.png(222x17) statusbar-left.png(401x18)
# 运行：powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/process-images5.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$ref  = Join-Path $root "references\01_关于我们_天空属于哈夫克.jpg"
$out  = Join-Path $root "assets\img"

# 裁切（1x 直出，尺寸=CSS 显示尺寸，避免下采样削笔画）。注意：PS 逗号优先级高于 *，宽高必须先算好
function Crop2([System.Drawing.Bitmap]$src, [int]$cx, [int]$cy, [int]$cw, [int]$ch) {
  $dst = New-Object System.Drawing.Bitmap($cw, $ch, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $cw, $ch)), (New-Object System.Drawing.Rectangle($cx, $cy, $cw, $ch)), [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  return $dst
}

# 键控：mode "red" = 红色强度转 alpha；mode "lum" = 亮度超底噪转 alpha（thresh/gain 可调，v10 验收后放宽—— faint 刻痕与细笔画不能被削没）
function Keyout([System.Drawing.Bitmap]$bmp, [string]$mode, [double]$thresh, [double]$gain) {
  $w = $bmp.Width; $h = $bmp.Height
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  for ($i = 0; $i -lt $bytes.Length; $i += 4) {
    $b = [int]$bytes[$i]; $g = [int]$bytes[$i+1]; $r = [int]$bytes[$i+2]
    $a = 0.0
    if ($mode -eq "red") {
      $score = $r - ($g + $b) / 2.0
      $a = $score / 70.0
    } else {
      $lum = 0.299 * $r + 0.587 * $g + 0.114 * $b
      $a = ($lum - $thresh) / $gain
    }
    if ($a -lt 0) { $a = 0 }; if ($a -gt 1) { $a = 1 }
    $bytes[$i+3] = [byte](255 * $a)
  }
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
  $bmp.UnlockBits($data)
}

$src = New-Object System.Drawing.Bitmap($ref)

# 1. 红色翻页条：x70-112 y440-525（42×85）红色键控
$p = Crop2 $src 70 440 42 85
Keyout $p "red" 0 70
$p.Save((Join-Path $out "band-pager.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$p.Dispose()
Write-Output "OK band-pager.png 42x85"

# 2. 刻度行：x113-335 y521-538（222×17）亮度键控——v12：墨量仍 0.67，再放宽（thresh 30 / gain 22）
$t = Crop2 $src 113 521 222 17
Keyout $t "lum" 30 22
$t.Save((Join-Path $out "band-ticks.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$t.Dispose()
Write-Output "OK band-ticks.png 222x17"

# 3. 页脚左侧状态簇（电池+wifi+52ms+UID 全文字）：x74-475 y558-576（401×18）亮度键控——v10：提高增益避免笔画被削薄
$s = Crop2 $src 74 558 401 18
Keyout $s "lum" 33 30
$s.Save((Join-Path $out "statusbar-left.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$s.Dispose()
Write-Output "OK statusbar-left.png 401x18"

$src.Dispose()
Write-Output "DONE"
