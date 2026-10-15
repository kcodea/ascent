import { describe, it, expect } from 'vitest';
import { openSync, readSync, closeSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * ART SIZE GUARD (owner ask 2026-10-11, "just fix the 24").
 *
 * In-game art is shown at about 150 to 300 CSS px, so the pipeline ships it at 512 px (`art:wire` ART_PX and
 * `optimize-art` MAX). On 2026-08-19 a set of 24 minions and the Aster portrait were hand-copied in at the full
 * 1254 px master size. Every shop roll, play or hover that showed one of them decoded and GPU-uploaded six times
 * the pixels of a normal card, with 15 to 36 ms first-raster tasks that broke the 6.25 ms frame bar. This test
 * fails the moment an oversized file is committed again, so the fix is one `npm run optimize-art` away.
 *
 * Limits mirror `scripts/optimize-art.mjs`: 512 px everywhere, 768 px for hero portrait frames (they paint
 * larger, see MAX_BY_DIR there). `modes/` is exempt: those are the full-width title-screen mode banners, not
 * card art, and are drawn far larger than a card. `versus/` holds the Versus room's full-stage painted backdrop
 * (2026-10-14): one image, capped at 2560 px wide (a 1440p stage shows it at its full height).
 */
const ART = join(__dirname, 'art');
const MAX = 512;
const MAX_BY_DIR: Record<string, number> = { frames: 768, versus: 2560 };
const EXEMPT = new Set(['modes']);

/** Width and height from a WebP or PNG header (no image library needed). */
function dims(path: string): [number, number] | null {
  const fd = openSync(path, 'r');
  const b = Buffer.alloc(32);
  try { readSync(fd, b, 0, 32, 0); } finally { closeSync(fd); }
  if (b.toString('ascii', 1, 4) === 'PNG') return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (chunk === 'VP8L') { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
  if (chunk === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  return null;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(webp|png)$/i.test(f)) out.push(p);
  }
  return out;
}

describe('in-repo art never ships larger than the size it is shown at', () => {
  it('every art file is within its directory limit (512 px; frames 768 px; modes exempt)', () => {
    const over: string[] = [];
    let checked = 0;
    for (const top of readdirSync(ART)) {
      if (EXEMPT.has(top) || !statSync(join(ART, top)).isDirectory()) continue;
      const limit = MAX_BY_DIR[top] ?? MAX;
      for (const p of walk(join(ART, top))) {
        const d = dims(p);
        expect(d, `could not read image size of ${relative(ART, p)}`).not.toBeNull();
        checked++;
        if (d && Math.max(d[0], d[1]) > limit) over.push(`${relative(ART, p).replace(/\\/g, '/')} ${d[0]}x${d[1]} (limit ${limit})`);
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(over, over.length
      ? `${over.length} art file(s) exceed the shipped size. Re-encode with the optimize-art settings (512 px, webp q85):\n  ${over.join('\n  ')}`
      : '').toEqual([]);
  });

  it('reads real dimensions from the committed art headers', () => {
    // Pin the header parser against real files so a parsing slip cannot quietly pass every image.
    const sample = walk(join(ART, 'minions')).slice(0, 25).map(dims);
    expect(sample.every((d) => d !== null && d[0] > 0 && d[0] <= 4096 && d[1] > 0 && d[1] <= 4096)).toBe(true);
  });
});
