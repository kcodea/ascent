# 2026-09-25: Set 3 runes take the tribe and rarity of the owner's list

Follow-up to `2026-09-25-set3-rune-list.md` (#1719), which set Set 3 membership to the owner's 163-rune list but left
tribe gates and rarity alone and reported the mismatches. Owner, verbatim: "see here in this list how spearline and
waking dreams are not "neutral" tagged and are tagged to tribes? can you make sure we're aligned on tribe orientation
of set 3 runes".

## Rulings applied (owner 2026-09-25)

| Rune | id | Before | After |
|---|---|---|---|
| Rune of the Seller's Market | `rune_sellers_market` | untribed, Epic | **Dwarf**, Epic |
| Rune of the Spearline | `rune_spearline` | untribed, Epic | **Undead**, Epic |
| Rune of the Dream Mirror | `rune_dream_mirror` | untribed, Epic | **Spirit**, Epic |
| Rune of the Open Hand | `rune_open_hand` | untribed, Epic | **Spirit**, Epic |
| Rune of the Waking Reserve | `rune_waking_reserve` | untribed, Epic | **Spirit**, Epic |
| Rune of Waking Dreams | `rune_waking_dreams` | untribed, Epic | **Spirit**, Epic |
| Rune of Lazarus | `rune_lazarus` | Undead, Epic | **untribed (Neutral)**, Epic |
| Rune of Soul Script | `rune_soul_script` | Undead + Celestial, Basic | unchanged (owner: keep both) |
| Rune of Engraving Gems | `rune_engraving_gems` | Kobold, **Epic** | Kobold, **Basic** |

A tribe gate applies in every set: Seller's Market (unscoped) now never appears in Set 1, which fields no Dwarves;
Lazarus (Sets 2 + 3) now appears in Set 2, which fields no Undead.

**Engraving Gems to Basic.** Rarity is array membership, so the def moved from `EPIC_RUNES` into `RUNES` (next to the
other Kobold Ruby Basics) and dropped its `epic: true` kicker. Cost stays **2 Gold**: Basic runes cost 1 to 6 (most
3 or 4), so 2 is inside the range, and the duplicate sweetener (half the cost, rounded up) does not read rarity. Its
text, tribe gate, sets and combat flag are unchanged. It is now offered at Basic forges and never at Epic ones.

## Audit: every Set 3 rune against the list

Zero mismatches after the rulings. Checked by `set3RuneList.test.ts`:

- **Tribe:** every rune listed under a tribe carries exactly that tribe gate (Soul Script's extra Celestial is the one
  allowed extra); every rune listed under Neutral carries none.
- **Rarity:** every Basic-listed rune is in `RUNES` without the Epic kicker, every Epic-listed rune is in `EPIC_RUNES`
  with it. The Neutral Basic names that sound Epic (Bubble Crown, Epic Forge, Gilded Ledger, Golden Splinter, Ornate
  Clock, ...) are all Basic in the game already, so no other rarity mismatch exists.

Set 3 is now **84 Basic / 79 Epic** (was 83 / 80). Other pools: Set 1 Epic 85 to 84 (Seller's Market); Set 2 Basic
129 to 130 and Epic 117 unchanged (Engraving Gems out, Lazarus in).

## Forge and board-fit check

- `runeforgePool`'s tribe filter reads `tribes`, so the new gates work with no engine change (pinned by a forge test
  per rune in `set3RuneList.test.ts`: absent without the tribe, present with it; Lazarus in a Set 2 run; Engraving
  Gems at a Basic forge only).
- **Not changed, flagged:** the "follows your board" guarantee and the pivot discount read `runeSynergies`, which
  derives tags from the rune TEXT only, never from the `tribes` gate. None of the newly gated runes names its tribe,
  so on a Dwarf board Seller's Market does not count as following it (same as before this PR). This is systemic: 90
  tribe-gated runes lack their own tribe as a synergy tag. The Set 3 half (Spirit / Celestial / Starform / Reveler)
  is the existing roadmap item deferred until Set 3 goes live; adding the `tribes` gate as a synergy tag would fix
  all 90 at once and is an owner call.

## Tests, oracle, docs

- `set3RuneList.test.ts`: counts 84 / 79; new rarity and tribe alignment tests; forge test for the rulings.
- `tribeGate.test.ts`: the six new gates are owner rulings (their text does not name the tribe); Lazarus joins
  `BODY_GRANT_ONLY` (grants an Undead body, owner-ruled Neutral).
- Count pins: `runes.test.ts` (RUNES 158), `set3RuneCuts.test.ts`, `set3RuneRoster.test.ts`,
  `set3RunesTrancheA.test.ts`, `set3RunesTrancheD.test.ts`, `balance/strategy/packages.test.ts` (Ruby package affine
  Basic runes 9 to 10).
- Oracle: **R-RUNE-22** in `packages/rules/src/registry/approved/runes.ts`.
- Regenerated `contracts:extract` and `docbot:text`. `docs/GAME-RULES.md` rune section and a Balance patch note.
