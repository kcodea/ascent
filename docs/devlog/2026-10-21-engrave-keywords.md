# 2026-10-21 — Engraved keeps the keywords it gains in combat (R-ENGRAVE-03)

Owner ruling: "change the engrave mechanic to also include keywords gained in combat ... if a risen minion gains
something like ward or stats, that is technically a new copy ... This does not include the spells that grant a next
combat only keyword." Confirmations the same day: "1. Yes carries back 2. Correct 3. Yes 4. Yes" (gained-then-lost
carries; losing an own keyword changes nothing; the Shop card shows it with a recap beat; a Gild keeps it).

## Mechanism

- `packages/core/src/combat/simulate.ts`: a per-side baseline `engraveKwStart` (run-board uid -> keywords) is taken
  right after the starting boards are built and the run-wide auras folded in, before any Start of Combat effect. So
  every Shop-granted one-combat keyword (banked Field Maneuvers / Last Stand / Executioner's Edge, Marked Target, a
  Maw of the Pit `tempShield`, a Lord of the Risen `tempReborn`, a Whisper keyword) is already in the baseline and
  can never read as a combat gain.
- `scanEngravedKeywords` runs on every `emit` (only when the fight has run-board bodies). For each body with a
  `sourceUid` that has not Risen (`riseCarry`), any keyword in `ENGRAVE_KEEPS_KEYWORDS` that is not in its baseline is
  recorded if the body is Engraved at that moment (`EG`, or Transcendant's live adjacency, now one shared
  `transcendantBeside` helper). One seen while NOT Engraved joins the baseline. Records are never removed, so a Ward
  gained and then broken still carries. A final scan runs in `carryBacksFor`.
- `carryBacksFor` reports `permaKeywords` (both sides; `playerPermaKeywords` on the result, `enemyCarry.permaKeywords`
  for the other seat, mapped by `versus/mirror.ts`). `reducer.ts` settle adds each to the run card (deduped; a
  Resilient Ward brings its Ward). Golden merges already union keywords.
- UI: the fight recap gets a "+Ward" item per minion, and the post-combat summary line reads "Engraved: +Ward".

## Decisions to flag

- Engraved itself (`EG`) is not kept, so Taurus's one-fight Engrave stays one fight. The trigger labels (RL, SL, SC,
  CN, FD, M) are not kept either: their grafted effect never comes home, so a pill alone would be a lie.
- Rebirth is treated as the same body, like the existing stat rule (R-RISE-06 says "A Rebirth is NOT a fresh copy").
  Only a Rise return is a fresh copy.
- A body that opened the fight with a one-combat keyword (e.g. a Maw of the Pit Ward) and regains that keyword in
  combat keeps nothing: it "already had" it. Rare; flagged rather than special-cased.

## Verification

`engravedKeepsKeywords.test.ts` (core: SoC grant, non-Engraved contrast, gained-then-lost, already-had, banked
next-combat keyword, risen copy, gain before a Rise, summon without a run card, enemy symmetry, determinism),
`engraveKeywords1021.test.ts` (sim: Shop card pill, no duplicate, Resilient Ward, Gild, Versus mirror),
`fightRecapData.test.ts` (recap chip). The core tests were checked to fail with the scan or the Rise exclusion removed.
