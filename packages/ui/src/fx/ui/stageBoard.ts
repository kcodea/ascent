import type { CardDef } from '@game/core';

/**
 * The FX workbench's own 3v3 board — the DATA half, kept pure so it can be unit-tested.
 *
 * The workbench used to author effects over WHATEVER THE GAME HAPPENED TO BE SHOWING. That is fine for
 * judging a burst in isolation and useless for everything else: a shop screen has no enemy row at all, a
 * mid-run board has however many units you happen to own, and neither is stable between sessions — so the
 * one thing an authoring tool must be able to do, show the same effect on the same layout twice, it could
 * not. Worse, it made whole CLASSES of effect unjudgeable. A watcher, a rally, an area buff, a hit landing
 * on someone else's unit are all about the RELATIONSHIP between several units on two sides; with one row on
 * screen there is nothing for them to relate to.
 *
 * So the workbench stages its own board: three units a side, always, using the real `Unit` component and the
 * real `[data-zone]`/`.row`/`[data-uid]` DOM contract that `boardAnchors.ts` and `reactTargets.ts` read.
 * Nothing here mimics the game's markup — it IS the game's markup, which is the only way a preview can be
 * trusted to predict a real fire.
 *
 * Six units is the smallest board that can express every reach the `react` primitive offers: `self` needs
 * one, `neighbours` needs a unit with a unit on EACH side (hence three, not two), `allies` needs a row, and
 * an effect crossing sides needs the far row to exist.
 */

/** Units per side. Three is the minimum that gives the middle slot two neighbours — see the header. */
export const FX_STAGE_SLOTS = 3;

export type FxStageSide = 'you' | 'foe';

export interface FxStageUnit {
  /** Stable across renders and across sessions, so a def saved with a subject still points at that slot. */
  uid: string;
  cardId: string;
}

export interface FxStageBoard {
  you: FxStageUnit[];
  foe: FxStageUnit[];
}

/** The uid a stage slot always has. Deliberately NOT a random/incrementing id: the workbench persists which
 *  unit a react layer previews on, and a uid that changed per mount would silently drop that pick every
 *  reload. The `fxs-` prefix keeps it from ever colliding with a real run's uids. */
export function stageUid(side: FxStageSide, index: number): string {
  return `fxs-${side}-${index}`;
}

/**
 * Six cards for an opening board, chosen for VISUAL variety rather than for power: the point of the stage is
 * that an author can see what an effect does to a taunt's wide frame, to a shielded unit, and to a plain one
 * without going and building a board first.
 *
 * Picks are made from the pool the caller passes (the live buyable set) and are DETERMINISTIC — sorted by
 * tier then id before anything is taken — so the same build always stages the same six. A pool too small to
 * fill six slots is not an error: the board simply repeats what it has, because a stage with four units is
 * still a better preview than an empty one.
 */
export function defaultStageBoard(pool: readonly CardDef[]): FxStageBoard {
  const sorted = [...pool].sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));
  const taken = new Set<string>();
  const take = (pred: (c: CardDef) => boolean): CardDef | undefined => {
    const hit = sorted.find((c) => !taken.has(c.id) && pred(c));
    if (hit !== undefined) taken.add(hit.id);
    return hit;
  };
  // Preference order, then anything: a taunt (the widest frame), a shielded unit (a dome to break), a plain
  // one, and three more of whatever is left.
  const wanted: ((c: CardDef) => boolean)[] = [
    (c) => c.keywords.includes('T'),
    (c) => c.keywords.includes('DS'),
    (c) => c.keywords.length === 0,
    (c) => c.keywords.includes('T'),
    (c) => c.keywords.includes('DS'),
    (c) => c.keywords.length === 0,
  ];
  const picks: CardDef[] = [];
  for (const pred of wanted) {
    const c = take(pred) ?? take(() => true);
    if (c !== undefined) picks.push(c);
  }
  // Nothing at all in the pool → no stage rather than a board of undefined cards. Callers render nothing.
  if (picks.length === 0) return { you: [], foe: [] };
  const at = (i: number): string => picks[i % picks.length].id;
  return {
    // The two sides are drawn from the SAME six picks but offset, so the rows don't read as mirror images
    // of each other while still guaranteeing a full board from a pool of any size.
    you: Array.from({ length: FX_STAGE_SLOTS }, (_, i) => ({ uid: stageUid('you', i), cardId: at(i) })),
    foe: Array.from({ length: FX_STAGE_SLOTS }, (_, i) => ({ uid: stageUid('foe', i), cardId: at(i + FX_STAGE_SLOTS) })),
  };
}

/** Swap the card in one slot, leaving its uid (and therefore any preview pick pointed at it) alone. */
export function setStageCard(
  board: FxStageBoard,
  side: FxStageSide,
  index: number,
  cardId: string,
): FxStageBoard {
  const next = board[side].map((u, i) => (i === index ? { ...u, cardId } : u));
  return side === 'you' ? { ...board, you: next } : { ...board, foe: next };
}

/** Every stage unit as (uid, label) for the "React on" picker, enemies first — the same top-to-bottom
 *  reading order they appear in on screen. `nameOf` keeps this file free of the content index. */
export function stageUnitOptions(
  board: FxStageBoard,
  nameOf: (cardId: string) => string,
): { uid: string; label: string }[] {
  return [
    ...board.foe.map((u, i) => ({ uid: u.uid, label: `Enemy ${i + 1} — ${nameOf(u.cardId)}` })),
    ...board.you.map((u, i) => ({ uid: u.uid, label: `Yours ${i + 1} — ${nameOf(u.cardId)}` })),
  ];
}
