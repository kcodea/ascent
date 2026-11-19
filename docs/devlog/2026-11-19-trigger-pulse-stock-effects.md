# 2026-11-19 — A trigger's effect replaces its medallion pulse (stock slots)

Owner: "what is this medallion pulse called? ... i want to start creating effects to replace it", then "yes, wire
them and tell me what i should save each as in the workbench". Rule: `R-FX-TRIGGER-STOCK-01`.

## What the pulse is

The **trigger pulse** is the medallion's CSS flash and ring (`.cgem.pulsing`, `cgemglow` + `cgempulse` in
`styles.css`): gold by default, yellow for a Rally, light blue for a Watcher, red for Karwind's crit. It fires by
rule on any unit whose effect fires, never per card. Shout (shop) and Pummel already swapped it for an authored
effect when one was bound; nothing else did, so a bound effect played on top of it.

## What changed

- **Stock effects by name** (`choreo/stockTriggerFx.ts`). Start of Combat, Avenge, End of Turn and Rally all use the
  owner's `medallion` def ("use that as the effect for start of combat, avenge, end of turn, and rally. lets ignore
  the others for now"). Echo and Watcher have a slot by name (`echo-stock`, `watcher-stock`) with nothing saved yet.
  `triggerFxFor(cardId, kind)` returns the card's own binding, else the stock def when it exists. A def that does
  not exist resolves to nothing and the pulse stays.
- **Why not a `bindings.json` kind row.** A kind row is read by every `bindingFor` caller, and several ask a narrower
  question: `bindingFor(card, 'watcher')` also decides the Beast bite, the Ale watcher and the epic-fire cue, and
  `ownRallyBindingFor` is asked about every attacker. A global row would have turned all of those on for every card.
  `triggerFxFor` is called only at the trigger's own play sites, and the stock Rally is gated on the Rally keyword.
- **The pulse is skipped when an effect is bound.** The per-beat scan moved into a pure channel
  (`choreo/channels/triggerPulse.ts`) that reads the simulator's own stamps (`key: ...:startOfCombat` / `:onDeath`,
  `avenge: true`) to tell why each unit fired. A unit's pulse drops only when every reason it fired for has an
  effect. Rally (`firePulse`), the Watcher loop and the shop's End of Turn beat make the same check. Sounds are
  untouched.
- **Echo slot.** New binding kind `echo` and an "On Echo" row in the By-card lens. The score's `deathFx` channel
  plays it on a dying card that has an `onDeath` effect.

## Visible today

Start of Combat, Avenge, End of Turn and Rally play `medallion` on the acting card instead of the pulse. Echo and
Watcher still pulse. A Rally card with its own On Rally effect (Chorus Drake, Echohorn, Gasket) shows that instead
of the yellow pulse, and a Watcher with its own On Watcher effect no longer shows the light-blue medallion pulse (the
card-frame bloom stays).

## Not covered

An Echo fired without a death (another card's Rally procs it), a granted Echo or Rally, Start of Turn (it shares the
lightning medallion but pulses from the Start of Turn beat player), the shop-only Watchers, and Karwind's crit pulse.

## Verified

`stockTriggerFx.test.ts`, `channels/triggerPulse.test.ts`; typecheck, lint, full test run and web build.
