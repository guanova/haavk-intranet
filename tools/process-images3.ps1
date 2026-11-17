# process-images3.ps1 — 首页视觉对齐第二批：主视觉合成单元 / 员工之声 / 优秀员工 重裁
# 依据视觉规格（references 01–03 像素量测）：
#   主视觉单元 = 签名+人物+蓝块 合成裁切 x417-1132 y80-336（715×256），左/上/右 18px 羽化，底边不切（与深色带齐平）
#   员工之声 = 4 卡 x[674,782,890,998] 宽 104、y338-476（避开底部烘焙文字），底缘 14px 羽化
#   优秀员工 = 卡1 x260-390 / 卡2 x480-610、y338-485（避开左半文字与底部标语），不羽化（铺满卡高）
# 白平衡校正增益：R1.226 G1.159 B1.090（照片蓝灰偏色）
# 运行：powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/process-images3.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$ref  = Join-Path $root "references"
$out  = Join-Path $root "assets\img"
New-Item -ItemType Directory -Force -Path $out | Out-Null

$gR = 1.226; $gG = 1.159; $gB = 1.090

function Correct-WB([System.Drawing.Bitmap]$bmp) {
  $rect = New-Object System.Drawing.Rectangle(0, 0, $bmp.Width, $bmp.Height)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $data.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  for ($i = 0; $i -lt $bytes.Length; $i += 4) {
    $b = [int]$bytes[$i] * $gB; $g = [int]$bytes[$i+1] * $gG; $r = [int]$bytes[$i+2] * $gR
    $bytes[$i]   = [byte]([math]::Min(255, $b))
    $bytes[$i+1] = [byte]([math]::Min(255, $g))
    $bytes[$i+2] = [byte]([math]::Min(255, $r))
    $bytes[$i+3] = 255
  }
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
  $bmp.UnlockBits($data)
}

# 边缘羽化：$edges = "L","T","R","B" 哪些边；$feather = 像素宽
function Feather-Edges([System.Drawing.Bitmap]$bmp, [string]$edges, [int]$feather) {
  $w = $bmp.Width; $h = $bmp.Height
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $data.Stride
  $bytes = New-Object byte[] ($stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
      $a = 1.0
      if ($edges.Contains("L") -and $x -lt $feather) { $a = [math]::Min($a, $x / $feather) }
      if ($edges.Contains("R") -and $x -ge ($w - $feather)) { $a = [math]::Min($a, ($w - 1 - $x) / $feather) }
      if ($edges.Contains("T") -and $y -lt $feather) { $a = [math]::Min($a, $y / $feather) }
      if ($edges.Contains("B") -and $y -ge ($h - $feather)) { $a = [math]::Min($a, ($h - 1 - $y) / $feather) }
      if ($a -lt 1.0) { $bytes[$y * $stride + $x * 4 + 3] = [byte](255 * $a) }
    }
  }
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
  $bmp.UnlockBits($data)
}

function Crop-Scale([string]$srcPath, [int]$cx, [int]$cy, [int]$cw, [int]$ch, [double]$scale) {
  $src = New-Object System.Drawing.Bitmap($srcPath)
  $dw = [int]($cw * $scale); $dh = [int]($ch * $scale)
  $dst = New-Object System.Drawing.Bitmap($dw, $dh, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $dw, $dh)), (New-Object System.Drawing.Rectangle($cx, $cy, $cw, $ch)), [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose(); $src.Dispose()
  return $dst
}

# ---- 1. 主视觉合成单元 ×3 ----
$units = @(
  @{ ref = "01_关于我们_天空属于哈夫克.jpg"; out = "hero-unit-1.png" },
  @{ ref = "02_关于我们_无声之力成就至效.jpg"; out = "hero-unit-2.png" },
  @{ ref = "03_关于我们_进步始于认知.jpg";   out = "hero-unit-3.png" }
)
foreach ($u in $units) {
  $p = Join-Path $ref $u.ref
  if (-not (Test-Path $p)) { Write-Output "SKIP $($u.ref) 不存在"; continue }
  $bmp = Crop-Scale $p 417 80 715 256 2.0
  Correct-WB $bmp
  Feather-Edges $bmp "LTR" 36   # 放大2倍后羽化 36px = 显示 18px
  $bmp.Save((Join-Path $out $u.out), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "OK $($u.out) 1430x512"
}

# ---- 2. 员工之声 ×4 ----
$voiceX = @(674, 782, 890, 998)
$refHome = Join-Path $ref "01_关于我们_天空属于哈夫克.jpg"
for ($i = 0; $i -lt 4; $i++) {
  $bmp = Crop-Scale $refHome $voiceX[$i] 338 104 138 2.0
  Correct-WB $bmp
  Feather-Edges $bmp "B" 28    # 底缘羽化 28px = 显示 14px
  $name = "voice-$($i+1).png"
  $bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "OK $name 208x276"
}

# ---- 3. 优秀员工 ×2（右 2/3 人物区，避文字）----
$exc = @(
  @{ x = 260; w = 130; out = "excellent-1.png" },
  @{ x = 480; w = 130; out = "excellent-2.png" }
)
foreach ($e in $exc) {
  $bmp = Crop-Scale $refHome $e.x 338 $e.w 147 2.0
  Correct-WB $bmp
  Feather-Edges $bmp "B" 24
  $bmp.Save((Join-Path $out $e.out), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "OK $($e.out) 260x294"
}

Write-Output "DONE"
