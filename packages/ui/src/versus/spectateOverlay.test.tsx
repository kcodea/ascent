// @vitest-environment jsdom
/**
 * THE STANDS FOLLOW THE PLAYER'S OVERLAYS, AND HOVER RUNES THEMSELVES (owner 2026-10-16, via the coordinator). Pinned:
 *  - R-SPECTATE-OVERLAY-01: the player's minimize state of the Discover, the hero-power Discover, the Quest pick and
 *    the Runeforge travels (`ov`: once on a change, on every keyframe, kept while nobody watches) and the spectator
 *    applies it after the offer's own reset; an older player sends none and the spectator shows the overlay open.
 *  - R-SPECTATE-RUNEHOVER-01: the spectator's own hand on a rune lifts the player's mirrored hover on their screen and
 *    gives it back when it leaves; only real pointer events count; a viewer's press on a forge rune buys nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const sp = await import('./spectate');
const tap = await import('./spectateTap');
const hover = await import('./spectatorHover');

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 0; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  sp.installSpectateIo({ latestFrames: vi.fn(async () => []), requestKey: vi.fn(), loadRounds: vi.fn(), lobbyFor: vi.fn(() => undefined) });
});
afterEach(() => {
  hover.watchLocalHover(false);
  hover.setSpectatorHover(null);
  tap.tapOverlay({ discover: false, power: false, quest: false, forge: false });
  tap.setSpectatorTap(false, null, null);
  sp.resetSpectate();
  sp.installSpectateIo(null);
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('R-SPECTATE-OVERLAY-01: minimize and restore follow the player', () => {
  it('the player side: kept with nobody watching, sent once on a change, and on every keyframe', () => {
    tap.tapOverlay({ discover: false, power: false, quest: false, forge: true }); // minimized before anyone watched
    const wake = vi.fn();
    tap.setSpectatorTap(true, 'p1', () => undefined, wake);
    expect(tap.takeOverlay(true)).toEqual({ f: 1 }); // a joiner's keyframe carries it
    expect(tap.takeOverlay(false)).toBeNull(); // nothing new on a delta
    tap.tapOverlay({ discover: false, power: false, quest: false, forge: false }); // "Return to the Runeforge"
    expect(wake).toHaveBeenCalledOnce();
    expect(tap.hasPendingActs()).toBe(true); // it asks for a publish even with nothing visible changed
    expect(tap.takeOverlay(false)).toEqual({});
    tap.tapOverlay({ discover: true, power: true, quest: true, forge: false });
    expect(tap.takeOverlay(false)).toEqual({ d: 1, p: 1, q: 1 });
    tap.tapOverlay({ discover: true, power: true, quest: true, forge: false }); // the same state again: no send
    expect(tap.takeOverlay(false)).toBeNull();
  });

  it('the spectator side: stored per seat, applied as the four minimize flags; an older player changes nothing', () => {
    sp.liveSync('g-1');
    const base = { kind: 'delta', seat: 'p1', round: 3, changed: {}, removed: [], m: 'g-1' } as const;
    sp.receiveSpectate({ ...base, seq: 1 }); // an older player: no `ov`
    expect(sp.useSpectate.getState().overlay?.p1).toBeUndefined(); // the overlay stays open, as before
    sp.receiveSpectate({ ...base, seq: 2, ov: { f: 1 } });
    expect(sp.useSpectate.getState().overlay?.p1).toEqual({ f: 1 });
    expect(sp.overlayMinOf(sp.useSpectate.getState().overlay!.p1!)).toEqual({ discover: false, power: false, quest: false, forge: true });
    sp.receiveSpectate({ ...base, seq: 3, ov: {} }); // restored
    expect(sp.overlayMinOf(sp.useSpectate.getState().overlay!.p1!).forge).toBe(false);
    expect(sp.parseWireOverlay({ f: true, d: 1, x: 1 })).toEqual({ d: 1 }); // junk dropped
    expect(sp.parseWireOverlay('min')).toBeNull();
    sp.liveSync(null);
  });

  it('Recruit wires both ends, and the stands apply the state AFTER each offer resets its own toggle', () => {
    const src = readFileSync(join(__dirname, '..', 'Recruit.tsx'), 'utf8');
    expect(src).toContain('tapOverlay({ discover: discoverMin, power: powerMin, quest: questMin, forge: forgeMin })');
    const reset = src.indexOf('useEffect(() => { setForgeMin(false); }, [run.runeforgeOffer]);');
    const mirror = src.indexOf('const min = overlayMinOf(watchedOverlay);');
    expect(reset).toBeGreaterThan(0);
    expect(mirror).toBeGreaterThan(reset);
    // the spectator never sends its own (inert) toggles: the tap is skipped on the watch screen
    expect(src).toMatch(/if \(spectatorOn\) return;\s*\n\s*tapOverlay\(/);
  });
});

describe('R-SPECTATE-RUNEHOVER-01: the spectator hovers runes themselves', () => {
  const runeBadge = (spec: string): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'questbadge runebadge';
    el.setAttribute('data-spec', spec);
    document.body.appendChild(el);
    return el;
  };

  it('their own hand on a rune lifts the mirrored hover; leaving gives the player hover back', () => {
    const playerHovered = runeBadge('rune:0:rune_warding');
    const mine = runeBadge('rune:1:rune_slaying');
    const outs: string[] = [];
    playerHovered.addEventListener('mouseout', () => outs.push('out'));
    hover.setSpectatorHover('s:rune:0:rune_warding');
    expect(playerHovered.classList.contains('tt-on')).toBe(true);
    hover.noteLocalHover(mine); // the spectator's own mouse lands on another rune
    expect(playerHovered.classList.contains('tt-on')).toBe(false);
    expect(outs).toEqual(['out']);
    hover.setSpectatorHover('s:rune:0:rune_warding'); // the player's hover keeps arriving: it waits
    expect(playerHovered.classList.contains('tt-on')).toBe(false);
    hover.noteLocalHover(null); // the spectator's hand leaves
    expect(playerHovered.classList.contains('tt-on')).toBe(true);
  });

  it('only REAL pointer events count (the mirrored hover\'s own synthetic events never trip it)', () => {
    const playerHovered = runeBadge('rune:0:rune_warding');
    const mine = runeBadge('rune:1:rune_slaying');
    hover.watchLocalHover(true);
    hover.setSpectatorHover('s:rune:0:rune_warding');
    // a synthetic (untrusted) pointerover, like the mirror's own, changes nothing
    mine.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(playerHovered.classList.contains('tt-on')).toBe(true);
    expect(hover.LOCAL_HOVER_SELECTOR).toContain('.runecard');
    expect(hover.LOCAL_HOVER_SELECTOR).toContain('.combatopp-rune');
  });

  it('a viewer reads a forge rune but never picks it, hears no pick, and keeps the gauntlet cursor', () => {
    const card = readFileSync(join(__dirname, '..', 'RuneCard.tsx'), 'utf8');
    expect(card).toContain('if (useGame.getState().replaying) return; onBuy(');
    const game = readFileSync(join(__dirname, '..', 'Game.tsx'), 'utf8');
    expect(game).toContain("if (pick.closest('.app.viewing')) return;");
    const css = readFileSync(join(__dirname, 'versus.css'), 'utf8');
    expect(css).toContain(".app.viewing.spectating .runecard { pointer-events: auto; cursor: url('/cursors/gauntlet_default.svg') 6 2, default; }");
  });
});
