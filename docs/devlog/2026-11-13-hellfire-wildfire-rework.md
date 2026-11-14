# 2026-11-13 — Hellfire is Demon damage; Wildfire reworked to a kill payoff

Owner rulings the same day the Set 2 runes shipped (#2687):

- "Hellfire only counts as Demon damage" (Wildfire stays sourceless), and "make sure to note in hellfire that it counts
  as demon damage".
- Wildfire, in three steps: "remove the cap", then "when an enemy dies, deal its damage to a random enemy minion.
  3 times per combat", then "change it so it cannot chain and only triggers when a minion kills an enemy". The last
  one is what shipped. The uncapped version was never built.

## Final texts

- **Hellfire:** "When a **Demon** attacks or dies, deal **1** damage to all enemies. This counts as **Demon** damage."
- **Wildfire:** "When one of your minions kills an enemy, deal that enemy's **Attack** as damage to a random enemy
  minion. (**3** times per combat.)" The owner wrote "its damage". "Attack" is our reading and needs his confirmation.

## Hellfire (`hellfireVolley` in `simulate.ts`)

The Demon that swings, or the Demon that dies, deals the volley. It uses the same rule as one Fel Spikes spray
(`sprayDamageExceptFriendlyTribe`):

1. Every hit lands, and each landed hit queues its `friendlyDemonDealtDamage` reaction.
2. The queue flushes in hit order, once per LANDED hit. That covers Rad Rachel, Impossible Todd, Ruinous Lord and Rune
   of Ruins. While it flushes, a body left at 0 still counts as living (R-DEMON-DMG-DEATH-01).
3. The deaths resolve, and the Demon is credited as the killer.

Because the Demon is the dealer, every landed hit also advances that Demon's **Pummel** meter (Todd's Pummel 20 now
crosses on his third swing against 7 enemies). An **Execute** Demon executes the first enemy it lands on, and its venom
is spent on that hit, exactly as on a spray. No presentation wave is opened, so the volley keeps its own Hellfire beat.
The `dmg` events now carry `source` = the Demon uid. The Fel Spikes FX binding being built on `feat/rune-fel-spike-fx`
should check this.

## Wildfire (`runeFireOnDeath` + `lethalSource`)

`applyDamage` records which minion dealt the lethal hit (`lethalSource`, latest lethal hit wins; `null` when the hit
had no source). This replaces the attack-exchange mark (`exchangeHit` / `attackHitPending` / `lethalByAttack`), which
is gone. At death, Wildfire fires when that minion is on the rune's side. The dead enemy's Attack, read at its death, is
dealt by `dealDamage` with no source to one `rng.pick` of the living enemies. The budget stays at 3 per copy.

- **It cannot chain.** Wildfire's own hit has no source, so a kill it makes is never a minion kill.
- **No use is spent** when the dead enemy had 0 Attack or no enemy is left.
- **It is not Demon damage,** so Rachel and Ruins never react to it.
- **What counts as a kill by one of your minions:** whatever the engine credits to a friendly dealer. That includes
  attacks, retaliation, Cleave, Fel Spikes and Gasket sprays, Bleed, Pitchforks (the Imp is the source) and Hellfire
  (the Demon).
- **What does not count:** spells, rune volleys with no dealer, Wildfire's own hit, destroys, and any effect routed
  through the shared arena `damage` verb, which credits no minion. Imp Legion's Echo is no longer one of these (see
  below).

## Pitchforks and Imp Legion are Demon damage too (owner, same day)

The owner ruled: "What about pitchforks and imp legion? Those should also count as demon damage".

- **Pitchforks** already passed the Imp as the source, so its hits already fired the Demon-damage reactions one by one.
  One copy's throw now uses the shared `sourcedVolley`, the same helper Hellfire uses: both hits land, the reactions
  fire per landed hit, then the deaths, with the Imp credited.
- **Imp Legion**: the combat factory now hands the shared arena body a `damage` verb sourced by the dying Imp. This is
  how Fel Spikes' Echo credits its dying Demon. The body itself stays in `arena.ts`, and Imp Legion is its only user.
  Its kill now fires Wildfire.
- **Texts are unchanged.** Pitchforks says "**Imps** deal **3** damage...", and Imp Legion gives the Imp the Echo, so
  both already name the Imp as the dealer.
- **The other Demon-sourced effect damage in this batch was already sourced:**
  - Fel Spikes' Echo and Gasket's Rally (the spray).
  - Mirror Sheen's reflected hit, dealt by the Warded minion, so it is Demon damage when that minion is a Demon.
  - Wildfire stays sourceless by ruling.

## Tests

`set2EpicTribalRunes1112.test.ts` (the Hellfire and Wildfire blocks were rewritten) and `set2RunesCombined.test.ts`
(the Pitchforks and Imp Legion pins, plus Rachel, Ruins and mirrored-side checks for both). Oracle rules
`R-SET2-EPIC-TRIBAL-1112-04` (rewritten) and `R-SET2-TRIBAL-RUNES-04` (extended).
