# probe-pixels.ps1 — 无头验收：对截图做像素采样，与参考图做结构/颜色对比
# 用法: pwsh tools/probe-pixels.ps1 <image> [mode]
#   mode=col   沿若干垂直线每 12px 采样（看纵向结构）
#   mode=grid  输出 16 灰阶ASCII 缩略图（看整体布局）
param([string]$img, [string]$mode = "col", [int]$step = 12)

Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::FromFile($img)
$W = $bmp.Width; $H = $bmp.Height
Write-Output ("{0}  {1}x{2}" -f (Split-Path $img -Leaf), $W, $H)

function Hex($c) { "#{0:X2}{1:X2}{2:X2}" -f $c.R, $c.G, $c.B }

if ($mode -eq "grid") {
  # 64 列 ASCII 缩略图：每格取平均亮度映射字符
  $cols = 64; $rows = [int]($H / $W * $cols * 0.5)
  $chars = " .:-=+*#%@"
  for ($ry = 0; $ry -lt $rows; $ry++) {
    $line = ""
    for ($cx = 0; $cx -lt $cols; $cx++) {
      $x = [int]($cx * $W / $cols + ($W / $cols / 2)) % $W
      $y = [int]($ry * $H / $rows + ($H / $rows / 2)) % $H
      $c = $bmp.GetPixel($x, $y)
      $lum = (0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B) / 255.0
      # 蓝色高亮用 B 标记（品牌蓝检测）
      if ($c.B -gt 150 -and $c.B -gt $c.R + 40) { $line += "B" }
      elseif ($c.R -gt 150 -and $c.R -gt $c.B + 40) { $line += "R" }
      else { $line += $chars[[int]($lum * 9)] }
    }
    Write-Output $line
  }
} else {
  foreach ($xf in @(0.12, 0.30, 0.50, 0.70, 0.88)) {
    $x = [int]($W * $xf)
    $samples = @()
    for ($y = 0; $y -lt $H; $y += $step) {
      $samples += Hex($bmp.GetPixel($x, $y))
    }
    Write-Output ("x={0,4} ({1,4}%): {2}" -f $x, [int]($xf * 100), ($samples -join " "))
  }
}
$bmp.Dispose()
