# process-images6.ps1 — 子页状态栏左侧状态簇（浅底深字版）
# 参考：论坛/解决方案/寻人页状态栏为浅灰底 #E3E7EA + 深灰字（v14 验收 a 项）。
# 从 references/04 裁 x74-475 y556-576（电池+wifi+52ms+UID 全文字），
# 深色键控：alpha = clamp((LUM_TH - lum) / LUM_GAIN)。
# 运行：powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/process-images6.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$ref  = Join-Path $root "references\04_员工论坛_公告列表.jpg"
$out  = Join-Path $root "assets\img"

function Crop2([System.Drawing.Bitmap]$src, [int]$cx, [int]$cy, [int]$cw, [int]$ch) {
  $dw = $cw; $dh = $ch
  $dst = New-Object System.Drawing.Bitmap($dw, $dh, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $dw, $dh)), (New-Object System.Drawing.Rectangle($cx, $cy, $cw, $ch)), [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  return $dst
}

function Keyout-Dark([System.Drawing.Bitmap]$bmp, [double]$thresh, [double]$gain) {
  $w = $bmp.Width; $h = $bmp.Height
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $data.Stride
  $bytes = New-Object byte[] ($stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  for ($i = 0; $i -lt $bytes.Length; $i += 4) {
    $lum = 0.299 * $bytes[$i+2] + 0.587 * $bytes[$i+1] + 0.114 * $bytes[$i]
    $a = ($thresh - $lum) / $gain
    if ($a -lt 0) { $a = 0 }
    if ($a -gt 1) { $a = 1 }
    $bytes[$i+3] = [byte](255 * $a)
  }
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
  $bmp.UnlockBits($data)
}

$src = New-Object System.Drawing.Bitmap($ref)
$bmp = Crop2 $src 74 556 401 20
# ref04 状态栏文字被照片洗淡（实测 lum 155-185 vs 底 225）；215/35 让模糊字芯也拿到高 alpha（205/50 实测合成后近乎不可见）
Keyout-Dark $bmp 215 35
# 照片洗淡属拍摄眩光非设计（同组首页状态栏清晰）：字形取自参考，颜色统一为
# 与 CSS 状态栏文字一致的深灰 #4A4F56，保证可读（v22 验收第 6 项 FAIL 的修复）
$rect2 = New-Object System.Drawing.Rectangle(0, 0, $bmp.Width, $bmp.Height)
$data2 = $bmp.LockBits($rect2, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride2 = $data2.Stride
$bytes2 = New-Object byte[] ($stride2 * $bmp.Height)
[System.Runtime.InteropServices.Marshal]::Copy($data2.Scan0, $bytes2, 0, $bytes2.Length)
for ($i = 0; $i -lt $bytes2.Length; $i += 4) {
  if ($bytes2[$i+3] -gt 0) { $bytes2[$i] = 0x56; $bytes2[$i+1] = 0x4F; $bytes2[$i+2] = 0x4A }
}
[System.Runtime.InteropServices.Marshal]::Copy($bytes2, 0, $data2.Scan0, $bytes2.Length)
$bmp.UnlockBits($data2)
$bmp.Save((Join-Path $out "statusbar-left-dark.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose(); $src.Dispose()
Write-Output "OK statusbar-left-dark.png 401x20"
