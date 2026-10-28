# 2026-10-27 — Set 3 balance list + three new minions

Owner's Set 3 list (2026-10-27). Oracle: R-SET3-1027-01, R-ARCHIVE-SET3-1027-01. Tests:
`packages/sim/src/set3Balance1027.test.ts`.

## Changes to existing cards (SAME / CHANGED vs the live game)

- **Gramps** (`k3_gramps`) CHANGED. Was "Sell: Cast a Ruby on all of your minions" (Gilded 2 each). Now "Sell: Give your
  Rubies +1 Attack and cast a Ruby on a friendly Kobold". Two onSell effects in order: `rubyStatGain` (Ruby Mender's
  body) then `battlecryPlayRubiesRandomTribe` (random friendly Kobold; dual/All-types count). Gilded: +2 Attack, 2
  Rubies each drawn separately. Stats T3 4/2 SAME.
- **Zapdash** (`k3_zapdash`) CHANGED. Was "Pummel (10): Cast a Ruby on your Kobolds. (Twice per combat)". Now "Pummel
  (12): Summon a Gemheart Golem and cast 2 Rubies on it. (Twice per combat)". Reuses Impossible Todd's
  `dealtDamageSummonToken` marker with a new `rubies` param (`noteDamageDealt` in simulate.ts): each payout summons one
  Golem and casts the Rubies on it via `playRubyOn` (only if it landed). With the rider, Gilded doubles the Rubies (4),
  not the Golems (Geode Guardian's convention). Todd is unchanged. Stats T3 4/4 SAME. `dealtDamageCastRubiesTribe` is
  now unused by content (kept; old saves never needed it since effects resolve from the live def).
- **Goldvein** (`k3_goldvein`) CHANGED: 3 -> 2 Gold, Gilded 6 -> 4. Pummel (6) and once per combat SAME.
- **Whispwarder** (`d3_whispwarder`) CHANGED: T5 -> T4 (7/5 SAME). Its Warding Call is now a Tier 4 Whisper (derived).
- **Doubletap Brewer** (`dw_brewer`) leaves Set 3 (still a Set 2 card).
- **Falx** (`d3_falx`) archived (`cards/archive.ts`; it was Set 3 only). Side effect: its Whisper Ripple has no live
  owner, so `WHISPER_TIERS` reads it as Tier 1, and set-scoped random Whisper rolls never offer it (its only owner is in
  no set). `whisperTiers.test.ts` re-pointed its Tier 5 owner case at Well Watcher.
- **Frack Attack** art framing baked into `cardArt.data.json` from the owner's tuner value.

## New minions (data only, plus one primitive)

- **Studious Steven** (`d3_studioussteven`, Dragon T4 6/4): Shout: Cast Quick Study (`battlecryCastNamedSpell`).
  Gilded twice.
- **Riftwalker** (`d3_riftwalker`, Dragon T6 8/8): Avenge (3): Cast Waking Rift. NEW factory `avengeCastNamedSpell`
  (the avenge window of `avengeCastTribeAttack` around Flamebeat's `rallyCastNamedSpell` body). Gilded twice.
- **Beer Gut Bud** (`dw3_beergutbud`, Dwarf T5 6/2; the sheet named no tribe): Shout and Echo: Get a Dwarven Ale
  (old Doubletap Brewer's two effects). Gilded 2 each.

No art for the four new minions yet.

- **Choosey Dragon** (`d3_choosey`, Dragon T3 3/4, Rally): "Rally: Cast Tribes Choice on the minion to the right of
  this." Owner confirmed the spell is the existing `tribeschoice` ("Get a random minion of the targeted minion's type").
  NEW factory `rallyCastNamedSpellOnRight` (one arena body, both phases) plus a new arena method `castNamedSpellOn`
  (combat: `castNamedSpellOnInCombat`; shop: `castSpell` with that target). Tribes Choice was not combat-castable, so
  `spellGainOfTargetTribe` now resolves in combat too (`resolveCombatSpellCast`, via `grantRandomMinion`); that also
  makes every other combat caster of Tribes Choice work instead of fizzling. Gilded: two casts.

## Owner answers

- **Dealski** SAME: the owner's "special Ruby" = a random Ruby (any of the six). Dealski already reads "When you play a
  Choose One card, get a random Ruby." (`getRandomRubies`, since 2026-10-22). No change.
- **Titan Sculptor** (`e3_sculptor`) art: reset to default. It had no saved framing on main, so it already uses the
  default; no change.

Content change: redeploy versus-resolve after merge.
