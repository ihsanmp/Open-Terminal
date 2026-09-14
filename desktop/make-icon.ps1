# Generates the app icon: desktop\icon.ico (shortcut/window icon) and
# web\app\icon.png (favicon, picked up automatically by Next.js).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$Root = Split-Path -Parent $PSScriptRoot

function F([double]$v) { [float]$v }

function New-IconBitmap {
  $bmp = New-Object System.Drawing.Bitmap 256, 256, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)

  $amber = [System.Drawing.Color]::FromArgb(255, 255, 153, 0)
  $green = [System.Drawing.Color]::FromArgb(255, 0, 200, 83)

  # Rounded dark tile with an amber border.
  $x = F 10; $y = F 10; $w = F 236; $d = F 92
  $tile = New-Object System.Drawing.Drawing2D.GraphicsPath
  $tile.AddArc($x, $y, $d, $d, (F 180), (F 90))
  $tile.AddArc((F ($x + $w - $d)), $y, $d, $d, (F 270), (F 90))
  $tile.AddArc((F ($x + $w - $d)), (F ($y + $w - $d)), $d, $d, (F 0), (F 90))
  $tile.AddArc($x, (F ($y + $w - $d)), $d, $d, (F 90), (F 90))
  $tile.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 12, 12, 12))), $tile)
  $g.DrawPath((New-Object System.Drawing.Pen $amber, (F 10)), $tile)

  # Terminal prompt ">_".
  $prompt = New-Object System.Drawing.Pen $amber, (F 18)
  $prompt.StartCap = 'Round'; $prompt.EndCap = 'Round'; $prompt.LineJoin = 'Round'
  $g.DrawLines($prompt, [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF 58, 58),
    (New-Object System.Drawing.PointF 100, 94),
    (New-Object System.Drawing.PointF 58, 130)))
  $g.DrawLine($prompt, (F 116), (F 130), (F 166), (F 130))

  # Rising price line.
  $chart = New-Object System.Drawing.Pen $green, (F 16)
  $chart.StartCap = 'Round'; $chart.EndCap = 'Round'; $chart.LineJoin = 'Round'
  $g.DrawLines($chart, [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF 58, 204),
    (New-Object System.Drawing.PointF 102, 176),
    (New-Object System.Drawing.PointF 138, 194),
    (New-Object System.Drawing.PointF 198, 144)))

  $g.Dispose()
  return $bmp
}

function Get-PngBytes([System.Drawing.Bitmap]$src, [int]$size) {
  $b = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.SmoothingMode = 'AntiAlias'
  $g.DrawImage($src, 0, 0, $size, $size)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $b.Dispose()
  return ,$ms.ToArray()
}

# ICO container holding PNG-compressed images (supported since Windows Vista).
function Save-Ico([System.Drawing.Bitmap]$src, [int[]]$sizes, [string]$path) {
  $images = New-Object 'System.Collections.Generic.List[byte[]]'
  foreach ($s in $sizes) { $images.Add((Get-PngBytes $src $s)) }

  $fs = [System.IO.File]::Create($path)
  $w = New-Object System.IO.BinaryWriter $fs
  $w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
  $offset = 6 + 16 * $sizes.Count
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([UInt16]1); $w.Write([UInt16]32)
    $w.Write([UInt32]$images[$i].Length); $w.Write([UInt32]$offset)
    $offset += $images[$i].Length
  }
  foreach ($img in $images) { $w.Write($img) }
  $w.Close()
}

$bmp = New-IconBitmap
Save-Ico $bmp @(256, 64, 48, 32, 24, 16) (Join-Path $PSScriptRoot 'icon.ico')
[System.IO.File]::WriteAllBytes((Join-Path $Root 'web\app\icon.png'), (Get-PngBytes $bmp 256))
$bmp.Dispose()
Write-Host 'Icon generated.'
