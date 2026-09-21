# 2026-09-21 — The damage-meter trigger effect (`payload-trigger`)

Owner ask: *"I made an effect for when cards like Goldvein and Han Gover trigger. Please assign this to when
that happens. This must be wired to work in recruit, combat, end of turn, etc. If it triggers from the last
attack of combat, please make sure it still fires the animation and beat. We are going to give this a keyword,
perhaps Payload. Do not change the text yet, but the effect is called payload-trigger."*

The owner authored `payload-trigger` in the FX workbench (`packages/ui/src/fx/defs/payload-trigger.json`, params
verbatim — 900 ms: a 96-diamond `burst` rising against gravity at 100 ms and a `shockwave` at 90 ms, both on the
SOURCE card's **medallion** (`anchorPart: medallion` → the `.cgem` trigger gem), plus a `sound` layer at 0 ms
playing the library clip `triggerpulse` on the combat bus). This wires it to the moment a damage meter crosses.
No card text changed; no Payload keyword / pill / glyph was added (the keyword is parked — see the memory note).

## The mechanic being presented

The damage-dealt meter (`DAMAGE_METER_MARKERS` in `packages/core/src/types.ts`): Han Gover's `dealtDamageAleMeter`
(every 40 damage → an Ale, lifetime tally, "(Max 2 per hit)") and Goldvein's `dealtDamageGoldNextTurn` (6 damage
→ 3 Gold next turn, once per combat). Both advance in exactly one place — `noteDamageDealt`, called from the
combat damage site (`applyDamage` in `simulate.ts`) for every landed hit that carries a dealer. **The trigger
moment is a crossing that pays out.**

## What changed

### Engine — the crossing becomes an observable event

- **`packages/core/src/types.ts`** — one new `CombatEvent` member (shared-boundary file, kept minimal):
  `{ type: 'payloadTrigger'; source: string; side: Side; marker: string }`. `source` = the body whose meter
  crossed (the same field name `sc` / `rally` / `shout` use for the acting unit, so `momentUnits`, the trig scan
  and the harness's `actingUid` all read it unchanged); `marker` = the meter's factory id.
- **`packages/core/src/combat/simulate.ts`** — `noteDamageDealt` emits it right after the `dmg` that crossed and
  BEFORE the payout's own events (`toHand`), wrapped in `withEffect(dealer, eff, …)` so the event and the payout
  carry the meter's own identity (`key: 'factory:dealtDamage…:passive'`) instead of inheriting the outer effect
  that dealt the hit (a Fel Spikes volley, Yeti's reflection). **Count = one per CREDITED crossing**: a plain
  Han Gover 80-damage hit crosses twice and emits twice; a gilded crossing (two Ales fill the cap) emits once; a
  120-damage hit crosses three times but "(Max 2 per hit)" credits two, so two events; Goldvein's latch means
  one per fight. **A crossing that pays nothing emits nothing** — Goldvein's second crossing in a fight, a Han
  Gover in a pool with no Ales — because there is no trigger to show (the badge already reads "cannot fire
  again"). Emitting touches no RNG; the harness's byte-for-byte determinism check covers it. Before this,
  Goldvein's payout was completely silent (`grantBonusGold` only bumps a counter), Han Gover's was inferable only
  from a player-side `toHand`, and an ENEMY meter was invisible.
- **`combatTrace.ts`** coverage row + projection; **`policies.ts`** — both meter keys move from `passive` to
  `foldedCue` / `react` (the flash rides the hit's beat, claiming credit not time), and the old comment claiming
  "the Gold bank is a `bonusGold` moment of its own" is corrected (no such event ever existed).
- **`packages/tools/src/combat-harness.ts`** — the `⚑ … damage meter TRIGGERS` narration, and a second matchup
  (Goldvein 2/3 vs three 0/1 dummies — the third hit crosses 6 AND ends the fight) so `npm run harness` actually
  prints the event, with its own determinism check.

### Choreography — the beat, the binding, the channel

- **The beat** (`combatBeats.ts` `RESULT_TYPES`): `payloadTrigger` rides the impact run, like `keyword`. It is
  emitted between the hit and the clash's retaliation, and it is a consequence OF that hit, so the clash stays
  ONE moment (`[dmg, payloadTrigger, retaliation dmg, death]`) and the flash lands at the lunge's real contact,
  a hair after the damage number (the def's own 90/100 ms internal `at`s). The alternative — its own beat — would
  have split every clash the way `deferClashBuffs` exists to prevent. `kinds.ts` gets a `payloadTrigger` kind
  (so it is a `BindingKind`, and a synthetic leading instance is never scored as a `damage` moment), paced on the
  `dmg` key; the Beat Lab adapter files it under `reaction` and lists it as a consequence.
- **The channel** (`choreo/channels/payloadFired.ts` + the `payloadFx` row in `score.ts`, on EVERY kind like
  `rallyFx` / `shoutFx`): a per-event scan, counted at the signal — one play per credited crossing, a body that
  crossed twice detonates twice `PAYLOAD_STACK_MS` (240 ms ÷ speed) apart. Plays `bindingFor(cardId,
  'payloadTrigger')` at `anchorsForUnits(uid, uid)` with `{ uids: { source: uid, target: uid } }`, which is what
  lets `playDef` resolve the def's medallion part to the card's `.cgem`. `onPayloadProc(uid, marker, count)`
  reaches the replay whether or not defs can play.
- **The binding** (`bindings.json` `kinds.payloadTrigger → payload-trigger`; golden copy in `bindings.test.ts`;
  `DYNAMIC_CALL_SITES['choreo/score.ts']` 7 → 8). The def is reached through the binding, so the FX library
  reports it `bound`, re-bindable from the workbench, and it appears in the by-event lens under its kind.
- **Dedupe decisions** (`useCombatReplay.ts`): the body is deliberately NOT added to the per-beat `trig` scan —
  the def carries its own `triggerpulse` sound layer and its shockwave IS the medallion pulse, so the stock white
  CSS pulse + `sfx.triggerPulse()` would stack a second pulse and a second copy of the same clip under it (the
  shop's rule for a bound Shout). When nothing is bound at the kind the stock pulse + sound stand in
  (`pulseTrigger`), so unbinding the def in the workbench never leaves a crossing silent. `Card.tsx`'s generic
  counter-pill flourish (`pixiFx.spellPower` on a step-proc tick) stands down for a damage-meter card while a
  `payloadTrigger` binding resolves — otherwise every crossing showed two effects at two positions.
- **Han Gover's Ale beat is untouched**: its `toHand` still pulses the medallion white, plays `ale-bubbles` and
  flies the card, one beat after the flash. That is the consequence reading after the trigger, and both are
  authored — but the `triggerpulse` clip does play twice ~0.5 s apart on a Han Gover crossing (once from the def,
  once from the Ale beat). Flagged for the owner rather than stripped.

### The last-attack case — how it is guaranteed

Every beat's cues fire, the last included, so a crossing on the killing blow always plays. What was NOT
guaranteed was that the end-of-combat hand-off waited for it: the def plays at wall clock (the score never
passes `speed` to `playDef`) while `finalHold` divides by the player's speed — at 4× the fight settled 225 ms
after contact with the flash barely started, and `done` dropped a dead meter body from the DOM under it and
started the hero-strike tally over it. `choreo/finalHold.ts` (pure, tested) now floors the final hold at the
bound def's VISUAL end (`payloadReadMs` — the last non-sound layer's `at + span`, ~980 ms for this def; NOT
`playLifetimeMs`, whose unmodelled-sound tail would add 3 s), wall-clock, plus the stack stride for a double
crossing, in two ways: the last beat's own crossings are scanned directly (Goldvein's third hit into the last
dummy), and a flash fired on an EARLIER beat is waited out through a recorded fire time (`payloadRemainingMs`)
— Han Gover's crossing is followed by its Ale's `toHand` beat and the death beat, and a Target Dummy's deferred
reactor buff can trail even Goldvein's. Skip still deliberately hides it (skipping must reach the same final
state).

### Which phases can fire it today

- **Combat: yes** — every landed hit with a dealer (attack, retaliation, Cleave, Mauron splash, Yeti's
  reflection, Fel Spikes volleys), both sides.
- **Recruit / End of Turn / hero powers: no** — not because the cue is missing but because the mechanic cannot
  fire there: `noteDamageDealt` is reachable only from the combat damage site; the recruit factories for both
  markers are explicit no-ops (`recruit.ts`: "combat-only meter — no damage is dealt in the shop"); the two shop
  Health subtractions (Blaster / Fel Spikes friendly fire) are sourceless and credit no dealer. No reducer, hero
  power or End-of-Turn path deals dealer-attributed damage. The hook is shaped for the day one does: the binding
  kind is a plain string a future `RecruitMomentKind` twin can share (exactly as `shieldGain` does for both
  phases), and `runRecruitMomentCues` → `fireLand` already plays a binding on a shop card with `uids`, so the
  medallion part resolves there too.

## Verifying it

- `npm run harness` — the second matchup prints the `⚑` line as the last thing before the final death.
- Tests: `packages/core/src/combat/payloadTrigger.test.ts` (count / order / key / Warded / no-payout / enemy
  side / last-attack / determinism), `packages/ui/src/choreo/channels/payloadFired.test.ts`,
  `packages/ui/src/choreo/payloadTrigger.test.ts` (beat structure, the cue, real fights — the LAST-EVENT case
  proves a `payloadTrigger` as the final event of the log still produces the beat + the `playDef` call),
  `packages/ui/src/choreo/finalHold.test.ts`.
- DEV: the Scene Builder with Goldvein (2 Attack) against three 1-Health / 0-Attack dummies reproduces the
  last-attack case; the console handle `__fx.play('payload-trigger', __fx.anchors('<uid>','<uid>'), { uids: {
  source: '<uid>', target: '<uid>' } })` plays it on any board minion's medallion without a combat; the FX
  Workbench library shows it bound at `payloadTrigger`.
