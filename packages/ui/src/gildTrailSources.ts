/**
 * GILD TRAIL — the pure half: where each trail starts, and when the last one lands.
 *
 * The gild (three copies becoming one gilded card) throws a golden trail from EVERY consumed copy's slot into
 * the new card (owner redesign 2026-09-24, replacing the centre-screen fuse of `plateGild`). The hard part is
 * WHERE the copies were: the sim consumes them inside the commit that tells the UI a triple happened, so by
 * the time anything can react they are already off the screen. Hence a snapshot taken on the previous commit
 * (`snapshotGildCandidates`) and resolved here (`resolveGildSources`).
 *
 * Kept free of the DOM and of Pixi so every rule below is unit-tested; `gildTrail.ts` is the side-effect half.
 */

export interface Pt { x: number; y: number }

/** One card's last on-screen centre, plus what it was — a triple is matched by `cardId`. */
export interface GildSnap { cardId: string; x: number; y: number }

/**
 * The centre of each consumed copy, in layout order, ALWAYS exactly `need` points long.
 *
 * Three sources, in this order:
 *   1. copies that were on screen last commit and are gone now (hand and board);
 *   2. the bought copy, when a buy completed the triple — it was minted AND consumed in one commit, so it never
 *      reached `prev`, but the release point of the drag is exactly where the player last saw it;
 *   3. for anything still missing (a copy conjured and consumed in one commit by some other path), points
 *      spread around `fallback` so no two trails start on top of each other.
 *
 * `present` is every uid still on the hand or board: a copy still there was not part of the triple (a fourth
 * copy), and a bought card still there was not consumed.
 */
export function resolveGildSources(a: {
  prev: ReadonlyMap<string, GildSnap>;
  present: ReadonlySet<string>;
  cardId: string;
  need: number;
  bought?: { uid: string; at: Pt } | null;
  fallback: Pt;
  /** Horizontal gap between padded fallback points, px. */
  spread?: number;
}): Pt[] {
  const need = Math.max(0, Math.floor(a.need));
  const out: Pt[] = [];
  for (const [uid, s] of a.prev) {
    if (s.cardId === a.cardId && !a.present.has(uid)) out.push({ x: s.x, y: s.y });
  }
  if (a.bought && !a.present.has(a.bought.uid)) out.push({ ...a.bought.at });
  if (out.length >= need) return out.slice(0, need);
  const pad = need - out.length;
  const spread = a.spread ?? 140;
  for (let i = 0; i < pad; i++) {
    out.push({ x: a.fallback.x + (i - (pad - 1) / 2) * spread, y: a.fallback.y });
  }
  return out;
}

/** The shape of a def this module reads — structural, so it needs no runtime import of the FX engine. */
interface TimedLayer { anchor: string; at: number; travelMs?: number; stagger?: number }

/**
 * When, from the first play, the LAST copy's trail reaches the gilded card — which is when the card is shown.
 *
 * Read off the def rather than hard-coded so it follows whatever the owner tunes in the workbench: the landing
 * (`target`-anchored) layer's `at` if the def has one, else the end of the `travel`, each shifted by its
 * per-copy `stagger` for the last copy. A def with neither reveals at once.
 */
export function gildArrivalMs(def: { layers: readonly TimedLayer[] } | undefined, lastIndex: number): number {
  if (!def) return 0;
  const i = Math.max(0, lastIndex);
  const shifted = (l: TimedLayer, t: number): number => t + (l.stagger ?? 0) * i;
  const landings = def.layers.filter((l) => l.anchor === 'target');
  if (landings.length) return Math.max(...landings.map((l) => shifted(l, l.at)));
  const travels = def.layers.filter((l) => l.anchor === 'travel');
  if (travels.length) return Math.max(...travels.map((l) => shifted(l, l.at + (l.travelMs ?? 0))));
  return 0;
}

/**
 * The centres worth remembering this commit, keyed by uid.
 *
 * Only cards that could be part of the NEXT triple: a `cardId` already held `need - 1` times (not counting
 * golden copies, which cannot triple again). For a normal three-copy gild that is only your pairs, so this is
 * usually zero to four rect reads per render rather than the whole hand and board.
 */
export function snapshotGildCandidates(
  cards: readonly { uid: string; cardId: string; golden?: boolean }[],
  need: number,
  measure: (uid: string) => Pt | null,
): Map<string, GildSnap> {
  const held = new Map<string, number>();
  for (const c of cards) if (!c.golden) held.set(c.cardId, (held.get(c.cardId) ?? 0) + 1);
  const out = new Map<string, GildSnap>();
  for (const c of cards) {
    if (c.golden || (held.get(c.cardId) ?? 0) < need - 1) continue;
    const p = measure(c.uid);
    if (p) out.set(c.uid, { cardId: c.cardId, x: p.x, y: p.y });
  }
  return out;
}
