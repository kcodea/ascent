# 2026-10-11: Demon-damage buffs play at the hit, with tendrils (R-DEMON-DMG-BEATS-01)

Owner ask, 2026-10-11:

> rad rachel needs tendrils to demons she buffs, and let's make sure if we have an effect like this/ruinous lord, the
> other effect etc when a minion is buffed from dmg dealt by demons, it should have its beat happen in real time. for
> example, with gasket, when gasket winds up and ralliy procs, damaging the units it does, rad rachel's tendrils should
> go out THEN, before the gasket's attack goes off.

## What was wrong

The engine was already right: every landed Demon hit emits its `dmg`, then the `friendlyDemonDealtDamage` reactions
buff on the spot (Rachel, Ruinous Lord, Todd, Leech, Axeman). The presentation was the problem, and only for WAVES:

- A wave pass (Gasket's Rally, a Fel Spikes volley) is one moment, and every event in it shares the wave id, so the
  reactions' buffs were folded into the pass. The `damage` kind has no `buffCast` cue, so they drew no tendril at all,
  and the badge hold placed for them was never released by a strike: the numbers appeared when the hold timed out
  (~2 s), long after the swing. (The Gasket devlog's "the tendril channel groups per (source, target)" was never true
  for a pass.)
- A melee hit was already fine: `deferClashBuffs` slides the reactions past the clash, and they compile to their own
  `buffWave` moment right after it, before the next attack, with tendrils.

## The fix (presentation only)

- **Split the pass.** `choreo/hitReactions.ts` `hitReactionStart` finds a pass's trailing buff run (already at the tail,
  courtesy of `deferClashBuffs`) and, when any buff in it belongs to an effect the presentation registry gives
  `ownBeat`, `compileMoments` makes it its own `buffWave` moment (`hitReaction: true`). `buildBeats`, the equivalence
  oracle, mirrors it. Contiguous split of the replay's own order, so the folded frame is unchanged.
- **The registry decides.** `factory:onFriendlyDemonDamageBuffTribe:friendlyDemonDealtDamage` was already `ownBeat`.
  `factory:onFriendlyDemonDamageBuffSelf:...` (Impossible Todd / Leech / Axeman) moved from `foldedCue` to `ownBeat`,
  so Todd's Imp buff takes the same beat (judgement call; it had no Shop body, so nothing changes there). A
  `foldedCue` reaction still folds into its pass.
- **The clock.** `holdMs`: a reaction beat starts `HIT_REACTION_LEAD_MS` (200) after its pass; whatever follows it
  waits at least `HIT_REACTION_READ_MS` (640: the demon tendril's ~384 ms flight plus most of the roll). The parked
  swing (`wavesAheadOf`) keeps parking through the reaction beats, so Gilded Gasket is: wind-up, pass 1, reactions,
  pass 2, reactions, strike. Fel Spikes: `echoDeliveryLead` holds the next volley `READ` after a reaction beat and
  `scheduleEchoVolleys` pushes each later spike back by the same amount, so spikes still connect on their damage beat.
- **Tendrils.** The reaction beat is a `buffWave`, so the existing `buffCast` channel draws them: `groupBuffCasts`
  merges per (source, target), so one tendril per buffed minion per source per pass, from that source, in its tribe's
  ribbon (`tendril-trail-demon`). A full Gilded 7v7 pass with Rachel + Lord fires up to 11 hits x 2 reactors (~130
  buff events) and draws 8 tendrils. Rachel buffs ALL your minions (her text), so she sends a tendril to every
  friendly minion, not just Demons (the owner said "to demons she buffs"; flagged).
- **Shop.** `fireShopDemonDealtDamage` opens a nested trigger per reaction under the hit (`withRecruitTrigger`, the
  registry identity, `discardIfEmpty`), so the batch (End of Turn, Beat Lab) places each at its hit. The mid-turn
  replay coalesces to one tendril per target per `fxWave`, which swallowed Ruinous Lord's ribbon whenever Rachel
  also buffed that Demon; each reaction's records are now tagged one wave per (pass, source).

## Perf (prod bench builds, `VITE_PERF_BENCH=1`, `vite preview`, Browser pane at 240 Hz)

A/B against a baseline bundle of `origin/main` (f3d771343), same pane, same scene, `__bench` injection:

| Scene | Build | Frames | Frames over 9.4 ms (a missed 160 fps frame) | FX tick p99 / max |
|---|---|---|---|---|
| Gilded Gasket + Rachel + Lord + 4 (0-Attack, so only Gasket swings) vs 7, 14 s | main | 2050 | 480 | 2.7 / 13.0 ms |
| same | this branch | 2016 | 464 | 3.6 / 7.9 ms |
| Gilded Gasket + Rachel + Lord + 2 Demons + 2 vs 7 (everyone swings), 22 s | main | 3286 | 663 | 3.5 / 17.2 ms |
| same | this branch | 3219 | 648 | 3.8 / 24.8 ms |

- **No regression.** Same over-budget frame count within noise on both scenes.
- **The tendrils are not the cost.** 9 x `tendril-trail-demon` fired every 420 ms for 5 s on the same page: 0 frames
  over budget at full particles (peak ~3,950), so no fan budget was added.
- **A pre-existing cost was found, NOT caused by this change:** in both builds a Rachel fight drops to ~70 fps
  (main-thread work per frame ~13-15 ms, measured rAF-to-post-paint) from about the third Gasket swing onward, while
  nothing in the FX layer exceeds 5 ms, and a resting board with the same stats runs at 240 fps. It begins once the
  buffed stats have climbed for a few swings and stays for the rest of the fight. Not traced yet; the likely suspect is
  the per-frame badge roll restyling every card (the milestone tiers start at 50). Card CSS is mid-restructure on
  `perf/card-css-restructure`, so it was left alone and flagged.

## Tests

`packages/ui/src/choreographer/demonDamageBeats.test.ts` (13): engine order damage then reaction; plain and Gilded beat
order (pass, react, [pass, react,] strike); one tendril per (source, target) from the right body; a 7v7 pass = 8
tendrils; a melee hit's reaction right after the clash; clock lead/read; the moment list still tiles the log and the
`buildBeats` oracle agrees; same seed same outcome; the Shop's nested beats and per-(pass, source) waves; same Shop
outcome with and without the collector. 8 of them fail on `main`.
