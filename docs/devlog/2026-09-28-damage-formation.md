# 2026-09-28: The damage formation, shared by every hero attack

Owner ask (2026-09-28): "we need to change the dmg numbers / should have the tier section pulse with the number showing
up from left to right / have them all flow up and merge into a single numbere / then the hero tier dmg shows / and joins
/ or the minion tier dmg number joins the hero number / and then have the full dmg show / then a moment where it reduces
to the cap / and said damage capped / and then the attack happens / purely a change in how the dmg formation
happens/shows". Scope: "apply it to ALL attacks" (Classic, Blast, Quake, Arcana, Phantom Blades).

First review (after the first push): "dmg tally looks decent, i think it needs to slow down between steps slightly so
it's a bit more obvious what's happening. like when it gets slashed and says capped - it all looks fantastic just needs
to be a bit slower and oomphier in general but it is a great start". The pacing and weight pass below answers it.

Second review, with the owner ready to merge the stack: "do we just remove the green/red number pill from the hero
windup for the normal animation? can you clean up the normal animation so it's a bit more in line with these? i think
slightly slowing down the combination -> capped speed so it's a bit more readable in general is important too", then
"try and match the same speed as how it was for the wind up and normal hit. it should be basic but impactful. dont over
do the zoom/shake." Answered in "Classic" below and the slower join-to-cap defaults. Oracle R-PROG-ATTACK-09.

Stacked on `feat/hero-attack-blades` (itself on Arcana #1798 and Quake #1797). Oracle R-PROG-ATTACK-08.

## The beats

One implementation, `packages/ui/src/heroAttack/damageFormation.ts` (DOM) + `formationConfig.ts` (tuned values and the
pure plan):

1. **Pulse.** Each surviving minion of the striking side, left to right: its tier badge (the star plaque) swells and a
   ring bursts off it, its tier number pops up above it, each with a tick a step higher in pitch. The stagger is
   `min(pulseStaggerMs, pulseSpanMs / (n - 1))`, so a full board compresses instead of dragging.
2. **Merge.** The numbers flow toward the middle of the screen (up off your row, down off the foe's, so the foe's never
   lands under the round title) and land one by one in a minion number that ticks up; the last lands with a slam, a
   glow flare and a shockwave ring.
3. **Hero.** The striking hero's tier number pops in just off the portrait, toward the middle of the screen.
4. **Join.** The minion number flies into the hero number (the default; `joinDir: 1` plays the hero number into the
   minions', and the tuner has a "▶ Other direction" button). I chose minions into hero because the attack starts at the
   hero: the number is already where the style's charge picks it up, and it reads as the hero gaining its army's damage.
5. **Full.** The full, uncapped blow slams in big (a flare, a shockwave, a white-hot flash).
6. **Cap (capped blows only).** The full number holds, then a SLASH hits it: a white flash, a jolt and a rattle, a
   streak of light across it and a heavy sound, and it crunches down to the cap at once (no freeze, see below) and a red "Damage capped" stamp
   slams on at an angle and holds. Uncapped, this beat is skipped entirely.
7. **The attack.** The style's own attack starts exactly at the formation's end (its `leadIn`): the charge absorbs the
   number into the hero and the style carries it to the target; the consequence lands once, on the impact beat, as
   before. Classic does the same on the same clock (`heroClassic.ts`, below).

Reduced motion: the same stages as quick fades (minion numbers, then the minion total and the hero, then the full, then
the capped value and the stamp); nothing moves and no badge pulses.

## The timeline (shipped defaults, base ms; the attack starts at "attack")

| board | join | attack (uncapped) | attack (capped) |
| --- | --- | --- | --- |
| 1 minion | 1640 | 2100 | 3300 |
| 4 minions | 2138 | 2598 | 3798 |
| 7 minions | 2230 | 2690 | 3890 |

After the second review the join-to-cap stretch is slower: join 280 to 320, full hold 420 to 460, capped hold 380 to 520,
count-down 380 to 520, stamp hold 440 to 620. The slash's own hit-stop (110, then 130) was removed with every other
freeze (below). Uncapped stays around 2 to 2.7 s; a capped blow adds about 1.2 s for the slash, the count-down and the
held stamp.

## No freeze frames (third review)

Owner: "all of them seem to have some hit stun freeze frame? i dont want that. remove the freezeing frame from all of the
animations. it looks like lag". Oracle R-PROG-ATTACK-10.

- The shared clock (`heroAttack/sequence.ts`) lost `hitStop()` and the "freeze exactly on the beat" pinning: every frame
  advances it by exactly the time played.
- Removed: Classic's 60 ms, Blast's / Quake's / Arcana's / Blades' per-tier `HitStop` (55 to 150 ms), Quake's slam stop (up
  to 80 ms), and the formation's 130 ms slash freeze (its count-down now starts on the slash). The dials are gone from
  every tuner. Nothing else was lengthened to compensate: the impacts start at their brightest, and the flash, squash,
  knockback, shake, particles and sound carry the weight.
- A test drives every style (and the formation's capped slash inside it) frame by frame and asserts the clock moves by
  exactly the frame time every frame, and that no plan, config or tuner still has a hit-stop.
- Each style's own end time (from its charge, 1600 px apart, tiers I / II / III / IV):
  - Blast 1230 / 1430 / 1741 / 2314 (was 1285 / 1505 / 1836 / 2444, with the hit-stop)
  - Quake (the reworked one from main: boulders I-III, the earthquake at IV) 1346 / 1616 / 1910 / 1810 (slam 230 / 270
    / 330 / 380, impact 690 / 860 / 990 / 660); its slam stop and eruption hit-stop were removed on the restack
  - Arcana 1328 / 1673 / 2073 / 2574 (was 1388 / 1748 / 2168 / 2714)
  - Phantom Blades 1412 / 1692 / 2152 / 2636 (was 1472 / 1767 / 2247 / 2786)
  - Classic about 1760 (was about 1820 plus a little more on big blows); its swing is distance-driven, so this is at
    1600 px.

## Classic

`heroAttack/heroClassic.ts` + `classicConfig.ts`. The free default now runs on the same clock as the cosmetic styles:

- The green attack pill on the striking hero and the red damage-taken number on the struck hero are retired, in both
  directions (store fields, JSX, CSS and the old GSAP `choreo/heroStrike.ts` removed; the Hero Duel tuner hides its dead
  pill / tally / strike dials and its Test buttons now play the real Classic).
- The formation's number sinks into the hero, and the wind-up starts halfway through that absorb, so the handoff reads
  as one motion.
- The swing is the ORIGINAL one, per "match the same speed": the Lunge tuner's `windupDur` / `windupDepth` /
  `windupScale` (power1.out), `contactGeometry`'s distance-scaled strike and its band ease (expo.in), the 60 ms rebound
  and the `elastic.out(1, 0.45)` settle, all at the old 1.15 tempo (`tempo`). Measured on the real portraits: coil 470 ms,
  strike about 300 ms, contact at the smack lead, as before.
- On contact (no freeze): the shared strike burst and smack
  (`playContactImpact`, weight 3.45 as before), a 12 px knockback and 0.07 squash, a 3.5 px shake and a 1% punch (well
  under the Legendary attacks'), and the same big `-N`. No dim, no push-in.
- Reusable for the planned Legendary "enraged" strike: `classicSwing` (the geometry, measured once), `strikePose` (the
  pure pose at any time) and `playHeroClassic({ intensity })`, which scales only the impact, never the swing.

Everything is tunable. The style suites pin each style's own timeline from its charge, so formation tuning never re-pins
them.

## The engine's numbers (additive fields)

The UI never adds a blow up. What it shows comes off the result:

- `CombatResult.enemyDamageBreakdown` (new): the mirror of `damageBreakdown` for a WIN (the player's tier as
  `oppTier`, each surviving player minion's tier). A win used to rebuild its contributions from the replay frame and
  `CARD_INDEX` in the UI; it now reads the fight.
- `DamageBreakdown.survivorUids` (new, both breakdowns): each survivor's combat uid, index-aligned, so the right badge
  pulses (left to right = board order).
- `CombatResult.damageCap` and `playerDamageUncapped` (new): stamped by the run loop where it applies the cap (the
  simulator does not know the round). `damageCap` is absent on uncapped rounds (16 on).
- `mirrorForEnemySeat` swaps the two breakdowns with the damage they explain.

`heroStrikeNumbers` (`heroBlast/heroStrikeDamage.ts`) reads them. An older result (a saved run, an old replay) shows
what it knows: no breakdown means just the blow; no cap stamp means no cap beat and the full number IS the blow. Golden
and determinism tests needed no change (all additive); the replay frame carries the whole result, so new replays get the
fields for free.

## Removed

The per-style combine (`heroAttack/combineNumbers.ts`, the `combineTimeline` helpers, each style's FlyMs / StaggerMs /
SlamPop / HoldMs tier dials, the combine sizes, bias and gather / tick / slam sounds, the scenes' `mergeTick` /
`mergeSlam`), and Classic's old centre tally (the `lossdmg` / `lossfly` DOM and CSS). After the second review the Hero Duel tuner's dead dials are hidden
(left in its config so saved values stay harmless).

## Tuner

Dev hub, "Damage Formation" (🧮): every timing, the pulse strength and ring, every number size, the merge height and
arcs, the count-down, the stamp (size, tilt, slam, when), the join direction and every sound (clip,
gain, pitch). The preview board: minions 0 to 7, tiers spread low to high, the hero tier, a cap (0 = uncapped), and
which attack follows. ▶ You / Foe, Other direction, 1 minion, 4 capped, full board capped / uncapped, No minions, Reduced
motion, 1x / 0.5x / 0.25x, Copy JSON. localStorage in DEV only; production plays the baked defaults.

## Perf

DOM only, written from the style's clock: transform / opacity, plus a number's text when it changes. Every element is
built and placed once; the one `getComputedStyle` per tier badge is at construction (a test fails if painting reads
layout). The badge pulse writes the badge's own inline transform only inside its window and restores it exactly after
(and on cancel). Browser, dev build, a 7-minion capped formation: 0.026 ms of JS per frame on average, 0.1 ms at p95.

## Verification

- Tests: `heroAttack/damageFormation.test.ts` (tuner defaults and clamping, left-to-right order, the cap beat only when
  capped, stage order, the pinned timeline, reduced motion, cue merging, every number equal to the engine's, badge
  restore, no per-frame layout reads, the engine reader incl. old results, all four styles and Classic opening with the
  formation and landing the consequence once, cleanup, slow motion); `sim/damageFormationData.test.ts` (both
  breakdowns with uids, the mirror, the run loop's stamps).
- Browser (own port 5211): a real capped win (Classic: +2 +3 +4 +5, hero +4, 18 slashed to 5, the blow landed once),
  a real uncapped loss (Arcana, foe side); every beat stepped frame by frame and screenshotted; the rings measured
  exactly centred on the real tier badges. After the Classic pass: real fights with Classic (a capped win, an uncapped
  loss with the foe striking) and Arcana (a capped win); each landed once, left no pill and restored every transform;
  both Classic directions stepped frame by frame (coil, contact, the -N).
