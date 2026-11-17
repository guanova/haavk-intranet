# process-images4.ps1 — 首页全幅烘焙路线（v6 视觉验收修正版）
# 主视觉：整幅裁切 x0-1280 y0-336（1:1 显示，不放大），【不做白平衡校正——
#   v6 验收实测参考照片颜色即用户眼中的样子，提亮约 1.13× + 去蓝灰是扣分项】，
#   抹除 4 个导航文字区（垂直取上下各 4px 外像素线性插值填充），
#   保留烘焙的标题/副标题/签名/人物/蓝块/轮播点/区块标题/L1 右上装饰。
# 卡片：整卡烘焙（含名字/部门/标语/蓝色渐层），DOM 不再叠字。
# 运行：powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/process-images4.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$ref  = Join-Path $root "references"
$out  = Join-Path $root "assets\img"
New-Item -ItemType Directory -Force -Path $out | Out-Null

$gR = 1.0; $gG = 1.0; $gB = 1.0   # 不校正白平衡：参考照片颜色即基准

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$jpegParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$jpegParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]92)

function Load-WB([string]$path) {
  $src = New-Object System.Drawing.Bitmap($path)
  $bmp = New-Object System.Drawing.Bitmap($src.Width, $src.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.DrawImage($src, 0, 0)
  $g.Dispose(); $src.Dispose()
  $rect = New-Object System.Drawing.Rectangle(0, 0, $bmp.Width, $bmp.Height)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $data.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  for ($i = 0; $i -lt $bytes.Length; $i += 4) {
    $b = [int]$bytes[$i] * $gB; $g2 = [int]$bytes[$i+1] * $gG; $r = [int]$bytes[$i+2] * $gR
    $bytes[$i]   = [byte]([math]::Min(255, $b))
    $bytes[$i+1] = [byte]([math]::Min(255, $g2))
    $bytes[$i+2] = [byte]([math]::Min(255, $r))
    $bytes[$i+3] = 255
  }
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
  $bmp.UnlockBits($data)
  return $bmp
}

# 水平插值抹除矩形区：用区域左缘左方 4px 与右缘右方 4px 的同行像素线性混合
# （v7 验收：垂直插值在斜向发丝/蓝块边界产生接缝，水平取色保持同行局部亮度）
function Inpaint-H([System.Drawing.Bitmap]$bmp, [int]$x0, [int]$y0, [int]$x1, [int]$y1) {
  $w = $bmp.Width; $h = $bmp.Height
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $data.Stride
  $bytes = New-Object byte[] ($stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $xl = [math]::Max(0, $x0 - 4); $xr = [math]::Min($w - 1, $x1 + 4)
  for ($y = $y0; $y -lt $y1; $y++) {
    if ($y -lt 0 -or $y -ge $h) { continue }
    for ($x = $x0; $x -lt $x1; $x++) {
      $t = ($x - $x0 + 1) / ($x1 - $x0 + 1)
      $ia = ($y * $stride + $xl * 4); $ib = ($y * $stride + $xr * 4); $ic = ($y * $stride + $x * 4)
      for ($ch = 0; $ch -lt 3; $ch++) {
        $bytes[$ic + $ch] = [byte]([int]$bytes[$ia + $ch] * (1 - $t) + [int]$bytes[$ib + $ch] * $t)
      }
      $bytes[$ic + 3] = 255
    }
  }
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
  $bmp.UnlockBits($data)
}

function Crop([System.Drawing.Bitmap]$src, [int]$cx, [int]$cy, [int]$cw, [int]$ch) {
  $dst = New-Object System.Drawing.Bitmap($cw, $ch, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $cw, $ch)), (New-Object System.Drawing.Rectangle($cx, $cy, $cw, $ch)), [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  return $dst
}

# ---- 1. 主视觉全幅 ×3 ----
$units = @(
  @{ ref = "01_关于我们_天空属于哈夫克.jpg";    out = "hero-full-1.jpg" },
  @{ ref = "02_关于我们_无声之力成就至效.jpg";   out = "hero-full-2.jpg" },
  @{ ref = "03_关于我们_进步始于认知.jpg";       out = "hero-full-3.jpg" }
)
# 抹除区（照片坐标）：v8 起改为【不抹除】——导航区整行烘焙，DOM 透明仅作点击热区，
# 彻底消除接缝/重影/色差。如需恢复抹除，填回矩形并确认插值方向。
$zones = @()
foreach ($u in $units) {
  $p = Join-Path $ref $u.ref
  $bmp = Load-WB $p
  $hero = Crop $bmp 0 0 1280 336
  $bmp.Dispose()
  foreach ($z in $zones) { Inpaint-H $hero $z[0] $z[1] $z[2] $z[3] }
  $hero.Save((Join-Path $out $u.out), $jpegCodec, $jpegParams)
  $hero.Dispose()
  Write-Output "OK $($u.out) 1280x336"
}

# ---- 2. 员工之声整卡 ×4（v7 验收几何：卡 x[672,781,890,999] 宽 107、y336-516）----
$refHome = Join-Path $ref "01_关于我们_天空属于哈夫克.jpg"
$homeBmp = Load-WB $refHome
$voiceX = @(672, 781, 890, 999)
for ($i = 0; $i -lt 4; $i++) {
  $card = Crop $homeBmp $voiceX[$i] 336 107 182
  $name = "voice-full-$($i+1).jpg"
  $card.Save((Join-Path $out $name), $jpegCodec, $jpegParams)
  $card.Dispose()
  Write-Output "OK $name 107x182"
}

# ---- 3. 优秀员工整卡 ×2（v7 验收几何：卡 x178/399 宽 214、y336-516）----
$excX = @(178, 399)
for ($i = 0; $i -lt 2; $i++) {
  $card = Crop $homeBmp $excX[$i] 336 214 182
  $name = "excellent-full-$($i+1).jpg"
  $card.Save((Join-Path $out $name), $jpegCodec, $jpegParams)
  $card.Dispose()
  Write-Output "OK $name 214x182"
}
$homeBmp.Dispose()

Write-Output "DONE"
