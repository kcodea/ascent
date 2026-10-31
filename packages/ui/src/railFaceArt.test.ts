import { describe, expect, it, vi } from 'vitest';

/**
 * R-PHONE-RAIL-THUMB-01 (CI phone-budgets, 2026-10-31): the Docked rail and the eight-seat lobby reveal load the 256 px
 * rail thumbnail of a hero portrait on a phone, where it is at least the drawn size, so the run's eight faces stop
 * costing eight 384 px decodes (plus eight more at the reveal). `heroThumb` is stubbed as a phone build would answer.
 */
const warm = vi.fn();
vi.mock('./art', () => ({ heroThumb: (u: string | undefined) => (u ? `thumb:${u}` : u) }));
vi.mock('./fullResArt', () => ({ warmSharpArt: (urls: Iterable<string | undefined>) => warm([...urls]) }));
// Imported after the mocks are registered (vi.mock is hoisted).
const { railSliceFace, revealLineupFace } = await import('./railFaceArt');

describe('the Docked rail slice', () => {
  it('a slice wider than tall (the 8-seat lobby, ~198 x 59) loads the thumbnail and still warms the master for the fight', () => {
    warm.mockClear();
    expect(railSliceFace('hero.webp', { w: 198, h: 59 })).toBe('thumb:hero.webp');
    expect(warm).toHaveBeenCalledWith(['hero.webp']);
  });
  it('a slice taller than wide (a lobby with few seats draws the face bigger) keeps the copy', () => {
    expect(railSliceFace('hero.webp', { w: 198, h: 240 })).toBe('hero.webp');
  });
  it('no portrait stays no portrait', () => {
    expect(railSliceFace(undefined, { w: 198, h: 59 })).toBeUndefined();
  });
});

describe('the lobby reveal line-up', () => {
  const entries = (n: number): unknown[] => Array.from({ length: n }, () => ({}));
  it('seven or more players: the same thumbnail the rail shows (one decode per hero)', () => {
    expect(revealLineupFace('hero.webp', { entries: entries(8), layout: 'lobby' })).toBe('thumb:hero.webp');
    expect(revealLineupFace('hero.webp', { entries: entries(7) })).toBe('thumb:hero.webp');
  });
  it('six or fewer, and the duel, draw bigger faces: the copy', () => {
    expect(revealLineupFace('hero.webp', { entries: entries(6) })).toBe('hero.webp');
    expect(revealLineupFace('hero.webp', { entries: entries(8), layout: 'duel' })).toBe('hero.webp');
  });
});

describe('the wiring (source pins)', () => {
  it('the Docked slice and the reveal route their portraits through these helpers', async () => {
    const { readFileSync } = await import('node:fs');
    const panel = readFileSync(new URL('./LobbyPanel.tsx', import.meta.url), 'utf8');
    const reveal = readFileSync(new URL('./lobbyReveal/LobbyReveal.tsx', import.meta.url), 'utf8');
    expect(panel).toMatch(/<span className="lrv-tileart"[^\n]*\n\s*<FadeImg className="lobbyface" src=\{railSliceFace\(heroPortrait\(/);
    expect(reveal).toMatch(/art=\{revealLineupFace\(heroPortrait\(e\.heroId, skins\), play\)\}/);
    expect(reveal).toMatch(/return revealLineupFace\(heroPortrait\(e\.heroId, skinsOf\(e\)\), play\);/);
  });
});
