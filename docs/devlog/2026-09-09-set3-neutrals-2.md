# 2026-09-09 — Set 3 Neutrals, tranche 2: hand spells (Tower Shield, Clue), Defender, Inspector Pell

Builds on tranche 1 (`2026-09-09-set3-neutrals-1.md`). Owner rulings from the roster conversation: Tower Shield
is "a spell (not a Shop spell — similar to Rubies): it counts as a spell cast but not a Shop-spell cast", gives
+2/+1 and Taunt, takes **no spell power or buffs as of now**, and a golden Defender gets four. A Clue is "give a
minion +1/+1; improve your Clues by +1/+1".

## The HAND SPELL class — card-minted Gifts

Both are the existing **Gift** class (`gift: true`, `cards/gifts.ts`): a real spell cast for every tally and
`spellCast` watcher, never a Shop spell (never in the shop, never Discovered, never copied by Steward / Recaller /
Recurrence / Mushy), free, and outside every set manifest. Two differences, both data:

- They live in `cards/set3/handSpells.ts` (`SET3_HAND_SPELLS`, added to `ALL_CARDS`), **not** in `GIFT_IDS`, so
  Merry Christmas's Gift Discover can never offer one. They are minted by cards through one new factory,
  `battlecryGetHandSpell { cardId, count }` (× golden; an Equipment passes its gilded source, so a gilded
  Magnifying Glass mints four with the same params).
- **`giftMulticast: true`** — the one cast multiplier a Gift honours. The reducer's Gift branch repeats a
  targeted multicast Gift `yazzusExtraCasts` times (the set-3 Yazzus only; set 1's says "Shop spells").

**Tower Shield:** `spellBuffTarget { attack: 2, health: 1, keyword: 'T', flat: true }`. `spellDisplayText` prints a
flat Gift's base text unchanged (folding spell power in would promise what the cast never grants), and the
spell-power text sweep skips `flat` effects.

**Clue:** the value is run state, not per-instance — `RunState.clueBonus`. `clueBuffTarget` grants `1 + clueBonus`
then bumps it, so a Yazzus-repeated Clue is two real Clues (+1/+1 then +2/+2) and every Clue in hand prints the
live value through `spellDisplayText({ clueBonus })` (threaded through `LiveTextParams` in instView / Recruit).
A Clue targets a FRIENDLY minion (a judgement call — the Ruby's "a minion" also reaches a shop offer; extend if
the owner wants that).

## Cards

- **Defender** (`n3_defender`, T2 2/2): Shout — get 2 Tower Shields (golden 4).
- **Inspector Pell** (`n3_pell`, T3 2/5): Equip **Magnifying Glass (1)** — get 2 Clues (`content/equipment.ts`,
  `targetMode: 'none'`, `effectId: 'battlecryGetHandSpell'`).

Registrations: factory union, schema whitelist (`giftMulticast` field + both factories), presentation policies,
`CARD_REF_EFFECTS` (so the hover preview shows the minted spell), a `PHASE_EXCUSED` combat excuse for the mint
(no hand mid-fight; replays at settle), contracts registry and docbot report regenerated. Art pending for both
minions and both spells (`ART_PENDING`).

Tests: tranche-2 cases in `packages/sim/src/set3Neutral.test.ts` (mint counts plain/golden, +2/+1 + Taunt with
spell power armed and ignored, spell-cast tally vs no copy memory, Yazzus-3 repeats / Yazzus-1 doesn't, the Clue
ladder 1→2→3, the repeated Clue, live text, the Glass plain/gilded).

## Still to come (tranche 3)

Highway Hustler + **Whiplass-o** (steal the highest-TIER Shop minion; golden two), Warband Recruiter (Rally:
summon AND get a random Rally minion), Equipment Inspector + a **Start of Turn** trigger (fires on re-entering the
shop, alongside the per-turn Equipment charge).
