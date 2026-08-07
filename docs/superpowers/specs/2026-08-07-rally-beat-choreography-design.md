# Rally Beat Choreography — pulse first, effect after, for every rally

**Date:** 2026-08-07
**Status:** Design approved, pending spec review
**Owner ask:** *"I just want to make sure that the rally icon pulse occurs first and THEN the rally effect occurs after for every instance of the effect across the board."*

## Goal

Every card with an `on:'onAttack'` effect (36 cards — the "rally" family) should read as a two-part beat: the unit's **pulse fires first**, then its **effect resolves a uniform, tunable gap later**. Today this ordering is accidental and inconsistent — some effects fire simultaneously with (or before) the pulse, some cards don't pulse at all, and the one card already fixed (Errand Fiend's imps) uses its own bespoke constant.

This unifies the timing behind one knob and guarantees the cause→effect read across all rally cards and all effect types.

## Scope

**In scope:** all 36 `on:'onAttack'` cards, split into two beats:

- **Self-rallies** — the attacker's own swing triggers its effect (Errand Fiend, Supporter, Packstrider, Echohorn, Hoardbreaker, Philippe, Sunmane, Trophy Stalker, Chorus Engine, Equinox, Watcher, Deathsayer, …). Signalled by the **medallion** pulse.
- **Watchers** — a *friendly/ally* attack triggers the effect (Crypt Drake, Raptor, Fatecarver, Thundeer, Traveling Skald, Rouge Rogue). Signalled by a **card-frame** pulse, always **light blue** (tunable).

**Out of scope:** changing any card's *mechanics* (what the effect does), retiming non-rally FX, and the shop/recruit phase (this is combat choreography only).

## Core mechanism

Three ideas, all reusing the withhold pattern already proven by the imp-summon fix.

### 1. One constant

`RALLY_EFFECT_GAP_MS` (default **300**) — the single knob for the pulse→effect gap. It **replaces** the imp-specific `IMP_SUMMON_LEAD_MS` added in #902; summons become one consumer of the shared constant rather than owning their own.

### 2. One anchor: `T`

Every rally fires its pulse at one consistent instant — the **attacker's wind-up** (the same moment the yellow `RL` pulse already uses via the lunge timeline's `onRallyPulse`). Call that instant `T`. Every effect channel then schedules its FX at `T + RALLY_EFFECT_GAP_MS`. Nothing invents its own timing.

For a **watcher**, `T` is the *attacking ally's* wind-up (that's the swing that triggered it), but the pulse fires on the *watcher's* card. Same anchor, different pulsing unit.

### 3. Pulse decoupled from effect

Today a non-`RL` card's medallion pulse is *derived from its effect's own events* (a `buff`/`sc`/`keyword` event flashes the medallion). If we merely delay the effect, the pulse delays with it. So the pulse must fire at `T` off the fact that **a rally is happening** (this attacker has an on-attack effect this swing), **independent of** when the effect's FX plays. Two things that were one event become a cause (`T`) and a consequence (`T + gap`).

## Pulse language

| Beat | Pulse surface | Colour |
|---|---|---|
| Self-rally, `RL` keyword | medallion ring | yellow (unchanged) |
| Self-rally, non-`RL` | medallion ring | normal (unchanged) |
| Watcher | **card frame** | **light blue** (tunable via CSS custom property) |

The frame pulse is a new, third pulse variant. The card frame already carries a hover glow (`--hglow-*` box-shadow); the frame pulse is the same surface with a distinct one-shot animation and its own colour property. Fired on the watcher at `T`.

Colours are unchanged for self-rallies — only *timing* changes there. (We deliberately do **not** unify all pulses to one colour; the watchers reading blue vs. the rally yellow is the point.)

## Per-channel treatment

All channels read the same `T` and `RALLY_EFFECT_GAP_MS`.

- **Summons** — already implemented (#902). Re-point its constant to the shared `RALLY_EFFECT_GAP_MS`. *(Errand Fiend, Malphas.)*
- **Buffs** — the largest group. Buffs are already withheld via the stat-hold roll; today the release is anchored to the strike. Re-anchor the release to `T + gap`. *(Supporter, Packstrider, Sunmane, Trophy Stalker, Chorus Engine, Equinox, and all watchers.)*
- **Casts** — hold the cast FX (and the buffs it produces) and fire at `T + gap`. *(Hoardbreaker, Ashen Broodlord, Watcher.)*
- **Damage** — hold the projectile/damage FX to `T + gap`, **and** add the medallion pulse (it has none today). *(Philippe.)*
- **No board FX** — get-a-spell / get-rubies / keyword-strip. Nothing visibly arrives, so nothing to delay; they only need the pulse to read. *(Badgington, Perfect Core, Tunnelcharger, Tauntbreaker.)*

### Enabling change: universal, decoupled pulse

Fire the pulse for *every* rally card at `T`, off "this attacker has an on-attack effect firing this swing," independent of the effect's own events. `RL` cards keep their yellow medallion; non-`RL` self-rallies fire their normal medallion at `T`; watchers fire the light-blue **frame** pulse; the few with no pulse today (Philippe) get one.

## Testing & verification

The method that de-risked the imp fix — a headless-Chrome probe driving a real fight, sampling frame-by-frame **when the pulse fires vs. when the effect FX fires**, asserting for each representative card that the pulse lands first and the effect lands ~`gap` ms later:

- Buff — **Supporter**
- Summon — **Errand Fiend** (already passing; re-confirm under the shared constant)
- Cast — **Hoardbreaker**
- Damage — **Philippe**
- Watcher — **Crypt Drake** (assert **frame** pulse, blue, then buff at `+gap`)

Plus: the existing combat-invariant harness stays green (no badge ever prints out of its true range), and a final eyeball on the dev server.

## Risks & open questions

- **Casts/damage aren't absorbed into the wind-up** (unlike buffs/summons), so they currently fire as their own beats. Corralling them onto `T + gap` is the least-charted part and needs a close read of those channels during planning.
- **Watcher frequency** — watchers fire often (Crypt Drake every 2 ally attacks, Raptor every Beast swing). The frame pulse must stay subtle enough to not read as noise on a wide board.
- **Anchor precision for non-`RL` cards** — verifying the decoupled pulse fires at the same `T` as the `RL` yellow pulse, not at beat-start, is the key correctness check.

## Constants / tunables introduced

- `RALLY_EFFECT_GAP_MS = 300` (pulse→effect gap; replaces `IMP_SUMMON_LEAD_MS`).
- A CSS custom property for the watcher frame-pulse colour, default light blue.
