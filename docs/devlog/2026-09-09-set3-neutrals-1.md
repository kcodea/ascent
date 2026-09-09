# 2026-09-09 — Set 3 Neutrals, tranche 1: roster, renames, Blaster back, the set-3 Yazzus, Splitboon Adept

**Owner roster (2026-09-09):** twenty-six Neutrals for set 3. Rulings taken in the same conversation:
Bellringer Voss, Wayfinder, Black Belt Brian and Steward of Spells keep their CURRENT stats (the sheet's numbers
were stale); Steward keeps "Shop spells"; Titan Sculptor is unchanged; Sylus and Drakko are renamed for every
set; Blaster is un-archived into set 3; Yazzus gets a **set-3 fork** (T6 4/8, "your targeted spells" — Rubies
included) while set 2 keeps the original; Copper Spellsword on the sheet is Coppercoat Spellsword.

## Shipped in this tranche

- **Carry-overs by id** — `SET1_NEUTRALS_IN_SET3` (Venom, Arena Heckler, Tauntbreaker, Wayfinder, Black Belt
  Brian, Jensen & Fi, Sylus, Drakko, Chronos, Steward of Spells, Mysterious Joker, Salvatore) and
  `SET2_NEUTRALS_IN_SET3` (Cheap Date, Coppercoat Spellsword, Bellringer Voss, Paragon) in `sets.ts`, appended
  after the Undead so no earlier position moved. Alchemist Frank and Titan Sculptor were already set-3 cards.
- **`cards/set3/neutral.ts`** — Blaster (moved out of the archive verbatim, id unchanged), **Splitboon Adept**
  (T3 3/4, Choose One: +6/+6 to a friendly minion, or +3/+3 to both neighbours) and **`n3_yazzus`**.
- **`battlecryBuffAdjacent`** — a new Shout-family ARENA effect (both phases), registered in the factory union,
  the schema whitelist and the presentation policies. Splitboon's first option uses a per-option `target`
  (the Godfodder shape) so only that branch opens the aim step.
- **The set-3 Yazzus** — `spellCastMult` accepts either id for aimed Shop spells; a new `yazzusExtraCasts`
  feeds `rubyCastCount`, so a Ruby lands twice (golden: three times) with it on board. Set 1's Yazzus still
  says "Shop spells" and never touches Rubies. The hand spells coming in tranche 2 (Tower Shield, Clue) will
  read the same helper.
- **Renames** — `sylus` → "Sylus", `drummer` → "Drakko" (display only, all sets); the Drakko hero's quest
  text now says "get **Drakko**".

Tests: `packages/sim/src/set3Neutral.test.ts`; the set-3 roster pin in `set3Scaffold.test.ts` extended.

## Still to come (tranche 2+)

Defender + **Tower Shield** (a non-Shop hand spell: +2/+1 and Taunt, no spell power, golden gets 4), Inspector
Pell + **Clues** (a Ruby-like hand spell that improves itself by +1/+1 per cast), Highway Hustler + **Whiplass-o**
(steal the highest-TIER Shop minion; golden two), Warband Recruiter (Rally: summon AND get a random Rally
minion), Equipment Inspector + a **Start of Turn** trigger (fires on re-entering the shop, alongside the
per-turn Equipment charge).
