/**
 * THE RUNE INSPECT'S LAYOUT, as pure math (R-RUNE-INSPECT-01; RuneInspect.tsx measures, this places). Every box is in the
 * overlay's own layout px with the group's top-left at (0, 0), before the group's fit scale.
 *
 * The rune and the cards it names are ONE group: the cards sit beside the rune with a clear `gap` between what each one
 * PAINTS (a plated card's plate, label and frame spill reach far past its layout box), their plates' tops level with the
 * rune card's top, never overlapping it or each other. When the window is tall and narrow enough that stacking draws them
 * bigger, the cards sit below the rune instead, centred under it. The group is then scaled (at most `maxK`) to fit the
 * overlay and centred on it, a little higher when the touch Pick pill sits below.
 */
export interface Box { l: number; t: number; r: number; b: number }

export interface RuneInspectInput {
  /** The rune card's own box (its top is what the cards line up with). */
  body: Box;
  /** Everything the rune paints: the card plus the cost coin on its top edge. */
  rune: Box;
  /** What each named card paints, in order. */
  cards: Box[];
  /** Each named card's plate top (its frame's top edge). */
  tops: number[];
  /** The overlay. */
  ov: Box;
  /** The touch Pick pill is shown under the group. */
  pick: boolean;
  gap: number;
  maxK: number;
}

export interface RuneInspectPlan {
  /** Each card's move from where it was measured. */
  off: { x: number; y: number }[];
  /** The group's painted box after those moves (before the scale). */
  box: Box;
  stacked: boolean;
  /** The group's scale and its move (transform-origin at its top-left): a point p lands at k * p + (tx, ty). */
  k: number;
  tx: number;
  ty: number;
}

const union = (a: Box, b: Box): Box => ({ l: Math.min(a.l, b.l), t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) });
const moved = (u: Box, o: { x: number; y: number }): Box => ({ l: u.l + o.x, t: u.t + o.y, r: u.r + o.x, b: u.b + o.y });

export function planRuneInspect(i: RuneInspectInput): RuneInspectPlan {
  const { body, rune: R, cards: U, tops, ov, pick, gap, maxK } = i;
  const availW = (ov.r - ov.l) * 0.9;
  const availH = (ov.b - ov.t) * (pick ? 0.72 : 0.88);
  const cx = (ov.l + ov.r) / 2;
  const cy = ov.t + (ov.b - ov.t) * (pick ? 0.42 : 0.5);

  const row = (): { off: { x: number; y: number }[]; box: Box } => {
    let x = R.r + gap;
    let box = R;
    const off = U.map((u, n) => {
      const o = { x: x - u.l, y: body.t - tops[n] };
      box = union(box, moved(u, o));
      x = u.r + o.x + gap;
      return o;
    });
    return { off, box };
  };
  const col = (): { off: { x: number; y: number }[]; box: Box } => {
    const w = U.reduce((a, u) => a + (u.r - u.l), 0) + gap * Math.max(0, U.length - 1);
    let x = (R.l + R.r) / 2 - w / 2;
    let box = R;
    // Level the plates, and keep the highest thing any card paints a `gap` under the rune.
    const lift = Math.min(...U.map((u, n) => u.t - tops[n]));
    const off = U.map((u, n) => {
      const o = { x: x - u.l, y: R.b + gap - lift - tops[n] };
      box = union(box, moved(u, o));
      x = u.r + o.x + gap;
      return o;
    });
    return { off, box };
  };
  const kOf = (box: Box): number => Math.min(maxK, availW / (box.r - box.l), availH / (box.b - box.t));
  const a = row();
  const b = U.length ? col() : null;
  const stacked = !!b && kOf(b.box) > kOf(a.box) * 1.05;
  const p = stacked && b ? b : a;
  const k = kOf(p.box);
  return { ...p, stacked, k, tx: cx - (k * (p.box.l + p.box.r)) / 2, ty: cy - (k * (p.box.t + p.box.b)) / 2 };
}
