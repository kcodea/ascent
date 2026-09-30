// @vitest-environment jsdom
/**
 * THE DRAG'S MAKE-ROOM SLIDE ON A SCALED STAGE (owner report 2026-09-30: *"im seeing issues with the warband units
 * not reacting appropriately when dragging units onto the board and repositioning them"* … *"its perfect in full
 * screen, when not in full screen its broken"*).
 *
 * While a card is dragged, the rows open the drop gap by giving each neighbour a React `slideDir` transform
 * (`translateX(calc((var(--ccw) + 22px) * n))`, Card.tsx), and `fromSimpleState` glides each card from where it
 * WAS to where that transform now puts it. At `s === 1` that is GSAP `Flip.from`, which re-reads each card's
 * transform fresh (`cache.uncache = 1`) and tweens TO it. Below the design size stageFlip.ts did the FLIP by hand,
 * read `x` from GSAP's stale cache and tweened every card TO `x: 0` — its natural slot. That wiped the slide the
 * row had just applied: the neighbours twitched and fell back instead of parting, so the warband never made room.
 *
 * GSAP is faked here (jsdom computes no transforms): a per-element "live" transform (what a fresh parse sees —
 * React's slide) and a separately cached value (what GSAP last wrote), so the test pins that the scaled path reads
 * the live transform and ends the glide ON it, exactly like Flip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Live { x: number; y: number }
const live = new Map<Element, Live>();    // the element's CURRENT transform (layout px) — what a fresh parse returns
const cached = new Map<Element, Live>();  // GSAP's transform cache — what it last parsed / wrote
interface Tween { el: Element; from?: Partial<Live>; to: Partial<Live> }
const tweens: Tween[] = [];
const flipFrom = vi.fn();

vi.mock('gsap', () => {
  const read = (el: Element, prop: 'x' | 'y', uncache?: boolean): number => {
    const c = cached.get(el);
    if (c && !uncache) return c[prop];
    const l = live.get(el) ?? { x: 0, y: 0 };
    cached.set(el, { ...l });
    return l[prop];
  };
  const write = (el: Element, v: Partial<Live>): void => {
    const cur = live.get(el) ?? { x: 0, y: 0 };
    const next = { x: v.x ?? cur.x, y: v.y ?? cur.y };
    live.set(el, next);
    cached.set(el, { ...next });
  };
  const timeline = () => {
    const tl = {
      fromTo: (el: Element, from: Partial<Live>, to: Partial<Live>) => { tweens.push({ el, from, to }); write(el, to); return tl; },
      to: (el: Element, to: Partial<Live>) => { tweens.push({ el, to }); write(el, to); return tl; },
      set: (el: Element, v: Partial<Live>) => { write(el, v); return tl; },
    };
    return tl;
  };
  const gsap = {
    getProperty: (el: Element, prop: 'x' | 'y', _unit?: string, uncache?: boolean) => read(el, prop, uncache),
    timeline,
    killTweensOf: () => {},
    set: (el: Element, v: Partial<Live>) => write(el, v),
  };
  return { default: gsap, gsap };
});
vi.mock('gsap/Flip', () => ({ Flip: { getState: vi.fn(() => ({ flip: true })), from: flipFrom } }));

const { applyStage, stageScale } = await import('./stage');
const { fromSimpleState, getSimpleState } = await import('./stageFlip');

function setWindow(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
  applyStage();
}

/** A card whose on-screen box we control (jsdom lays nothing out). */
function card(uid: string): HTMLElement & { at: (left: number, top?: number) => void } {
  const el = document.createElement('div') as unknown as HTMLElement & { at: (left: number, top?: number) => void };
  el.dataset.uid = uid;
  document.body.appendChild(el);
  let box = { left: 0, top: 0 };
  el.at = (left, top = 0) => { box = { left, top }; };
  el.getBoundingClientRect = () => ({ left: box.left, top: box.top, width: 150, height: 210, right: box.left + 150, bottom: box.top + 210, x: box.left, y: box.top, toJSON: () => ({}) }) as DOMRect;
  return el;
}

describe('fromSimpleState on a scaled stage — the make-room slide lands where the row put the card', () => {
  beforeEach(() => {
    live.clear(); cached.clear(); tweens.length = 0; flipFrom.mockClear();
    document.body.innerHTML = '';
  });
  afterEach(() => setWindow(1920, 1080));

  // 1440×810 → s = 0.75. One slot = --ccw + 22px = 200 LAYOUT px = 150 SCREEN px.
  const SLOT = 200;

  it('a neighbour shifted one slot by the drag glides FROM its old spot TO the slide (not back to its natural slot)', () => {
    setWindow(1440, 810);
    expect(stageScale()).toBeCloseTo(0.75, 10);
    const b = card('b');
    b.at(750);                        // resting: natural slot at layout 1000 = screen 750, no transform
    cached.set(b, { x: 0, y: 0 });    // GSAP last saw it untranslated (a previous glide ended at 0)
    const state = getSimpleState([b]);
    // The gap crosses it: React writes slideDir -1 → translateX(-200 layout px); it now draws one slot left.
    live.set(b, { x: -SLOT, y: 0 });
    b.at(750 - SLOT * 0.75);
    fromSimpleState(state, { duration: 0.12, ease: 'power2.out' });
    const tw = tweens.filter((t) => t.el === b);
    expect(tw.length).toBe(1);
    // Starts where it visually WAS (layout x 0 = its old spot) and ends ON the slide — what Flip.from does at s === 1.
    expect(tw[0]!.from?.x).toBeCloseTo(0, 6);
    expect(tw[0]!.to.x).toBeCloseTo(-SLOT, 6);
    expect(live.get(b)!.x).toBeCloseTo(-SLOT, 6); // after the glide the card sits in the gap's neighbour slot
  });

  it('a card that did not move is left on its current slide (no glide back to x: 0)', () => {
    setWindow(1440, 810);
    const c = card('c');
    live.set(c, { x: SLOT, y: 0 }); // already parted right by an earlier crossing
    c.at(900);
    const state = getSimpleState([c]);
    fromSimpleState(state, { duration: 0.12, ease: 'power2.out' }); // nothing moved this commit
    expect(live.get(c)!.x).toBeCloseTo(SLOT, 6);
    for (const t of tweens.filter((w) => w.el === c)) expect(t.to.x ?? SLOT).toBeCloseTo(SLOT, 6);
  });

  it('keeps a card\'s own vertical offset (the hand tuck) through a horizontal glide', () => {
    setWindow(1440, 810);
    const h = card('h');
    live.set(h, { x: 0, y: 14 }); // translateY(var(--hand-tuck))
    h.at(400, 900);
    const state = getSimpleState([h]);
    live.set(h, { x: -120, y: 14 });
    h.at(400 - 120 * 0.75, 900);
    fromSimpleState(state, { duration: 0.12, ease: 'power2.out' });
    const tw = tweens.find((t) => t.el === h)!;
    expect(tw.from?.x).toBeCloseTo(0, 6);
    expect(tw.to.x).toBeCloseTo(-120, 6);
    expect(tw.from?.y).toBeCloseTo(14, 6);
    expect(tw.to.y).toBeCloseTo(14, 6);
  });

  it('is exactly GSAP Flip (simple) at s === 1 — full screen keeps its code path', () => {
    setWindow(1920, 1080);
    expect(stageScale()).toBe(1);
    const a = card('a');
    const state = getSimpleState([a]);
    expect(state).toEqual({ flip: true });
    fromSimpleState(state, { duration: 0.12, ease: 'power2.out' });
    expect(flipFrom).toHaveBeenCalledWith({ flip: true }, { duration: 0.12, ease: 'power2.out', simple: true });
    expect(tweens.length).toBe(0);
  });
});

describe('the drag decision compares like with like on a scaled stage', () => {
  it('the row-collapse lift (owner-tuned LAYOUT px) is converted to screen px before it meets the screen-px pointer lift', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const recruit = readFileSync(join(__dirname, 'Recruit.tsx'), 'utf8');
    expect(recruit.includes('collapseY: toScreen(getDragFeel().collapseY)')).toBe(true);
    expect(recruit.includes('collapseY: getDragFeel().collapseY,')).toBe(false);
  });
});

// ── The owner's recording (2026-09-30, windowed): while a card is dragged along the warband the parting shows up to
// the RIGHT of the cursor and the neighbours' slides don't match where the card is held. Two halves to pin: the
// insertion INDEX (which slot the gap belongs in) and the SLIDE (whether the row actually shows it there).
const { indexFromSlots, reorderIndexFromSlots } = await import('./dragDecision');

describe('warband drag at s = 0.75: the gap opens under the cursor and the row shows it there', () => {
  // A 5-minion warband, one slot = --ccw 178 + 22px gap = 200 LAYOUT px, the row starting at layout x 560.
  const PITCH = 200, CCW = 178, ROW_LEFT = 560, N = 5;
  const natural = (i: number): number => ROW_LEFT + PITCH * i;
  /** The resting slots exactly as `getBoundingClientRect` reports them on a stage of scale `s` (screen px). */
  const slotsAt = (s: number) => Array.from({ length: N }, (_, i) => ({ uid: `m${i}`, left: natural(i) * s, width: CCW * s }));

  afterEach(() => setWindow(1920, 1080));

  it('the insertion index for a pointer held over slot k is k — at s = 0.75 exactly as at s = 1', () => {
    for (const s of [1, 0.75]) {
      const slots = slotsAt(s);
      for (let k = 0; k <= N; k++) {
        // The dragged card's centre just right of the boundary before card k (screen px, like `clientX`).
        const x = (k === 0 ? natural(0) : natural(k - 1) + CCW / 2 + 1) * s;
        expect(indexFromSlots(slots, x)).toBe(k);
      }
      // Reordering m1: held over the right half of m3's slot → the gap is at 3 (after m0, m2, m3).
      expect(reorderIndexFromSlots(slots, (natural(3) + 150) * s, 'm1', 1)).toBe(3);
      expect(reorderIndexFromSlots(slots, (natural(0) + 40) * s, 'm1', 1)).toBe(0);
    }
  });

  it('as the gap walks 0→1→2→3→2→1 every neighbour glides from where it was and ENDS on its slide', () => {
    setWindow(1440, 810);
    const s = stageScale();
    expect(s).toBeCloseTo(0.75, 10);
    document.body.innerHTML = '';
    live.clear(); cached.clear(); tweens.length = 0;
    const els = Array.from({ length: N }, (_, i) => {
      const el = document.createElement('div');
      el.dataset.uid = `m${i}`;
      document.body.appendChild(el);
      // On screen = the natural slot plus whatever transform is live right now, all shrunk by the stage.
      el.getBoundingClientRect = () => {
        const left = (natural(i) + (live.get(el)?.x ?? 0)) * s;
        return { left, top: 700 * s, width: CCW * s, height: 250 * s, right: left + CCW * s, bottom: 950 * s, x: left, y: 700 * s, toJSON: () => ({}) } as DOMRect;
      };
      return el;
    });
    // A hand minion played into the row: half a slot each side of the gap (WarbandRow's `boardSlide`).
    const slideOf = (i: number, gap: number): number => (i < gap ? -0.5 : 0.5) * PITCH;
    let state = getSimpleState(els); // captured at drag start, every card at rest
    for (const gap of [0, 1, 2, 3, 2, 1]) {
      const before = els.map((el) => live.get(el)?.x ?? 0);
      tweens.length = 0;
      // React commits the new `slideDir` transforms (only the ones that changed) — GSAP's cache never sees these.
      els.forEach((el, i) => { if ((live.get(el)?.x ?? 0) !== slideOf(i, gap)) live.set(el, { x: slideOf(i, gap), y: 0 }); });
      fromSimpleState(state, { duration: 0.12, ease: 'power2.out' });
      els.forEach((el, i) => {
        expect(live.get(el)!.x, `gap ${gap}: m${i} rests on its slide`).toBeCloseTo(slideOf(i, gap), 6);
        const tw = tweens.find((t) => t.el === el);
        if (tw) expect(tw.from?.x, `gap ${gap}: m${i} starts where it was`).toBeCloseTo(before[i]!, 6);
      });
      state = getSimpleState(els); // the next crossing's baseline (RowFlip re-captures after each drag commit)
    }
  });
});
