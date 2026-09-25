/**
 * WHERE A UNIT WILL SETTLE — the landing point for an effect travelling to a unit whose row is still
 * reflowing (owner report 2026-09-24, King Oona's banana): *"i need the banana to land on where the unit ends
 * up … in the case of multiple summons at once, it misses the mark as the unit continues to shift over as more
 * summons occur."*
 *
 * A combat row is a centred flex row (`.row`: `justify-content: center`, fixed `gap`). A summoned unit GROWS
 * its own slot (`summonexpand`, width 0 → full) and its neighbours glide over as layout, so the unit's rect at
 * fire time is where it is mid-reflow, not where it ends up. The settled slot is pure arithmetic instead: with
 * every unit at full width, unit `i` of `n` sits at `rowCentre + (i - (n - 1) / 2) * (width + gap)`.
 *
 * ONE layout read per call — the caller measures at fire time and again at each beat commit (a new summon
 * changes `n`), never per frame (CLAUDE.md: don't read layout per frame). Between measurements the effect
 * eases onto the newest goal with `createSettlingPoint`, so a retarget mid-flight reads as the banana curving
 * with the unit rather than jumping.
 */
export interface Point { x: number; y: number }

/** A unit that is leaving its slot (its death collapse) will not hold one once the row settles. */
const leaving = (el: Element): boolean => el.classList.contains('dying');

/**
 * The screen point `unitEl` will occupy once its row stops reflowing, or null when it is not in a row. All
 * lengths are read in layout px (`offsetWidth`, the computed `gap`) and converted to screen px by the row's
 * own rect/offset ratio, so a scaled board (the app's `--scale`, a CSS transform on an ancestor) still lands.
 */
export function settledSlotCenter(unitEl: Element | null): Point | null {
  const row = unitEl?.parentElement;
  if (!unitEl || !row) return null;
  const units = Array.from(row.children).filter((c) => c.hasAttribute('data-uid') && (c === unitEl || !leaving(c)));
  const i = units.indexOf(unitEl);
  if (i < 0) return null;
  const rowRect = row.getBoundingClientRect();
  const rowW = (row as HTMLElement).offsetWidth;
  const k = rowW > 0 ? rowRect.width / rowW : 1;
  // Full width = the widest unit: a GROWING slot is narrower than its final width, a settled one is not.
  const width = Math.max(0, ...units.map((u) => (u as HTMLElement).offsetWidth || 0));
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
  const pitch = (width + gap) * k;
  const r = unitEl.getBoundingClientRect();
  return {
    x: rowRect.left + rowRect.width / 2 + (i - (units.length - 1) / 2) * pitch,
    y: r.top + r.height / 2,
  };
}

/** Ease time constant: close to the row's own glide, so the effect curves in step with the unit it chases. */
const SETTLE_TAU_MS = 90;

/**
 * A point that eases toward a goal that can change mid-flight. `get()` is called once per frame by the play's
 * updater (no layout reads — it only does arithmetic); `setGoal()` is called whenever the caller re-measures.
 */
export function createSettlingPoint(start: Point, now: () => number = () => performance.now()): {
  get(): Point;
  setGoal(p: Point): void;
} {
  const cur = { ...start };
  let goal = { ...start };
  let last = now();
  return {
    get(): Point {
      const t = now();
      const a = 1 - Math.exp(-Math.max(0, t - last) / SETTLE_TAU_MS);
      last = t;
      cur.x += (goal.x - cur.x) * a;
      cur.y += (goal.y - cur.y) * a;
      return { x: cur.x, y: cur.y };
    },
    setGoal(p: Point): void { goal = { ...p }; },
  };
}
