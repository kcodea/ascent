import type { CardDef } from '@game/core';

/**
 * ── SET 3 — THE CELESTIALS (owner roster 2026-08-05) ────────────────────────────────────────────────────
 *
 * A real tribe now (`tribe: 'celestial'`), replacing the seven test units that proved the mechanics on
 * 2026-08-03 — those moved to the MINION ARCHIVE rather than being deleted, so any saved run or captured
 * board still resolves them.
 *
 * Two mechanics carry the whole tribe:
 *
 *  • **ALIGNMENT** — the board splits around its centre: **Dawn** left, **Dusk** right, **Eclipse** the exact
 *    middle body, which counts as BOTH. Derived from board SIZE, so it re-centres as minions come and go (a
 *    lone minion is Eclipsed; an EVEN board has no Eclipse). It moves freely in the shop and LOCKS at combat.
 *    The `align` field on an EFFECT is the entire mechanism: `align: 'dawn'` fires for a Dawn *or Eclipse*
 *    body, `align: 'dusk'` for Dusk *or Eclipse*. Eclipse getting both halves falls out of that rule — which
 *    is why a two-halves card is simply two effect entries, and why none of these needs a special case.
 *
 *  • **ORBIT** — fires when a card is PLAYED FROM HAND into a slot adjacent to this minion. Written
 *    **Orbit (N)** when it pays out only every Nth arrival (`params.every`, a per-instance tick — the same
 *    cadence shape as Avenge (N)). A separate `orbitFired` trigger is the BOARD-WIDE watcher, "whenever an
 *    Orbit triggers" anywhere, with `params.others` excluding your own.
 *
 * Positioning is therefore the tribe's real cost: alignment is decided by where a body sits, and an Orbit
 * only pays the two neighbours of the slot you drop into.
 */
export const SET3_CELESTIALS: readonly CardDef[] = [
  // EMPTY — the sixteen that lived here were archived on 2026-08-28: "celestials have been extremely and
  // completely re-worked ... leaving set 3 empty of minions now" (owner). They are in `cards/archive.ts`,
  // resolvable by id so old runs and replays still load, and in no set pool so they are unreachable in play.
  //
  // The reworked tribe lands here. Everything the mechanics need is still in place — the `celestial` flag and
  // tribe, `align` gating, the `orbit` / `orbitFired` triggers and their factories — so a new roster is card
  // DATA, as it should be. Note both classes are currently PARKED in `@game/rules/parked`, which keeps them
  // out of the rules deck while the design is open; un-parking is one edit there.
];
