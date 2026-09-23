# 2026-09-23 — Balance 9/23, tranche 6: eleven rune archives, the Deathtouched Apple goes Undead, Picnic

Owner items (verbatim): *"archive rune of emberline from all sets"*, *"archive centerline"*, *"archive rune of the
cindergem"*, *"archive rune of the second litter"*, *"archive spare chair"*, *"archive rune of moonhowl"*, *"archive
taurus rune"*, *"archive ashen heir rune"*, *"archive old pack"*, *"archive open market"*, *"archive warpath"*, *"make
deathtouched apple an undead rune, so it is not in set 2"*, *"Picnic - T5 1 cost - Give the right-most Shop minion
+8/+8 permanently."*, *"wire this art"*.

## The archives (eleven runes, every set)

Each def moved VERBATIM from `RUNES` / `EPIC_RUNES` into `ARCHIVED_RUNES` (`packages/content/src/runes.ts`), the way
the 2026-08-07 / 08-12 / 08-18 batches were kept: out of BOTH forge stocks in every set, still in `RUNE_INDEX`, so a
saved run or replay that holds one keeps its badge, text and reward machinery. Their `sets` / `tribes` tags ride
along as history. Nothing in the reducer, simulator or combat flags changed — the effects stay wired for old runs.

| Rune | id | Was |
| --- | --- | --- |
| Rune of Emberline | `rune_emberline` | Basic, Demon-gated |
| Rune of the Centerline | `rune_centerline` | Basic |
| Rune of the Cindergem | `rune_cindergem` | Basic, set 2, Demon-gated |
| Rune of the Second Litter | `rune_second_litter` | Basic, Beast-gated |
| Rune of the Spare Chair | `rune_spare_chair` | Basic |
| Rune of Moonhowl | `rune_moonhowl` | Epic, set 2 |
| Rune of Taurus | `rune_taurus` | Epic |
| Rune of the Ashen Heir | `rune_ashen_heir` | Epic, Demon-gated |
| Rune of the Old Pack | `rune_old_pack` | Epic, Beast-gated |
| Rune of the Open Market | `rune_open_market` | Epic, sets 2 + 3 |
| Rune of the Warpath | `rune_warpath` | Epic |

References cleaned up the way earlier archives did it:

- `packages/core/src/presentation/policies.ts` — the eleven `rune:<id>:…` entries removed (the "no ghosts" test
  requires every key to be produced by live content); each left a dated comment in place.
- Pool-pinning tests moved the archived ids out with a dated comment (`runeBatch4T1/T2/T3`, `runeCardKeyed2`); the
  behaviour tests for those runes stay, because `buyRune` resolves through `RUNE_INDEX` and the combat flags are
  untouched. `RUNE_INDEX`-based lookups (`runeMinionBatchAug11`, `fourRunes`, `runeDuplication`, `runeBatchAug19`,
  `balanceExport`, `placementReport`) needed nothing.
- Count tripwires: `runes.test.ts` (Basic 164 → 159), `set3RuneRoster.test.ts` (set 3 non-original 112/90 →
  110/87; set 1 106/89 → 102/85; set 2 135/124 → 130/117), `balance/strategy/packages.test.ts` census.
- `RUNE_DUP_SWEETENER` keeps `rune_centerline` / `rune_moonhowl` (a saved run holding one still shows the right
  duplicate pill); `docs/rulebook/TRIAGE.md` and the Doc Bot corpora are historical records and were left alone.
- Not referenced anywhere in the tutorial scripts, hero-quest Discovers or balance fixtures except the Midas replay
  fixture, which resolves through `RUNE_INDEX` and still replays.

## Rune of the Deathtouched Apple → Undead

`tribes: ['undead']` on the def. The forge's tribe gate (`runeforgePool`) offers a tagged rune only when the run
rolled that tribe, and a run rolls its tribes from its set's roster (`SETS[set].tribes`) — Set 2 fields no Undead, so
the Apple can never appear in a Set 2 run; a Set 1 / Set 3 run that rolled Undead still sees it. The tag audit in
`tribeGate.test.ts` checks that a tag is named by the text; the Apple names the tribe by its KEYWORD (Rise), so an
owner-ruled `OWNER_TRIBE_RULINGS` map records that (the same idea as Imps counting as Demon content), plus a new
test that walks five Set 2 seeds and both other sets. Set 2's static Epic count dropped by one for it.

Oracle: **R-RUNE-04** (`packages/rules/src/registry/approved/runes.ts`) — the set + tribe scoping of a rune, with
the Apple as the worked case and the archive contract as the other exclusion.

## Picnic (`sp_picnic`)

Tier 5, 1 Gold, untargeted, neutral: *Give the right-most Shop minion **+8/+8** permanently.* Lives in
`SET2_SPELLS` (set 2 is the active set) and is opted into set 3 by id (`SET3_SHARED_SPELL_IDS`), Dissipate's shape.

"Permanently" is Market Tormentor's channel: a new cast factory `spellBuffShopRightmost` grows `rightmostSlotBuff`
by the grant and lands it on the current right-most minion offer; `applyShopRefreshed` re-lands the running total on
every fresh roll, and the buff rides the offer into the bought minion. Spell power folds on both stats (the shop-buff
family's rule, Staff of Guel's sibling) and `spellDisplayText` greens the printed number. It is a stat spell (Rune of
Thrift discounts it) but NOT a board stat spell (`SHOP_TARGETED_STAT_SPELLS`, so the Gilded Ledger never casts it).
No minion in the Shop → refused before it consumes the card (`spellFizzle.ts`; `guardReachability` fixture added).

Wiring: `EffectFactoryId` (core), the schema whitelist, `presentation/policies.ts` (`factory:…:cast` ownBeat),
the balance bots' `SPELL_POLICY` (`shopBuff`, buy 1), `sets.test.ts` / `set3Scaffold.test.ts` rosters, and
`packages/sim/src/picnic.test.ts`.

**Art: none.** `C:\Game Assets\Ascent Art` holds no file named Picnic (`find -iname "*picnic*"` is empty; the
`Spells` folder was listed by hand). The name-match rule forbids guessing from an unattributed master, so the
spell ships without art and the owner's "wire this art" is still open — drop a `Picnic.png` master in and run
`npm run art:wire`.

## Player-facing

One `Balance` patch note, "Balance 9/23: archives and Picnic", lists the eleven runes, the Apple move and Picnic.
