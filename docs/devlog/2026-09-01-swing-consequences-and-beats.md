# 2026-09-01 — a swing's consequences, and what belongs in one beat

A long chain of owner reports on Echohorn, Fel Spikes and the on-attack watchers. Most of them turned out to
be one structural question asked four different ways: **what belongs to a swing, and what belongs to a beat?**

## Engine: the wind-up fully resolves before the swing lands

> *"echohorn should wind up and trigger rally, which triggers the chicken brawl. chicken brawl's summoned
> minion attacks IMMEDIATELY … the echo is always fully resolved before the attack goes off (same for
> deathsayer)."*

An attack-on-summon token defers onto the immediate-attack queue and lands at the next flush. Every flush point
was AFTER a clash, so a token conjured by an on-attack trigger landed once the attacker's damage had already
been dealt. The queue is now drained between the on-attack triggers and the clash.

Scoped to SUMMONS (`flushImmediateAttacks(true)`). The queue also carries immediate strikes by bodies already
on the board — Solaris Fang's Avenge re-grants a Ward *before each* of its two strikes, so draining those early
strips the second Ward. That is a different mechanism with its own ordering.

This supersedes the 2026-07-10 ruling only for this window; a token queued by a DEATH cascade still flushes
after that cascade, which is what that ruling was about.

### …and a flush must not nest inside itself

Each queued token takes its strike inline, and that strike runs `performAttack` — which now flushes during its
own wind-up. So the first charger's swing drained the queue mid-wind-up and ran the SECOND charger's entire
summon, attack and death before its own damage landed:

```
summon m3 · attack m3 · summon m4 · attack m4 · dmg m4 · death m4 · dmg m3 · death m3
```

A re-entrancy guard fixes it; the outer drain loop already produces the sequential order the owner described
(*"summons a charging soldier that attacks immediately and settles or dies, then the second is summoned"*).

### The board cap moved to LAND time

Owner ruling: with Sylus doubling the Echo, one wind-up queues two chargers, and *"if it dies, the next
charging soldier now has room and should be summoned"*. Judging the cap when they were QUEUED read the board
before any of them had lived and died. `placeSummon` judges it as each one lands, which is what "usual board
space rules" means when they land one at a time.

The 2026-08-11 report the queue-time check was protecting (a token landing because the ATTACKER's own death
freed the slot) is closed a different way now: an on-attack summon flushes during the wind-up, before the
attacker's clash, so the attacker is still alive and still occupying its slot when the cap is judged.

### No clash into a corpse

Once consequences resolve before the swing lands, they can kill the body being swung at. The clash is written
for a live exchange and ran anyway — the attacker dealt damage into a corpse AND took retaliation FROM it. The
clash is now skipped entirely: no damage either way, the swing is spent rather than redirected. A Reborn body
that died and returned is not gone, so it fails the check and the clash proceeds as before.

## Presentation: one swing's results are one beat

The one that mattered most, and the reason every timing fix before it did nothing.

`collapse` merges a contiguous run of RESULT_TYPES into one moment — right for a single clash (damage, cleave,
retaliation, deaths are one impact), wrong when two swings' results sit next to each other:

```
dmg<soldier · dmg<enemy · death · dmg<ECHOHORN · dmg<enemy      ← one beat
```

A summoned charger's exchange and the parked attacker's exchange, together. **Echohorn's swing had no beat of
its own**, so no hold or delay could separate them — *"its attack follows immediately after the charging
soldier attacks"* was them being literally simultaneous.

`swingOpeners` walks the log once and marks the first damage dealt by each attacker whose `attack` is still
unresolved; the collapse breaks there. A retaliation is not a new swing (the defender has no open `attack`), so
an ordinary clash is untouched — that is what keeps this from re-pacing every fight. Mirrored into
`buildBeats`, the equivalence oracle.

Verified on the owner's own export (`sb-gorun-w6`): twelve rally procs, four summons with their own attacks,
forty events between the wind-up and the attacker's damage — and that damage still lands in a beat of its own.

## A timer whose job outlives its beat does not belong to that beat

> *"dmg values being left behind from fel spike's trigger"*

Float removal timers sat in the beat effect's `timers` array, whose cleanup clears everything on each beat
change — so any float still on screen when the beat advanced lost its removal and stayed forever. Latent all
along; splitting a swing's results into their own beats made the beats short enough to lose the race routinely.

Moved to a combat-lifetime registry, which is the third time this rule has been learned here: `scheduleRoll`
and `echoVolleyTimersRef` already carry it, and the file documents the measured margins for the buff-roll case.

## Also

- A parked swing has THREE ways out, not two: it struck, it died, or it was **cancelled** (its target died to
  the Echo). Without the third the attacker stood reared back for the rest of the fight.
- A non-parked swing no longer clears an existing park — Echohorn's Rally can summon a body that attacks DURING
  the park, and the unconditional clear dropped the handle to its held lunge.
- A parked attacker waits `PARKED_COMMIT_LEAD_MS` before committing, added through the same additive `lead`
  path every other consequence hold uses.

## Known, not fixed

The parked lunge is resumed with `held.tl.play()` on a timeline built ~17 beats earlier. If anything killed its
tweens in between, `play()` runs an empty shell — a strike with no travel, intermittently. The owner still sees
this occasionally. Two attempts to rebuild the strike instead were rolled back because each was paired with
another change that regressed something else; the rebuild ALONE, on top of the beat split, is the outstanding
work.

> **Update, later the same day (`2026-09-01-shout-refire-beats.md`):** the release is now driven by the resumed
> strike's own CONTACT — the beat clock resumes the timeline after the stillness and the lunge's `onParkedContact`
> advances into the damage beat, so the numbers land on the hit instead of on a timer. A fallback timer covers
> the empty-shell case, so it can no longer stall; the rebuild of a gutted timeline is still open.
