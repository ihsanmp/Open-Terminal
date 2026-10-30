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

  # Parallax's "ridges": three ridge lines, the far ones fainter (the depth that parallax reads),
  # the nearest in ice blue, on a near-black tile with a silver border.
  $silver = [System.Drawing.Color]::FromArgb(255, 229, 231, 235)
  $ice = [System.Drawing.Color]::FromArgb(255, 56, 189, 248)

  # Rounded dark tile with a silver border.
  $x = F 10; $y = F 10; $w = F 236; $d = F 92
  $tile = New-Object System.Drawing.Drawing2D.GraphicsPath
  $tile.AddArc($x, $y, $d, $d, (F 180), (F 90))
  $tile.AddArc((F ($x + $w - $d)), $y, $d, $d, (F 270), (F 90))
  $tile.AddArc((F ($x + $w - $d)), (F ($y + $w - $d)), $d, $d, (F 0), (F 90))
  $tile.AddArc($x, (F ($y + $w - $d)), $d, $d, (F 90), (F 90))
  $tile.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 10, 10, 10))), $tile)
  $g.DrawPath((New-Object System.Drawing.Pen $silver, (F 10)), $tile)

  # The ridges, far to near (as web/components/Logo.tsx draws them).
  $ridges = @(
    @{ color = [System.Drawing.Color]::FromArgb(89, 229, 231, 235); width = 14; points = @(40, 166, 100, 96, 140, 136, 216, 60) },
    @{ color = [System.Drawing.Color]::FromArgb(166, 229, 231, 235); width = 14; points = @(40, 184, 96, 128, 136, 162, 216, 86) },
    @{ color = $ice; width = 16; points = @(40, 202, 92, 160, 132, 186, 216, 112) }
  )
  foreach ($r in $ridges) {
    $pen = New-Object System.Drawing.Pen $r.color, (F $r.width)
    $pen.StartCap = 'Round'; $pen.EndCap = 'Round'; $pen.LineJoin = 'Round'
    $p = $r.points
    $g.DrawLines($pen, [System.Drawing.PointF[]]@(
      (New-Object System.Drawing.PointF $p[0], $p[1]),
      (New-Object System.Drawing.PointF $p[2], $p[3]),
      (New-Object System.Drawing.PointF $p[4], $p[5]),
      (New-Object System.Drawing.PointF $p[6], $p[7])))
  }

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
