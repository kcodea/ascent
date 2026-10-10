import { Flip } from 'gsap/Flip';
import { stageScale } from './stage';

/**
 * GSAP Flip's `simple: true` fast path on the SCALED STAGE (stage.ts) — still Flip, at every scale.
 *
 * The row slides (board / shop / hand reorders, the drag's pre-emptive parting) use `Flip.getState(…, { simple:
 * true })` because the full path forces a layout per card (owner drag-stutter traces 2026-09-04 / 09-17). The simple
 * path records each card's on-screen box and, in `Flip.from`, adds the SCREEN-px distance between the recorded box
 * and the current one straight onto the element's `x` / `y`, which are LAYOUT px. Unscaled those are the same unit;
 * on a scaled stage that offset is `1 / s` too big and every card would fly in from far outside its row.
 *
 * The fix is ONE unit conversion, applied to the recorded state just before `Flip.from` runs: each recorded
 * position is pulled toward the element's CURRENT position so that `recorded − current` becomes
 * `(recorded − current) / s`, i.e. the same distance in layout px. Everything else stays GSAP Flip's own behaviour —
 * and that behaviour is load-bearing (owner report 2026-09-30, R-PRESENT-27: *"its perfect in full screen, when not
 * in full screen its broken"*):
 *   · `Flip.getState` FINISHES any in-flight flip on its targets (and the drag captures right after each
 *     `Flip.from`), so the row always lands on the slide React just rendered;
 *   · `Flip.from` ends by restoring the element's own inline transform — the React `slideDir` translate that opens
 *     the drag's make-room gap (Card.tsx), never an `x: 0` or a cached value.
 * A hand-rolled FLIP below the design size (2026-09-26 → 09-30) diverged on both: its capture recorded where each
 * glide STARTED and left it running, so the next slot crossing replayed every earlier glide from its old spot (the
 * gap snapped back toward where the drag had come from) and a crossing that landed mid-glide froze cards part-way;
 * the first version also tweened to `x: 0`, wiping the gap outright. Only below full screen, because at `s === 1`
 * it was never used.
 */

export type StageFlipState = ReturnType<typeof Flip.getState>;

/** `Flip.getState(targets, { simple: true })` — identical at every stage scale (the unit fix happens at play). */
export function getSimpleState(targets: string | Element[]): StageFlipState {
  return Flip.getState(targets, { simple: true });
}

/** A recorded element box's position, as Flip keeps it (a translate-only matrix; `e`/`f` = page left/top). */
interface RecordedBox { element: Element; bounds: DOMRect; matrix: { e: number; f: number } }

/** Below this many px, a recorded box's size counts as the element's current size (see `snapSubpixelSizes`). */
const SIZE_EPSILON_PX = 0.5;

/**
 * Keep `Flip.from` on its SIMPLE path when only sub-pixel rounding moved a card's size (gameplay perf 2026-10-09).
 *
 * `Flip.from`'s fit takes the cheap translate-only branch only when the recorded box and the current one have the
 * SAME width and height; any difference counts as a resize and takes the "deep" branch, which resolves a global
 * matrix per card through GSAP's `getGlobalMatrix` (temp elements appended beside the card and measured: a forced
 * layout each). Measured on a heavy board drag: 77 of 112 card fits went deep, every one over a -0.031 px width
 * difference (layout rounding), never a real resize, and that was the drag's single biggest main-thread cost
 * (`getBoundingClientRect` under `Flip.from`). A size within half a pixel is the same box on screen, so it is
 * written back as the current size and the card slides exactly as before; a real resize (the lifted drag source,
 * a hover pop) is still a resize.
 */
export function snapSubpixelSizes(state: StageFlipState, rects: (DOMRect | null)[]): void {
  const states = state.elementStates as unknown as RecordedBox[];
  for (let i = 0; i < states.length; i++) {
    const r = rects[i];
    const b = states[i]!.bounds;
    if (!r || !b) continue;
    if (b.width !== r.width && Math.abs(b.width - r.width) < SIZE_EPSILON_PX) b.width = r.width;
    if (b.height !== r.height && Math.abs(b.height - r.height) < SIZE_EPSILON_PX) b.height = r.height;
  }
}

/**
 * Convert a simple state's recorded offsets from screen px to layout px, relative to where each element is NOW:
 * `recorded' = now + (recorded − now) / s`. Reads one rect per recorded element — on the same flush `Flip.from`
 * measures right after, so it adds no layout. A no-op at `s === 1`. Exported for the tests.
 */
export function rescaleSimpleState(state: StageFlipState, s: number, rects?: (DOMRect | null)[]): void {
  if (s === 1) return;
  const states = state.elementStates as unknown as RecordedBox[];
  for (let i = 0; i < states.length; i++) {
    const es = states[i]!;
    const el = es.element;
    if (!el?.isConnected) continue;
    const r = rects ? rects[i] : el.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) continue;
    const m = es.matrix;
    // `matrix.e/f` = the recorded box + the page scroll at capture; keep that scroll term on both sides.
    const nowE = r.left + (m.e - es.bounds.left);
    const nowF = r.top + (m.f - es.bounds.top);
    m.e = nowE + (m.e - nowE) / s;
    m.f = nowF + (m.f - nowF) / s;
  }
}

/**
 * Run a GSAP Flip call WITHOUT its body-scroll lock (gameplay perf pass 2026-10-09).
 *
 * `Flip.from` / `Flip.to` begin by "locking" the body whenever it is exactly as wide (or tall) as the window, which is
 * always true in a full-screen game window: they write `width: <px>; overflow-y: hidden` onto `body.style`, and take
 * them off again at the end. Each of those inline-style writes on `<body>` restyles AND re-lays-out the whole
 * document. Measured on a heavy board drag: two full restyles per slot crossing (~10 ms frames for the whole drag),
 * plus one at the drop. The lock exists so a scrollbar appearing mid-measure cannot shift anything; ASCENT's body is
 * `overflow: hidden` (styles.css) and never scrolls, so here it guards nothing, and the width it pins is the width
 * the body already has.
 *
 * GSAP keeps the lock private; its trigger is `body.clientWidth === window.outerWidth` (and the height twin). For the
 * duration of the synchronous call those two reads are shadowed on the body ELEMENT with `NaN`, so the comparison
 * is false and the lock never engages (it also saves the two forced-layout reads). The shadows are deleted in
 * `finally`, restoring the real accessors. Nothing else reads them inside a Flip call.
 */
const LOCK_READS = ['clientWidth', 'clientHeight'] as const;
export function withoutFlipBodyLock<T>(run: () => T): T {
  const body = typeof document !== 'undefined' ? (document.body as unknown as Record<string, unknown> | null) : null;
  if (!body) return run();
  const shadowed: string[] = [];
  for (const prop of LOCK_READS) {
    if (Object.prototype.hasOwnProperty.call(body, prop)) continue;
    try {
      Object.defineProperty(body, prop, { configurable: true, get: () => Number.NaN });
      shadowed.push(prop);
    } catch { /* an element that refuses own properties: the lock simply runs as before */ }
  }
  try {
    return run();
  } finally {
    for (const prop of shadowed) delete body[prop];
  }
}

/** `Flip.from(state, { ...vars, simple: true })`, scaled-stage safe. Consumes `state` (its offsets are rescaled). */
export function fromSimpleState(
  state: StageFlipState,
  vars: { duration: number; ease: string; onComplete?: () => void },
): gsap.core.Timeline {
  // One rect per recorded element, read on the same flush `Flip.from` measures on right after (no extra layout).
  const rects = (state.elementStates as unknown as RecordedBox[]).map((es) => (es.element?.isConnected ? es.element.getBoundingClientRect() : null));
  snapSubpixelSizes(state, rects);
  rescaleSimpleState(state, stageScale(), rects);
  return withoutFlipBodyLock(() => Flip.from(state, { ...vars, simple: true }));
}
