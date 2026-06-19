# Right-size illustrations for the build. Cards display at ~290px and hero portraits even smaller, so
# a 640px max is retina-crisp with headroom (and far smaller than the 1254px+ source art). The high-res
# *masters* live under `C:\Game Assets\Ascent Art\`; this only shrinks the in-repo build copies under
# `packages/ui/src/art/<sub>` (default `minions`; pass `-Sub heroes` for hero portraits, etc.). Re-run
# after dropping a new <id>.png in (idempotent — files already at/under the cap are skipped). For a
# bigger win later, convert these to WebP (needs sharp/cwebp).
param([int]$Max = 640, [string]$Sub = 'minions')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$dir = Join-Path (Split-Path -Parent $PSScriptRoot) "packages/ui/src/art/$Sub"
$before = 0; $after = 0; $changed = 0
foreach ($f in Get-ChildItem "$dir/*.png") {
  $before += $f.Length
  $img = [System.Drawing.Image]::FromFile($f.FullName)
  $w = $img.Width; $h = $img.Height
  if ([Math]::Max($w, $h) -le $Max) { $img.Dispose(); $after += $f.Length; continue }
  $scale = $Max / [Math]::Max($w, $h)
  $nw = [int]($w * $scale); $nh = [int]($h * $scale)
  $bmp = New-Object System.Drawing.Bitmap $nw, $nh
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.DrawImage($img, 0, 0, $nw, $nh)
  $g.Dispose(); $img.Dispose() # release the file lock before overwriting it
  $bmp.Save($f.FullName, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $after += (Get-Item $f.FullName).Length
  $changed++
  Write-Host ("  {0}: {1}x{2} -> {3}x{4}" -f $f.Name, $w, $h, $nw, $nh)
}
Write-Host ("Downscaled {0} file(s). {1} art: {2:N1} MB -> {3:N1} MB" -f $changed, $Sub, ($before/1MB), ($after/1MB))
