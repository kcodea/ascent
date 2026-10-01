// @vitest-environment jsdom
/**
 * THE DRAG'S MAKE-ROOM GAP ON A SCALED STAGE (owner report 2026-09-30: *"its perfect in full screen, when not in full
 * screen its broken"*; the pre-scaled-stage build *"works perfectly"*). R-PRESENT-27.
 *
 * While a card is dragged, the row opens the drop gap with a React `slideDir` transform on each neighbour
 * (`translateX(calc((var(--ccw) + 22px) * n))`, Card.tsx) and `RowFlip` runs, per slot crossing:
 * `fromSimpleState(prevState)` → `prevState = getSimpleState(row)`. At `s === 1` that is GSAP Flip, whose
 * `getState` FINISHES the flip it just started (so the row always stands exactly on React's slides) and whose
 * `from` ends by restoring React's own inline transform. Below the design size a hand-rolled FLIP stood in for it
 * and did neither: the capture recorded where each glide STARTED and left it running, so every crossing replayed
 * the whole row from its resting spots (the parting snapped shut and re-opened from where the drag had come from),
 * a crossing that landed mid-glide froze cards part-way, and the first version even tweened to `x: 0` (no gap).
 *
 * These tests run the REAL gsap + Flip + stageFlip against a modelled row: jsdom lays nothing out, so each card's
 * on-screen box is `(natural + its current translate) × s`, where the translate is whatever GSAP or React last wrote
 * inline (and `getComputedStyle().transform` reports the same thing as a matrix, the way a browser would).
 */
import { afterEach, describe, expect, it } from 'vitest';
import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { applyStage, stageScale } from './stage';
import { fromSimpleState, getSimpleState } from './stageFlip';
import { indexFromSlots, reorderIndexFromSlots } from './dragDecision';

gsap.registerPlugin(Flip);

// A 5-minion warband: one slot (and one slideDir unit) = 200 LAYOUT px, the row starting at layout x 560.
const PITCH = 200, CCW = 178, ROW_LEFT = 560, N = 5;
const natural = (i: number): number => ROW_LEFT + PITCH * i;

// ── the modelled DOM ────────────────────────────────────────────────────────────────────────────────────────────
const reactX = new WeakMap<Element, number>(); // what React's calc() slide resolves to (layout px)
const lastSlide = new WeakMap<Element, number>(); // React's own last-rendered slideDir (it only writes on change)

/** The element's current translateX in layout px: GSAP's inline `translate(…px, …px)`, React's slide, or 0. */
function liveX(el: HTMLElement): number {
  const t = el.style.transform;
  const g = /translate(?:3d)?\((-?[\d.e+-]+)px/.exec(t);
  if (g) return Number(g[1]);
  if (t.startsWith('translateX(calc(')) return reactX.get(el) ?? 0;
  return 0;
}

const realGetComputedStyle = window.getComputedStyle.bind(window);
(window as unknown as { getComputedStyle: typeof window.getComputedStyle }).getComputedStyle = (e: Element, p?: string | null) => {
  const cs = realGetComputedStyle(e, p);
  if (!(e as HTMLElement).dataset?.modelled) return cs;
  const tf = (): string => { const v = liveX(e as HTMLElement); return v ? `matrix(1, 0, 0, 1, ${v}, 0)` : 'none'; };
  return new Proxy(cs, {
    get(t, k) {
      if (k === 'transform') return tf();
      if (k === 'getPropertyValue') return (n: string) => (n === 'transform' ? tf() : t.getPropertyValue(n));
      const v = Reflect.get(t, k) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
};

function setWindow(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
  applyStage();
}

function row(): HTMLElement[] {
  document.body.innerHTML = '';
  return Array.from({ length: N }, (_, i) => {
    const el = document.createElement('div');
    el.dataset.modelled = '1';
    el.dataset.uid = `m${i}`;
    document.body.appendChild(el);
    el.getBoundingClientRect = () => {
      const s = stageScale();
      const left = (natural(i) + liveX(el)) * s;
      return { left, top: 700 * s, width: CCW * s, height: 250 * s, right: left + CCW * s, bottom: 950 * s, x: left, y: 700 * s, toJSON: () => ({}) } as DOMRect;
    };
    return el;
  });
}

/** React's commit of the rows' `slideDir`s: writes only the ones that changed, like React's style diff. */
function reactCommit(els: HTMLElement[], slides: readonly number[]): void {
  els.forEach((el, i) => {
    const n = slides[i]!;
    if ((lastSlide.get(el) ?? 0) === n) return;
    lastSlide.set(el, n);
    reactX.set(el, n * PITCH);
    el.style.transform = n ? `translateX(calc((var(--ccw) + 22px) * ${n}))` : '';
  });
}

const screenLefts = (els: HTMLElement[]): number[] => els.map((el) => el.getBoundingClientRect().left);
/** Where the row SHOULD stand for these slides (screen px) — what Flip shows at s === 1. */
const wanted = (slides: readonly number[]): number[] => slides.map((n, i) => (natural(i) + n * PITCH) * stageScale());

let clock = 0;
/** Advance GSAP's root timeline by `ms` (jsdom has no frames; the tests drive the clock). */
function advance(ms: number): void {
  clock = Math.max(clock, gsap.globalTimeline.time()) + ms / 1000;
  gsap.updateRoot(clock);
}

/**
 * RowFlip's drag branch, crossing by crossing: React commits the new slides, `fromSimpleState(prev)` glides the row,
 * `getSimpleState` captures the next baseline, then `stepMs` pass before the next crossing. Returns the row as it
 * stands right after each crossing, and once everything has settled.
 */
function dragWalk(steps: readonly (readonly number[])[], stepMs: number): { perCrossing: number[][]; settled: number[] } {
  const els = row();
  let state = getSimpleState(els); // captured at drag start (startDragSession)
  const perCrossing: number[][] = [];
  for (const slides of steps) {
    reactCommit(els, slides);
    fromSimpleState(state, { duration: 0.18, ease: 'power2.out' }); // flipConfig.dragMs = 180
    state = getSimpleState(els);
    perCrossing.push(screenLefts(els));
    advance(stepMs);
  }
  advance(1000);
  return { perCrossing, settled: screenLefts(els) };
}

const expectRow = (got: number[], want: number[], what: string): void =>
  got.forEach((v, i) => expect(v, `${what}: m${i}`).toBeCloseTo(want[i]!, 1));

/** A hand minion played into the row: half a slot each side of the gap (WarbandRow's `boardSlide`). */
const handPlay = (g: number): number[] => Array.from({ length: N }, (_, i) => (i < g ? -0.5 : 0.5));
/** Reordering m0 (it holds its slot, invisible): every card the gap has crossed shifts one slot left. */
const reorderM0 = (g: number): number[] => Array.from({ length: N }, (_, i) => (i === 0 ? 0 : i - 1 < g ? -1 : 0));

describe('the drag make-room gap stands where the row put it — on a scaled stage exactly as at full screen', () => {
  afterEach(() => setWindow(1920, 1080));

  for (const [w, h] of [[1920, 1080], [1440, 810], [1280, 720]] as const) {
    it(`${w}×${h}: a hand minion dragged LEFT along the warband — the gap follows the cursor at every crossing`, () => {
      setWindow(w, h);
      const steps = [handPlay(5), handPlay(4), handPlay(3), handPlay(2)];
      for (const stepMs of [250, 60]) { // crossings after the glide settled, and crossings mid-glide
        const { perCrossing, settled } = dragWalk(steps, stepMs);
        perCrossing.forEach((got, k) => expectRow(got, wanted(steps[k]!), `${stepMs}ms, crossing ${k}`));
        expectRow(settled, wanted(steps[steps.length - 1]!), `${stepMs}ms, settled`);
      }
    });

    it(`${w}×${h}: a board minion reordered RIGHT — the neighbours step aside under the cursor and stay there`, () => {
      setWindow(w, h);
      const steps = [reorderM0(1), reorderM0(2), reorderM0(3), reorderM0(4), reorderM0(3)];
      for (const stepMs of [250, 60]) {
        const { perCrossing, settled } = dragWalk(steps, stepMs);
        perCrossing.forEach((got, k) => expectRow(got, wanted(steps[k]!), `${stepMs}ms, crossing ${k}`));
        expectRow(settled, wanted(steps[steps.length - 1]!), `${stepMs}ms, settled`);
      }
    });
  }

  it('a glide that is left to run (the hand-reorder settle) starts where the card WAS on screen — the offset is layout px', () => {
    for (const [w, h] of [[1920, 1080], [1440, 810], [844, 390]] as const) {
      setWindow(w, h);
      const els = row();
      const before = screenLefts(els);
      const state = getSimpleState(els);
      // The layout changes under the cards (a reorder commit): m1 now sits one slot right, m2 one slot left.
      reactCommit(els, [0, 1, -1, 0, 0]);
      const moved = screenLefts(els);
      fromSimpleState(state, { duration: 0.2, ease: 'none' });
      expectRow(screenLefts(els), before, `${w}×${h} t=0`); // FLIP: nothing visibly jumps
      advance(100);
      expectRow(screenLefts(els), before.map((b, i) => (b + moved[i]!) / 2), `${w}×${h} halfway`);
      advance(500);
      expectRow(screenLefts(els), moved, `${w}×${h} end`);
      expect(els[1]!.style.transform.startsWith('translateX(calc(')).toBe(true); // React's own transform restored
    }
  });

  it('is plain GSAP Flip (simple) at s === 1 — full screen keeps its code path', () => {
    setWindow(1920, 1080);
    expect(stageScale()).toBe(1);
    const els = row();
    const state = getSimpleState(els);
    const matrixE = (state.elementStates as unknown as { matrix: { e: number } }[]).map((es) => es.matrix.e);
    reactCommit(els, [0, 1, -1, 0, 0]);
    fromSimpleState(state, { duration: 0.2, ease: 'none' });
    // No rescale at s === 1: the recorded boxes reach Flip.from untouched.
    expect((state.elementStates as unknown as { matrix: { e: number } }[]).map((es) => es.matrix.e)).toEqual(matrixE);
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

  it('the insertion index for a pointer held over slot k is k — at s = 0.75 exactly as at s = 1', () => {
    // The resting slots exactly as `getBoundingClientRect` reports them on a stage of scale `s` (screen px).
    const slotsAt = (s: number) => Array.from({ length: N }, (_, i) => ({ uid: `m${i}`, left: natural(i) * s, width: CCW * s }));
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
});
