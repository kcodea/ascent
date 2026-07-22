/**
 * Build `apps/desktop/icon.ico` (multi-resolution) from `apps/desktop/icon.png`.
 *
 * Why this exists: Windows embeds the icon a file listing shows into the .exe's PE resources, and that
 * requires an **.ico** — a PNG is not enough (the PNG only ever set the *window/taskbar* icon at runtime).
 *
 * Why it is hand-rolled: adding an image library to resize would be a dependency for one build step. Windows
 * already ships GDI+, so `System.Drawing` (via PowerShell) does the resizing, and the ICO container itself is
 * trivial to assemble here — since Vista, an ICO entry may hold a PNG payload verbatim, so there is no BMP/AND-
 * mask encoding to get wrong.
 *
 * Run via `npm run package:desktop` (or directly). Re-run only when the source logo changes; the .ico is
 * committed so a normal build needs neither PowerShell nor this script.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'apps', 'desktop', 'icon.png');
const out = path.join(root, 'apps', 'desktop', 'icon.ico');
// Every size Explorer/​the taskbar/​alt-tab actually pick from. 256 is what large-icon views use.
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const tmp = mkdtempSync(path.join(tmpdir(), 'ascent-ico-'));
try {
  // GDI+ resize, one PNG per size. HighQualityBicubic matters at 16px — the default nearest-ish scaler turns
  // a detailed 1254px logo into mush.
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile('${src.replace(/\\/g, '\\\\')}')
foreach ($s in @(${SIZES.join(',')})) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($src, 0, 0, $s, $s)
  $bmp.Save((Join-Path '${tmp.replace(/\\/g, '\\\\')}' ("$s.png")), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
$src.Dispose()
`;
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { stdio: 'pipe' });

  const images = SIZES.map((size) => ({ size, data: readFileSync(path.join(tmp, `${size}.png`)) }));

  // ICONDIR: reserved(2)=0, type(2)=1 (icon), count(2). Then one 16-byte ICONDIRENTRY each, then the payloads.
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256 — the field is a single byte
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette count (0 = truecolour)
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }

  writeFileSync(out, Buffer.concat([header, ...entries, ...images.map((i) => i.data)]));
  console.log(`✓ ${path.relative(root, out)}  (${SIZES.join('/')} px, ${(offset / 1024).toFixed(0)} KB)`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
