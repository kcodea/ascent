# Rune duplicate stacking — proposal for owner review

**Answers:** `q-policy-rune-duplicates` (Rulebook triage board), which the owner **REJECTED** on 2026-08-26 —
*"duplicates must always do SOMETHING — Claude proposes a stacking rule per rune family for review."*
**Status: PROPOSAL ONLY.** Nothing here is implemented; each family below is a click-sized decision.

## The problem, restated

The Runeforge can offer a rune you already own, and Rune of Duplication can copy any Epic — so a second copy
of ~80 runes is purchasable today and does nothing at all (Gold spent, zero state change; measured by Doc
Bot's `runeRewardDifferential` scan). The owner's ruling: a duplicate must never be a dead buy.

## Proposed rule per family

The families follow the reward kinds in `packages/content/src/runes.ts`; the counts are current as of
2026-08-26.

| Family (reward shape) | ~Count | Proposed duplicate behaviour |
| --- | --- | --- |
| **Amount-carrying `combatFlag`** (e.g. Warding's Armor value, Slaying's damage) | part of 84 | **Already stack** — the flag's amount accumulates (post-#900 contract, pinned by Doc Bot). No change. |
| **Boolean `combatFlag`** (an on/off combat behaviour — Forthcoming, Rallying) | part of 84 | **`flagCopies` becomes live**: the flag's effect fires once per copy where repetition is meaningful (a second Rallying = each Rally fires twice), and where it genuinely cannot repeat, fall back to the *universal sweetener* below. |
| **`grant` / one-shot `gainGold` / `multi` of one-shots** (cards or Gold, once, at forge time) | ~75 | **Re-grant** — the second copy simply grants again. These are already non-dead if re-fired; the fix is only to STOP suppressing the re-fire for owned runes. |
| **`runeThreshold`** (meter → periodic payoff) | 16 | **Meters run in parallel**: a second copy adds a second meter at the same `per`, effectively doubling the payoff rate. (Equivalently: halve the counter step. Same math, one line.) |
| **`recurringEndOfTurn` / `recurringGrant` / drip families** (`runeSpellDrip`, `runeTribeDrip`) | ~30 | **Stack the recurrence** — two copies = the end-of-turn effect fires twice / the drip doubles. Most of these already route through a list; duplicates append. |
| **Repeat runes** (`shoutRepeat`, `rallyRepeat`, `echoRepeat`, `runeSpellEcho`, `runeSpellDouble`) | ~11 | **+1 repetition per copy** (Shouts fire ×3 with two copies). The multiplier plumbing exists (`extraTriggerFires`); this is a count bump. |
| **`discover` / `scheduleRuneforge` and other one-time events** | ~5 | **Re-run the event** (a fresh Discover / another scheduled visit). A duplicated scheduled visit lands the following turn to avoid same-turn double modals. |
| **Unique engines** (`runeStructure`, `runeSummoning`, `runeContraband`, `runeHappyBirthday`, …) | ~15 | **Case-by-case, default = universal sweetener.** Some stack naturally (Consume's stats add); a few are genuinely idempotent. |

**Universal sweetener (the floor):** any duplicate that cannot meaningfully stack instead grants an immediate,
visible consolation — proposal: **Gold equal to half the rune's cost, rounded up, plus a free refresh**. This
guarantees the owner's invariant ("always does SOMETHING") even for the handful of true booleans, without
inventing 15 bespoke mechanics up front.

**Complementary guard (cheap, ship first):** filter runes whose duplicate would only pay the sweetener out of
forge offers when already owned — the sweetener then only ever backstops Rune of Duplication, which the player
aims deliberately.

## Suggested sequencing

1. **PR 1 (no design risk):** forge filter + the universal sweetener. Kills every dead buy immediately.
2. **PR 2:** threshold + recurrence + repeat stacking (mechanical, family-wide, testable by Doc Bot's
   duplicate lane).
3. **PR 3 (owner taste):** the unique-engine list, one ruling per rune on the triage board.

Doc Bot enforcement once ruled: the `runeRewardDifferential` scan flips from "excused: duplicate inert" to a
hard alarm — a duplicate that changes nothing becomes a red test.
