/**
 * THE BOTTOM-LEFT ROW (R-CORNER-SPLIT-01, owner 2026-10-31: "put the friends list back in the bottom left, have the bottom
 * right only show the compendium and settings. move the dev tool buttons to the bottom left, right of the friends
 * list"). `blAnchor` picks the row's place per screen from what is on it; these pin each screen's rule.
 */
import { describe, expect, it } from 'vitest';
import { BL_EDGE, BL_GAP, BL_PAGE_SHARE, blAnchor } from './bottomLeft';

const stage = { left: 0, top: 0, width: 1920, height: 1080 };
const id = (v: number): number => v;
const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });
const gear = box(1865, 1025, 39, 39);

describe('blAnchor: where the bottom-left row sits', () => {
  it('a side-menu page or the in-game menu: inside the sidebar, just above its Settings plaque, left edges aligned', () => {
    const a = blAnchor({ settings: box(16, 1006, 206, 52), titleFoot: box(36, 1040, 440, 22), hero: box(38, 712, 266, 266), gear }, stage, id)!;
    expect(a.screen).toBe('page'); // the sidebar wins over whatever lies under it
    expect(a.l).toBe(16);
    expect(a.b).toBe(1080 - 1006 + BL_GAP);
    expect(a.cb).toBeCloseTo(52 * BL_PAGE_SHARE, 6);
  });
  it('the title: just above the footer links, left edges aligned, at the corner square size', () => {
    const a = blAnchor({ settings: null, titleFoot: box(36, 1040, 440, 22), hero: null, gear }, stage, id)!;
    expect(a).toEqual({ screen: 'title', l: 36, b: 1080 - 1040 + BL_GAP, cb: 39 });
  });
  it('a game: the corner left of the hero portrait and its Health plaque, on the gear\'s baseline, at the gear\'s size', () => {
    const a = blAnchor({ settings: null, titleFoot: null, hero: box(200, 694, 266, 266), hp: box(225, 933, 216, 70), gear }, stage, id)!;
    expect(a.screen).toBe('game');
    expect(a.l).toBe(200 - BL_GAP - 39);
    expect(a.b).toBe(1080 - (1025 + 39));
    // A hero hard against the edge: never closer than BL_EDGE to it.
    expect(blAnchor({ settings: null, titleFoot: null, hero: box(38, 712, 266, 266), hp: box(55, 971, 230, 71), gear }, stage, id)!.l).toBe(BL_EDGE);
  });
  it('nothing measurable (hero select, a Versus room): null, the CSS corner fallback; boxes convert to stage px', () => {
    expect(blAnchor({ settings: null, titleFoot: null, hero: null, gear }, stage, id)).toBeNull();
    expect(blAnchor({ settings: box(0, 0, 0, 0), titleFoot: null, hero: null, gear }, stage, id)).toBeNull(); // a hidden sidebar
    const half = blAnchor({ settings: null, titleFoot: box(18, 520, 220, 11), hero: null, gear: box(930, 512, 20, 20) }, { left: 0, top: 0, width: 960, height: 540 }, (v) => v * 2)!;
    expect(half).toEqual({ screen: 'title', l: 36, b: 40 + BL_GAP, cb: 40 });
  });
});
