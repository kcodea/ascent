import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import manifest from './manifest.json';
import { auraIsLive } from './kwfx';

/**
 * THE BAKED KEYWORD AURAS (R-PERF-KEYWORD-AURA-01). Players see a capture of the authored Rise / Flurry / Execute /
 * Rebirth auras (`/kwfx/*.avif`, made by `scripts/kwfx/capture.mjs`). These tests keep the capture honest:
 *  - it was made from the aura sources as they are NOW (the signature), so a retune cannot ship a stale picture;
 *  - every picture the stylesheet asks for exists, with the size the manifest recorded;
 *  - the cost stays where it was put: the baked rules carry no animation and no blend mode.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const pub = join(root, 'apps/web/public/kwfx');
const css = readFileSync(join(here, '../styles.css'), 'utf8');
const auras = (manifest as unknown as { auras: Record<string, { w: number; h: number; bytes: number; stillBytes: number; frames: number; maxSpeedChangePct: number }>; signature: string }).auras;
const IDS = ['rise', 'rise-blue', 'rise-red', 'flurry', 'execute', 'rebirth', 'rebirth-shield'];

describe('baked keyword auras', () => {
  it('the capture matches the authored aura sources (re-run scripts/kwfx/capture.mjs after a retune)', async () => {
    const sigPath = join(root, 'scripts/kwfx/signature.mjs');
    const { auraSignature } = (await import(/* @vite-ignore */ `file://${sigPath.replace(/\\/g, '/')}`)) as { auraSignature: () => string };
    expect((manifest as unknown as { signature: string }).signature, 'packages/ui/src/kwfx/manifest.json is stale: the aura sources changed since the capture').toBe(auraSignature());
  });

  it('has every picture on disk, as the manifest recorded it', () => {
    expect(Object.keys(auras).sort()).toEqual([...IDS].sort());
    for (const id of IDS) {
      const a = auras[id]!;
      expect(existsSync(join(pub, `${id}.avif`)), `${id}.avif`).toBe(true);
      expect(statSync(join(pub, `${id}.avif`)).size, `${id}.avif bytes`).toBe(a.bytes);
      expect(statSync(join(pub, `${id}-still.webp`)).size, `${id}-still.webp bytes`).toBe(a.stillBytes);
      expect(a.w).toBeGreaterThan(0.5); expect(a.h).toBeGreaterThan(0.5); expect(a.frames).toBeGreaterThan(30);
      // A loop closes by rounding each animation to whole cycles: no period moves by more than a few percent.
      expect(a.maxSpeedChangePct, `${id}: a period changed by ${a.maxSpeedChangePct}%`).toBeLessThanOrEqual(8);
    }
  });

  it('keeps the whole shipped set small (the animated pictures are fetched by every desktop player)', () => {
    const total = IDS.reduce((n, id) => n + auras[id]!.bytes + auras[id]!.stillBytes, 0);
    expect(total, `kwfx assets are ${(total / 1024).toFixed(0)} KB`).toBeLessThan(3 * 1024 * 1024);
  });

  it('the stylesheet names every picture and its still, by class', () => {
    for (const id of IDS) {
      expect(css.includes(`url('/kwfx/${id}.avif')`), `${id}.avif in styles.css`).toBe(true);
      expect(css.includes(`url('/kwfx/${id}-still.webp')`), `${id}-still.webp in styles.css`).toBe(true);
    }
  });

  it('a baked aura is one static layer: no animation, no blend mode, no filter or mask in its rules', () => {
    const rules = css.split('}').filter((r) => /\.kwfx\b/.test(r.split('{')[0] ?? ''));
    expect(rules.length).toBeGreaterThan(10);
    for (const r of rules) {
      const body = r.split('{').slice(1).join('{');
      expect(/animation|mix-blend-mode|filter|mask/.test(body), `a .kwfx rule animates or blends: ${r.trim().slice(0, 90)}`).toBe(false);
    }
  });

  it('renders the live aura until the pictures are in, on a device that opts out, and while retuning', () => {
    expect(auraIsLive(true, true, false)).toBe(false); // the baked picture
    expect(auraIsLive(true, false, false)).toBe(true); // not loaded (or no animated AVIF): never blank
    expect(auraIsLive(false, true, false)).toBe(true); // a phone, or the `ascent.kwfx = live` switch
    expect(auraIsLive(true, true, true)).toBe(true); // a tuner moved a value: the picture would be stale
  });
});
