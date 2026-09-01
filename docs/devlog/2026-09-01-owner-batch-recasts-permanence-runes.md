# 2026-09-01 — Standard Bearer, the Hoardflame grant, and what a re-cast means

Three owner items, and the third turned into a rule the whole `spellCastOnThis` family now follows. Each one
got a generalized Doc Bot lane rather than a pinned test, because two of the three were the *third* time their
shape had shipped.

## Standard Bearer loses permanence

> *"standard bearer's buff to Rally: give a friendly minion of each type +3/+3. (it loses permanent)"*

`+2/+3 permanently` → `+3/+3` for the fight. It shares `onRallyBuffOnePerTribe` with Paragon, and permanence
was the only thing the two disagreed about, so the factory took a `permanent` param (absent = permanent, which
keeps Paragon exactly as printed) instead of being forked. Splitting them would have left two copies of the
pick-one-per-tribe rule to keep in step, which is a worse trade than one boolean.

The behavioural difference is `playerPermaBuffs` — the channel a combat gift rides home on. Standard Bearer
must still move stats inside the fight and put nothing on that channel; Paragon must keep putting its gift
there. That pair of assertions is what the test actually pins; the printed text is checked separately.

## Rune of Hoardflame handed you nothing

> *"rune of hoardflame did not grant me a hoardflame. can you please fix this?"*

`recurringGrant` only ever registered the recurrence, and the recurrence pays at **turn setup**. The Runeforge
opens partway *through* a shop turn, after that setup has already run — so the rune you had just paid for did
nothing until the following turn. The card says *"Get a Hoardflame. Repeat every Start of Turn"*: the **get**
is now, the **repeat** is the list.

This is the third time this exact shape has shipped (`runeTribeDrip`, 2026-08-20; Rune of Ruby Resonance
before it). Every case is a reward kind that models the recurrence and drops the promise of a payout now.

Two scope guards on the fix:

- **Cadenced runes** (`everyTurns > 1`, "Every 2 turns, get a Clockwork Assistant") still pay nothing up
  front — an immediate copy would desync the badge countdown from the payout.
- **Quests** keep their existing one-turn delay. Four shipped quests use `recurringGrant` and none of them
  promised a copy on completion; changing that would have been a silent re-balance.

The discriminator is `RUNE_INDEX[def.id]`, not the `sourceKind` parameter — `multi` deliberately re-enters
`applyQuestReward` without it (that is what stops a multi-reward rune double-counting in `runeStacks`), and
Hoardflame's grant is a sub-reward of a `multi`. The id survives the spread; the parameter does not.

## A re-cast is a full cast

The owner asked how many casts Rune of Hoardflame + Mirrorwing produces, then ruled on the answer:

> *"mirrorwing's interaction should be a full re-cast of the spell, not an additional trigger OF the spell.
> therefore it is a full multiplier. this is the same for reflector. if a spell casts 4x, then casting it on
> mirrorwing would cast it 8x because it fully casts it twice."*

The family had each been written as a bare `castSpell` loop, because the multiplier lives at the **play site**
and not inside `castSpell`. So Mirrorwing added a flat +1 however large the multiplier in front of it was
(rune alone: 2 → 3; with a Yazzus: 4 → 5) — the card got relatively *weaker* the more multicast you assembled.

Now every member scales by `spellCasts`: Mirrorwing, Yirin's Reflector, Runefire (unused by any card today,
but the same sentence), and Rune of Shared Reflection. Re-reading `spellCasts` at the re-cast is exact rather
than approximate — the play site clears its one-shot freebies (Nimbus' charge, Spell Thesis, Shared Pour) only
*after* its whole loop, so the second read returns the identical number. Rune of Distillation already
multiplied its spread this way; this brings the printed cards in line with it.

Termination is unchanged: every re-cast bumps the target's per-turn counter past 1 on the way in, so the
`=== 1` guard still closes the loop however many casts the multiplier asks for.

Measured end to end (`spellsCast` counts resolutions): 2 on an ordinary minion, 4 on a Mirrorwing; with a
Yazzus, 4 and 8.

## The lanes

Four, all sabotage-checked (revert the fix, confirm the lane fails):

- **`runeGrantImmediacy`** — every rune whose reward names cards through an immediate-family kind must place
  them, *and* every rune whose text opens with "Get …" must leave you holding something. The second half is
  the one that would have caught Hoardflame on the day it was authored, because it reads the promise the
  player reads rather than the reward kind the author picked. Runes that legitimately hand over something else
  (Gold, a Shop refresh, a conditional) are enumerated with a reason.
- **`permanenceAgreement`** — printed permanence and the buff channel cannot disagree, in both directions:
  a card that sets `permanent: false` must not still print "permanently", and the factory it names must
  actually read `params.permanent`. A param nobody reads is indistinguishable from a param that works.
- **`recastMultiplier`** — every `spellCastOnThis` factory that calls `castSpell` must scale by `spellCasts`.
  The family is discovered from the content, so a new spread card drags its factory into the lane by itself.

Two harness notes worth keeping, both found by the rune lane reporting a "bug" that was mine: a rune scoped to
set 1 draws from a pool a set-2 run does not have, and a "N random <filter> minions" grant draws from
`tier <= state.tier`, so a fresh run's tier 1 finds nobody. The lane now pins the run to the rune's own set at
max tier.

## Dragonflame plays on every cast

> *"i added a dragonflame effect that should play anytime dragonflame is played. that includes from hand, from
> cards that cast it in combat, from cards that cast it from hand, end of turn, anything … and should play
> each time it is cast."*

Two gaps, one per phase.

**Combat had no spell identity.** A cast logs `{ type: 'sc', source, text: "<Caster> casts <Spell>" }` — the
`source` is the *caster's* uid, so the only thing presentation could key off was the body that cast. An
authored spell effect would have needed a binding on Flamebeat Drake *and* Warflame *and* every future caster,
and a new caster would arrive silently unanimated. The spell's name was in the log line as prose, where nothing
could reach it. The `sc` event now carries an optional `spellId`, stamped at all nine "X casts Y" emits;
`score.ts` resolves the binding by the spell when one is present and falls back to the caster otherwise, so
every existing `sc` binding (the Butcher's, the Tormentor's — narration, not casts) is untouched.
`useCombatReplay` plays that spell's own clip off the same field.

**The shop showed one play per action, not per cast.** A multicast spell resolves N times at the play site but
reaches presentation as one action. The generic spark already staggered itself (`castSparks`); an authored def
had no equivalent, so *binding* a def to a spell silently cost it its repeat count. The `spellCast` moment now
carries `casts` and the single-fire path plays once per resolution at the spark's own 200ms gap. Fan-out defs
(the Ales) are deliberately excluded — they already model their repetition through the Edward Keg-hands echo,
and a second repeat would double-count it.

Lane: **`spellCastIdentity`** — every `sc` emit whose text announces a cast must stamp `spellId`. The failure
mode is silent and additive (copy the nearest `ctx.log`, omit the field, and that one caster just does not
animate), so it is checked on the source rather than per card. And **`buffedOnAnchor`** — both runners must
anchor a `buffedOn` def on the buffed unit. Neither runner can execute here (one measures the DOM, the other
drives Pixi), but the anchor PAIR each writes is exactly what broke, so that is what is pinned.

## A swing's consequences belong to its wind-up

> *"the flame beat winds up and attacks, and completes the lunge, no damage is dealt or taken, and all the
> animations trigger. once they finish, damage is dealt and stats reconcile … we need all of the animations and
> stats to reconcile while the flamebeat is paused in his pre-attack animation, like echohorn does. we need
> this to be the case for all cases where buffs are applying or animations are firing from an attack."*

The culprit was one un-absorbed counter. The real event order for that swing is:

```
attack · spellcast · buff · buff · buff · sc · dmg
```

`spellcast` is the side's running cast total — telemetry the live tallies tick off. It was not in
`absorbIntoWindup`, so the absorb loop stopped dead one event in, and the entire cast (its buffs, its
narration, its authored FX) fell out into beats after the lunge. Three changes:

1. **`spellcast` is absorbed.** That is the fix.
2. **Any mid-combat `sc` is absorbed**, not just a shop-buff line — so the loop does not stop at the cast's
   announcement either. A genuine Start-of-Combat cast (`cast: true`) still keeps its own beat; it is not a
   consequence of a swing.
3. **The park is no longer rally-specific.** `heldWindup` was "this swing force-triggered an Echo", which is
   exactly why Echohorn behaved and Flamebeat Drake did not. It is now `cur.end > cur.start + 1` — *did this
   swing absorb anything?* A plain swing is one event wide and is untouched. The forced-Echo scan stays as a
   SEPARATE reason: a forced Echo can resolve into events that are not absorbed (a Fel Spikes spray's `dmg`, a
   Dawnclaw Battlecry replay), so its moment can be one event wide and still need the park.

Both absorb rules are mirrored into `buildBeats`, the equivalence oracle, so the two cannot drift.

**Blast radius, stated:** every swing that carries buffs now parks its lunge, not only casts and Echoes. That
is what "all cases where buffs are applying" asks for, and it is the change most likely to feel different
across the whole game.

### …and then the tendrils came back

Moving the cast inside the wind-up broke the tendril suppression, because there are **two** tendril paths and
only one had it: a standalone buff wave goes through the score's `buffCast` cue, while a cast absorbed into a
swing goes through `fireBuffCasts` in the replay hook. The moment now belongs to the ATTACK, so the
moment-level binding could no longer see the spell at all.

The rule moved down a level to match: `BuffCast` carries the `spellId` the sim already stamps on each buff
event, and both paths ask one shared helper (`authoredBuffDefFor`), which returns a def only for a `buffedOn`
binding — so Karwind's additive `buffed` keeps its tendrils. It FILTERS per cast rather than standing the
channel down, so a moment mixing a spell's buffs with an unrelated buffer's stays honest.

With no tendril there is no flight time to release the withheld stats on, so the roll rides the def's arrival
on a short constant (`AUTHORED_BUFF_ROLL_MS`) — short because the whole point of absorbing the cast is that
its numbers reconcile while the attacker is still held.

Lane: **`windupConsequences`** — graded on a SIMULATED Flamebeat fight, not a hand-written log, because the
ordering it depends on is the simulator's. Every buff Dragonflame causes must live inside an attack's wind-up,
and the damage must stay a later beat (the fix must not collapse the swing into one moment either). The
`buffedOnAnchor` lane now pins that BOTH tendril paths route through the shared helper — the invariant that
would have caught this.

## Also

- Broodfire's authored buff FX + its per-card effect clip are wired (`minionBuffed` → `broodfire-buff`).
- Set-3 Kobold art re-wired (nine portraits actually changed). The folder joined `art:wire` as a real job (`dirs: ['Neutrals', 'Kobolds']`)
  instead of being hand-dropped, with aliases for the two attributed-but-misspelled files
  (`BlastSurveryor.png`, `KornOnTheKob.png`). Five files in that folder remain unwired on purpose: three UUID
  names, `nohingrn.png`, and `Kobabyboldies.png` — un-attributed art is reported, never guessed.
