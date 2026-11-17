$ErrorActionPreference = 'SilentlyContinue'
Stop-Process -Name msedge -Force
Start-Sleep -Milliseconds 900

$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$out = 'I:\新建文件夹\新建文件夹\haavk-intranet\previews'

$shots = @(
  @{ n = 'v97_forum';      u = 'http://127.0.0.1:8137/#/forum'; d = 'ud-v97a'; b = 6000 },
  @{ n = 'v97_postdetail'; u = 'http://127.0.0.1:8137/dev-shot-login.html?u=claire&p=Haavk%232026&to=%2Fpost%2F1'; d = 'ud-v97b'; b = 9000 }
)

foreach ($s in $shots) {
  $ud = Join-Path $env:TEMP $s.d
  if (Test-Path $ud) { Remove-Item $ud -Recurse -Force }
  $png = Join-Path $out ($s.n + '.png')
  if (Test-Path $png) { Remove-Item $png -Force }
  & $edge --headless=new --disable-gpu --window-size=1280,860 --virtual-time-budget=$s.b --user-data-dir=$ud --screenshot=$png $s.u 2>$null | Out-Null
  Start-Sleep -Milliseconds 700
  if (Test-Path $png) {
    "{0} {1} B" -f (Split-Path $png -Leaf), (Get-Item $png).Length
  } else {
    "{0} MISSING" -f $s.n
  }
}
