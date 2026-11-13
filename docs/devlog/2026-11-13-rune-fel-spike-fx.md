# 2026-11-13: rune hits throw fel spikes (R-RUNE-SPIKE-FX-01)

Owner: "for pitchforks and other similar runes/effects, use the fel spikes animation". The Set 2 runes that deal
effect damage to enemies (Pitchforks, Imp Legion, Hellfire, Wildfire, Mirror Sheen; no other new rune does) now play
Mike's authored `fel-spike` def, with its own launch and landing sounds. The def itself is untouched.

## How it plays

The Fel Spikes contract (`launchOnDeath`): the spike launches a beat early and the hit beat is held for its travel
(launch 120 + the def's target `at` 270 + the 80 ms read buffer), REPLACING the base hold, so each number lands as its
spike connects and a fight is not longer for it.

| Rune | Spike leaves | Notes |
|---|---|---|
| Pitchforks | the summoned Imp | 2 targets; a reaction that splits the two hits gives each its own spike + beat |
| Imp Legion | the dying Imp | a new `questTrigger` (the badge pulse) splits its Echo hit off the death beat |
| Hellfire | the Demon that attacked or died | one wave per volley: ONE spray at every enemy; the attacker parks reared back (`wavesAheadOf`) and strikes after |
| Wildfire | the enemy that died | the fire spreads out of its body, from its remembered slot once the row has collapsed |
| Mirror Sheen | the minion that lost its Ward | |

## Plumbing

- **Engine (presentation only, no outcome change):** `tagRuneHit` stamps a rune hit's OWN event (`dmg`, or the Ward pop
  that absorbed it) with `key: 'rune:<runeId>:hit'` + `srcCard`; the rune's `questTrigger` gains `from` (the body the
  effect comes from; a new optional field, not `source`, so the stock quest-trigger def stays dormant). Hellfire and
  Wildfire's hits are wrapped in a bare `waveN` tag (not `withWave`, so Demon-reaction queueing is untouched); their
  deaths stay outside the wave. Imp Legion's grafted Echo logs a `questTrigger` (`from` = the Imp) when there is an enemy.
- **Bindings:** rune ids are now valid `cards` keys in `bindings.json` (`rune_hellfire.damage` → `fel-spike`,
  `struck`, `launchOnDeath`); `bindings.test.ts` accepts `RUNE_INDEX` ids.
- **UI:** `choreo/channels/runeHits.ts` (pure: which hits are a rune's, grouped per rune + source); `useCombatReplay`
  launches (`scheduleRuneSpikes`) and holds (`runeSpikeLead`); `score.ts` claims the stock hit burst on the struck
  units; `fx/combatAnchors.ts` `anchorsFromRectToUnit` throws from a remembered rect (`rememberRuneSourceRects`).

## Verified

Headless (private Vite on 5301, live backend blocked), Scene Builder Set 2 with each rune bought through `buyRune` and a
pinned foe: contact sheets show the spikes leaving the right body and the numbers landing on connect for all five.
Perf: a 19-volley Hellfire fight (4 Demons, 7 enemies) against the same fight with the five bindings tombstoned; see the
PR for the frame-time numbers.
