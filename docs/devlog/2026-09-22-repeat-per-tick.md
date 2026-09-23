# 2026-09-22 — Repeat per tick: Mother Moss and Kringle land one buff per beat

Owner ask, verbatim: *"mother moss's animation and mechanic doesnt trigger each individual tick. neither does
kringle. both of these cards need to be 'give x' and 'repeat for every blah blah'. so mother moss and kringle
give the individual stat buff and repeat it x times. there are different ways of building these buffs. for
example, a lot of our stuff is... give a minion +x/+y, +a/+b for every c you played. that should give a lump
sum amount in one instance. however, if something says 'give a minion +x/+y. repeat for ever c played this
turn.' that should give the base buff and repeat it z times for every c played that turn. both kringle and
mother moss should function with the repeat logic. their animation beats will also naturally be longer since
they'll spew out all of the different buffs repeated times instead of 1 per target."*

## The two-pattern rule (R-REPEAT-01)

| wording | resolution |
|---|---|
| **LUMP** — `give … +x/+y, +a/+b for every C you played` / `+x/+y for each C` | ONE instance, magnitude = count × rate. One tick, one beat, one ribbon per target. |
| **REPEAT** — `give … +x/+y. Repeat for every C played this turn` | the BASE once, then once per C: `1 + count` ticks, EACH its own state delta, its own buff-FX event (`fxWave` = the tick), its own root trigger and beat. Random targets re-roll per tick; fixed targets are hit every tick. |

The rule is in the oracle as `R-REPEAT-01` (`packages/rules/src/registry/approved.ts`, 83 approved / 169
rules) and in `docs/GAME-RULES.md` beside R-TEXT-01.

## The one-line diagnosis

Both cards already computed the right TOTAL in the sim. Neither produced a per-repeat SIGNAL on the path the
game actually plays. End of Turn is the Choreographer's authoritative batch by default (`CHOREO_EOT` is
opt-out since 2026-08-13), and on that path each (card × Chronos repeat) was ONE trigger scope whose close-diff
emitted ONE `statsChanged` per target with the SUMMED delta. Mother Moss's `1 + n` picks and Kringle's `n`
waves each collapsed into one beat with one ribbon per distinct target. Kringle's 2026-08-29 itemization only
ever reached the legacy `recruitBuffFx` + `fxWave` channel (what `ascent.choreo = '0'` restores), and Mother
Moss never had per-fire capture on either channel.

## What shipped

**Sim (`packages/sim/src/recruit.ts`).** One shared tick count, `eotTickCount(state, effect)` (Mother Moss
`1 + Spirits played`, Kringle `1 + cards played`, everything else 1) and its per-card max `endOfTurnTicksOf`.
The factory payload gained `tick`; a factory resolves the ONE tick it is handed, or every tick when a
single-shot caller (Djinn's replay) passes none (`forEachTick`). `applyEndOfTurn` opens one ROOT
`withRecruitTrigger` per (card × effect × Chronos repeat × tick), never nested: the compiler places children
at the parent's delivery, all at once, and the scope diff would sum them. The repeat fields carry
`repeatIndex: r × ticks + t, repeatCount: repeats × ticks`, so Beat Lab reads "fire k of N" honestly and a
plain effect emits exactly what it did before. `projectEndOfTurnSteps` projects one beat per tick with the
same count, and the legacy runner in `Recruit.tsx` builds one beat per tick from the same helper, so the
projection and the beat list stay 1:1. Parliament of Flame's `fires` still counts triggers (card × Chronos
repeat), never ticks.

- **Mother Moss** (`endOfTurnBuffRandomTribeRepeatPerPlayed`): one `pickRandom` per tick, each inside its own
  `captureBuffFx` tagged `fxWave = tick`. The draw count and order are identical to the old all-in-one loop, so
  the commit, the projection and a replay roll the same targets. The pool still includes Moss itself (a self
  pick reads as a pulse, as accepted 2026-09-15) — flagged as an owner fork against R-TARGET-03, not changed.
- **Kringle** (`endOfTurnBuffEndsTribePerCard`): the REPEAT form. `eotRepeatTick` buffs both deduped ends
  inside one capture per tick, fires `onGainAttack` per end per tick (Kneel / Tankerchief / Hunter pay once
  per tick) and records `gainAttackFiredUids`. **Balance change, stated plainly:** `n` cards played used to
  pay `n ×` (+1/+2); the repeat form pays `(n + 1) ×`, and a turn with nothing played now pays the base once.
  Old vs new per end: n = 0 → +0/+0 vs +1/+2; n = 1 → +1/+2 vs +2/+4; n = 3 → +3/+6 vs +4/+8. Gilded +2/+4
  per tick. Striker keeps `eotPerCardWaves` untouched (LUMP text, n itemized waves inside one beat).

**Text.** Kringle: *"**End of Turn:** give your **left and right-most Dwarves +1/+2**. Repeat for every card you
played this turn."* (gilded +2/+4). Live (`perCardPlayedText`): the per-tick rate stays printed with both
halves and the count is folded in Mother Moss's house style, *"… this turn {{(×4)}}"* with 3 cards played.
Both chains (`liveCardText` for shop/board/hand/Discover; `Unit.tsx` for combat, which feeds the whole
`playedThisTurn` list on the player side) read the same helper. Mother Moss already printed `(×N)`.

**Presentation.** `Recruit.tsx`'s per-action watcher now paces TAGGED waves apart with `waveGapFor`, so a
Squirl Scout play or a Dragonflame cast (both now capture one tagged event per repeat) reads as repeats rather
than one burst; untagged actions replay exactly as before.

## The audit (every card whose text says "Repeat")

| card | before | after |
|---|---|---|
| Mother Moss (EoT) | per-fire in the sim; summed into one beat / one ribbon per target on BOTH channels | one root trigger + one beat + one ribbon per tick, fresh pick per tick |
| Kringle (EoT) | LUMP text; `n ×` one lump; n `fxWave` waves on the legacy channel only | REPEAT text; `(n + 1)` ticks, each its own root trigger / beat / wave / watcher fire |
| Squirl Scout (Battlecry) | per-rep `addBuff`; one capture → one summed ribbon per target | one tagged event per rep, paced apart on the play path (count unchanged: `beasts`, itself counted — owner fork) |
| Dragonflame (shop cast) | per-rep `addBuff`; one sourceless capture | one tagged descend per rep, paced apart. Combat cast (Flamebeat / Warflame) unchanged: one `buffWave` moment (combat channel, out of scope) |
| Rocket Power (Shout, shop row) | one summed `addOfferBuff` of `(1 + n) ×` | `1 + n` ticks, one `buffThisShopOffers` call each at the per-tick rate (review fix): the offer ledger counts the ticks (Inspect "Rocket Power ×3", the bought body inherits the count), the total is unchanged, Twinning still hears ONE `starformGained` (the token's growth is a per-action boundary diff, never per call). Live text moved to the house style, `(×N)` on the Repeat sentence. Still open: the row has no per-offer buff-FX channel, so its ticks re-render once. |
| Drunken Oaf (archived, SoC) | one combat `buff` event per rep, one summed moment | unchanged (archived; combat channel) |
| Striker (LUMP text) | n itemized waves in one beat | unchanged, pinned |
| Baby Gastrid (LUMP) | one instance | unchanged, pinned |

## Verification

`packages/sim/src/repeatPerTick.test.ts` (25): totals at n = 0 / 1 / 3 for both cards, the per-tick FX
signal in order, Moss's deterministic per-tick re-roll (same state → same targets; the projection's throwaway
clone lands on the committed board), gilding, the lone-Dwarf dedupe, Tankerchief once per tick, Parliament
counting triggers, Chronos repeating the whole sequence, and one pin per audited card.
`packages/ui/src/choreographer/repeatPerTickBeats.test.ts` (9): one ROOT trigger per tick with the factory
identity and `repeatIndex / repeatCount`, beats placed one after another, the timeline duration growing with
the count, the player's projection showing exactly one tick after the first beat, the legacy beat list matching
the projection 1:1, and prepared == reduce byte for byte. Existing pins moved to the new contract:
`balanceBatch0804`, `balanceAug15`, `set2Dwarves`, `set3Dwarves` (Kneel once per tick through Kringle),
`socEotTendrils` (6 per-tick `statGain` calls for 2 cards played), `promisedNumbers`, `cardText`.

Verified in the browser on port 5220 (see the PR): Mother Moss with two Spirits played plays three separate
buff beats; Kringle with three cards played plays four, each rolling +1/+2 onto both ends.

## Review pass (same day)

The review found Rocket Power pinned as a lump against its own REPEAT text, and showed the second deferral
reason was wrong: `reduce` fires `starformGained` from a per-action boundary diff (`fireStarformGainRemainder`),
so a per-tick loop cannot multiply Twinning. Fixed in the sim (`1 + spells` calls of `buffThisShopOffers` at the
per-tick rate; the ledger counts ticks, the total is unchanged), pinned with the Twinning single-delta test, and
the live text moved to the `(×N)` house style. `repeatPerTick.test.ts` is 26 tests now. Not changed: the row cue
(the Shop has no per-offer buff-FX channel; a new channel is presentation work, an owner fork), and the four
owner forks below. Rejected as behaviour changes without a ruling: excluding Moss from its own pool, Squirl
Scout to `1 + Beasts`, a per-fire `wave` on the combat `buff` event (a shared-types boundary; on the roadmap), and
an End-of-Turn accelerate policy past N ticks (the owner accepted the longer sequence; also on the roadmap, with
the reviewer's numbers: 710 ms per tick per card, so two REPEAT cards at 8 plays spend ~12.8 s). `npm run perf`
ran green after the fix; the headless harness does not cover the End-of-Turn beat sequence, and no prod-build
DevTools profile of a long End of Turn has been taken yet.

## Owner forks surfaced, not decided

1. Mother Moss keeps itself in its random pool (R-TARGET-03 says a random-friendly picker excludes the source).
2. Striker prints the LUMP form and itemizes n waves inside one beat — left as is.
3. Parliament of Flame counts triggers, not ticks (pinned; flip it if the owner wants ticks).
4. Squirl Scout reads "Repeat for every Beast you own" as `beasts` fires with itself as the base, not `1 + beasts`
   (R-REPEAT-01 now says so explicitly, so the rule is not read literally against it).
5. Rocket Power's shop ROW has no per-offer, per-tick cue: the sim ticks, the row re-renders once.
6. Combat-phase repeats (Oaf, a combat-cast Dragonflame) still collapse into one `buffWave` moment; per-tick
   separation there needs a `wave` tag on the combat `buff` event (a `types.ts` boundary change).
7. End of Turn grows linearly with the tick count (no cap, no acceleration past N ticks).
