/**
 * WHISPER DISSIPATE (owner 2026-10-14: "whispers need to coalesce/dissipate when unused at end of turn and not just
 * immediately go away").
 *
 * An unused Whisper vanishes at End of Turn (`vanishWhispers` in the sim). The hand now plays that vanish: each
 * Whisper drifts up a little and fades (transform + opacity, `.whisperdissipate` in styles.css) while its plate breaks
 * into wisps in the Whisper palette (`playPlateDissolve` with `WHISPER_DISSIPATE_FX`, the mirror of the
 * `playPlateCoalesce` arrival the next turn's re-grant plays, so the two read as a pair). Several Whispers stagger by
 * ~80 ms and the whole thing stays under ~600 ms. Then the hand closes the gap with the normal `--hand-glide` reflow.
 *
 * It never delays End of Turn: it starts on the End Turn action and runs IN PARALLEL with the End-of-Turn beats and the
 * combat transition. The Whisper is held in the hand row as a GHOST (its last view, at its last slot) after the
 * commit removes it from `run.hand`, until its own fade ends, and is then dropped from the row.
 *
 * This module is the pure part (the plan and the row merge), so the timing and ordering are testable without a DOM.
 */

/** Per-card fade, ms (drift + fade; the dust outlives it slightly). */
export const WHISPER_DISSIPATE_MS = 420;
/** Stagger between consecutive Whispers, ms. */
export const WHISPER_DISSIPATE_STAGGER_MS = 80;
/** The whole dissipate (first start to last end) never runs longer than this, ms. */
export const WHISPER_DISSIPATE_CAP_MS = 600;

/** The plate's wisps (`playPlateDissolve` overrides): the Whisper colours (blue-violet into cyan, matching the plate,
 *  arch and medallion), and a LIGHTER load than a minion play's dissolve (fewer motes, a tighter bloom) because two or
 *  three Whispers can leave in the same half second, on top of the End-of-Turn beats. */
export const WHISPER_DISSIPATE_FX = {
  cDeep: '#7a5cff', cMid: '#7fd8ff', cCore: '#e4f6ff',
  count: 150, g1: 24, g2: 70, lift: -60,
} as const;

export interface WhisperFadeItem {
  uid: string;
  /** The card's slot in the hand row when the fade began (where its ghost is held after the commit). */
  index: number;
  /** When its fade starts, ms after the End Turn action. */
  delayMs: number;
}

/**
 * Which hand cards dissipate and when: every Whisper in hand order, staggered. The stagger shrinks when there are
 * many, so the last one still ENDS inside the cap.
 */
export function planWhisperDissipate(hand: readonly { uid: string; cardId: string }[], isWhisper: (cardId: string) => boolean): WhisperFadeItem[] {
  const picks = hand.map((c, index) => ({ c, index })).filter(({ c }) => isWhisper(c.cardId));
  const n = picks.length;
  const room = Math.max(0, WHISPER_DISSIPATE_CAP_MS - WHISPER_DISSIPATE_MS);
  const stagger = n > 1 ? Math.min(WHISPER_DISSIPATE_STAGGER_MS, room / (n - 1)) : 0;
  return picks.map(({ c, index }, k) => ({ uid: c.uid, index, delayMs: Math.round(k * stagger) }));
}

/** First start to last end, ms (0 when nothing dissipates). */
export function whisperDissipateTotalMs(items: readonly WhisperFadeItem[]): number {
  return items.length ? Math.max(...items.map((i) => i.delayMs)) + WHISPER_DISSIPATE_MS : 0;
}

/**
 * The hand ROW while a dissipate runs: the real cards, minus every Whisper whose fade has ENDED (it must not
 * reappear while the End-of-Turn beats still show the pre-commit hand), plus every still-fading Whisper the commit
 * already removed, held as a ghost at its original slot so the row does not close the gap under it mid-fade.
 * Returns the input array itself when there is nothing to change (the memoized row keeps bailing out).
 */
export function mergeWhisperFade<T extends { uid: string }>(
  row: readonly T[],
  items: readonly WhisperFadeItem[],
  ghosts: ReadonlyMap<string, T>,
  ended: ReadonlySet<string>,
): readonly T[] {
  if (!items.length) return row;
  const present = new Set(row.map((c) => c.uid));
  const missing = items.filter((i) => !ended.has(i.uid) && !present.has(i.uid) && ghosts.has(i.uid));
  const dropsEnded = row.some((c) => ended.has(c.uid));
  if (!missing.length && !dropsEnded) return row;
  const out: T[] = row.filter((c) => !ended.has(c.uid));
  // A ghost's slot counts the hand as it was, so an EARLIER Whisper that has already left shifts it left by one.
  const slot = (i: WhisperFadeItem): number => i.index - items.filter((e) => ended.has(e.uid) && e.index < i.index).length;
  for (const i of [...missing].sort((a, b) => a.index - b.index)) out.splice(Math.min(slot(i), out.length), 0, ghosts.get(i.uid)!);
  return out;
}
