# 2026-09-21 — Pummel (X): the damage-threshold keyword, its mechanic, and the `pummel-trigger` effect

Two owner asks, one branch. First: *"I made an effect for when cards like Goldvein and Han Gover trigger. Please
assign this to when that happens. This must be wired to work in recruit, combat, end of turn, etc. If it triggers
from the last attack of combat, please make sure it still fires the animation and beat."* Then the ruling that
named the family: the damage-dealt threshold trigger is the keyword **Pummel (X)** — *"Pummel (X): Triggers once
this minion has dealt X damage in a combat."* Han Gover becomes *"Pummel (40): Get a Dwarven Ale. (Once per
combat)"*, and asked whether that is a mechanic change the owner answered *"yes, change this card's effect to
match the text"*. Goldvein takes the same shape: *"Pummel (6): Gain 3 Gold next turn. (Once per combat)"*.

The effect was authored as `payload-trigger` while the keyword was still unnamed; nothing shipped under that
name, so everything on this branch was renamed to `pummel` before it merged (the def, the `CombatEvent`, the beat
kind, the channel, the bindings, the tests, this file). No `payload` remains except unrelated pre-existing uses
(network payloads, event payloads).

## The keyword

- **Glossary** (`packages/ui/src/keywordGlossary.ts`): `pummel` / "Pummel", section Triggers, the owner's
  definition verbatim, declared like Avenge (N): the name matches "Pummel (40)" on its word boundary, so the hover
  pill raises on both cards and the number stays in the card text (it is the threshold X, not a buff number — the
  docbot `textNumbers` lane sees the 40 / 6 printed as before).
- **Mechanic** (`packages/ui/src/mechanics.ts`): a `pummel` row, glyph `fist` (shared with Start of Combat the way
  Rise and Rebirth share a glyph until one is authored), detected off core's `DAMAGE_METER_DOS` so a third meter
  card joins without touching the registry. Han Gover and Goldvein wore a blank medallion before; they wear the
  fist now, which is also where the owner's def lands (`anchorPart: medallion` → the `.cgem`).
- **Docbot** (`textParse/lexicon.ts`): a `Pummel (N):` trigger lexeme with a `text:` id — the engine names no `on`
  word for a passive meter, so the sentence is consumed, never compared.
- **Rules**: `docs/GAME-RULES.md` gets Pummel next to Avenge in the vocabulary table and its own section.

## The mechanic (owner ruling: the text is the rule)

`DAMAGE_METER_MARKERS` in `packages/core/src/types.ts` now reads `resetEachCombat: true` for BOTH bodies. Every
Pummel is once per combat:

| | before (2026-09-19) | now |
| --- | --- | --- |
| Han Gover | lifetime tally, an Ale every 40, "(Max 2 per hit)" | starts each fight at 0; the first 40 dealt pays one Ale (2 gilded); latched for the fight; carries back 0 |
| Goldvein | once per combat, reset each fight | unchanged (only the wording moved to the keyword) |

`noteDamageDealt` (simulate.ts) is simpler for it: advance the tally, `if (dealer.pummelFired || after < every)
return`, pay once, latch. `ALE_METER_MAX_PER_HIT` is gone (one payout makes a cap moot). The latch is one field for
the family — `goldMeterFired` became `pummelFired` on the combat `Minion` (Yeti's `reflectFired` convention: on
the instance, not reset by Rise / Rebirth, fresh every fight). `damageMeterReading` is unchanged in code: the
once-per-combat branch now serves Han Gover too, so his badge counts 0/40 up and **clamps at 40/40** once he has
paid — the "spent for this fight" reading, exactly what Goldvein's 6/6 already meant — then the settle clears the
run card and the shop reads 0/40. The shop chain (`instView`) additionally passes 0 for any reset meter whatever
the run card carries, so a pre-Pummel save with a lifetime tally never prints stale progress; the sim ignored that
seed already (`instantiate`).

Tests moved with it: `core/src/combat/pummelTrigger.test.ts` (one event per body per combat; 80 damage in one hit
and 40 + 40 in one fight both pay once; the 120 hit pays once; gilded pays two Ales on one trigger; a seeded
tally is ignored and the next fight re-arms; enemy side; last-attack; determinism), `sim/src/set3Dwarves.test.ts`
(the Han Gover block rewritten for once-per-combat + reset), `sim/src/goldvein.test.ts` (Han Gover is now declared
reset too), `ui/src/stepProgress.test.ts` and `ui/src/damageMeterBadge.test.ts` (0/40 → … → 40/40 clamp),
`ui/src/detectCardKeywords.test.ts` + `ui/src/mechanics.test.ts` (the pill + the glyph).

## The effect — how the fire is presented

The owner authored `pummel-trigger` in the FX workbench (`packages/ui/src/fx/defs/pummel-trigger.json`, params
verbatim — 900 ms: a 96-diamond `burst` rising against gravity at 100 ms and a `shockwave` at 90 ms, both on the
SOURCE card's **medallion**, plus a `sound` layer at 0 ms playing the library clip `triggerpulse` on the combat
bus). Only its `id` changed in the rename.

### Engine — the fire becomes an observable event

- **`packages/core/src/types.ts`** — one `CombatEvent` member (shared-boundary file, kept minimal):
  `{ type: 'pummelTrigger'; source: string; side: Side; marker: string }`. `source` = the body whose meter
  reached X (the same field name `sc` / `rally` / `shout` use for the acting unit, so `momentUnits`, the trig scan
  and the harness's `actingUid` all read it unchanged); `marker` = the meter's factory id.
- **`simulate.ts`** — `noteDamageDealt` emits it after the `dmg` that reached X and BEFORE the payout's own events
  (`toHand`). "After" is not "immediately after": `applyDamage` runs the victim's `onDamaged` reactors before it
  reaches the meter, so a reactor's event (a Target Dummy's `buff`, a Hearth Whisperer's `handBuff`) sits between
  the `dmg` and the trigger — the core test pins `dmg → reactor buff → pummelTrigger → toHand`. ONLY the trigger
  emit is wrapped in `withEffect(dealer, eff, …)`, so the event carries the meter's own identity
  (`key: 'factory:dealtDamage…:passive'`) instead of inheriting the outer effect that dealt the hit (a Fel Spikes
  volley, Yeti's reflection); the payout stays outside the wrap, so the Ale's `toHand` keeps its prior
  (unstamped-on-a-plain-swing) identity and its stock hold under the Beat Lab's live toggle (review 2026-09-21).
  **Count = one per body per combat.** A Pummel that pays nothing (a Han Gover in a pool with no Ales) emits
  nothing and does not latch — there is no trigger to show. Emitting touches no RNG; the harness's byte-for-byte
  determinism check covers it. Before this, Goldvein's payout was completely silent (`grantBonusGold` only bumps
  a counter), Han Gover's was inferable only from a player-side `toHand`, and an ENEMY meter was invisible.
- **`combatTrace.ts`** coverage row + projection; **`policies.ts`** — both meter keys move from `passive` to
  `foldedCue` / `react` (the flash rides the hit's beat, claiming credit not time), and the old comment claiming
  "the Gold bank is a `bonusGold` moment of its own" is corrected (no such event ever existed).
- **`packages/tools/src/combat-harness.ts`** — the `⚑ … PUMMEL triggers` narration, and a second matchup
  (Goldvein 2/3 vs three 0/1 dummies — the third hit reaches 6 AND ends the fight) so `npm run harness` actually
  prints the event, with its own determinism check.

### Choreography — the beat, the binding, the channel

- **The beat** (`combatBeats.ts` `RESULT_TYPES`): `pummelTrigger` rides the impact run, like `keyword`. It is
  emitted between the hit and the clash's retaliation, and it is a consequence OF that hit, so the clash stays
  ONE moment (`[dmg, pummelTrigger, retaliation dmg, death]`) and the flash lands at the lunge's real contact, a
  hair after the damage number (the def's own 90/100 ms internal `at`s). **It CAN lead a moment in a real fight**
  (review 2026-09-21): an `onDamaged` reactor event that is neither a RESULT_TYPE nor a deferred `buff` — Hearth
  Whisperer's `handBuff` — lands between the `dmg` and the trigger and splits the run, so an enemy Goldvein hitting
  a Whisperer compiles to `[attack] [dmg,dmg] [handBuff] [pummelTrigger,death]`. `kinds.ts` gets a `pummelTrigger`
  kind (so it is a `BindingKind`, and that leading instance is never scored as a `damage` moment) with its OWN
  pacing key in `choreoConfig` (`pummelTrigger: 460`, = `dmg`); the Beat Lab adapter files it under `reaction`
  and lists it as a consequence. The `fxDef` row stands down for the kind (the Rally one-channel rule): with
  `pummelFx` on BASE, a leading fire otherwise played the owner's burst, shockwave and clip TWICE.
- **The channel** (`choreo/channels/pummelFired.ts` + the `pummelFx` row in `score.ts`, on EVERY kind like
  `rallyFx` / `shoutFx`): a per-event scan, counted at the signal. The engine emits one per body per combat today;
  the counter and the `PUMMEL_STACK_MS` stride (240 ms ÷ speed) stay as the contract for a body a log fires more
  than once in one moment, pinned with synthetic logs. Plays `bindingFor(cardId, 'pummelTrigger')` at
  `anchorsForUnits(uid, uid)` with `{ uids: { source: uid, target: uid } }`, which is what lets `playDef` resolve
  the def's medallion part to the card's `.cgem`. `onPummelProc(uid, marker, count)` reaches the replay whether or
  not defs can play.
- **The binding** (`bindings.json` `kinds.pummelTrigger → pummel-trigger`; golden copy in `bindings.test.ts`;
  `DYNAMIC_CALL_SITES['choreo/score.ts']` 7 → 8). The def is reached through the binding, so the FX library
  reports it `bound`, re-bindable from the workbench, and it appears in the by-event lens under its kind.
- **Dedupe decisions** (`useCombatReplay.ts`): the body is deliberately NOT added to the per-beat `trig` scan —
  the def carries its own `triggerpulse` sound layer and its shockwave IS the medallion pulse. When nothing is
  bound at the kind the stock pulse + sound stand in (`pulseTrigger`), so unbinding the def in the workbench never
  leaves a fire silent. `Card.tsx`'s generic counter-pill flourish (`pixiFx.spellPower` on a step-proc tick) stands
  down for a Pummel card while a `pummelTrigger` binding resolves.
- **Han Gover's Ale beat is untouched**: it still pulses the medallion white, plays `ale-bubbles` and flies the
  card, one beat after the flash. The `triggerpulse` clip does play twice ~0.5 s apart on a Han Gover fire (once
  from the def, once from the Ale beat). Flagged for the owner rather than stripped.

### The last-attack case — how it is guaranteed

Every beat's cues fire, the last included, so a fire on the killing blow always plays. What was NOT guaranteed was
that the end-of-combat hand-off waited for it: the def plays at wall clock (the score never passes `speed` to
`playDef`) while `finalHold` divides by the player's speed — at 4× the fight settled 225 ms after contact with the
flash barely started. `choreo/finalHold.ts` (pure, tested) floors the final hold at the bound def's VISUAL end
(`pummelReadMs` — the last non-sound layer's `at + span`, ~980 ms for this def; NOT `playLifetimeMs`, whose
unmodelled-sound tail would add 3 s), wall-clock, in two ways: the last beat's own fires are scanned directly
(Goldvein's third hit into the last dummy), and a flash fired on an EARLIER beat is waited out through a recorded
fire time (`pummelRemainingMs`) — Han Gover's fire is followed by its Ale's `toHand` beat and the death beat. Skip
still deliberately hides it (skipping must reach the same final state).

### Which phases can fire it today

- **Combat: yes** — every landed hit with a dealer (attack, retaliation, Cleave, Mauron splash, Yeti's
  reflection, Fel Spikes volleys), both sides.
- **Recruit / End of Turn / hero powers: no** — not because the cue is missing but because the mechanic cannot
  fire there: `noteDamageDealt` is reachable only from the combat damage site; the recruit factories for both
  markers are explicit no-ops. The hook is shaped for the day one does: the binding kind is a plain string a
  future `RecruitMomentKind` twin can share, and `runRecruitMomentCues` → `fireLand` already plays a binding on a
  shop card with `uids`, so the medallion part resolves there too.

## Verifying it

- `npm run harness` — the second matchup prints the `⚑` line as the last thing before the final death.
- Tests: `packages/core/src/combat/pummelTrigger.test.ts`, `packages/ui/src/choreo/channels/pummelFired.test.ts`,
  `packages/ui/src/choreo/pummelTrigger.test.ts` (beat structure, the cue, real fights — the LAST-EVENT case
  proves a `pummelTrigger` as the final event of the log still produces the beat + the `playDef` call),
  `packages/ui/src/choreo/finalHold.test.ts`, plus the mechanic tests listed above.
- DEV: the Scene Builder with Goldvein (2 Attack) against three 1-Health / 0-Attack dummies reproduces the
  last-attack case; the console handle `__fx.play('pummel-trigger', __fx.anchors('<uid>','<uid>'), { uids: {
  source: '<uid>', target: '<uid>' } })` plays it on any board minion's medallion without a combat; the FX
  Workbench library shows it bound at `pummelTrigger`.
