# Attack-Windup Tendrils — buff FX for on-attack / Rally buffers

**Date:** 2026-07-12
**Status:** design approved (owner sign-off 2026-07-12)
**Related:** the buff-tendril system ([`2026-07-10-buff-tendril-design.md`](2026-07-10-buff-tendril-design.md)).
This closes "Gap B" from the buff-FX coverage audit — the last class of combat buffs with no FX.

## Problem

A buff emitted **immediately after an `attack` event** is absorbed into that attack's `attackExchange` moment
(`compile.ts` `absorbIntoWindup` includes `buff`). The tendril `buffCast` cue lives only on the `buffWave` moment
kind, so these **on-attack buff-others never fire a tendril** — they show nothing. Two sub-cases, six cards:

- **Rally-keyword** (the buffer **is** the attacker): `rallyBuff` (**Supporter**), `rallyGiveHealthToDragons`
  (**Chimerus**), `rallyBuffAttachments` (**Chorus Engine**).
- **On-ally-attack watchers** (the buffer is a **bystander** reacting to a friendly's swing):
  `onFriendlyAttackBuffTribe` (**Raptor**), `onAllyAttackBuffAll` (**Crypt Drake**), `onAllyAttackCastGrowth`
  (**Taragosa**).

## Goal

These buff-others fire **tendrils sequenced into the attacker's wind-up, before the lunge**, so the buff reads:

- **Rally:** yellow rally pulse → tendril(s) to allies → lunge. (The engine already pauses the wind-up + flashes
  the yellow pulse via `onRallyPulse`; the tendril slots in right after it.)
- **Watcher:** tendril(s) from the bystander → lunge of the triggering ally. (No yellow pulse.)

Reuses the existing tendril renderer + presets + badge hold/flash; the look auto-resolves by the **source's
tribe**. No new FX primitive — it's timing + wiring in the attack-exchange GSAP timeline.

## Non-goals

- No new visual. Reuses `pixiFx.buffTendril` + the tendril presets.
- Self-buff-on-attack (source === target absorbed into an attack) — none in the current set; `groupBuffCasts`
  already excludes self-buffs, so the wind-up path only fires buff-*others*. Noted as a follow-up if such a card
  appears (it would want the pulse via a wind-up `groupSelfBuffs`).
- Any simulation change. Presentation-only.
- Per-card tribe overrides unless the audit finds one (see §Verification).

## Architecture

The absorbed buff-others already live inside the `attackExchange` moment. The fix fires them as tendrils from
**within the attack-exchange GSAP timeline** (so the lunge can gate on them), at the wind-up, right after the
optional rally pulse.

### 1. Shared tendril-fire logic (refactor)

The tendril-firing + badge hold/flash currently inlined in `useCombatReplay`'s `onBuffCasts` handler is extracted
into a reusable closure so **both** the `buffWave` path and the new wind-up path use it. It takes the grouped
buff-other casts (`BuffCast[]`, from `groupBuffCasts`) and:
- routes each cast (Deathrattle-buffer source → `pixiFx.descend`; else living source → `pixiFx.buffTendril`) —
  the exact split shipped in the descend PR (in the wind-up path all casts are living-source non-Deathrattle, so
  they all tendril, but reusing the split keeps one code path);
- holds each target's pre-buff badge value and flashes it to the new value at the strike/landing (`travelMs` /
  `dropMs`), speed-scaled — unchanged from today.

This is a pure extraction: the `buffWave` `onBuffCasts` behavior is byte-for-byte preserved (existing tests stay
green).

### 2. Wind-up firing from the attack timeline

- **`channels/lunge.ts` (`playLunge`)** gets one new optional callback `onWindupBuffs?: () => void` and fires the
  wind-up hold whenever **either** `onRallyPulse` **or** `onWindupBuffs` is present:
  ```
  windup → [ call onRallyPulse ]      // yellow pulse (rally only)
         → [ call onWindupBuffs ]     // fire the tendrils (rally OR watcher)
         → hold WINDUP_BUFF_PAUSE     // let the pulse + tendril read
         → strike → contact → settle
  ```
  Today's `rallyPauseMs` (the hold) is generalized to fire when there are wind-up buffs too. Hold length is a
  tunable constant (start at the current `RALLY_PAUSE_MS` = 440ms; the lunge releases as the tendril strikes so it
  never feels slow — tune live).
- **`engine.ts` (`AttackCueCtx` + `runAttackExchangeCues`)** gets `onWindupBuffs?: () => void` and passes it
  through to `playLunge`. `runAttackExchangeCues` does not itself compute the buffs — the caller (the replay,
  which holds `events`) builds the closure.
- **`useCombatReplay.ts`** — where it invokes `runAttackExchangeCues`, it computes the moment's absorbed
  buff-others with `groupBuffCasts(moment, events)`; if any, it passes `onWindupBuffs = () => fireBuffCasts(casts)`
  (the shared closure from §1). No casts → `undefined` (normal swing, no hold change).

### 3. Timing / ordering

- Rally: `onRallyPulse` (yellow) fires first, then `onWindupBuffs` (tendrils), then the hold, then the lunge —
  matching the owner's **pulse → tendril → lunge** order.
- Watcher: no `onRallyPulse`, so it's `onWindupBuffs` (tendrils) → hold → lunge.
- The badge flash lands at the tendril strike (`travelMs`), i.e. during the wind-up hold, before the lunge.

## Data flow

```
attack event ─▶ compileMoments (absorbs the following buff into the attackExchange moment)
useCombatReplay useLayoutEffect (attack exchange):
  casts = groupBuffCasts(attackMoment, events)          // the absorbed on-attack/rally buff-others
  runAttackExchangeCues(..., { onRallyPulse?, onWindupBuffs: casts.length ? () => fireBuffCasts(casts) : undefined })
    → playLunge: windup → [rally pulse] → [fire tendrils] → hold → strike → contact → settle
fireBuffCasts (shared): per cast → buffTendril(source→target) + badge hold→flash   (same as buffWave onBuffCasts)
```

## Testing / verification

- **Refactor safety:** the extracted `fireBuffCasts` keeps the `buffWave` `onBuffCasts` path identical — the
  existing `score`/`buffCast` tests stay green (no behavior change on that path).
- **Unit (engine, seekable timeline):** extend the existing `engine`/`lunge` timeline test — a `playLunge` given
  `onWindupBuffs` calls it once during the wind-up (before the strike/`onContact`), and inserts the hold; without
  it, the timeline is unchanged (normal swing).
- **Integration (real combat):** a Rally card (e.g. `supporter`) attacking with a friend on board produces a
  `buff` event absorbed into its `attackExchange` moment → `groupBuffCasts` on that moment returns the buff-other
  cast (proving the wind-up path has something to fire). Same for a watcher (`raptor`) when a friendly attacks.
- Full gate green: typecheck + lint + test + build:web.
- **Live check** (owner eyeball, focused Chrome tab): a Rally unit swings → yellow pulse → tendril(s) to allies →
  lunge; a Raptor/Crypt Drake watches an ally swing → tendril fires during that ally's wind-up. Confirm the tribe
  look matches (Raptor→Beast green, Crypt Drake/Supporter→Dragon red, etc.).

## Tribe verification (do during implementation)

Confirm each source card's `tribe` resolves to the look the owner named, and add a `BUFF_ASSIGN.byCard` override
only where it doesn't:
- Raptor → Beast, Crypt Drake → Dragon, Supporter → Dragon, Chimerus → (dragon?), Chorus Engine → (mech?),
  Taragosa → (dragon?). The resolver keys off the card's own tribe; if e.g. Supporter isn't a Dragon but the
  owner wants Dragon tendrils, add `byCard['supporter'] = 'dragon-tribe'`.

## Scope guards / follow-ups

- Presentation-only; `simulate()` + the event log untouched.
- Only living-source buff-*others* in `attackExchange` (Deathrattle buffs are post-death `buffWave` → already
  descend; self-buffs are excluded by `groupBuffCasts`).
- Follow-up: if a future card self-buffs on attack, add a wind-up `groupSelfBuffs` → pulse path (mirror).
