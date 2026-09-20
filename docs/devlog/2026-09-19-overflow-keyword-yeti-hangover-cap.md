# 2026-09-19 — Overflow keyword · Yeti (Set 3 Neutral) · Han Gover "(Max 2 per hit)"

Owner handoff 2026-09-19, three items.

## Overflow — the `summonOverflow` trigger gets a printed keyword

Every card / rune whose text described "summoning a minion that does not fit" now prints the keyword form
**`**Overflow:** …`** (owner example: Squatimus). Effects and params are untouched; only the sentence changed.

| Object | Before | After |
| --- | --- | --- |
| Squatimus (`u3_squatimus`) | Whenever a summoned minion does not fit, give your minions +3/+4 permanently. | **Overflow:** give your minions +3/+4 permanently. (gilded +6/+8) |
| Flowing Monk (`monk`, set 1 neutral) | When you summon a minion that doesn't fit, Engrave 2 friendly minions +2/+2. Improves by +2/+2 every 5 overflows. | **Overflow:** Engrave 2 friendly minions +2/+2. Improves by +2/+2 every 5 overflows. (gilded +4/+4) |
| Bicycle Bob (`u3_bicyclebob`) | When a summoned minion does not fit, give a random Undead +1/+1. Improves for every Undead played this turn. | **Overflow:** give a random Undead +1/+1. Improves for every Undead played this turn. (gilded +2/+2) |
| Cratering Hulk (`thunderingabomination`, set 1 undead) | Gain +3/+3 when a minion is summoned in combat. Overflow summons Engrave your Undead +2/+2. | Gain +3/+3 when a minion is summoned in combat. **Overflow:** Engrave your Undead +2/+2. (gilded +4/+4) |
| Rune of Overflow (`rune_overflow`) | Whenever you summon a minion that does not fit, give your minions +4/+4 permanently. | **Overflow:** give your minions +4/+4 permanently. |
| Rune of the Crowded Crypt (`rune_crowded_crypt`) | Whenever a summoned minion does not fit, give your minions +1/+1 permanently. Triggers twice in the Shop. | **Overflow:** give your minions +1/+1 permanently. Triggers twice in the Shop. |

The two live-text reprints moved with them: Flowing Monk's `monkProgressText` (`cardText.ts`) and the Rune of
Overflow's `combatFlag` reward line (`questText.ts`). Bicycle Bob's helper rewrites the def text in place, so it
followed for free (its test's expected string was updated). Nanon ("For each one that can't fit") is a
Deathrattle that counts its OWN overflowing tokens, not a `summonOverflow` watcher, so it keeps its wording.

**The keyword** (`packages/ui/src/keywordGlossary.ts`, section Triggers): *"When a minion is summoned, but
does not have space on your board."* — owner's wording verbatim. It links `mechanic: 'overflow'`, a new
`MECHANICS` registry entry (`detect: hasOn('summonOverflow')`, glyph `overflow` — a brimming-cup icon added to
`Icon.tsx`), so the card medallion and the Compendium filter both recognise the trigger. `summonOverflow` LEFT
the Watcher set: Overflow is its own trigger family now, like Avenge. Pill detection + term colouring come from
the glossary entry automatically (`detectCardKeywords` / `termColour` are glossary-driven), and the coverage
test's forward/reverse walks pass with no keep-list change. Doc Bot's text parser gained
`{ /^Overflow\s*[:：]/ → 'summonOverflow' }` in `TRIGGER_LEXICON`, so "Overflow:" parses exactly like "Shout:".

## Han Gover — "(Max 2 per hit)"

Text: *"When this deals **40 damage**, get an **Ale**. (Max 2 per hit)"* (gilded: *"get **2 Ales**. (Max 2 per
hit)"*). `noteDamageDealt` (simulate.ts) now pays `min(crossings × count, 2)` per damage event. The owner's line
was read literally as a cap on **Ales per hit**, so gilded keeps the same cap of 2: its first crossing pays its
2 and a second crossing in the same hit pays nothing more. The meter still advances by the FULL damage — the
uncredited crossings are spent, not banked; the next 40 dealt pays again. Tests: a 120-damage hit → 2 Ales, not
3; the meter reads 120; a following 40 (meter 120 → 160) pays 1; gilded 85 → 2. The parser learned the
`(Max N per hit|turn|combat)` rider as a `limit` note so `UNRESOLVED_CAP` stayed at 91.

## Yeti (`n3_yeti`) — T6 Neutral 0/12

> When this minion takes damage, deal it to **2 random enemies**. (Once per combat)

New combat factory `onDamagedReflectRandomEnemies` (`count: 2`). The `onDamaged` payload now carries
`amount` (added at the one emit site in `applyDamage`; older watchers ignore it). The first time the Yeti
instance takes landed damage, it picks `count` DISTINCT living enemies off the combat rng (fewer when fewer
stand) and deals the same amount to each through `ctx.damage` with itself as source — so a Ward pops, Immune
shrugs it, on-damaged watchers wake, and a kill resolves at once with the standing Echo-before-Rise order.

**Once per combat and Rise/Rebirth.** The latch is `reflectFired` on the combat `Minion` instance, the same
place Gryphon's `grantedRefresh` cap and Candleback's `rubyRecvTick` live, and it is deliberately NOT on the
Rise / Rebirth reset list — a returned body is the same instance, so "once per combat" stays spent. (Those
existing per-combat latches already behave this way; Yeti matches them.) A fresh combat instantiates a fresh
Minion, so it re-arms every fight. It fires even on the hit that kills it (guard is `dead`, not Health). No
gilded rider: gilding doubles the body only. Appended to `SET3_NEUTRAL` (set 3 only, the file's convention);
whitelisted in `EffectFactoryId`, the content schema, and the presentation policies (`ownBeat` / `react`).
Art wired from the `Yeti.png` master (name match); ratchet 1254 → 1255.

## Goldvein (`k3_goldvein`) — T1 Kobold 2/3 (later the same day)

> When this deals **6 damage**, gain **3 Gold** next turn. (Once per combat)

A **"Payload" keyword was proposed for this family and PARKED by the owner** — no glossary entry, pill, mechanic
id, grammar rule or trigger rename; Han Gover's and Goldvein's texts stay in plain "When this deals N damage"
wording. Goldvein is built on Han Gover's damage-dealt meter, generalised: `DAMAGE_METER_DOS` (core types) names
the passive markers `noteDamageDealt` reads — `dealtDamageAleMeter` (Han Gover) and the new
`dealtDamageGoldNextTurn` (Goldvein, `params: { every: 6, gold: 3 }`). The tally advances identically for both
(seeded from the run card's `damageDealt`, carried back via `playerDamageMeters`, snapshotted, triple-merged as
the max); the marker's `do` decides the payout. Goldvein's body: the first time the meter crosses a multiple of
`every` in a fight, `ctx.grantBonusGold(gold × gild, side)` — the Tromboneer / Bounty Bot channel
(`playerBonusGold` → `bonusEmbersNextTurn` at settle, on top of the 10-Gold cap). Latched once per combat on the
instance (`goldMeterFired`), Yeti's convention: NOT reset by Rise / Rebirth, re-armed by the next combat's fresh
Minion. Gilded 6 Gold, still once. The step-counter badge (`cardText.ts`) keys off `DAMAGE_METER_DOS` so Goldvein
wears N/6 exactly as Han Gover wears N/40. Art wired from `Goldvein.png` (name match) alongside Yeti — ratchet
1254 → 1256.

## Chipwick Prospector out of set 3

`k_chipwick` left `SET2_KOBOLDS_IN_SET3` (`sets.ts`, six set-2 Kobolds remain); it is untouched in set 2 and
still resolves globally. Roster pin in `set3Scaffold.test.ts` and a test in `goldvein.test.ts` carry the date.

Tripwires moved consciously: the set3Scaffold roster, contracts re-extracted, final-report headline numbers,
the balance fixture snapshot. Patch note prepended.
