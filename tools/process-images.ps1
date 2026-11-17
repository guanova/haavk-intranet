# Process source images into site assets (run: powershell -ExecutionPolicy Bypass -File tools/process-images.ps1)
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "Stop"

$root  = "I:\新建文件夹\新建文件夹\haavk-intranet"
$src   = Join-Path $root "assets\src"
$refs  = Join-Path $root "references"
$out   = Join-Path $root "assets\img"
New-Item -ItemType Directory -Force -Path $out | Out-Null

# White-balance gains measured from the reference photos (white renders as #D0DCEA)
$GR = 1.226; $GG = 1.159; $GB = 1.090

function ClampB([double]$v) { if ($v -lt 0) { return 0 } elseif ($v -gt 255) { return 255 } else { return [int]$v } }

function SaveJpg($bmp, $path, [long]$q = 90) {
  $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
  $p = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, $q)
  $bmp.Save($path, $enc, $p)
}

function WbCorrect($bmp) {
  $w = $bmp.Width; $h = $bmp.Height
  $dst = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
      $px = $bmp.GetPixel($x, $y)
      $c = [System.Drawing.Color]::FromArgb((ClampB($px.R * $GR)), (ClampB($px.G * $GG)), (ClampB($px.B * $GB)))
      $dst.SetPixel($x, $y, $c)
    }
  }
  return $dst
}

function Crop($bmp, [int]$x, [int]$y, [int]$w, [int]$h) {
  $rect = New-Object System.Drawing.Rectangle($x, $y, $w, $h)
  return $bmp.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
}

# Resize preserving aspect by target height (or exact box with cover-crop when -Cover passed)
function ResizeH($bmp, [int]$th) {
  $scale = $th / $bmp.Height
  $tw = [Math]::Max(1, [int]($bmp.Width * $scale))
  $dst = New-Object System.Drawing.Bitmap($tw, $th, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($bmp, 0, 0, $tw, $th)
  $g.Dispose()
  return $dst
}

function ResizeW($bmp, [int]$tw) {
  $scale = $tw / $bmp.Width
  $th = [Math]::Max(1, [int]($bmp.Height * $scale))
  $dst = New-Object System.Drawing.Bitmap($tw, $th, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($bmp, 0, 0, $tw, $th)
  $g.Dispose()
  return $dst
}

# Square crop from the upper-center of a portrait (for faces)
function FaceSquare($bmp) {
  $side = [int]($bmp.Width * 0.7)
  if ($side -gt $bmp.Height) { $side = $bmp.Height }
  $x = [int](($bmp.Width - $side) / 2)
  $y = [int]($bmp.Height * 0.05)
  if (($y + $side) -gt $bmp.Height) { $y = $bmp.Height - $side }
  return (Crop $bmp $x $y $side $side)
}

function CenterSquare($bmp) {
  $side = [Math]::Min($bmp.Width, $bmp.Height)
  $x = [int](($bmp.Width - $side) / 2)
  $y = [int](($bmp.Height - $side) / 2)
  return (Crop $bmp $x $y $side $side)
}

function SquareThumb($bmp, [int]$size, [bool]$face) {
  if ($face) { $sq = FaceSquare $bmp } else { $sq = CenterSquare $bmp }
  $dst = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($sq, 0, 0, $size, $size)
  $g.Dispose()
  $sq.Dispose()
  return $dst
}

# Transparent-background square thumb (keeps alpha, contain fit)
function AlphaThumb($bmp, [int]$size) {
  $dst = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $scale = [Math]::Min($size / $bmp.Width, $size / $bmp.Height)
  $tw = [int]($bmp.Width * $scale); $th = [int]($bmp.Height * $scale)
  $x = [int](($size - $tw) / 2); $y = [int](($size - $th) / 2)
  $g.DrawImage($bmp, $x, $y, $tw, $th)
  $g.Dispose()
  return $dst
}

function Log($msg) { Write-Output $msg }

# ---------- 1. Hero backgrounds (vertical art, height 800) ----------
$heroJobs = @(
  @{ s = "hero-hudson.jpg"; o = "hero-01.jpg" },
  @{ s = "hero-luna.jpg";   o = "hero-02.jpg" },
  @{ s = "hero-die.jpg";    o = "hero-03.jpg" }
)
foreach ($j in $heroJobs) {
  $b = [System.Drawing.Bitmap]::FromFile((Join-Path $src $j.s))
  $r = ResizeH $b 800
  SaveJpg $r (Join-Path $out $j.o) 88
  Log ("hero -> " + $j.o + " " + $r.Width + "x" + $r.Height + " (src " + $b.Width + "x" + $b.Height + ")")
  $r.Dispose(); $b.Dispose()
}

# ---------- 2. Excellent employee cards (photo 01 crops, WB, x2) ----------
$p1 = [System.Drawing.Bitmap]::FromFile((Join-Path $refs "01_关于我们_天空属于哈夫克.jpg"))
$ex = @(
  @{ box = @(260, 338, 96, 178); o = "excellent-1.jpg" },
  @{ box = @(440, 338, 100, 178); o = "excellent-2.jpg" }
)
foreach ($j in $ex) {
  $c = Crop $p1 $j.box[0] $j.box[1] $j.box[2] $j.box[3]
  $wb = WbCorrect $c
  $r = ResizeW $wb ($j.box[2] * 2)
  SaveJpg $r (Join-Path $out $j.o) 90
  Log ("excellent -> " + $j.o + " " + $r.Width + "x" + $r.Height)
  $r.Dispose(); $wb.Dispose(); $c.Dispose()
}
$p1.Dispose()

# ---------- 3. Promo banners (photos 14/15/16, x344-896 y96-210, WB) ----------
$promoJobs = @(
  @{ s = "14_解决方案_商城MHS.jpg";   o = "promo-mhs.jpg" },
  @{ s = "15_解决方案_商城图灵砖.jpg"; o = "promo-turing.jpg" },
  @{ s = "16_解决方案_商城HVK2.jpg";  o = "promo-hvk2.jpg" }
)
foreach ($j in $promoJobs) {
  $b = [System.Drawing.Bitmap]::FromFile((Join-Path $refs $j.s))
  $c = Crop $b 344 96 552 114
  $wb = WbCorrect $c
  $r = ResizeW $wb 1104
  SaveJpg $r (Join-Path $out $j.o) 88
  Log ("promo -> " + $j.o + " " + $r.Width + "x" + $r.Height)
  $r.Dispose(); $wb.Dispose(); $c.Dispose(); $b.Dispose()
}

# ---------- 4. Voice card faces (upper square, 512) ----------
$voiceJobs = @(
  @{ s = "voice-lingxiao.png"; o = "voice-1.jpg" },
  @{ s = "voice-hackclaw.jpg"; o = "voice-2.jpg" },
  @{ s = "voice-redwolf.jpg";  o = "voice-3.jpg" },
  @{ s = "voice-shuimo.jpg";   o = "voice-4.jpg" }
)
foreach ($j in $voiceJobs) {
  $b = [System.Drawing.Bitmap]::FromFile((Join-Path $src $j.s))
  $t = SquareThumb $b 512 $true
  SaveJpg $t (Join-Path $out $j.o) 88
  Log ("voice -> " + $j.o + " 512x512 (src " + $b.Width + "x" + $b.Height + ")")
  $t.Dispose(); $b.Dispose()
}

# ---------- 5. Product thumbs 176 ----------
# turing brick: center square from the 747x617 art
$b = [System.Drawing.Bitmap]::FromFile((Join-Path $src "item-turing.jpg"))
$t = SquareThumb $b 176 $false
SaveJpg $t (Join-Path $out "item-turing.jpg") 90
Log ("item -> item-turing.jpg")
$t.Dispose(); $b.Dispose()

# MHS helmet: photo 14 close crop, WB, pad to square on dark bg
$b14 = [System.Drawing.Bitmap]::FromFile((Join-Path $refs "14_解决方案_商城MHS.jpg"))
$c = Crop $b14 430 88 230 130
$wb = WbCorrect $c
$sq = New-Object System.Drawing.Bitmap(230, 230, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [System.Drawing.Graphics]::FromImage($sq)
$bgSample = $wb.GetPixel(5, 5)
$g.Clear($bgSample)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($wb, 0, 50, 230, 130)
$g.Dispose()
$t = SquareThumb $sq 176 $false
SaveJpg $t (Join-Path $out "item-mhs.jpg") 90
Log ("item -> item-mhs.jpg (bg " + $bgSample.Name + ")")
$t.Dispose(); $sq.Dispose(); $wb.Dispose(); $c.Dispose(); $b14.Dispose()

# official equipment PNGs with alpha
$alphaJobs = @(
  @{ s = "item-d6helmet.png"; o = "item-h09.png" },
  @{ s = "item-hls2.png";     o = "item-hls2.png" },
  @{ s = "item-hmp.png";      o = "item-hmp.png" },
  @{ s = "item-warrior.png";  o = "item-warrior.png" },
  @{ s = "item-assault.png";  o = "item-assault.png" }
)
foreach ($j in $alphaJobs) {
  $b = [System.Drawing.Bitmap]::FromFile((Join-Path $src $j.s))
  $t = AlphaThumb $b 176
  $t.Save((Join-Path $out $j.o), [System.Drawing.Imaging.ImageFormat]::Png)
  Log ("item -> " + $j.o)
  $t.Dispose(); $b.Dispose()
}

# ---------- 6. Wanted card images (width 760) ----------
$wantedJobs = @(
  @{ s = "wanted-wuming.png"; o = "wanted-h42.jpg" },
  @{ s = "wanted-feihu.png";  o = "wanted-felar.jpg" }
)
foreach ($j in $wantedJobs) {
  $b = [System.Drawing.Bitmap]::FromFile((Join-Path $src $j.s))
  $r = ResizeW $b 760
  SaveJpg $r (Join-Path $out $j.o) 88
  Log ("wanted -> " + $j.o + " " + $r.Width + "x" + $r.Height)
  $r.Dispose(); $b.Dispose()
}

# ---------- 7. Officer avatars 256 ----------
$avJobs = @(
  @{ s = "officer-demulan.png"; o = "avatar-demulan.png"; face = $true },
  @{ s = "hero-hudson.jpg";     o = "avatar-hudson.png";  face = $true },
  @{ s = "officer-romius.png";  o = "avatar-romius.png";  face = $true }
)
foreach ($j in $avJobs) {
  $b = [System.Drawing.Bitmap]::FromFile((Join-Path $src $j.s))
  $t = SquareThumb $b 256 $j.face
  $t.Save((Join-Path $out $j.o), [System.Drawing.Imaging.ImageFormat]::Png)
  Log ("avatar -> " + $j.o)
  $t.Dispose(); $b.Dispose()
}
# secretary office: logo centered on white square
$b = [System.Drawing.Bitmap]::FromFile((Join-Path $src "haavk-logo.png"))
$sq = New-Object System.Drawing.Bitmap(256, 256, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [System.Drawing.Graphics]::FromImage($sq)
$g.Clear([System.Drawing.Color]::White)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$scale = [Math]::Min(200 / $b.Width, 200 / $b.Height)
$tw = [int]($b.Width * $scale); $th = [int]($b.Height * $scale)
$g.DrawImage($b, [int]((256 - $tw) / 2), [int]((256 - $th) / 2), $tw, $th)
$g.Dispose()
$sq.Save((Join-Path $out "avatar-secretary.png"), [System.Drawing.Imaging.ImageFormat]::Png)
Log ("avatar -> avatar-secretary.png")
$sq.Dispose(); $b.Dispose()

# keep a copy of the logo for the shell header
Copy-Item (Join-Path $src "haavk-logo.png") (Join-Path $out "haavk-logo.png") -Force
Log "logo -> haavk-logo.png"

Log "ALL DONE"
