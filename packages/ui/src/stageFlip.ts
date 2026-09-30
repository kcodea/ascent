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

/**
 * Convert a simple state's recorded offsets from screen px to layout px, relative to where each element is NOW:
 * `recorded' = now + (recorded − now) / s`. Reads one rect per recorded element — on the same flush `Flip.from`
 * measures right after, so it adds no layout. A no-op at `s === 1`. Exported for the tests.
 */
export function rescaleSimpleState(state: StageFlipState, s: number): void {
  if (s === 1) return;
  for (const es of state.elementStates as unknown as RecordedBox[]) {
    const el = es.element;
    if (!el?.isConnected) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const m = es.matrix;
    // `matrix.e/f` = the recorded box + the page scroll at capture; keep that scroll term on both sides.
    const nowE = r.left + (m.e - es.bounds.left);
    const nowF = r.top + (m.f - es.bounds.top);
    m.e = nowE + (m.e - nowE) / s;
    m.f = nowF + (m.f - nowF) / s;
  }
}

/** `Flip.from(state, { ...vars, simple: true })`, scaled-stage safe. Consumes `state` (its offsets are rescaled). */
export function fromSimpleState(
  state: StageFlipState,
  vars: { duration: number; ease: string; onComplete?: () => void },
): gsap.core.Timeline {
  rescaleSimpleState(state, stageScale());
  return Flip.from(state, { ...vars, simple: true });
}
