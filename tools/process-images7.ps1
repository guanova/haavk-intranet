# process-images7.ps1 — 解决方案页素材烘焙（v17 规格，源自 b37+规格提取代理）
# 1) 轮播全带 3 张：refs 14/15/16 各裁 x347 y96 854x135（含头盔/产品、右侧文字、底部指示点，全烘焙不做 DOM 文字）
#    不校正白平衡（v6 教训：照片原色即用户眼中基准）
# 2) 侧栏 3 功能条目图标：ref14 深色键控（图标 #373C43 on 卡底 #EEF0F5），2x 输出
#    军工品质=坦克 (95,304,35,21) / 物美价廉=圆环M (98,389,30,30) / 精益求精=双箭头 (95,480,30,27)
# 运行：powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/process-images7.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$refs = Join-Path $root "references"
$out  = Join-Path $root "assets\img"

function LoadBmp($name) { return New-Object System.Drawing.Bitmap((Join-Path $refs $name)) }

function Crop([System.Drawing.Bitmap]$src, [int]$cx, [int]$cy, [int]$cw, [int]$ch, [int]$scale) {
  $dw = $cw * $scale; $dh = $ch * $scale
  $dst = New-Object System.Drawing.Bitmap($dw, $dh, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $dw, $dh)), (New-Object System.Drawing.Rectangle($cx, $cy, $cw, $ch)), [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  return $dst
}

function SaveJpg([System.Drawing.Bitmap]$bmp, $path, [long]$q) {
  $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
  $p = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, $q)
  $bmp.Save($path, $enc, $p)
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
    # 照片蓝色偏色中和：图标本体应为 #373C43 近中性深灰
    $excess = [int]$bytes[$i] - [int]($bytes[$i+2])
    if ($excess -gt 8) {
      $bytes[$i] = [byte]($bytes[$i] - ($excess - 8) / 2)
    }
  }
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
  $bmp.UnlockBits($data)
}

# ---- 1) 轮播全带 ----
$bands = @(
  @("14_解决方案_商城MHS.jpg",  "promo-full-1.jpg"),
  @("15_解决方案_商城图灵砖.jpg", "promo-full-2.jpg"),
  @("16_解决方案_商城HVK2.jpg", "promo-full-3.jpg")
)
foreach ($b in $bands) {
  $src = LoadBmp $b[0]
  $bmp = Crop $src 347 96 854 135 1
  SaveJpg $bmp (Join-Path $out $b[1]) 92
  $bmp.Dispose(); $src.Dispose()
  Write-Output ("OK " + $b[1] + " 854x135")
}

# 指示点 sanity：输出每张带 4 个点位（相对带内 x=188/210/231/252, y=111..123 中心 y=117）的核心色，确认激活点逐张右移
foreach ($b in $bands) {
  $img = New-Object System.Drawing.Bitmap((Join-Path $out $b[1]))
  $line = $b[1] + ":"
  foreach ($dx in @(188, 210, 231, 252)) {
    $p = $img.GetPixel($dx + 6, 117)
    $line += " (" + $p.R + "," + $p.G + "," + $p.B + ")"
  }
  Write-Output $line
  $img.Dispose()
}

# ---- 2) 侧栏条目图标（深色键控 2x）----
$ref14 = LoadBmp "14_解决方案_商城MHS.jpg"
$icons = @(
  @(95, 304, 35, 21, "icon-tank.png"),
  @(98, 389, 30, 30, "icon-circle.png"),
  @(95, 480, 30, 27, "icon-arrows.png")
)
foreach ($ic in $icons) {
  $bmp = Crop $ref14 $ic[0] $ic[1] $ic[2] $ic[3] 2
  Keyout-Dark $bmp 205 130
  $bmp.Save((Join-Path $out $ic[4]), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output ("OK " + $ic[4] + " " + ($ic[2] * 2) + "x" + ($ic[3] * 2))
}
$ref14.Dispose()
Write-Output "DONE"
