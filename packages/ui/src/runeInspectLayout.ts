/**
 * THE RUNE INSPECT'S LINE-UP, as pure math (R-RUNE-INSPECT-01; RuneInspect.tsx measures, this places). Every box is in the
 * group's own layout px (before its Inspect scale). Sizes are never touched: only where each piece sits.
 *
 * The rune and the cards it names sit in ONE row: each card beside the one before with a clear `gap` between what each
 * PAINTS (a plated card's plate, frame spill and the label under it reach far past its layout box), never over the rune
 * or over another card, its plate top level with the rune card's top. The whole row is then moved so its painted centre
 * sits on the backdrop's centre (a little higher when the touch Pick pill sits below).
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
  /** The point the row is centred on (the backdrop's centre). */
  centre: { x: number; y: number };
  gap: number;
}

export interface RuneInspectPlan {
  /** Each card's move from where it was measured. */
  off: { x: number; y: number }[];
  /** The row's painted box after those moves. */
  box: Box;
  /** The whole row's move that centres it. */
  shift: { x: number; y: number };
}

const union = (a: Box, b: Box): Box => ({ l: Math.min(a.l, b.l), t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) });

export function planRuneInspect(i: RuneInspectInput): RuneInspectPlan {
  const { body, rune, cards, tops, centre, gap } = i;
  let x = rune.r + gap;
  let box = rune;
  const off = cards.map((u, n) => {
    const o = { x: x - u.l, y: body.t - tops[n] };
    box = union(box, { l: u.l + o.x, t: u.t + o.y, r: u.r + o.x, b: u.b + o.y });
    x = u.r + o.x + gap;
    return o;
  });
  return { off, box, shift: { x: centre.x - (box.l + box.r) / 2, y: centre.y - (box.t + box.b) / 2 } };
}
