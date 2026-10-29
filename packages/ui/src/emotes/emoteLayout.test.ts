// @vitest-environment jsdom
/**
 * EMOTE LAYOUT (owner 2026-10-29: "Need to clean up spectators and their emotes. It's cluttered and emotes cover each
 * other. They are also kinda small. Emotes are too. Also, mirrored emotes on the lobby rail come out backwards so text
 * doesn't work"; R-EMOTE-LAYOUT-01). Pins:
 *  - simultaneous bubbles never overlap: several spectators at once, neighbouring rail rows at once, a spectator's next
 *    to the player's own; a bubble with no room waits and goes up when one leaves; the on-screen caps hold;
 *  - no bubble is ever mirrored: no `flip` class, no mirroring transform on the art, and the stylesheet carries none;
 *  - bubbles are larger than before (2026-10-13 widths: self 300, rail 200, foe 230, spectator 190).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { useGame } from '../store';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUBBLE_WIDTH, MAX_WATCH_LIVE, bubbleBox, bubblesOverlap, clearEmoteBubbles, setEmoteFoe, settleBubble, showEmoteBubble,
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
    // every rail bubble stays to the LEFT of the faces
    for (const b of shown) expect(b.left + b.width).toBeLessThanOrEqual(1740);
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

  it('bubbles are larger than the 2026-10-13 sizes', () => {
    expect(BUBBLE_WIDTH.self).toBeGreaterThan(300);
    expect(BUBBLE_WIDTH.rail).toBeGreaterThan(200);
    expect(BUBBLE_WIDTH.foe).toBeGreaterThan(230);
    expect(BUBBLE_WIDTH.watch).toBeGreaterThan(190);
  });
});
