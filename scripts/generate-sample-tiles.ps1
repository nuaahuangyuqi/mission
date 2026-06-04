param(
  [double]$CenterLon = 120.18,
  [double]$CenterLat = 30.28,
  [int]$MinZoom = 0,
  [int]$MaxZoom = 8
)

Add-Type -AssemblyName System.Drawing

$root = Join-Path $PSScriptRoot '..\apps\web\public\tiles'
$root = [System.IO.Path]::GetFullPath($root)

function Get-TileXY([double]$lon, [double]$lat, [int]$zoom) {
  $x = [Math]::Floor((($lon + 180.0) / 360.0) * [Math]::Pow(2, $zoom))
  $latRad = $lat * [Math]::PI / 180.0
  $y = [Math]::Floor(((1.0 - ([Math]::Log([Math]::Tan($latRad) + (1.0 / [Math]::Cos($latRad))) / [Math]::PI)) / 2.0) * [Math]::Pow(2, $zoom))
  return @{ x = [int]$x; y = [int]$y }
}

function Ensure-Dir([string]$path) {
  if (-not (Test-Path $path)) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
  }
}

function New-Brush([int]$r, [int]$g, [int]$b, [int]$a = 255) {
  return New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($a, $r, $g, $b))
}

function Draw-Tile([string]$file, [int]$z, [int]$x, [int]$y, [int]$centerX, [int]$centerY) {
  $bmp = New-Object System.Drawing.Bitmap 256, 256
  $graphics = [System.Drawing.Graphics]::FromImage($bmp)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

  $seaBrush = New-Brush 38 74 112
  $gridPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(60, 190, 220, 245), 1)
  $coastPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(180, 199, 242, 158), 2)
  $landBrush = New-Brush 111 143 82 220
  $landBrush2 = New-Brush 163 230 53 90
  $accentBrush = New-Brush 250 204 21 160
  $textBrush = New-Brush 242 248 242
  $subTextBrush = New-Brush 185 198 186
  $overlayBrush = New-Brush 9 17 13 170
  $fontTitle = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
  $fontMeta = New-Object System.Drawing.Font('Segoe UI', 10)

  $graphics.Clear([System.Drawing.Color]::FromArgb(255, 38, 74, 112))

  for ($i = 0; $i -le 256; $i += 32) {
    $graphics.DrawLine($gridPen, $i, 0, $i, 256)
    $graphics.DrawLine($gridPen, 0, $i, 256, $i)
  }

  $dx = $x - $centerX
  $dy = $y - $centerY
  $landX = 48 - ($dx * 36)
  $landY = 88 - ($dy * 34)
  $graphics.FillEllipse($landBrush, $landX, $landY, 160, 108)
  $graphics.FillEllipse($landBrush2, $landX + 34, $landY + 18, 118, 70)
  $graphics.DrawEllipse($coastPen, $landX, $landY, 160, 108)
  $graphics.FillEllipse($accentBrush, $landX + 128, $landY + 82, 44, 28)

  $riverPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 125, 211, 252), 6)
  $riverPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $riverPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawBezier($riverPen, 18, 224, 88, 176, 146, 192, 236, 138)

  $graphics.FillRectangle($overlayBrush, 10, 10, 150, 54)
  $graphics.DrawString('OFFLINE DEMO', $fontTitle, $textBrush, 18, 16)
  $graphics.DrawString("z$z / $x / $y", $fontMeta, $subTextBrush, 20, 40)
  $graphics.DrawString('Generated sample tile', $fontMeta, $subTextBrush, 12, 232)

  Ensure-Dir([System.IO.Path]::GetDirectoryName($file))
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)

  $fontMeta.Dispose()
  $fontTitle.Dispose()
  $overlayBrush.Dispose()
  $subTextBrush.Dispose()
  $textBrush.Dispose()
  $accentBrush.Dispose()
  $landBrush2.Dispose()
  $landBrush.Dispose()
  $coastPen.Dispose()
  $gridPen.Dispose()
  $seaBrush.Dispose()
  $riverPen.Dispose()
  $graphics.Dispose()
  $bmp.Dispose()
}

$downloaded = 0

for ($z = $MinZoom; $z -le $MaxZoom; $z++) {
  $center = Get-TileXY -lon $CenterLon -lat $CenterLat -zoom $z
  $radius = if ($z -le 1) { 0 } else { 1 }
  $maxIndex = [Math]::Pow(2, $z) - 1

  for ($x = [Math]::Max(0, $center.x - $radius); $x -le [Math]::Min($maxIndex, $center.x + $radius); $x++) {
    for ($y = [Math]::Max(0, $center.y - $radius); $y -le [Math]::Min($maxIndex, $center.y + $radius); $y++) {
      $target = Join-Path $root "$z\$x\$y.png"
      Draw-Tile -file $target -z $z -x $x -y $y -centerX $center.x -centerY $center.y
      $downloaded++
    }
  }
}

Write-Host "sample offline tiles ready: $downloaded generated"
