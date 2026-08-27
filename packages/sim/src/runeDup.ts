/**
 * RUNE DUPLICATE STACKING — the owner's 2026-08-27 rulings (decisions q-runedup-*), one module.
 *
 * Every rune duplicate must DO something (owner 2026-08-26: "duplicates do nothing" REJECTED). The families:
 *  · recurring / per-event runes  — a second copy makes the effect fire once more each time it recurs.
 *  · threshold / meter runes      — same meter, DOUBLED payoff per trip (owner revise: "2 rune of the
 *                                   returning pack, every 6 beast summons you'd get 2 random beasts").
 *  · repeat runes                 — +1 repetition per copy.
 *  · one-shot grants              — the reward simply fires again (banked to next turn when immediate value
 *                                   is impossible — full hand, empty board).
 *  · boolean combat flags         — fire once per copy where repetition is meaningful (`flagCopies`).
 *  · everything that CANNOT stack — the universal sweetener: Gold = half the rune's cost rounded up, plus a
 *                                   free refresh (`RUNE_DUP_SWEETENER`).
 *  · genuinely unique runes       — a duplicate does nothing at all, and the forge never offers them again
 *                                   (`RUNE_DUP_UNIQUE`; owner: "rune of the ornate clock should do nothing
 *                                   if duplicated, that one is unique").
 *
 * MECHANISM: rune ownership is COUNTED. `RunState.runeStacks[runeId]` ticks on every reward application
 * (buy, Rune of Duplication's copy, a granted rune), and consumers read `runeStacksOf` to scale their
 * output. Combat-side boolean flags keep using `flagCopies` (the pre-existing per-copy channel the rune
 * Avenge dispatchers already consume). Single-copy runs are byte-identical: every consumer multiplies by a
 * count that is 1 unless a duplicate was actually applied, so existing replays and saves do not move.
 */
import { RUNE_DUP_SWEETENER, RUNE_DUP_UNIQUE } from '@game/content';
import type { RunState } from './state';

/** How many applied copies of `runeId` this run holds. 1 for a single copy AND for legacy saves from before
 *  the counter existed (they can only have reached >1 copies through paths that were no-ops then). Only
 *  meaningful once the rune's own arming field says it is owned — this does not check ownership. */
export function runeStacksOf(s: Pick<RunState, 'runeStacks'>, runeId: string): number {
  return Math.max(1, s.runeStacks?.[runeId] ?? 1);
}

/**
 * Duplicates that pay the SWEETENER instead of stacking (owner approve, family 6/8): runes whose effect is
 * genuinely idempotent — a rules change that is already fully on, or a keyword grant that cannot deepen.
 * The SET lives in `@game/content` (`runes.ts`), beside `runeStacks` (the forge pill), so the pill, the
 * sweetener and the forge filter can never disagree. Per-rune reasons:
 *   · rune_twin_gilding    — "Gild at 2 copies" is already at 2; a copy cannot lower it again
 *   · rune_spellstone      — "Rubies count as Shop spells" is a category membership, already fully on
 *   · rune_trophy          — owner family-5 text: copying the first kill cannot meaningfully repeat
 *   · rune_engraving_gems  — "permanent" is already permanent (owner family-5 text)
 *   · rune_centerline      — grants Ward + Critical Strike: keyword grants, idempotent on the one target
 *   · rune_vanguard        — Critical Strike + Ward on the three left-most: the same idempotent keywords
 *   · rune_living_treasure — grants one Echo to Gemheart Golems; a minion cannot hold the same Echo twice
 *   · rune_chef            — grants Chef Gary his Rally: a single idempotent keyword grant
 *   · rune_ancestral_roar  — grants Shout-Dragons one Echo: idempotent keyword grant
 *   · rune_moonhowl        — grants Mage-Pups one Echo: idempotent keyword grant
 * RUNE_DUP_UNIQUE is the owner-ruled "does nothing at all" set (Ornate Clock).
 */
export { RUNE_DUP_SWEETENER, RUNE_DUP_UNIQUE };

/** The forge filter (owner approve, family 7/8): stop OFFERING a rune the player already owns when its
 *  duplicate would only pay the sweetener (or nothing). Stacking runes stay offerable — a second Flagship
 *  is a real purchase. Rune of Duplication still reaches everything, aimed deliberately. */
export function forgeFilteredDuplicate(s: RunState, runeId: string): boolean {
  if (!(RUNE_DUP_SWEETENER.has(runeId) || RUNE_DUP_UNIQUE.has(runeId))) return false;
  return (s.ownedRunes ?? []).includes(runeId);
}
