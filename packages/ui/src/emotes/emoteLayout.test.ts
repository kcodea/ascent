// @vitest-environment jsdom
/**
 * EMOTE LAYOUT (owner 2026-10-29: "Need to clean up spectators and their emotes. It's cluttered and emotes cover each
 * other. They are also kinda small. Emotes are too. Also, mirrored emotes on the lobby rail come out backwards so text
 * doesn't work"; R-EMOTE-LAYOUT-01). Pins:
 *  - simultaneous bubbles never overlap: several spectators at once, neighbouring rail rows at once, a spectator's next
 *    to the player's own; a bubble with no room waits and goes up when one leaves; the on-screen caps hold;
 *  - no bubble is ever mirrored: no `flip` class, no mirroring transform on the art, and the stylesheet carries none;
 *  - every bubble fits its portrait (owner follow-up the same day: "emotes should eclipse the players icon a bit more and
 *    be more vertically aligned and sized appropriately to the portraits"): a fixed multiple of the portrait's width
 *    per surface, level with its middle, its near edge over the portrait.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { useGame } from '../store';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EMOTE_ASPECT } from './emoteArt';
import {
  BUBBLE_TO_PORTRAIT, DOCK_BUBBLE_TO_SLICE, MAX_WATCH_LIVE, MIN_BUBBLE_WIDTH, PORTRAIT_ECLIPSE, bubbleBox, bubblesOverlap, clearEmoteBubbles, fitBesideSlice, fitToPortrait,
  setEmoteFoe, settleBubble, showEmoteBubble,
} from './emoteBubble';

const EMOTES = ['emote_hi', 'emote_good_choice', 'emote_too_nasty', 'emote_lemon_approved', 'emote_its_beasts', 'emote_zen_brian'];

afterEach(() => {
  vi.useRealTimers();
  clearEmoteBubbles();
  setEmoteFoe(null);
  act(() => { useGame.setState({ combatStaged: false }); });
  document.body.innerHTML = '';
});

type R = { left: number; top: number; width: number; height: number };
const stub = (el: Element, r: R): void => {
  (el as HTMLElement).getBoundingClientRect = () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}) }) as DOMRect;
};
const add = (html: string): HTMLElement => {
  const host = document.createElement('div');
  host.innerHTML = html;
  const el = host.firstElementChild as HTMLElement;
  document.body.appendChild(el);
  return el;
};
/** A spectator plate in the top-left stands column, its portrait ring at (left, top), 88 px. */
const plate = (id: string, top: number): void => {
  const el = add(`<span class="vsspec-seat vswatch-seat" data-watcher="${id}"><span class="portring"></span></span>`);
  stub(el, { left: 20, top, width: 132, height: 120 });
  stub(el.querySelector('.portring')!, { left: 42, top, width: 88, height: 88 });
};
const railRow = (seat: string, top: number): void => {
  const el = add(`<div class="lobbyseat" data-seat="${seat}"><span class="lobbyface"></span></div>`);
  stub(el.querySelector('.lobbyface')!, { left: 1740, top, width: 60, height: 60 });
};
const boxes = (): (R & { seat: string })[] => [...document.body.querySelectorAll<HTMLElement>('.emote-bubble')].map((el) => ({
  seat: el.dataset.seat!, left: parseFloat(el.style.left), top: parseFloat(el.style.top), width: parseFloat(el.style.width), height: parseFloat(el.style.height),
}));
const noTwoOverlap = (list: R[]): boolean => list.every((a, i) => list.every((b, j) => i === j || !bubblesOverlap(a, b)));

describe('bubbles never cover each other', () => {
  it('settleBubble: a clear spot is kept; a taken one slides along its anchor; no room within reach is null', () => {
    const p = { x: 140, y: 300, width: 232, side: 'right' as const, slide: 160 };
    const first = settleBubble(p, [], 1080)!;
    expect(first).toEqual(bubbleBox(p));
    const second = settleBubble(p, [first], 1080)!;
    expect(second).not.toBeNull();
    expect(bubblesOverlap(first, second)).toBe(false);
    // its anchor point stays where it was: the pop still grows from the plate
    expect(second.top + second.originY).toBeCloseTo(first.top + first.originY);
    expect(settleBubble({ ...p, slide: 0 }, [first], 1080)).toBeNull();
  });

  it('five spectators emote at once: the bubbles that show never overlap, at most three, the rest wait their turn', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 5; i++) plate(`u${i}`, 12 + i * 130);
    for (let i = 0; i < 5; i++) expect(showEmoteBubble(`w:u${i}`, EMOTES[i]!)).toBe(true);
    const shown = boxes();
    expect(shown).toHaveLength(MAX_WATCH_LIVE);
    expect(noTwoOverlap(shown)).toBe(true);
    // every one sits to the right of its own portrait
    for (const b of shown) expect(b.left).toBeGreaterThan(42);
    // when the first ones leave, the waiting ones go up (still clear of each other)
    const first = shown.map((b) => b.seat);
    act(() => { vi.advanceTimersByTime(3300); });
    const next = boxes();
    expect(next.map((b) => b.seat).sort()).toEqual(['w:u0', 'w:u1', 'w:u2', 'w:u3', 'w:u4'].filter((x) => !first.includes(x)));
    expect(noTwoOverlap(next)).toBe(true);
  });

  it('a waiting bubble that cannot go up in time is dropped, never shown late', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 4; i++) plate(`u${i}`, 12 + i * 130);
    for (let i = 0; i < 4; i++) showEmoteBubble(`w:u${i}`, EMOTES[i]!);
    expect(boxes()).toHaveLength(3);
    // the three shown speakers say another just before theirs leave, so no room opens for a long while
    act(() => { vi.advanceTimersByTime(3000); });
    for (let i = 0; i < 3; i++) showEmoteBubble(`w:u${i}`, EMOTES[i + 3]!);
    act(() => { vi.advanceTimersByTime(3300); });
    expect(boxes().map((b) => b.seat)).not.toContain('w:u3');
  });

  it('neighbouring rail rows emote at once: their bubbles slide apart along the rail', () => {
    for (let i = 1; i <= 4; i++) railRow(`s${i}`, 160 + i * 78);
    for (let i = 1; i <= 4; i++) expect(showEmoteBubble(`s${i}`, EMOTES[i]!)).toBe(true);
    const shown = boxes();
    expect(shown.length).toBeGreaterThanOrEqual(3);
    expect(noTwoOverlap(shown)).toBe(true);
    // every rail bubble sits to the LEFT of the faces, its right end only over their left edge
    for (const b of shown) expect(b.left + b.width).toBeLessThanOrEqual(1740 + 60 * PORTRAIT_ECLIPSE + 1);
  });

  it('a spectator bubble never covers the player\'s own bubble: it slides clear, or waits for it to leave', () => {
    vi.useFakeTimers();
    const me = add('<div class="statusbar"><div class="hero"><div class="f"></div></div></div>');
    stub(me.querySelector('.f')!, { left: 40, top: 300, width: 260, height: 260 });
    plate('u1', 120);
    expect(showEmoteBubble('s0', 'emote_good_choice')).toBe(true);
    expect(showEmoteBubble('w:u1', 'emote_hi')).toBe(true);
    expect(noTwoOverlap(boxes())).toBe(true);
    if (boxes().length < 2) {
      act(() => { vi.advanceTimersByTime(3300); });
      expect(boxes().map((b) => b.seat)).toEqual(['w:u1']);
    }
  });
});

describe('emote art is never mirrored (the words are painted in)', () => {
  it('rail, Versus foe, combat foe, spectator and self bubbles carry no flip and no mirroring transform', () => {
    railRow('s2', 300);
    const foe = add('<div class="vsfoe-face" data-seat="s1"><div class="vsfoe-disc"></div></div>');
    stub(foe.querySelector('.vsfoe-disc')!, { left: 1600, top: 600, width: 160, height: 160 });
    plate('u1', 12);
    const me = add('<div class="statusbar"><div class="hero"><div class="f"></div></div></div>');
    stub(me.querySelector('.f')!, { left: 40, top: 800, width: 200, height: 200 });
    for (const [seat, e] of [['s2', 'emote_hi'], ['s1', 'emote_too_nasty'], ['w:u1', 'emote_good_choice'], ['s0', 'emote_its_beasts']] as const) {
      expect(showEmoteBubble(seat, e)).toBe(true);
    }
    const combat = add('<div class="combatopp"><div class="combatopp-body"></div></div>');
    stub(combat.querySelector('.combatopp-body')!, { left: 1500, top: 120, width: 180, height: 180 });
    act(() => { useGame.setState({ combatStaged: true }); });
    setEmoteFoe('s3');
    expect(showEmoteBubble('s3', 'emote_lemon_approved')).toBe(true);
    const all = [...document.body.querySelectorAll<HTMLElement>('.emote-bubble')];
    expect(all).toHaveLength(5);
    for (const el of all) {
      expect(el.className).not.toMatch(/\bflip\b/);
      expect(el.style.transform).not.toMatch(/scaleX\(-1\)|scale\(-1/);
      expect(el.querySelector('img')!.style.transform).toBe('');
    }
    // the rail, the Versus foe and the combat foe open to the left, the rest to the right
    expect(all.filter((el) => el.classList.contains('left')).map((el) => el.dataset.seat).sort()).toEqual(['s1', 's2', 's3']);
  });

  it('the stylesheet never mirrors a bubble', () => {
    const css = readFileSync(join(__dirname, 'emotes.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = css.split('}').filter((r) => r.includes('.emote-bubble'));
    expect(rules.length).toBeGreaterThan(0);
    expect(css).toContain('.emote-bubble.left > img { transform: none; }');
    for (const r of rules) expect(r).not.toMatch(/scaleX\(\s*-1\s*\)|scale\(\s*-1/);
  });

});

describe('every bubble fits its portrait (owner 2026-10-29: "eclipse the players icon a bit more ... vertically aligned and sized appropriately to the portraits")', () => {
  const middle = (b: R): number => b.top + b.height / 2;

  it('sized as a fixed multiple of its portrait, per surface: a bigger portrait gets a bigger bubble, a small face a floor', () => {
    for (const surface of ['self', 'rail', 'foe', 'watch'] as const) {
      const small = fitToPortrait({ left: 400, top: 400, width: 100, height: 100 }, surface, 'right');
      const big = fitToPortrait({ left: 400, top: 400, width: 200, height: 200 }, surface, 'right');
      expect(big.width).toBe(Math.max(MIN_BUBBLE_WIDTH, Math.round(200 * BUBBLE_TO_PORTRAIT[surface])));
      expect(big.width).toBeGreaterThanOrEqual(small.width);
      expect(small.width).toBeGreaterThanOrEqual(MIN_BUBBLE_WIDTH);
    }
    // the hero portrait's bubble is the biggest at the game's real sizes (hero 266, foe 160, ring 88, rail face 58)
    const w = (s: keyof typeof BUBBLE_TO_PORTRAIT, px: number): number => fitToPortrait({ left: 400, top: 400, width: px, height: px }, s, 'left').width;
    expect(w('self', 266)).toBeGreaterThan(w('foe', 160));
    expect(w('foe', 160)).toBeGreaterThan(w('watch', 88));
    expect(w('watch', 88)).toBeGreaterThan(w('rail', 58));
  });

  it('level with the portrait\'s middle, its near edge over the portrait by the eclipse, on every surface', () => {
    railRow('s2', 300);
    const foe = add('<div class="vsfoe-face" data-seat="s1"><div class="vsfoe-disc"></div></div>');
    stub(foe.querySelector('.vsfoe-disc')!, { left: 1600, top: 500, width: 160, height: 160 });
    plate('u1', 120);
    const me = add('<div class="statusbar"><div class="hero"><div class="f"></div></div></div>');
    stub(me.querySelector('.f')!, { left: 40, top: 420, width: 260, height: 260 });
    for (const [seat, e] of [['s2', 'emote_hi'], ['s1', 'emote_too_nasty'], ['w:u1', 'emote_good_choice'], ['s0', 'emote_its_beasts']] as const) {
      expect(showEmoteBubble(seat, e)).toBe(true);
    }
    const by = Object.fromEntries(boxes().map((b) => [b.seat, b]));
    const check = (seat: string, p: R, side: 'left' | 'right'): void => {
      const b = by[seat]!;
      expect(Math.abs(middle(b) - (p.top + p.height / 2))).toBeLessThanOrEqual(1);
      const eclipse = p.width * PORTRAIT_ECLIPSE;
      if (side === 'right') expect(b.left).toBeCloseTo(p.left + p.width - eclipse, 0);
      else expect(b.left + b.width).toBeCloseTo(p.left + eclipse, 0);
    };
    check('s2', { left: 1740, top: 300, width: 60, height: 60 }, 'left');
    check('s1', { left: 1600, top: 500, width: 160, height: 160 }, 'left');
    check('w:u1', { left: 42, top: 120, width: 88, height: 88 }, 'right');
    check('s0', { left: 40, top: 420, width: 260, height: 260 }, 'right');
  });
});

describe('the Docked rail: a seat\'s bubble is sized off its slice and sits beside it (owner 2026-11-01: "emotes on the rail are massive and look bad"; R-EMOTE-RAIL-DOCKED-01)', () => {
  /** A docked slice: the wide seat box of the Docked rail, its portrait art spanning most of it. */
  const slice = (seat: string, r: R): void => {
    let rail = document.querySelector('.lobbyrail.lrv-docked .lobbyseats');
    if (!rail) rail = add('<div class="lobbyrail lrv-docked"><div class="lobbyseats"></div></div>').querySelector('.lobbyseats')!;
    const host = document.createElement('div');
    host.innerHTML = `<div class="lobbyseat" data-seat="${seat}"><span class="lrv-tileart"><img class="lobbyface" alt=""></span></div>`;
    const el = host.firstElementChild!;
    rail.appendChild(el);
    stub(el, r);
    // the art spans the right 53% of the slice: sizing off it is what made the old bubble huge
    stub(el.querySelector('.lobbyface')!, { left: r.left + r.width * 0.47, top: r.top, width: r.width * 0.53, height: r.height });
  };
  const SLICE_H = 61;
  const at = (i: number): R => ({ left: 1617, top: 260 + i * 66.5, width: 245, height: SLICE_H });
  const cover = (a: R, b: R): boolean => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

  it('about the slice\'s height (not a multiple of the portrait art), level with its middle, wholly left of it', () => {
    slice('s3', at(2));
    expect(showEmoteBubble('s3', 'emote_good_choice')).toBe(true);
    const [b] = boxes();
    expect(b!.height).toBe(Math.round(SLICE_H * DOCK_BUBBLE_TO_SLICE));
    expect(b!.height).toBeLessThan(SLICE_H * 1.5);
    expect(Math.abs(b!.top + b!.height / 2 - (at(2).top + SLICE_H / 2))).toBeLessThanOrEqual(1);
    expect(b!.left + b!.width).toBeLessThan(at(2).left);
    expect(b!.left + b!.width).toBeGreaterThan(at(2).left - 10);
    expect(document.querySelector('.emote-bubble')!.classList.contains('left')).toBe(true);
  });

  it('tracks the rail\'s scale: a smaller rail (a smaller screen) gets a proportionally smaller bubble', () => {
    const big = fitBesideSlice({ left: 1600, top: 300, width: 245, height: 61 }, []);
    const small = fitBesideSlice({ left: 1200, top: 220, width: 184, height: 46 }, []);
    expect(small.width / big.width).toBeCloseTo(46 / 61, 1);
    // a phone draws the whole game small: never under the readable floor (here 36 screen px at a 0.4 screen scale)
    expect(Math.round(fitBesideSlice({ left: 1600, top: 300, width: 245, height: 61 }, [], 36 / 0.4).width * EMOTE_ASPECT)).toBe(90);
  });

  it('every seat at once: no bubble covers another, a slice, the placement column or the board pieces the rail is cut round', () => {
    for (let i = 0; i < 7; i++) slice(`s${i + 1}`, at(i));
    // the End Turn gem bites into slices 3 and 4, the Gold coin into 6 and 7 (they stand left of the rail's edge)
    const gem = add('<div class="etb-base"></div>');
    stub(gem, { left: 1525, top: 390, width: 130, height: 140 });
    const coin = add('<div class="goldpill"></div>');
    stub(coin, { left: 1525, top: 655, width: 130, height: 130 });
    for (let i = 0; i < 7; i++) expect(showEmoteBubble(`s${i + 1}`, EMOTES[i % EMOTES.length]!)).toBe(true);
    const shown = boxes();
    expect(shown).toHaveLength(7); // a slice tall: neighbours fit side by side, nobody waits
    expect(noTwoOverlap(shown)).toBe(true);
    const pieces: R[] = [...Array.from({ length: 7 }, (_, i) => at(i)), { left: 1525, top: 390, width: 130, height: 140 }, { left: 1525, top: 655, width: 130, height: 130 }];
    for (const b of shown) for (const p of pieces) expect(cover(b, p)).toBe(false);
  });

  it('a piece that only reaches into the overhang (the Refresh pill\'s foot over the top slice) nudges the bubble down, not away', () => {
    const s: R = { left: 1617, top: 260, width: 245, height: SLICE_H };
    const pill: R = { left: 1430, top: 140, width: 280, height: 116 }; // its foot ends 4 px above the slice
    const p = fitBesideSlice(s, [s, pill]);
    const b = bubbleBox(p);
    expect(b.left + b.width).toBeGreaterThan(s.left - 10); // still right beside its slice
    expect(b.top).toBeGreaterThanOrEqual(pill.top + pill.height);
    expect(b.top).toBeLessThanOrEqual(s.top);
  });

  it('a Duos table (teams side by side): the bubble stands left of the pair, never over the teammate\'s slice', () => {
    slice('s0', { left: 1617, top: 300, width: 120, height: SLICE_H });
    slice('s1', { left: 1742, top: 300, width: 120, height: SLICE_H });
    expect(showEmoteBubble('s1', 'emote_hi')).toBe(true);
    const [b] = boxes();
    expect(b!.left + b!.width).toBeLessThan(1617);
  });

  it('the Gem rail fallback (a round face, no dock) keeps its portrait fit', () => {
    railRow('s2', 300);
    expect(showEmoteBubble('s2', 'emote_hi')).toBe(true);
    const [b] = boxes();
    expect(b!.left + b!.width).toBeCloseTo(1740 + 60 * PORTRAIT_ECLIPSE, 0);
  });
});
