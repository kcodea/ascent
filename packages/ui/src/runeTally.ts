import type { RunState } from '@game/sim';

/**
 * LIVE RUNE TALLIES (owner ask 2026-08-03: "make sure our runes/quests all have tally trackers like the
 * avenge tracker — this should always show x/10g so I know how far off I am from triggering its effect").
 *
 * A rune whose effect fires on a METER (spend 10 Gold, cast 3 spells, buy 5 cards…) is otherwise invisible:
 * the card states the threshold but nothing on screen says how close you are, so the payout reads as random.
 * This turns each of those into the same `4/10g` progress the Avenge counters already show on units.
 *
 * Quests are deliberately NOT covered here — their objective progress is already rendered on the pending
 * badge by `questProgressText`. This fills the gap on the RUNE side, plus the two recurring runes that keep
 * their own counter outside the shared `runeThresholds` list.
 */

/** The unit suffix each meter counts in, so `4/10g` reads as Gold and `2/3` as casts. */
const METER_SUFFIX: Record<string, string> = {
  gold: 'g',
  spellCast: '',
  spellCastNonAle: '',
  castRuby: '',
  cardsBought: '',
  shout: '',
};

/**
 * The live `x/N` tally for a rune, or null when it has no meter to show (most runes are passive or
 * one-shot). Pure — safe to call per render.
 */
export function runeTally(run: RunState, runeId: string): string | null {
  // Threshold runes (Gemspam, Spending, Action, …) — `sourceId` is stamped when the meter is armed.
  const t = run.runeThresholds?.find((x) => x.sourceId === runeId);
  if (t && t.per > 0) {
    // `oncePerTurn` runes that already paid out this turn read as full rather than as a fresh 0 — the meter
    // is banked, it just can't fire again until next turn.
    if (t.oncePerTurn && t.usedThisTurn) return `${t.per}/${t.per}${METER_SUFFIX[t.meter] ?? ''}`;
    return `${Math.min(t.tick, t.per)}/${t.per}${METER_SUFFIX[t.meter] ?? ''}`;
  }
  // Rune of Spellslinging keeps its own Gold meter rather than joining `runeThresholds`.
  if (runeId === 'rune_spellslinging' && run.spellDripPer) {
    return `${Math.min(run.spellDripTick ?? 0, run.spellDripPer)}/${run.spellDripPer}g`;
  }
  // Rune of the Summit counts SHOPS OPENED, and fires every second one.
  if (runeId === 'rune_summit' && run.runeSummitTick != null) {
    return `${run.runeSummitTick % 2}/2`;
  }
  return null;
}
