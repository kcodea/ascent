import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * EVERY GAME <img> IS `decoding="sync"` (owner report 2026-09-03: the card plate and taunt frame POPPED IN on the
 * first frame of the board — and again on the first hand card — in a build that had fetched AND decoded every
 * image at boot).
 *
 * Why the boot preload cannot fix this on its own: Chromium's COMPOSITOR keeps its own decode cache with a
 * fixed budget, far smaller than 1,180 decoded images, and for any image whose decoded size is over ~512 KB
 * (80 of the 100 public webps — a card plate is 800×1244, 3.9 MB decoded) it rasterises the tile WITHOUT the
 * image the first time it is seen and fills it in a frame or two later. `decoding="sync"` is the one lever the
 * platform gives for that: it tells the compositor never to defer this image. `Card.tsx` already carried it on
 * the art (with a comment describing this exact pop); the plate and frame images beside it did not.
 *
 * Exceptions are listed with a reason — the AvatarPicker grid is deliberately lazy (hundreds of thumbnails),
 * and the dev UI editor is not player-facing.
 */
const UI = __dirname;
const SKIP = new Set(['AvatarPicker.tsx', 'EditorOverlay.tsx']);

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsxFiles(p));
    else if (e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx')) out.push(p);
  }
  return out;
}

describe('every player-facing <img> decodes synchronously', () => {
  const files = tsxFiles(UI);

  it('the sweep sees the component tree (guards against a vacuous pass)', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('no <img> tag lacks decoding="sync"', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const name = f.split(/[\\/]/).pop()!;
      if (SKIP.has(name)) continue;
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/<img\b[^>]*?>/gs)) {
        if (!/decoding="sync"/.test(m[0])) {
          const line = src.slice(0, m.index).split('\n').length;
          offenders.push(`${name}:${line}`);
        }
      }
    }
    expect(offenders, `add decoding="sync" (or list the file in SKIP with a reason): ${offenders.join(', ')}`).toEqual([]);
  });
});
