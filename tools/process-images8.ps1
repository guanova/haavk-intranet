# process-images8.ps1 — 商品列表图标（从 ref14 商品行直接裁切，白底与行融为一体）
# ref14 行1 图灵砖 (slot x362-430 y250-354)、行2 H09防爆头盔 (x362-430 y362-466)
# 运行：powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/process-images8.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$ref  = New-Object System.Drawing.Bitmap((Join-Path $root "references\14_解决方案_商城MHS.jpg"))
$out  = Join-Path $root "assets\img"

function Crop([System.Drawing.Bitmap]$src, [int]$cx, [int]$cy, [int]$cw, [int]$ch) {
  $dst = New-Object System.Drawing.Bitmap($cw, $ch, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $cw, $ch)), (New-Object System.Drawing.Rectangle($cx, $cy, $cw, $ch)), [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  return $dst
}

$jobs = @(
  @(362, 250, 68, 104, "item-turing.png"),
  @(362, 362, 68, 104, "item-h09.png")
)
foreach ($j in $jobs) {
  $bmp = Crop $ref $j[0] $j[1] $j[2] $j[3]
  $bmp.Save((Join-Path $out $j[4]), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output ("OK " + $j[4] + " " + $j[2] + "x" + $j[3])
}
$ref.Dispose()
Write-Output "DONE"
