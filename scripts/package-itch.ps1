# Package the production web build (apps/web/dist) into an itch.io-uploadable zip.
#
# itch.io serves an HTML5 game from a CDN sub-path and unzips on a Linux box, so the zip must:
#   - have index.html at its ROOT (not nested in a folder), and
#   - use forward-slash entry names (Windows PowerShell's Compress-Archive writes backslashes,
#     which Linux treats as literal filenames and breaks the asset paths) — hence the manual zip.
#
# The build itself uses a relative base (`base: './'`, see apps/web/vite.config.ts) so every asset
# resolves from the sub-path. Run `npm run package:itch` (build + this script) to (re)generate it.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'apps/web/dist'
$zipPath = Join-Path $root 'ascent-itch.zip'

if (-not (Test-Path $dist)) {
  Write-Error "dist not found at $dist - run 'npm run build:web' first."
  exit 1
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$distFull = (Resolve-Path $dist).Path
$fs = [System.IO.File]::Create($zipPath)
$archive = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -Recurse -File $distFull | ForEach-Object {
    $rel = $_.FullName.Substring($distFull.Length + 1).Replace('\', '/')
    $entry = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
    $stream = $entry.Open()
    $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
  }
} finally {
  $archive.Dispose(); $fs.Dispose()
}

$kb = (Get-Item $zipPath).Length / 1KB
Write-Host ("Created {0} ({1:N0} KB) - upload this to itch.io (HTML, 'play in browser')." -f $zipPath, $kb)
