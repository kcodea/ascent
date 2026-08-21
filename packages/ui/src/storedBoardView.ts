import { CARD_INDEX } from '@game/content';
import type { BoardMinion } from '@game/core';
import type { CardView } from './Card';

/**
 * Render a card from a STORED board snapshot (Career / Leaderboard history).
 *
 * The one rule that governs this file: **a stored board is read back by a build that may not be the build that
 * wrote it.** Career and Leaderboard history are fetched from the SERVER, and two devs on divergent content
 * branches share one database — so a row can name a card the reader has never heard of, and a packaged build
 * lags the branch that played the run. Anything the reader would otherwise resolve out of its own `CARD_INDEX`
 * therefore has to travel WITH the row, and the row wins when both exist.
 *
 * That is the bug this file was extracted to fix (owner report 2026-08-20: boards showing `d2_transcendence`,
 * tribe NEUTRAL, placeholder art). `text`/`goldenText` were already baked into the snapshot; `name`/`tribe`
 * were not, so the reader fell through to `def?.name ?? m.cardId` and printed an internal id at the player.
 * Correct rule text under a wrong name was the fingerprint that identified it.
 *
 * Extracted because Career.tsx and Leaderboard.tsx carried BYTE-IDENTICAL copies of this resolver, which is how
 * one bug came to exist in two places. One definition now; both screens import it.
 *
 * What this CANNOT fix: art. `artFor` is keyed by card id against locally-bundled assets, so a card the reader
 * does not ship still renders the placeholder illustration. That is honest — the build genuinely does not have
 * the picture — and is why an unresolvable card is labelled rather than left showing its id.
 */

/** Shown when a stored card resolves to nothing at all — no local def AND no baked identity (a row written
 *  before the bake shipped, by a build we do not have). Better than leaking a raw card id into the UI. */
export const UNKNOWN_CARD_NAME = 'Unknown Card';

/** True when this build cannot identify the stored card — the caller may want to mark it in the UI. */
export function isUnknownStoredCard(m: BoardMinion): boolean {
  return !CARD_INDEX[m.cardId] && !m.name;
}

/**
 * Read-only `CardView` for a snapshot minion. Resolution order for every display field is the same:
 * **live def → value baked into the snapshot → a safe placeholder.** The def is preferred so a card this build
 * DOES have picks up renames and re-tribes; the bake is the fallback for cards it does not.
 */
export function storedCardView(m: BoardMinion): CardView {
  const def = CARD_INDEX[m.cardId];
  const tribe = def?.tribe ?? m.tribe ?? 'neutral';
  return {
    name: def?.name ?? m.name ?? UNKNOWN_CARD_NAME,
    cardId: m.cardId,
    tribe,
    // Anomaly Reactor: show the spell-added tribe badge.
    tribe2: def?.tribe2 ?? m.addedTribes?.find((t) => t !== tribe),
    attack: m.attack,
    health: m.health,
    keywords: m.keywords ?? [],
    // The LIVE end-of-run text baked at capture (a maxed Sergeant's real grant, etc.) beats the printed base.
    text: m.text ?? def?.text ?? '',
    goldenText: m.goldenText ?? def?.goldenText,
    golden: m.golden,
    tier: def?.tier ?? 1,
    // Base stats drive the "buffed above base" colouring. With no def the stored stats ARE the base, so the
    // card reads as unbuffed rather than claiming a growth it cannot substantiate.
    baseAttack: def?.attack ?? m.attack,
    baseHealth: def?.health ?? m.health,
    // Per-source buff breakdown (captured in the snapshot) → the right-click inspect panel. Older snapshots
    // carry none, so the panel simply does not appear for them.
    buffs: m.buffs,
  };
}
