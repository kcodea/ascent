import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CARD_FRAME_DIR, CARD_FRAME_WIDTH, cardFrameArt, cardFramesFit, cardFrameTwin, publicArtWanted } from './phoneArt';
import { splitPublicArt } from './preloadPlan';

/**
 * RIGHT-SIZED CARD FRAMES (R-PERF-FRAME-SIZE-01, perf/frame-size 2026-11-19). The card frames are 1059 x 1427 /
 * 1086 x 1448 masters (about 6 MB decoded each) drawn at most about 570 device px wide; a desktop whose screen a
 * 640 px copy covers loads the derived copy in frames/w640/ instead. The masters are never touched.
 */
const FRAMES = fileURLToPath(new URL('../../../apps/web/public/frames/', import.meta.url));

describe('right-sized card frames', () => {
  it('every card frame master has a derived 640 px twin on disk, and nothing else does', () => {
    const masters = readdirSync(FRAMES).filter((f) => cardFrameTwin(`frames/${f}`));
    expect(masters.length).toBeGreaterThanOrEqual(42);
    for (const f of masters) expect(existsSync(FRAMES + cardFrameTwin(`frames/${f}`)!.slice('frames/'.length)), f).toBe(true);
    const twins = readdirSync(FRAMES + `w${CARD_FRAME_WIDTH}`);
    expect(twins.length).toBe(masters.length);
  });

  it('maps a master to its twin (png masters become webp) and leaves every other frame alone', () => {
    expect(cardFrameTwin('frames/oval-beast.webp')).toBe(`${CARD_FRAME_DIR}oval-beast.webp`);
    expect(cardFrameTwin('frames/taunt-undead-gilded.webp')).toBe(`${CARD_FRAME_DIR}taunt-undead-gilded.webp`);
    expect(cardFrameTwin('frames/taunt-shield.png')).toBe(`${CARD_FRAME_DIR}taunt-shield.webp`);
    expect(cardFrameTwin('frames/standard-oval-v2.png')).toBe(`${CARD_FRAME_DIR}standard-oval-v2.webp`);
    for (const other of ['frames/spell-frame-arch.webp', 'frames/compendium-frame.webp', 'frames/title-logo.png', 'frames/cardplate-wire.webp', 'frames/standard-oval.png']) {
      expect(cardFrameTwin(other), other).toBeNull();
    }
  });

  it('the 640 px copy is used only where it covers the largest card the screen can draw', () => {
    expect(cardFramesFit(1080, 1)).toBe(true);
    expect(cardFramesFit(1080, 2)).toBe(true); // 1080p at 2x = a 4K panel: the Inspect card is about 570 px
    expect(cardFramesFit(1440, 1.5)).toBe(true);
    expect(cardFramesFit(1440, 2)).toBe(false); // 5K: keeps the masters
    expect(cardFramesFit(2160, 1)).toBe(true);
    expect(cardFramesFit(2880, 1)).toBe(false);
  });

  it('cardFrameArt picks the twin only when derived frames are on', () => {
    expect(cardFrameArt('frames/oval-mech.webp', true, '/')).toBe('/frames/w640/oval-mech.webp');
    expect(cardFrameArt('frames/oval-mech.webp', false, '/')).toBe('/frames/oval-mech.webp');
    expect(cardFrameArt('frames/spell-frame-arch.webp', true, '/')).toBe('/frames/spell-frame-arch.webp');
  });

  it('the preload plan loads exactly one of a master and its twin', () => {
    const list = ['frames/oval-beast.webp', 'frames/w640/oval-beast.webp', 'frames/spell-frame-arch.webp'];
    const all = new Set(list);
    expect(list.filter((f) => publicArtWanted(f, all, true))).toEqual(['frames/w640/oval-beast.webp', 'frames/spell-frame-arch.webp']);
    expect(list.filter((f) => publicArtWanted(f, all, false))).toEqual(['frames/oval-beast.webp', 'frames/spell-frame-arch.webp']);
    const on = splitPublicArt(list, undefined, true); const off = splitPublicArt(list, undefined, false);
    const flat = (s: ReturnType<typeof splitPublicArt>) => [...s.chrome, ...s.rest].join(' ');
    expect(flat(on)).toContain('frames/w640/oval-beast.webp');
    expect(flat(on)).not.toMatch(/frames\/oval-beast\.webp/);
    expect(flat(off)).not.toContain('w640');
  });
});
