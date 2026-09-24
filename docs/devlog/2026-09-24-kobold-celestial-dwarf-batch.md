# 2026-09-24 — Kobold / Celestial / Dwarf batch (Facetwright rename, Pickles, Jewel, Delver, Kurse, Maestro Lux, Han Gover)

Owner list (verbatim):

> Rename facetwright's choice -> facetwright
> * Pickles -> Choose One: Get 3 Rubies or a Facetwright.
> * Jewel -> Choose One: Get a random Kobold or increase your max gold by 1.
> * Delver -> T2 and stats to 4/3
> * Kurse -> Avenge (3): Summon a Gemheart Golem with this minion's Rubies. It attacks immediately.
>   * let's use this terminology for the gemheart golems. not a mechanical change, but i think this sounds better.
> * Maestro Lux -> Pummel (12): Get a random Celestial. (Once per combat.)
> * Han Gover -> (Max 5 per combat.)

Clarification on Kurse the same day (verbatim): *"the attacks immediately is a mechanical change in addition to the
text change. that piece is specific to kurse, though."*

## What changed

| Card | Before | After |
| --- | --- | --- |
| Facetwright (`facetwright`, set 2 spell) | name "Facetwright's Choice" | name "Facetwright" (id, art, behaviour unchanged) |
| Pickles (`k3_splitpick`) | Choose One: random Shop spell / 3 Rubies | Choose One: 3 Rubies (`battlecryGetRubies`) / a Facetwright (`battlecryGrantSpell`); gilded 6 / 2 |
| Jewel (`k3_jeweler`) | Choose One: Discover a Kobold / Discover a Shop spell | Choose One: random Kobold (`battlecryGainRandomMinion`, ≤ shop tier) / +1 max Gold (`gainMaxMana`, the `maxGoldBonus` route); gilded 2 / +2 |
| Delver (`k3_veinchant`) | T3 5/3 | T2 4/3 |
| Kurse (`k3_kurse`) | Golem waits its turn | Golem attacks immediately (`charge: true` → `attackNow`) |
| Maestro Lux (`ce3_starcharter`) | Shout: Discover a Celestial | Pummel (12): a random Celestial, once per combat (new marker `dealtDamageGrantRandomTribe`) |
| Han Gover (`dw3_hangover`) | Pummel (40), once per combat | Pummel (40), max 5 per combat (`maxPerCombat: 5`) |

Wording only (no behaviour change): Gemheart Carver and Porkbelly now say "Summon a Gemheart Golem with this
minion's Rubies". Rune of the Gem Golem already said "with its Rubies". Geode Guardian ("two 1/1 Golems with
Taunt, and cast a Ruby on them") summons plain Golems, so it keeps its own wording.

## Non-obvious decisions

- **The Pummel cap is a param.** `noteDamageDealt` now counts payouts per combat instance (`pummelFires`,
  replacing the `pummelFired` boolean) against `params.maxPerCombat` (default 1). Within the cap it pays once per
  multiple crossed, so one 85-damage Han Gover hit pays two Ales. Under a cap of 1 this is the old behaviour
  exactly (Goldvein tests unchanged). One `pummelTrigger` per payout; the UI channel already counted stacks.
  Oracle: R-PUMMEL-01 updated, R-PUMMEL-02 added.
- **Maestro Lux's "random Celestial"** is the shared combat `grantRandomMinion` (the run's pool, ≤ shop tier,
  active tribes), so All-types cards are legal picks, as for every other "random <tribe>" grant.
- **Jewel's max Gold** reuses `gainMaxMana` (Gold Font's body), now × golden. Spells are never Gilded, so Gold
  Font is unchanged.
- **Kurse's immediate attack** is `params.charge` read by the shared arena body
  `deathrattleSummonRubyStats`; Carver does not pass it.
- Doc Bot text grammar: the sentence splitter keeps "(Once per combat.)" / "(Max 5 per combat.)" as one
  sentence, and "with (double) this minion's Rubies" is a tolerated tail.
