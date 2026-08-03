import { CARD_INDEX } from '@game/content';
import type { Alignment } from '@game/core';
import type { BoardCard } from './state';

/**
 * ── CELESTIAL ALIGNMENT (owner spec 2026-08-03) ────────────────────────────────────────────────────────
 *
 * The board splits around its CENTRE, not around fixed slot numbers: **Dawn** left, **Dusk** right, and the
 * exact middle body is **Eclipse** — which counts as BOTH sides, so an Eclipsed Celestial gets both halves
 * of its text.
 *
 * Because it is derived from the board's SIZE, the board re-centres itself as minions arrive and leave:
 *
 *   1 minion  → [eclipse]                       a lone minion is always Eclipsed
 *   2 minions → [dawn, dusk]                    EVEN boards have NO Eclipse — everything pairs off
 *   3 minions → [dawn, eclipse, dusk]
 *   4 minions → [dawn, dawn, dusk, dusk]
 *   5 minions → [dawn, dawn, eclipse, dusk, dusk]
 *   7 minions → [dawn ×3, eclipse, dusk ×3]     the full board — the owner's "left 3 / middle / right 3"
 *
 * So: odd counts have exactly one Eclipse, even counts have none. That is the rule the owner stated, and the
 * "left 3 / middle / right 3" description is its full-board case.
 *
 * Alignment is a RECRUIT-PHASE property. It moves freely while you rearrange, then LOCKS when combat starts
 * (the reducer stamps `BoardMinion.align` at combat setup). Combat deaths never re-centre the board — you
 * fight the alignment you built (owner ruling 2026-08-03).
 */

/** The alignment of the minion at `index` on a board of `count` minions. Pure arithmetic — no board needed. */
export function alignmentAt(count: number, index: number): Alignment {
  if (index < 0 || index >= count) return 'eclipse'; // out of range — degenerate, treated as the lone-minion case
  // `mid` is the board's centre in index space: a whole number on an ODD board (that index IS the Eclipse),
  // and a half-step on an EVEN one (so no index can equal it — hence no Eclipse, exactly as specified).
  const mid = (count - 1) / 2;
  if (index === mid) return 'eclipse';
  return index < mid ? 'dawn' : 'dusk';
}

/** Every minion's alignment on a board, in board order. */
export function alignmentsOf(board: readonly BoardCard[]): Alignment[] {
  return board.map((_, i) => alignmentAt(board.length, i));
}

/** The alignment of a specific board card, or undefined when it isn't on this board. */
export function alignmentOf(board: readonly BoardCard[], uid: string): Alignment | undefined {
  const i = board.findIndex((c) => c.uid === uid);
  return i < 0 ? undefined : alignmentAt(board.length, i);
}

/** Is any Celestial on the board? Drives the alignment HUD — the strip only appears once alignment can
 *  actually matter, so a board with no Celestials is visually unchanged. */
export function boardHasCelestial(board: readonly BoardCard[]): boolean {
  return board.some((c) => CARD_INDEX[c.cardId]?.celestial);
}
