# Replay v2 — state-replay: design handoff

> **Status: TABLED (2026-08-11).** Spec extended 2026-08-19 with the round rail + per-turn stats panel (§7). The action-replay spectator (branch `feat/replay-driver`, PR #956) was
> built end-to-end and then **killed** because the underlying approach cannot produce a *faithful* replay of a
> real run (evidence below). This document is the durable plan for rebuilding it correctly as **state replay**
> when the game is more complete. Nothing here is started; it is a spec to pick up cold.
>
> **Decision:** rebuild later, from this doc, as a fresh feature. Do NOT try to salvage the action-replay
> driver — the whole point is that we're changing the foundation.

---

## 1. The goal (owner's vision, verbatim intent)

> "I can click on a player from the leaderboard or from a 'recent matches' list somewhere and **watch back
> their game** — shop phases, combats, rune/quest selections, etc." … "with **timed purchases** like when the
> player actually purchased something." … plus a **1–10× speed slider** and a **scrub/seek bar**.

The **only game mode is `lobby`** (an 8-seat elimination lobby; the player is always `seats[0]`). A replay is
that lobby run played back from the player's perspective. Course/`ascent`/`rift` are not shipped modes — v2 can
ignore them (or treat them as a trivial subset: same shop frames, opponents from the pool instead of seats).

The non-negotiable property v2 must have and v1 does not: **what you watch is exactly what happened.**

---

## 2. Why v1 (action-replay) failed — the evidence, so we don't repeat it

v1 recorded `{ seed, heroId, mode, actions[], timings[], servedBoards }` and *re-derived* the run by folding
the reducer over the actions: `reconstruct(seed,heroId)` then `reduce()` per action. This is **Option A /
action replay**. It rests entirely on the reducer being perfectly deterministic across a fresh session.

It is not. Investigation on a real winning run (`brackus`, 249 actions, recorded **1st place / a win**):

- A pure reduction of the recorded action log produced **4th place, dead at wave 13, empty board** — a
  completely different game from the one the player actually played and won.
- **121 of 249 actions were no-ops** (55 `play`, 18 `buy`, 15 `sell`, 6 of 8 `discover`, `chooseOne`, …).
- The run reproduced *perfectly through wave 6*, then diverged at wave 7 and cascaded.

**Root cause:** actions reference cards by a **creation-counter `uid`** (e.g. `{"uid":"s59","type":"buy"}`).
A mid-run combat consumes RNG / summons a slightly different number of tokens on replay than it did live, which
drifts the run's RNG cursor **and** the uid counter. From that point the reconstructed shop no longer holds the
card the recorded action names, the action no-ops, and every later uid-referencing action (buy/play/sell/
reposition/target) misses too. One tiny combat drift → total divergence of the back half.

`servedBoards` does **not** save it: in lobby mode the player's opponent comes from the *seat pairing*, not the
served pool board, so injecting servedBoards changes nothing (verified: identical divergence with and without).

**Why the existing guard missed it:** `packages/sim/src/replayFidelity.test.ts` only replays **bot-generated**
runs in the *same process* (with `resetLobbyDrivers`). It never exercised a real human run captured in a
browser and replayed cold, and bot runs happen not to hit the drift.

**The deeper, permanent problem with Option A:** even if we chase down *this* drift source, action-replay
stays fragile forever. It re-runs against *today's* code, so **any future card / RNG / balance change silently
breaks every previously-recorded replay.** In a repo where content changes constantly, that is a standing
liability, not a one-time bug. This is the decisive reason to abandon it.

---

## 3. The v2 principle: record outcomes, never re-derive

**State replay (Option B): the recording IS the ground truth; playback is a pure renderer.** We capture the
actual visible state as it happens and the actual combat that was fought, and play those back. There is *no*
`reduce()` and *no* `simulate()` at playback time, so:

- Accuracy is true **by construction** — you can only render what was recorded.
- Replays are **immune to content drift** — a run captured on an old patch still plays correctly forever,
  because playback never touches current card/rule code.
- **Scrubbing becomes trivially correct** — seeking is "jump to the frame active at time *T*", O(1), with no
  simulation to drift.
- Placement, opponents, and timing are recorded facts, so the other v1 bugs dissolve for free.

The cost is payload size (we store snapshots + combat logs instead of a short action list). It is very
manageable — see §8.

### The lever that makes this cheap: the UI already renders from these exact shapes

- The **recruit screen** renders from `run` (board / hand / shop / gold / tier / hero power / quests / runes).
  A recorded "shop frame" is just a projection of `run`.
- The **combat arena** (`useCombatReplay`) already animates `lastCombat`, which is exactly what `simulate()`
  returns: `{ events, result, playerDamage, initial }`. A recorded "combat frame" *is* a `lastCombat`.

So playback = feed the store a synthetic `run` (from a shop frame) or a synthetic `lastCombat` (from a combat
frame), stepping along a timeline. We reuse the real recruit screen and the real combat arena unchanged.

---

## 4. The v2 data shape

A replay is a flat, wall-clock-ordered list of **frames**. A recruit phase emits many shop frames (one per
player action, so purchases play back at their real times); each fight emits one combat frame.

```ts
// Lives in packages/sim (it references BoardSnapshot / CombatEvent / CombatSideState / CombatResult, all in
// core/sim). Keep it OUT of the reducer path — it is capture/replay metadata, not run state.

export interface ReplayV2 {
  version: 2;
  // Identity + display only. `seed` is kept for debugging/repro; playback must NEVER re-simulate from it.
  seed: number;
  heroId: string;
  mode: RunMode;            // 'lobby' in practice
  author: string;          // display handle at capture time
  patch: string;           // content revision at capture (for provenance / bug triage)
  createdAtMs?: number;    // stamped server-side or on upload; scripts can't read Date.now()

  frames: ReplayFrame[];   // wall-clock order

  result: {                // the recorded truth about the outcome
    placement: number;                       // lobby finish, 1..8 (1 = won)
    record: { wins: number; losses: number; draws: number };
    ratingDelta?: number;
    finalBoard: MinionView[];
  };
}

export type ReplayFrame = ShopFrame | CombatFrame;

export interface ShopFrame {
  kind: 'shop';
  wave: number;
  tMs: number;              // ms from run start — the timeline position (drives scrub + pacing)
  cause: ActionCause;       // what produced this frame: 'turnStart' | 'buy' | 'sell' | 'play' | 'roll'
                            //   | 'upgrade' | 'freeze' | 'reposition' | 'reorderShop' | 'discover'
                            //   | 'chooseOne' | 'buyRune' | 'rerollRuneforge' | 'heroPower' | ...
                            // NOT just debug metadata — the stats panel counts by it (§7.2), so the union must
                            // cover EVERY dispatched action or per-round counts silently under-report.
  spent?: number;           // gross Gold this action cost, and gross Gold it paid out. Net is derivable from
  earned?: number;          //   consecutive `view.gold`, but GROSS is not — one action can do both (§7.3).
  view: ShopView;           // FULL visible recruit-phase state AFTER this action
}

export interface CombatFrame {
  kind: 'combat';
  wave: number;
  tMs: number;
  opponent: { author: string; heroId: string };  // who you were paired against (display)
  // Exactly a `lastCombat`. The arena animates this verbatim — no re-simulation.
  events: CombatEvent[];
  initial: { player: CombatSideState; enemy: CombatSideState };
  result: CombatResult;
  playerDamageDealt: number;
  resolveLost: number;      // what the player lost this fight (for the HUD)
}

// ── Views: everything the recruit screen reads, snapshotted. Audit Recruit.tsx / StatusBar.tsx for the
//    complete field list before finalizing — this is the contract that must be COMPLETE or playback shows
//    stale/blank bits. Start from `run` and keep only what the recruit UI actually consumes. ──
export interface ShopView {
  gold: number; tier: number; wins: number; wave: number;
  board: MinionView[];
  hand: CardView[];
  shop: (CardView | null)[];
  heroPower?: HeroPowerView;    // name, live status line, ready/used, counters (StatusBar already computes these)
  quests?: QuestView[];
  runes?: RuneView[];
  frozen?: boolean;
  // + any other recruit-screen inputs discovered in the audit (henchman state, pending-combat banks that show
  //   a gold tag, live-text scaler fields the cards print, etc.)
}

export interface MinionView {
  cardId: string; attack: number; health: number;
  keywords: string[]; golden?: boolean; addedTribes?: string[];
  buffs?: BuffBreakdown;        // so the inspect panel itemizes exactly as it did live
  liveText?: Record<string, number>;  // any scaler values the card printed (spellProgress, eotBonus, …)
  uid: string;                  // for stable React keys + drag identity during playback (display only)
}
// CardView = a shop/hand card projection (cardId, cost, tribe, golden, the same liveText treatment).
```

Design notes:
- **`ShopView` must be complete.** The recruit screen renders from it directly, so any field it reads that we
  fail to snapshot shows blank/stale. The build starts with an audit of `Recruit.tsx` + `StatusBar.tsx` reads.
- **`CombatFrame` is a `lastCombat`.** No new arena work — `useCombatReplay` already consumes this.
- **`liveText` per card matters** because of the hard rule (CLAUDE.md) that card text always shows the current
  live value. Snapshot the numbers the card printed so playback prints the same, without recomputation.
- **`uid` is display-only in v2** (React keys, drag identity) — never used to *find* a card in a re-simulation,
  because there is no re-simulation. This is what makes uid drift a non-issue.

---

## 5. Capture (live run → frames)

All capture is **UI/store-side** (`packages/ui/src/store.ts`), no engine change. The store's dispatch already
sees every action and its timing delta (this part of v1 is reusable — see §10).

- **After each recruit action's reduce:** project a `ShopFrame` from the resulting `run` (`view =
  projectShopView(run)`), stamped with `cause` (the action type) and `tMs` (accumulated real time).
- **When a combat resolves** (`faceOmen` produced `lastCombat`): emit a `CombatFrame` from `lastCombat` +
  the opponent identity (from the lobby pairing) + the resolve lost.
- **At run end:** capture `result` (placement from `run.lobby.seats[0].placement`, record from `runRecord`,
  final board, rating delta).

**CRITICAL — deep-clone every captured frame** (`structuredClone`). The reducer shares `lastCombat` and
`servedBoards` by reference for perf (reducer.ts carve-out), and combat mutates boards in place. A shallow
capture would let later turns corrupt earlier frames — the exact class of bug that sank v1's servedBoards.

Emit to `run_telemetry.replay` (opaque jsonb — **no schema change**), same upload path as today
(`uploadRunTelemetry`).

---

## 6. Playback (frames → screen)

A `ReplayPlayer` (rewrite of the killed `replayDriver.ts`, but far simpler — no reducer, no combat gating for
correctness):

- Holds `frames` + a cursor + a clock. `tMs` deltas drive pacing; `× speed` divides them; floor/cap for
  legibility (reuse the 350 ms / 5 s / 900 ms constants from the killed branch).
- **Render a ShopFrame:** `useGame.setState({ run: synthRunFromShopView(frame.view), phase: 'recruit', … })`.
  The real recruit screen renders it. (`synthRunFromShopView` builds a minimal `run`-shaped object the recruit
  components read; it does NOT need to be a valid engine RunState — nothing reduces it.)
- **Render a CombatFrame:** `useGame.setState({ lastCombat: frame, phase: 'combat' })`; the existing arena
  animates. Advance either on the arena's `done` signal (as v1 did) or on the recorded combat duration.
- **Seek(tMs):** find the frame active at `tMs` (binary search on `frames[].tMs`) and render it directly.
  O(log n), no rebuild, always correct. Seeking into a combat can either start its animation from the top or
  show its end state — decide per UX.
- **Exit:** restore the pre-replay store slice (v1's snapshot/restore pattern is reusable).

Input is fully inert during playback (no dispatch), same as v1's `if (replaying) return` guard.

---

## 7. The round rail + the stats panel

> Owner ask 2026-08-19: "a round scrub on the left hand side … I click round 8 and it auto-scrubs to the start
> of round 8" plus "a stats panel that shows cards played / gold spent for each individual turn so I could see
> where all the action was."

**Both are nearly free, and that is a structural consequence of §3, not luck.** Because a state replay records
the full visible state after *every* action and stamps each frame with the action that caused it, the frame
list is already a complete, per-turn event log of the run. The rail is an index over it; the stats panel is a
fold over it. **Neither needs anything captured that Phase A wasn't already capturing** (one small exception,
below), and both can be built later — including *retroactively over replays already recorded*.

### 7.1 The round rail

Frames carry `wave` and `tMs`, so the index is derived once at load:

```ts
// The first frame of a wave is its `turnStart` shop frame — "the start of round N" is the shop opening,
// which is what you actually want to watch, not the combat that ends it.
export interface RoundMark {
  wave: number;
  tMs: number;                 // seek target
  result?: 'win' | 'loss' | 'draw';   // from that wave's CombatFrame
  resolveLost?: number;
}
export const roundMarks = (frames: ReplayFrame[]): RoundMark[] => { /* one pass */ };
```

Click round N → `seek(marks[N].tMs)`, which §6 already makes O(log n) and exactly correct. The rail also
**highlights the current round as playback advances**, so it doubles as the coarse position indicator; keep the
linear transport bar for fine scrubbing within a round.

### 7.2 The stats panel is a pure fold — no new capture

Every metric the owner named is already implied by the frames:

| Metric | Derivation |
| --- | --- |
| Cards played this round | count of `cause === 'play'` frames in that wave |
| Bought / sold / rolled / upgraded / frozen | same count, by `cause` |
| Net gold flow | `view.gold` of the wave's last frame minus its first |
| Gold left unspent | `view.gold` on the wave's last shop frame |
| Board power at turn end | sum of `attack`/`health` on that frame's `board` |
| Combat result, damage dealt, Resolve lost | already fields on the `CombatFrame` |
| Tribe mix over time | `board[].cardId` → tribe, per wave |
| Purchase log | every `cause === 'buy'` frame: card + wave + price |

So the panel is `rollup(frames) → RoundStat[]`, a pure function with no engine dependency. Two consequences
worth stating plainly: it **cannot drift from the replay** (the numbers are literally derived from the frames
being watched), and it **works on old recordings**, because it reads only what state replay already stores.

**This makes `ShopFrame.cause` load-bearing.** It was introduced in §4 for pacing and debugging; the stats panel
promotes it to a data contract. `ActionCause` must cover *every* dispatched action type or counts silently
under-report — a missing case reads as "you played 3 cards that turn" when you played 5. Add an exhaustiveness
check over the `Action` union when Phase A defines it.

### 7.3 The one thing that is NOT free: gross gold spent

Net gold flow per round is exact and free (§7.2). **Gross spend is not.** Diffing `view.gold` conflates
spending with income — sell refunds, hero powers, quest and rune payouts — and a *single action* can do both
(buying Rune of the Tip Jar costs 0 and grants 4). Attributing by `cause` recovers most of it but not that case.

**Recommendation: capture `spent` and `earned` on the `ShopFrame` at capture time**, where the reducer has both
the before/after gold and the action in hand. Two numbers per frame is negligible against the combat logs that
dominate the payload (§8), and it removes a whole class of "the panel says 14, I counted 11" bugs. This is the
*only* capture change either feature needs, and it belongs in Phase A so recordings carry it from day one.

### 7.4 Recommendation: the rail and the panel are one widget

They answer the same question from two directions — "where was the action" and "take me there" — so building
them as one component makes the second gesture free:

```
┌──────────────────────────┐
│ Gold spent          ▾    │  ← the dropdown: what the bars encode
├──────────────────────────┤
│  R6  ▓▓▓▓▓▓▓▓▓  W   -0   │  ← click the row to seek to that round's shop opening
│  R7  ▓▓▓        L   -7   │
│ ▶R8  ▓▓▓▓▓▓▓▓▓▓▓▓ W  -0  │  ← current round, highlighted as playback advances
│  R9  ▓▓▓▓▓       L  -9   │
└──────────────────────────┘
```

One row per round: number, a bar for the selected metric, the combat verdict, the Resolve delta. Click to seek;
expand a row for that round's detail (purchases, plays, board power, the fight). The "dropdown for fun" the
owner asked for is then just *which metric the bars encode* — and every option in it is one line of the fold in
§7.2, so adding metrics later costs nothing.

### 7.5 The metrics worth shipping, in priority order

1. **Gold spent + cards played per round** — the literal ask, and the best single answer to "where was the action."
2. **Board power curve, yours vs the board you actually faced.** Both sides are already in
   `CombatFrame.initial` (`player` and `enemy` `CombatSideState`), so the opponent overlay is free — and it is
   the most diagnostic chart available: it shows the exact round you fell behind, which a solo curve cannot.
   **Ship it as a BASELINE, not as truth** — see §7.6 for what that means in practice (owner ruling
   2026-08-19: "the board power algorithm isn't perfect, though, but it's still fine to include as a
   baseline").
3. **Resolve track** — where the run started dying, straight off `resolveLost` per combat frame.
4. **Gold left on the table at End of Turn** — the sharpest read on *play quality* rather than activity.
5. **Purchase log** — a plain table of every card bought, with round and price.
6. **Tribe mix over rounds** — shows the pivot, and reads well as a stacked band.

### 7.6 Board power is a baseline — present it as one

Two different things could draw this curve, and the difference matters:

- **Raw stat total**, `Σ(attack + health)` over the board. Exact, model-free, and derivable straight from a
  recorded frame — nothing to be wrong about.
- **The fitted model**, `predictBoardElo(minions, wave)` / `boardStrength(...)` in `packages/sim/src/boardModel.ts`.
  Better on average, and honest about its own limits: held-out r = **0.789**, against 0.716 for raw power. Raw
  power explains synthetic boards almost perfectly (r 0.88–0.94) and **human** boards badly once they get
  going — **r = 0.37 at waves 10–12**. The model narrows that but does not close it, and its 16–20 band was
  never fitted at all, so late-game boards are scored against a neighbouring band.

Note where both are weakest: **the late game** — exactly the rounds a viewer cares most about. That is the
substance of the owner's caveat, and it drives three rules.

**Rule 1 — raw stat total is the primary line.** It is exact, it needs no model, and it is consistent with the
whole point of §3: a state replay renders recorded facts rather than re-derived judgments. The modeled score is
an optional secondary line, never the default.

**Rule 2 — if the modeled score is shown, CAPTURE it, never compute it at playback.** Computing
`predictBoardElo` while watching would score a months-old replay with *today's* fitted weights — reintroducing
precisely the content-drift fragility v2 exists to eliminate (§2). A model refit would silently rewrite the
history of every stored run. If we want it, it is a number recorded on the `CombatFrame` at capture time,
alongside the patch string that produced it.

**Rule 3 — present it as shape, not magnitude.** Label the series an estimate, avoid a precise-looking figure
next to it, and let it answer "which round did the lines cross" rather than "how strong was I." The crossing
point survives an r ≈ 0.79 model far better than any single value does, and the crossing is the question a
viewer is actually asking.

### 7.7 Spoilers

The panel necessarily reveals rounds the viewer hasn't watched yet (it shows the whole run). Since the scrub bar
already reveals the ending, **recommend showing everything**, with the current round highlighted. If that reads
badly in practice, a "hide future rounds" toggle is a two-line change over the same rollup.

---

## 8. Storage & size

- `run_telemetry.replay` is jsonb and opaque — **no migration**. Gate watchable rows on `version === 2`.
- **Combat event logs dominate.** ~14 combats × ~50–150 events; shop frames are small (a ~7-minion board + a
  5-card shop). Ballpark **100–300 KB/run** as raw JSON — fine for jsonb.
- **Store the full event logs, not `initial + combatSeed` + re-simulate.** Re-simulation would reintroduce the
  content-drift fragility we're eliminating. Full logs are the price of "pure accurate."
- **If size bites later:** delta-encode shop frames (only changed fields vs the previous frame — most actions
  touch one slot), and/or gzip the `replay` payload before upload. Do this only if measured; don't pre-optimize.

---

## 9. Migration & entry points

- v1 replays already in `run_telemetry` are unfaithful — abandon them. All v2 replays are faithful, so the v1
  "fidelity gate" (only show reproducible runs) is unnecessary; simply gate on `version === 2`, which also
  hides every pre-v2 row.
- **Entry-point UX is unchanged** from the killed branch and should be lifted wholesale (see §10): a "Watch"
  recent-matches feed on the title, and a per-row "Watch" on the leaderboard. Only the *data* differs — the
  fetch returns v2 replays, playback uses the `ReplayPlayer`.

---

## 10. Salvage list — lift these from the killed branch (PR #956) before it's gone

The branch is being deleted, but the following are directly reusable for v2 (the *entry points and chrome* were
correct; only the *engine* was wrong). Recover them from the PR #956 diff / the commits listed at the bottom.

- **Transport bar** — `packages/ui/src/ReplayOverlay.tsx` + its `.replaybar*` CSS in `styles.css`. Play/pause,
  click-to-seek progress, speed slider, exit. Reuse as-is; wire to `ReplayPlayer` instead of `replayDriver`.
- **Recent Matches overlay** — `packages/ui/src/RecentMatches.tsx` + `.matchlist/.matchrow*` CSS. The whole
  feed UX (portrait · name · hero · placement/wins · Watch). Repoint its fetch to v2.
- **Leaderboard Watch** — the per-row `.rankwatch` button in `Rankings.tsx` + CSS. Reuse.
- **Fetch scaffolding** — `fetchRecentReplays` / `fetchLatestReplayForUser` in `remoteBoards.ts` (best-effort,
  time-boxed, filter to playable). Reuse; change the filter to `version === 2`.
- **Author identity in the panel** — `replaySession.authorName` → `StatusBar` shows the recorded player's name
  (`replaySession?.authorName ?? playerName`). Directly applicable.
- **Per-action timing capture** — the store's `lastActionAt` / `replayTimings` delta accumulation. This is the
  `tMs` source for v2 frames; keep it.
- **Terminal snap + pacing floor** — end the timeline at the recorded result; floor/cap step ms so a fast run
  is legible. Reuse the constants.
- **The store's overlay plumbing** — `showRecentMatches` + open/close, `startReplay` closing launcher overlays,
  mounting order in `Game.tsx`. Reuse.

Do **not** salvage: `replayDriver.ts` (the reconstruct/`reduce` engine), the `servedBoards` injection, the
`isFaithful` fidelity gate (obviated by `version === 2`), and the v1 `Replay` interface's action-centric fields.

### What is already on `main` (merged as #955, `71e2a215` — "capture per-action timing + served boards")

The v1 `Replay` interface (`packages/sim/src/snapshot.ts`) with `timings?` + `servedBoards?`, and the store
capture that records them into telemetry, are **merged to main** and will remain after the branch dies. They
are dormant (nothing reads them without the viewer) and harmless. When building v2, either extend that
interface to `ReplayV2` or leave the v1 fields and add the v2 shape alongside — but the v2 capture should
supersede the v1 recording so telemetry isn't carrying both. Revisit at build time; not urgent.

---

## 11. Testing strategy (what replaces the determinism test)

- **Round-trip test:** play a bot run while capturing v2 frames, then assert that rendering each frame yields
  that frame (guards the `projectShopView` / `synthRun` projections). Trivial by construction, but it locks the
  view contract.
- **No-mutation-leak test:** capture frames, then run more turns, and assert the captured frames are byte-for-
  byte unchanged (guards the deep-clone requirement — the v1-class bug).
- **Result golden:** the captured `result` equals the live run's actual `{placement, record, finalBoard}`.
- **View-completeness check:** a lint/test that the fields `Recruit.tsx` + `StatusBar.tsx` read are a subset of
  `ShopView` (so a future UI addition that reads a new field fails loudly rather than rendering blank).
- **No determinism test needed** — that's the entire benefit of the approach.

---

## 12. Phased build plan (pick up cold from here)

- **Phase A — capture.** Define `ReplayV2` + `projectShopView(run)` (+ `MinionView`/`CardView` projections).
  Hook the store to emit frames after each recruit action, a combat frame per fight, and `result` at run end.
  Deep-clone. Upload in `replay` jsonb. Ship behind nothing — capture is invisible until a viewer reads it.
- **Phase B — playback core.** `ReplayPlayer` + `synthRunFromShopView` + the clock + seek. Reuse the transport
  bar. Verify against a freshly-captured v2 run end-to-end (watch a full winning run, confirm the final board
  and placement match reality — the exact check v1 failed). **Include the round rail** (§7.1): it is one pass
  over `frames[].wave` on top of the seek this phase already builds, and it is the coarse position indicator
  the transport bar is bad at.
- **Phase C — entry points.** Lift the recent-matches feed + leaderboard Watch (§10), gated on `version === 2`.
- **Phase D — the stats panel** (§7.2–§7.5). A pure `rollup(frames)` fold plus the rail-row UI. Independent of
  everything above and buildable last, since it reads only recorded frames — it even works on replays captured
  before it existed. Ship metrics 1–4 from §7.5; the rest are one fold line each.
- **Phase E — polish.** Size (delta/gzip) if measured; combat mid-seek behavior; speed edge cases; a "Watch"
  on Career match cards.

Each phase is independently shippable and testable; A can land and bake (accumulating real v2 recordings)
before B is built.

---

## 13. Open questions to settle at build time

- **Full combat logs vs `initial + seed` re-sim.** Recommend full logs (accuracy + drift-immunity). Only
  reconsider if size is genuinely prohibitive after delta-encoding shop frames.
- **Shop frames: per-action vs delta-encoded.** Recommend per-action for correctness; delta only if size bites.
- **Exact `ShopView` field set.** Requires the `Recruit.tsx` / `StatusBar.tsx` read audit — do this first in
  Phase A; it is the load-bearing contract.
- **Where `ReplayV2` types live.** Recommend `packages/sim` (references `BoardSnapshot` / `CombatEvent` /
  `CombatSideState` from core/sim). Keep them off the reducer hot path.
- **Seek-into-combat UX.** Start the fight's animation from the top, or show its resolved end state? The round
  rail makes this routine rather than rare — every rail click on a mid-combat target hits it.
- **Gross vs net Gold in the stats panel** (§7.3). Recommend capturing `spent`/`earned` in Phase A so gross is
  exact; the fallback is showing net flow only, which is free but reads less like "where the action was".
- **Does the stats panel spoil the run?** (§7.7) Recommend showing all rounds, since the scrub bar already
  reveals the ending.
- **Is the MODELED board score worth capturing at all** (§7.6), or is the raw stat total enough on its own?
  It is one number per combat frame if we want it, but it must be recorded rather than computed at playback.

---

## Appendix — reference points in the current code (as of 2026-08-11)

- `simulate(playerSide, enemySide, rng, cards, …) → { events, result, playerDamage, initial }` — the combat
  pure function; its return shape *is* a `CombatFrame`'s core.
- `lastCombat` on the run/store — a `simulate()` result; `useCombatReplay` animates it. The combat-frame target.
- `CombatEvent` union — `packages/core/src/types.ts` (source of truth for the event vocabulary).
- `CombatSideState`, `BoardSnapshot` — `packages/core/src/types.ts` (for `initial`).
- Recruit render inputs — `packages/ui/src/Recruit.tsx`, `packages/ui/src/StatusBar.tsx` (hero panel, power
  status line, player name pill). Audit these for the `ShopView` contract.
- `createLobbyRun(seed, heroId, rules, mode)` — `packages/sim/src/lobby/runLobby.ts`; player is
  `run.lobby.seats[0]`, `.placement` is the finish.
- `runRecord(state) → {wins,losses,draws}` — `packages/sim/src/state.ts`.
- Killed branch `feat/replay-driver` commits (recover salvage from these via `git show` / the PR #956 diff):
  - `caa381f6` the replay driver
  - `e6359ee5` viewer transport (play/pause, speed, scrub, restore, entry)
  - `548891b6` Phase 2+3 (recent-matches feed + leaderboard Watch)
  - `e4addec9` fidelity gate + author identity + pacing/progress fixes
- Merged, on main: `71e2a215` (#955) v1 capture (timings + servedBoards) — dormant, harmless.
- The `packages/sim/src/replayFidelity.test.ts` guard is v1-specific (bot runs only) — it does NOT prove real
  runs replay, as this investigation showed. v2 replaces it with the tests in §11.
```
