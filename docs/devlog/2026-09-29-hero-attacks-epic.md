# 2026-09-29: the first Epic hero attacks, Card Shark and Storm Call

Owner ask (2026-09-29): "branch off and build 5 animations that range from rare -> epic. all of the animations we have
done so far are legendary. rare and epics should only have 2 or 3 tiers to them and generally be less exciting, but
still extremely clean and fun. get creative". Another session builds the three Rares; this branch builds the two Epics.

## What an Epic is here

- One strong idea, shorter than the Legendaries (about 1.1 to 2.5 s after the damage formation), no giant cinematic.
- THREE visual tiers, not four. Every style still reads the SHARED tier (`attackTier`: 6 / 12 / 20, a knockout is IV), so
  the thresholds and the knockout rule stay in one place; each Epic maps it locally (`cardsLevel` / `stormLevel`):
  I small, II and III medium, IV big. `plan.tier` stays the shared tier (the knockout test reads it); `plan.level` is the
  look. Per-look dials are `v1..v3` keys (Small / Medium / Big groups in the tuner).
- Built on the shared core like every style: the damage formation, one clock that never pauses, the consequence once on
  the impact beat, the `#stage` camera, portraits by transform only, pooled and capped Pixi, reduced motion as fades.

## Card Shark (`attack_cards`, Epic, placeholder name)

A poker hand climbing the ranks. Faces are painted on canvas at 96 x 134 (plain pips and letters, nothing copied): near
white paper with the ink baked in, tinted ivory at rest and GOLD for the flush (the paper turns gold, black ink stays
black), so the gilding needs no second set of faces. The back is painted in its own colours.

- Small: the Ace of spades snaps into the hand and is flicked, spinning, into the struck hero. It sticks EDGE FIRST: the
  card turns so its top edge leads along its heading and `embed` of it sinks past the contact point, with a slit flash.
- Medium: three Aces (hearts, diamonds, spades) thrown thunk thunk thunk; the first two are ticks, the third the blow.
- Big: the royal flush is dealt face down into a hand fanned upright in front of the hero (kept inside the view), flipped
  one by one (10, J, Q, K, A), gilded with a flash and a glint sweeping each card, held a beat, fired together, and
  bursts into card confetti (chips and suit pips that flutter as they fall). The burst is the blow.
- A card is three sprites on one transform (glow, card, flash) plus two faint spin ghosts sampled back along its flight.
- Stuck cards stick clear of the big -N (a wider berth than the darts: a card's body trails back along its flight) and
  ride the struck portrait's knockback, then fall away.

## Storm Call (`attack_storm`, Epic, placeholder name)

- Every bolt is three additive strips (glow, body, white core) over one centreline of 24 points; its jag is REGENERATED
  every `regenMs` (45) from the seeded generator, two octaves (a coarse wander and a fine crackle), ends pinned. The
  leader races out first (the far end collapsed onto the moving head), a hot restrike, then a flicker and a fade. Side
  forks and static are 10-point arcs drawn once per regeneration (a crackle, not a per-frame shimmer).
- Small: a crackling arc and a zap. Medium: a trunk that forks at 62%; the branches strike 150 ms apart (tick, then the
  blow) and static crawls over the struck portrait while it jitters (a fixed 30 ms stutter). Big: the hero thrusts a thin
  call up; a cloud of normal-blend billows gathers over the target, rumbles and lights up from inside twice, then drops a
  thick strike with a screen flash, a ring of sparks, a shock ring and lingering static while the cloud breaks up.
- A hero at the top of the screen has no room above it: the cloud rolls in over the top edge and hangs just over the
  portrait, so the strike still DROPS onto the face (a first cut slid the cloud sideways and the strike read as a beam).

## The camera is applied once (`heroAttack/stageCamera.ts`, #1851)

Since #1762 the FX canvas lives inside `#stage`, so the DOM camera already moves it; the Banana PR (#1839) found styles
mirroring the camera onto their Pixi root as well (applied twice, FX overshoot at peak zoom). The branch first carried
its own `heroAttack/cameraMirror.ts`; on merge (after #1851 landed) both Epics switched to #1851's shared mechanism,
`new StageCamera(cameraEl, scene, heroFxCanvas(o))`, and `cameraMirror.ts` was deleted (one approach only). Both are in
the all-styles camera test (`heroAttack/stageCamera.test.ts`), canvas inside and outside the camera.

## Perf

Measured in a dev build in the Browser pane (Chrome, ANGLE), stepping the real runner and scene by 16 ms with a manual
clock and timing `update` + the overlay render + `gl.finish()` per step (the pane was hidden, so real rAF frame
intervals could not be sampled; this is the attack's own work per frame):

| run | steps | p50 | p95 | p99 | worst | peak sprites | peak strips |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Card Shark big (you) | 415 | 0.0 | 0.2 | 0.7 | 3.0 | 107 | 0 |
| Card Shark big (foe) | 415 | 0.0 | 0.2 | 0.3 | 1.0 | 107 | 0 |
| Card Shark medium | 332 | 0.0 | 0.2 | 0.5 | 1.7 | 49 | 0 |
| Card Shark small | 300 | 0.0 | 0.1 | 0.3 | 0.5 | 22 | 0 |
| Storm Call big (you) | 402 | 0.0 | 0.2 | 0.8 | 3.7 | 79 | 21 |
| Storm Call big (foe) | 402 | 0.0 | 0.2 | 0.3 | 0.9 | 79 | 21 |
| Storm Call medium | 320 | 0.0 | 0.2 | 0.5 | 1.7 | 33 | 29 |
| Storm Call small | 296 | 0.0 | 0.1 | 0.2 | 0.6 | 16 | 13 |

ms, 0.1 ms timer resolution. Hard caps: Card Shark 600 sprites; Storm Call 500 sprites and 64 strips (every strip at most
48 vertices, under Pixi's batch limit). Textures are painted once per session (Card Shark about 580 KB, Storm Call about
130 KB of their own, plus the shared Blast / Arcana set) and pre-warmed on the GPU during the damage formation; bolt
vertices are rewritten in place; nothing reads layout after the opening measure. Worth a PROD-build rAF pass with the
pane visible before the owner signs off (as with the other attacks).

## Sound (existing clips, one tuner row each)

Card Shark: `cardtouch` (draw), the stereogenic swish + whip snap (the flick), `fel-spike-echo-land` + `smack1` (thunk),
`flurryhit` / `crit` (impact), `cardlanding` (deal), `reordercard` (flip), `triplereward` + the sparkle whoosh (the gold
reveal), `turnexplosion` pitched up (the burst). Storm Call: `turncharge` (charge), `fx/blue-impact-hit` (zap), `crit`
(crack), `flurryhit` (impact), `divineshieldbreak` pitched up (static), `windup` (the call), `fx/heavy-rock-impact` pitched
down (the rumble), `turnexplosion` pitched down (thunder).

## Crate odds (first crate)

Epic now holds 12 items (was 10): each Epic 1.25% (15 / 12); each Legendary stays 0.33% (5 / 15, after Grave Call, the
Stampede and the Banana Cannon merged). By category: titles 58.1%, minion skins 32.9%, hero skins 2.5%, hero attacks 6.5%.

## Owner to-do

- Rename "Card Shark" / "Storm Call" if you like (the ids stay). They reach the database on the next deploy of
  `progression-inventory` (the catalog sync). No SQL.
- Oracle R-PROG-ATTACK-26 (Card Shark) and -27 (Storm Call): picked clear of 17-19 (Undead, Beast, Banana), 21 (Bleed,
  #1847), 25 (the double-camera fix, #1851) and 22-24 (left for the Rares). Renumber on merge if taken.
- Done on merge: the runners use #1851's shared `heroFxCanvas` / `StageCamera` fix; `cameraMirror.ts` is gone.
