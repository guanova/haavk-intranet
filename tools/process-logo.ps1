Add-Type -AssemblyName System.Drawing
$ref = "I:\新建文件夹\新建文件夹\haavk-intranet\references\01_关于我们_天空属于哈夫克.jpg"
$src = New-Object System.Drawing.Bitmap($ref)
# 导航 logo 墨迹区 x72-170 y50-82（98×32），放大 2 倍输出
$cw = 98; $ch = 32; $scale = 2
$dw = $cw * $scale; $dh = $ch * $scale
$dst = New-Object System.Drawing.Bitmap($dw, $dh, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $dw, $dh)), (New-Object System.Drawing.Rectangle(72, 50, $cw, $ch)), [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose(); $src.Dispose()
# 亮度转 alpha：亮底透明、墨迹保留（logo 为深蓝/深色墨迹，lum<150 实，150-210 渐变）
$rect = New-Object System.Drawing.Rectangle(0, 0, $dw, $dh)
$data = $dst.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bytes = New-Object byte[] ($data.Stride * $dh)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
for ($i = 0; $i -lt $bytes.Length; $i += 4) {
  $lum = 0.299 * $bytes[$i+2] + 0.587 * $bytes[$i+1] + 0.114 * $bytes[$i]
  $a = (215.0 - $lum) / 50.0
  if ($a -lt 0) { $a = 0 }; if ($a -gt 1) { $a = 1 }
  $bytes[$i+3] = [byte](255 * $a)
}
[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
$dst.UnlockBits($data)
$dst.Save("I:\新建文件夹\新建文件夹\haavk-intranet\assets\img\haavk-nav-logo.png", [System.Drawing.Imaging.ImageFormat]::Png)
$dst.Dispose()
Write-Output "OK haavk-nav-logo.png 196x64"