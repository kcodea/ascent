# 2026-11-01 — Every Duos send streams from its source (R-DUOS-PASS-FLIGHT-01)

Owner (on a Matchmaker screenshot): "anytime a card passes something like this, or like disco, show the passing
animation from the source card into the teammate's portrait, just like we do for handout. from the discover selection,
the card(s) that is passed should fire that animation".

## Before

Only a spell's pass (`via: 'spell'`, Handout / CueBee) and a manual drag animated on the sender's screen. Matchmaker's
pass also had `via: 'spell'`, but its card was born in the pick (a fresh uid nothing on screen carries), so
`playSpellPass` found nothing. Every team gift (Disco's other options, Antsy, Toot Toot, Monstrocity, rune gifts, Gold
Gifter) was silent.

## What changed

- **Engine, presentation only.** `DuosOutboxEntry.src` (`{ uid } | { discover } | { rune } | { equip }`) names what
  sent the entry on the sender's screen. Stamped by: `shopArena.sendTeam` (the body), Disco and Matchmaker (the option
  index), the Duos runes (their id), `activateEquipment` (forced to the Equipment), and two restamps for cards an action
  just made (`takeDiscoverPick` -> the option; `reduce` for `play` / `buy` -> the acted-on uid, since a bought card takes
  a fresh uid). Team gifts only for the restamps: a card pass keeps "the card itself". Never read by gameplay, never on
  the wire (`duosWireOf` sends the card only).
- **Combat.** `teamSend` carries the sending body's `uid` (`EffectContext.sendTeam`'s new `srcUid`). A rune meter's gift
  has no body: the UI falls back to the rune badge, then the hero portrait.
- **UI.** `passLob.ts`: `passFlightOf` (pure mapping), `passFlightEl` (the element), `playPassFlight` /
  `playEntryFlight` (once per entry; a network retry does not re-fly). A leaving card dissolves (`playSpellPass`, as
  before); a Discover option dissolves its face; a card that stays streams from itself (its face dissolves only when the
  gift is that very card, a Monstrocity copy: a random gift is the receiver's pick, so the sender cannot know its face).
  Hooked in `duosAfterRun` (match) and `sbDuos` (Scene Builder rig; combat entries wait for `releaseCombatFx`).
  `duosCombat` notes each `teamSend`'s body as the beat is reached.

## Notes

- Versus-resolve: the core change only adds an optional field to an event; no gameplay result moves.
- Watching your teammate: nothing plays (`ownRunWhileWatching`), as before.
