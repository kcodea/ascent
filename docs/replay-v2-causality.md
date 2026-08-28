# Replay v2 and effect causality — what a future revision would need

Written 2026-08-28, out of the Equipment handoff. That spec asked for per-trigger causality (parent effect,
trigger index, Gold paid, activation consumed, resulting spell casts) to survive a replay. It cannot today,
and the owner's call was: **state-only for now, record what a better replay would need.** This is that record.

## Why it cannot today

Replay v2 is **state replay**. A recording is a flat, wall-clock-ordered list of frames — one `ShopFrame` per
recruit action, one `CombatFrame` per fight — and playback is a *pure renderer*. Nothing re-derives: no
`reduce()`, no `simulate()`, no RNG. `replayV2.ts` says so in its header, and that is the property that makes
replays cheap and impossible to desync.

The consequence is that a replay knows **what the state became**, never **why**. A frame after an Equipment
activation shows: one less Gold, one more spent allowance, a buffed minion. It cannot show that the buff came
from Bloodpot, that it was trigger 2 of 3, or which activation paid for it.

## What DOES exist

Two things, and they are not the same thing:

1. **State is captured for free.** The frame model is *inclusion-by-omission* — every `RunState` key is
   captured unless explicitly excluded (`SHOP_VIEW_EXCLUDED_KEYS`). `PlayerEquipmentState` therefore persists
   through save, reconnect and replay with no capture code at all. This is why Equipment is run state rather
   than UI state, and it is most of what the handoff's Persistence section asked for.

2. **Causality exists live, on the presentation channel.** `withRecruitTrigger` opens a source-attributed,
   nestable trigger scope carrying `policyKey`, source identity and `repeatIndex`; consequences are emitted
   inside it. So the Beat Lab and Doc Bot see the full parent/child shape of an Equipment activation,
   including which trigger index produced which mutation. That batch is **not persisted** — it is built per
   action and consumed by the choreographer.

So the causality the handoff wants already exists. It just does not survive the process.

## What a replay revision would need

Roughly in order of cost:

1. **Persist the presentation batch alongside each ShopFrame.** The batch is already a serializable tree of
   trigger scopes and consequences. Attaching it to the frame that produced it would give replays exact
   causality with no new instrumentation — the recording simply gets bigger. That is the whole trade: a batch
   is far larger than the state delta it explains, and replays are stored per run.

2. **Decide a retention rule.** Full causality for every action is probably not worth its size. Options worth
   considering: keep batches only for actions that spent a resource; keep the last N; keep them only when a
   run is flagged for QA. Any of these keeps the useful cases without unbounded growth.

3. **Version the frame.** Frames are consumed by a renderer that must keep loading older recordings, so a
   causality payload has to be optional and additive, exactly as `cardSummoned.index` was.

4. **Decide whether playback may branch on it.** It should not. The value is *inspection* — a replay viewer
   that can say "this +3/+3 was Bloodpot, trigger 2 of 3, paid 1 Gold". The moment playback reads causality to
   decide what to render, the pure-renderer property is gone and desync becomes possible again.

## What NOT to do

Do not build a second recording system beside replay v2. The reason this document exists rather than an event
log is that two recordings of the same run drift, and the one nobody looks at drifts silently. If causality is
worth persisting, it belongs *in the frame that already exists*.
