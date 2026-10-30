# 2026-10-30 · Duos-only cards, batch A (12 cards)

Owner design 2026-10-30. Built on the foundation (#2468, `2026-10-30-duos-cards-foundation.md`). Branch
`feat/duos-cards-batch-a`. Rules R-DUOS-BATCHA-01..03.

## The cards

| Card | Tribe / tier | How it is wired |
| --- | --- | --- |
| Antsy | Beast T1 2/1 | `onDeath` `giftTeammate { randomSpellTier: 1, guard: 'self' }` |
| Salandaman | Beast T4 4/4 | Spear Warden's `cardDeathScaler` (data only; live text via `cardTypeTallyText`) |
| Bratworst Buck | Dwarf T3 3/5 | `spellCast` `aleCastGiftTeammate { perTurn: 2 }` (new; Shop + combat `spellResolved`) |
| Spencer | Dwarf T4 6/2 | `onDeath` `teamUpgradeDiscount { guard: 'self' }` |
| Roo | Kobold T2 3/1 | `passedCard` `getRubies { count: 2 }` |
| Toot Toot | Kobold T4 5/4 RL | `onAttack` `giftTeammate { mateTribe: true, guard: 'rally' }` |
| Proxus | Demon T5 8/5 | `passedCard` `demonConsumesShop` (new; random Demon eats a random Shop minion; Gilded = double stats) |
| Hippie Hulk | Demon T6 9/9 | `teammateSold` `teammateSoldGainStats { oncePerTurn }` (Gilded double) |
| Galfagan | Dragon T4 5/4 | `passedCard` `passedSpellGetCopy { spellOnly, oncePerTurn }` (new; Shop-pool spells only) |
| Monstrocity | All-type T4 4/4 | `onBuy` `giftTeammate { cardId, selfObtain }` + `fireSelfObtained` on buy and Discover pick |
| Broshake | spell T2 (1) | `spellBuffTeamLeftmost` (new; a `buffLeftmost` TeamEffect; spell power folded) |
| Tribe Bundle | spell T2 (2) | `giftTeammate { mateTribe: true }` |

## New primitives

- **Per-turn caps** (`duosOnceOk`): `oncePerTurn` = 1, `perTurn: N` = N, counted per copy on `BoardCard.duosUses` beside
  `duosOnce`'s turn stamp, cleared at the turn boundary. The live text (`duosTurnCapText`) turns "(Twice per turn)" into
  "(N left this turn)" once used.
- **Own-trigger guard** on the Shop `giftTeammate` / `teamUpgradeDiscount`: `guard: 'self' | 'rally'` and `selfObtain`
  fire only for the body's OWN Echo / Rally / buy. The Shop broadcasts a triggered Rally and a buy to every board body;
  without the guard a Toot Toot gifted on every ally's Rally.
- **`fireSelfObtained`**: a card's own `onBuy` effects marked `selfObtain`, fired by `applyOnBuy` and `takeDiscoverPick`.
- **`buffLeftmost` TeamEffect** (core `TeamEffect`): the receiver's left-most board minion, clamped wide on receipt.

## Judgement calls (flagged to the owner)

- Combat gifts (Antsy, Toot Toot, Spencer, a combat Ale for Bratworst) ride the foundation's team carry and land at fight
  settle. They call `arena.sendTeam`, so when the real-time combat channel lands (Duos runes builder) they switch with no
  card change.
- Bratworst's Ales cast in combat have their own two per fight (the Shop's turn count is not carried into combat).
- Galfagan's "Shop Spell" = `isShopPoolSpell` (not a Ruby, Clue or token spell). A Gold Pouch is a real Tier 1 Shop Spell.
- Gilded: Antsy 2 spells, Bratworst 2 copies each, Spencer -2, Roo 4 Rubies, Toot Toot 2 minions, Galfagan 2 copies,
  Monstrocity 2 copies, Proxus double stats (the Demon consume rider), Hippie Hulk double (owner).
- Salandaman prints "for every ... that died this game" (Spear Warden's wording, so the live text matches) rather than the
  owner's "for each ... that has died".
- Broshake text: "Give your left-most minion and your teammate's left-most minion +3/+5." (grammar of the owner's line).
