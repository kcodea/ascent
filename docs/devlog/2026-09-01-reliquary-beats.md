# 2026-09-01 — Rune of the Reliquary: one beat per Echo, and the skull at its beat

> *"rune of the reliquary literally has no beats, animations or anything firing."* — owner
>
> *"each trigger needs its own beat, and this needs to be the case across the board, similar to how the normal
> end of turn events happen … it should trigger the deathrattle skull animation + whatever bespoke or general
> animation each card triggers as they trigger their beats, left to right."*

## What was actually happening

The engine was fine and the batch was not empty. Under the authoritative End-of-Turn player, the recurring
loop wrapped the whole effect in ONE rune-sourced diffing scope (`rune:rune_reliquary:endOfTurn`, no uid):
both Echoes' summons landed in that one beat, no minion pulsed (a rune source lights no medallion), the
skull-shatter existed only as the legacy `shopDeathFx` stamp — played at commit, after the phase had flipped
to combat, so off screen — and the beats audit had never observed the identity because no probe scenario armed
the rune. Four readers mapped this in parallel (dispatch, shop-Echo presentation, the audit probe, the rune HUD);
the fix follows the Lasting Cadence pattern they all pointed at.

## What changed

- **One beat per Echo, sourced on the Echo minion.** `SELF_BEAT_RECURRING` names the recurring effects that
  open their own per-source beats; the loop opens no scope for them (an outer diff would emit every delta twice
  — the Lasting Cadence rule). The Reliquary opens a diffing `withRecruitTrigger` per Echo, board order, with
  the rune's identity, `discardIfEmpty` (a stripped copy leaves no beat), and the Chronos repeat forwarded.
  **Rune of the Crucible Choir** gets the same treatment: its Shout minion's beat, then its Echo minion's.
- **`echoFired`** — a new consequence emitted at the shop-Echo chokepoint (`fireRecruitDeathrattles`) whenever
  the body is still on the board (Ossuary Rite, Deathsayer, the Reliquary, a Gravetwin copy). A shop DESTROY
  removes the body first and its `cardDestroyed` already plays the skull, so it does not double. The presenter
  plays `pixiFx.deathrattle` on the minion at its beat and marks the uid pre-fired so the legacy commit-time
  stamp never replays it.
- **The rune's ribbon rides the beat.** A minion-sourced beat whose identity is a rune's draws the ribbon from
  that rune's badge to the acting minion as the beat lands (`onBeatActivate`) — Lasting Cadence and Combat
  Prowess inherit it.
- **The audit observes it.** A `defaultScenarios()` entry arms the rune with two Echo minions, so
  `beats:audit` reads the row as emitting, and `beatProbe.test.ts` pins it.

## The extra trigger at the end

Watching it live, the owner: *"i am also getting an 'extra trigger' at the end that causes things to spazz
one last time."* The first cut added `procRuneId` for the badge. The badge already bursts once at commit off
the tendril stamp's SEQUENCE, and `runeTriggerFx` fires `counted + seqFire` — so the proc COUNT on top made it
burst twice, 300 ms apart, after the beats. Removed; the tendril stamp stays (state parity with plain
`reduce` is a pinned contract, so presentation never branches on the collector).

## …and Kobebes re-triggering at the end

Second live report: *"kobebes triggers again at the end … i am seeing inconsistencies."* Kobebes' Echo casts
Rubies on your Kobolds. On the beat the `rubyPlayed` consequence plays the gem cascade; then the commit bumps
`rubyLandedFxSeq` / `recruitFxSeq`, and the LEGACY commit-time runners (the moment-cue runner, the buff
tendril watcher) replay the cascade and the ribbons — the board is still on screen under the combat curtain,
so it is visible. Summon-only Echoes bump neither seq, which is the inconsistency. The End-of-Turn completion
now advances every legacy per-action tracker past the committed seqs — the same rule it already applied to the
shop-consume watchers — so the commit replays nothing the beats presented.

## Lanes

- `sim/reliquaryBeats.test.ts` — two minion-sourced beats under the rune identity, in board order, each opening
  with `echoFired` and carrying its own summons; byte-identical state with capture on/off; only the two
  left-most fire; a stripped copy / no Echo → no beat; the Crucible Choir's two beats; the legacy channels
  stamped exactly as before (tendril per Echo, no proc count).
- `sim/beatProbe.test.ts` — the audit observes `rune:rune_reliquary:endOfTurn` with consequences.
- `ui/choreographer/consequencePresenters.test.ts` — `echoFired` is covered and inert without a uid.
- `ui/choreographer/reliquaryRibbon.test.ts` — source pins for the beat-time ribbon and the skull's dedupe.
