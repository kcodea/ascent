# 2026-10-14 · Real-time combat stats + one live text on every surface

Owner: "can you make sure our buffs update in real time in combat? i believe ive seen some that dont, like
veinstorm but im sure there are others." and "also lantern light doesnt show updated spell power related affects if
it's in shop, only in hand. make sure we fix all of this"

Oracle: `R-REALTIME-STATS-01` (`approved/triggers.ts`) and `R-TEXT-SURFACES-01` (`approved/text.ts`).

## Part A: the combat replay shows the engine's stats on the beat

**The audit (permanent, `packages/ui/src/realtimeStatsAudit.test.ts`).** `simulate` takes an AUDIT-ONLY
`CombatConfig.probe` (additive, test-only, one boolean check per step when unset): it hands the live boards to the
caller at every resolution-step boundary and once at the end. The test sweeps random fights of sets 1-4 (the
R-SYMMETRY-01 fixture generator, moved out of `sideSymmetry.test.ts` into `packages/core/src/combat/fuzz.ts` so both
sweeps share it: random boards, run contexts and rune / quest / hero mods) and checks two layers:

1. **The fold.** After every step whose events the replay order (`replayOrder`) has not reshuffled, `computeFrame`
   must show every living body at the engine's Attack and Health.
2. **The delivery.** Every number the replay withholds for an animation (`combatBuffDeltas`) must have a deliverer
   on its own beat: a tendril / pulse cue, the attack wind-up, or `undeliveredRollPlan`.

`RT_AUDIT_SEEDS=1500` runs a deeper local sweep (6000 fights, clean); CI runs 250 per set.

**What it found (all fixed):**

| # | Effect | Root cause | Fix |
|---|---|---|---|
| 1 | Every **Rise** body (Second Wind, Rising Tide, Revenant, any Echo / aura buffing a risen body) | `computeFrame` kept the OVERKILL DEBT of the blow that killed the body (R-DEMON-DMG-DEATH-01's tracker) through the `reborn`, so its next Health buffs paid a debt that no longer existed and never showed | `reborn` clears the debt and restarts the max-Health track |
| 2 | **Rune of Unity** | `syncUnityCombat` gave the Undead Aura to bodies joining the full house mid-fight with NO event | emits a presentation `buff` (not `ctx.buff`: an aura is not a gain, no reactor / carry-back may hear it); the opening pass stays silent because the `initial` snapshot already shows it |
| 3 | A Health buff during a **clash** (Chosen Fiend, Ruinous Lord, Rad Rachel buffing the attacker that the retaliation then hits) | `deferClashBuffs` slid the buff past a later `dmg` on the same body; `dmg` carries the ABSOLUTE remaining Health, which already held the buff, so it was folded twice for the rest of the fight | the moved buff is a copy tagged `prefoldedShareOf = 'health'`; the fold and the badge hold skip that share, the float still says "+A/+H" |
| 4 | A grant on a body **before it is placed** (Solid Ground, an Avenge grant on the token it summons) | the clash reorder and `deferAvengeAfterSummons` slid the buff past its own body's `summon`, whose snapshot already held it | clash: tagged `'all'`; Avenge order: never hops the payoff's own target's summon |
| 5 | Every **Ruby** outside an attack wind-up (Gemstorm's Avenge, Blazer, Kobaby Boldies, a Shout that casts Rubies, Spots) | the replay withholds the number for the gem to deliver, but the authored `ruby-gem-apply` def carries no number, so it snapped in on the NEXT beat (this is the "Veinstorm" the owner saw: the Ruby family) | `choreo/buffDelivery.ts` names what no cue delivers; the per-beat cue effect rolls each one in as its gem lands (`RUBY_GAP_MS` cascade + `AUTHORED_BUFF_ROLL_MS`) |

Veinstorm itself only casts on the Shop since 2026-10-13 (R-STORMCHASER-01), so it changes no combat stat; the combat
Ruby path was the delay.

## Part B: one live text on every surface

**Root cause of the owner's report:** the Shop SPELL SLOT (`spellView` in `Recruit.tsx`) built its own opts literal and
never passed `tier`, so Lantern Light read "+1/+1 for each Tavern Tier" there while the copy in hand read its total.

**Generic fix:** every surface builds its inputs through one builder and prints through `liveCardText`:

- `liveOptsFromRun` now also carries the rune rule notes (`runeTextFlagsOf`), the Mammoth switch, the tier ceiling,
  Rune of Mastery's repeats and the banked next-spell bonus (so a Gift subtracts it everywhere, not only in hand);
- `shopOfferOpts(run, offer, extras)` = `liveOptsFromRun` + what only an offer has (price, buy auras, cast badge); the
  Shop row AND the spell slot use it, and their memos key on the whole `run` (complete by construction; the per-offer
  signature cache still skips unchanged offers);
- the Shop spell branch of `shopView` prints through `liveCardText` (it had its own `spellDisplayText` extras: no
  Falling Embers on Star Crash, no Rune of Gambling wording);
- the hover popup (`tokenRefView(..., live)`) and the combat cast preview / fly-in (`conjuredView`) take the full
  inputs; Discover is `discoverCardText`; the hand is `handLiveOf` + `handCardView`, which now also passes Rune of
  Living Growth's accrual (a Growth in hand read 2 below its real value) and the run's tribe overrides.

**The audit** (`liveTextAudit.test.ts`, R-TEXT-SURFACES-01) builds every surface with those exported builders under
run states that move every live input, and requires: every spell of sets 1-4 prints the HAND's text in the Shop row,
spell slot, Discover, hover popup and cast preview; every minion offer prints Discover's text in the Shop row and when
conjured into hand. Combat `Unit` text and the end screen are already covered by the existing combat live-text tests
(`liveSpellTextInCombat.test.ts`, `docbotLiveText.test.ts`); the Compendium prints base text by design.

## Performance

Headless timing (the browser pane was not used), the 12 busiest fuzz fights (322 to 1525 events), every beat folded the
way the replay folds it (`computeFrame` + `combatBuffDeltas`), 3 passes, vitest on this machine:

| | per beat | `replayOrder` + `compileMoments`, once per fight |
|---|---|---|
| `main` | 96 to 100 us | 0.40 to 0.56 ms |
| this branch | 99 to 115 us | 0.56 to 0.58 ms |

Within run-to-run noise. The added per-event work is one `WeakMap` lookup per `buff` event; the per-beat roll plan
loops that beat's events only; no DOM reads were added. The Shop / spell-slot / hover memos now key on `run`, but the
per-offer signature cache (`buildShopViews`) and `stabilizeView` / `stabilizeRefMap` still return the previous view
objects for unchanged cards, so `Card` memos hold exactly as before.
