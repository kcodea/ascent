# 2026-09-16 — Set 3 batch 2, tranche D: the two owed runes, Rebirth ≡ Rise, Soul Script Collapse, the Festival's one-time +2/+2

**Branch:** `feat/set3-runes-d` → base `feat/set3-runes-batch2`. Four owner rulings (2026-09-16), in order.

## 1. The two runes tranche A deferred (combat-side hand-summon hooks)

Both Epic, `sets: ['set3']`, at the end of `EPIC_RUNES` under a tranche-D header; set 3's originals move from
21/28 to **21 Basic / 30 Epic**. Neither is tribe-gated — the owner's sheet files them under Spirits, but the
codified rule (2026-09-10, `tribeGate.test.ts`) gates only where the TEXT names a tribe on the board, and neither
text does (the Dreamed Graves precedent). **Flagged for the owner.**

- **Rune of the Open Hand** (5) — "When you summon a minion from your hand, give its stats to another friendly
  minion." Combat: read at the same `pendingHandSummon` moment as Dreamed Graves, inside `placeSummon`, so
  EVERY landed hand-summon pays (the Spirit copies, the consumed hand-summon Echo, the Waking Reserve's copy);
  the receiver is a random OTHER living friendly; the gift is the summoned body's CURRENT Attack/Health; one
  gift per copy held; no other living friendly → nothing. Shop: `fireOpenHandShop` off the two shop hand-summon
  sites (`summonCopyFromHandShop`, the shop `deathrattleSummonRandomHandMinion`) — permanent, as every shop
  grant is. Flag `runeOpenHand` (schema + `QuestCombatFlag` + `QuestCombatMods` + `questFlags` + the mods pass).
- **Rune of the Waking Reserve** (6) — "Start of Combat: summon a copy of your highest-stat minion in hand when
  you have room. This does not mark that hand card as summoned." Combat: at the SoC rune site beside the Mirror
  March; highest Attack + Health (ties → the left-most hand card); `occupied(side) < 7`, re-checked per copy
  held; the copy takes the hand card's current stats, keywords and gilding through the Mirror March `copyStats`
  path, so it is a summon in full (Undertow / Packcraft / Hatchery apply). **Interpretation:** it IS a hand-summon
  for the other hand-summon runes (`pendingHandSummon` set, so Dreamed Graves may mark the copy and the Open Hand
  pays on it) but the card is NOT marked — neither `handCopiedUids` nor `fromHandUid` — so a Spirit may still
  summon the same card later that fight and the replay does not grey it. Locked and spell cards are skipped. A
  served enemy hand works the same. Shop twin: a `socRuneReplaysOf` entry (Combat Prowess / Lasting Cadence).

## 2. Rebirth acts like Rise (owner: "it acts like rise, so copy that")

Tranche C's ordering already matched the Rise branch step for step — death (rise-flagged) → slot reservation →
tally → own Echo → on-death watchers → kill credit → Avenge → overflow check → return → re-slot → `reborn` →
summon-entry — and its Rebirth-before-Rise precedence stands (Rise has no precedence rule of its own; the
stronger return goes first). Two Rise rules the branch had NOT copied were found by a new **Rise-vs-Rebirth
parity fixture** (`rebirth.test.ts`: a printed-body Avenge probe whose flow of deaths / returns / Avenge payouts
must be identical under `R` and `RB`) and added:

- **Avenge progress restarts** on the return (`avengeBaseline` re-stamped after its own death is tallied — Rise's
  "1/3 should reset to 0/3", and what `placeSummon` stamps on any placed body). A side-level deaths tally is not
  part of the "full body" the owner listed (stats, granted buffs, keywords, effects).
- **A body that dies to retaliation on its own swing and returns is next to attack again** — the main loop's Rise
  rewind now covers a Rebirth return (`RB` on the body before the swing, gone after, body standing).

Unchanged and Rise-only by design: `onRise` (the Rise watchers) and the Deathtouched Apple re-arm. The shop twin
(`rebirthReturn`) needed nothing: it already mirrors `riseReturn`'s cap, slot and overflow rules.

## 3. Soul Script → consume + Collapse

- **Consume:** the shared Shop-consume chokepoint (`consumeShopOffer`) already takes ANY eater, and the generic
  random-Shop-minion draws (`battlecryConsumeShopRandom`) already include the token — so "Undead can consume it"
  needed no engine change; it is re-pinned through a NON-Demon (Undead probe) random consume on top of tranche
  C's direct-chokepoint pin. There is still no tribe-restricted consume in the codebase to widen; the only
  Starform-excluding pickers are the token's OWN draws (`pickRandomShopMinion` / `pickShopMinionFor`, a token
  cannot eat itself).
- **Collapse:** `collapseHits` draws from `isTribe(c, 'celestial') || (runeSoulScript && isTribe(c, 'undead'))` —
  originals, extras and the Supernova's "all your Celestials" alike. Generic predicate, so an added-tribe Undead
  counts too.

## 4. Rune of the Traveling Festival — the +2/+2 is one time

`revelerSell` already added the extra ONCE per Reveler trigger (not per gilding: a gilded Reveler pays 2× the
value + the extra once; not across triggers: the shared value climbs, the extra does not). The reducer's
`runeRevelerExtra` case ACCUMULATED per copy held (two copies → +4/+4); it now assigns (`Math.max`), so a
duplicate pays its Reveler drip again but never raises the extra. Pinned in `set3RunesTrancheD.test.ts`.

## Verification

`core/src/combat/set3RunesTrancheD.test.ts` (16: both runes end to end, both sides, copies, room, locks, ties,
the unmarked card, Dreamed Graves / Open Hand interplay, determinism), `sim/src/set3RunesTrancheD.test.ts` (14:
roster / wiring, the shop halves, the SoC replay, Soul Script consume + Collapse + Supernova + a Solburn end to
end, the Festival), `rebirth.test.ts` +3 (the parity fixture, the Avenge restart, the attack-again rewind — each
verified to fail without its fix). Pins moved deliberately: tranche A's "absent" assertion flipped, the roster
21/28 → 21/30. Full gates: typecheck, lint, test, audit, contracts:extract, docbot:report --check, build:web (see
the PR).
