# Gauntlet — design

**Date:** 2026-09-29 · **Status:** approved design, awaiting plan · **Owner:** Mike

A single-player mode of 10 authored stages. Each stage is a 10-round 1v1 against one hand-built opponent whose
board grows round by round. Survive all 10 rounds to clear the stage, earn a crate (first clear only) and unlock
the next. Gauntlet **replaces "vs bots" practice** and sits in the Play menu beside Tutorial and Practice.

## 1. Rules

| Rule | Value |
|---|---|
| Rounds per stage | 10 |
| Opponent | one authored board per round (1v1) |
| Hero | any hero; normal Resolve + Armor (per hero, unchanged) |
| Shop / economy / tribes | identical to the normal game; random each attempt (no fixed seed) |
| Scouting | none — the opponent's next board is not shown before combat |
| Loss damage | normal formula (opponent tier + tier of each surviving enemy minion) |
| Damage cap | rounds 1–3: **5** · 4–6: **10** · 7–8: **15** · 9–10: **uncapped** |
| Tie | 0 damage to both sides (normal) |
| Stage lose | Resolve reaches 0 on any round → run ends |
| Stage clear | Resolve > 0 after round 10's combat — **even if round 10 was lost or tied** |
| Turn timer | none until the player has spent 30 Gold in a round, then 60 s; on timeout, identical to the normal game (can still reorder and freeze/unfreeze; cannot buy, sell, roll or play) |
| Mid-run quit | resumes like a normal run; not a loss |
| Opponent runes | one authored rune from round 6, a second from round 9; they stack (round-6 rune stays active 6–10) |
| Opponent rune visibility | icons shown during combat only |

Stage order: **1 Demons · 2 Kobolds · 3 Dragons · 4 Dwarves · 5 Beasts**. Stages 6–10 are unique themes (e.g.
Warden / warded units), authored later; shown as locked "Coming soon" slots until built. Difficulty rises with
stage number.

## 2. Engine

**Approach: a 2-seat lobby (player + one authored seat).** The tutorial already runs authored seats through the
lobby (`packages/sim/src/lobby/tutorialSeats.ts` — `authoredSeat`, `authoredTierFor`, `omenBoardMinions`), so
damage, elimination, timer and save/restore are reused. Rejected: reviving the legacy single-opponent course
path (`servedBoards` + `courseRounds`/threats) — retired, and the repo rule is not to build on it.

New pieces:
- **Run mode `'gauntlet'`** added to the `RunMode` union (`packages/sim/src/state.ts`), carrying the stage number.
  Like `tutorial`, it skips rating and ladder upload. Does **not** upload to `practice_games`.
- **Cap table** `gauntletDamageCap(round)` (5/5/5/10/10/10/15/15/∞/∞), applied wherever the lobby currently
  applies `lossDamageCap` for the player's fight. Kept separate from `lossDamageCap` so the normal game is untouched.
- **Clear check:** after round 10's combat is settled, a surviving player (Resolve > 0) ends the run as a clear.
  The lobby's `maxRounds` backstop is not used for this.
- **Opponent runes in combat:** the authored seat carries its active runes into `simulate()`; only combat-time
  rune effects can act (the opponent has no recruit phase). *Verify during planning whether authored seats can
  already carry runes; if not, add it as a small engine change.*
- **Authored board fidelity:** the seat fields each minion with the authored card id + Attack/Health, plus
  `golden` and `addedKeywords` on top of the card's printed keywords/effects. The existing `AuthoredOmen`
  (`{attack, health, cardId?}`) is extended or wrapped accordingly.
- **Opponent hero power:** out of scope now; the data format leaves room for it (`hero?` on the stage) for the
  unique stages 6–10.

### Stage data

One JSON file per stage, e.g. `gauntlet/stages/01-demons.json` (lives with content; exact directory decided in
the plan). The Stage Builder writes these; the game reads them.

```ts
interface GauntletStage {
  number: number;              // 1..10
  name: string;                // "Demons"
  opponentName: string;        // "The Demon Host" — shown on the in-run portrait
  tribe?: Tribe;               // emblem; absent for unique stages
  runes: { round6?: RuneId; round9?: RuneId };
  rounds: GauntletRound[];     // exactly 10
}
interface GauntletRound {
  tier?: number;               // 1..6; absent = normal tier-up pace for that round
  board: GauntletMinion[];     // ≤ 7
}
interface GauntletMinion {
  cardId: string;
  attack: number;
  health: number;
  golden?: boolean;
  addedKeywords?: Keyword[];
  cardVersion: string;         // fingerprint of the card def at save time — drives "changed since saved"
}
```

Opponent boards may use any card in `CARD_INDEX` (they are not drawn from the player's set pool).

## 3. Stage Builder (dev build only)

A separate screen beside the Scene Builder, reusing its board-editing components (add/remove, drag reorder,
Attack/Health edit) rather than copying them. Never shipped to players.

- **Stage picker:** 1–5 by tribe, 6–10 as blank named slots.
- **Round strip 1–10:** click to load that round's opponent board; unsaved rounds show a dot.
- **Per round:** Tier field (blank shows the derived normal-pace tier); per-minion Golden toggle and
  added-keywords picker.
- **Per stage:** opponent name; rune slots appear on rounds 6 and 9 only. Recruit-only runes are greyed with a
  "no effect for opponents" badge.
- **Warnings:** red flag for a missing card id; amber "changed since saved" when a card's current fingerprint
  differs from the saved `cardVersion`.
- **Copy from previous round** — boards mostly grow from the round before.
- **Test this round** — fight the round's opponent board against a player board you set up, via the Scene
  Builder's existing fight flow (the internal bot-lobby code is kept for this; see §5).
- **Save all edits** — writes the stage file into the repo through a dev-server endpoint, the same way the FX
  workbench saves defs; it then goes through a normal commit + PR. Leaving with unsaved edits asks to confirm.
- **Validation on save (and in CI):** card ids exist, ≤ 7 minions, tier 1–6, runes exist, exactly 10 rounds.
- Not in v1: multi-step undo (beyond discard), duplicating a whole stage.

## 4. Player-facing screens

- **Play menu:** new **Gauntlet** node beside Tutorial and Practice.
- **Stage select:** 10 slots — 🔒 locked / ▶ available / ✓ cleared (+ "crate claimed") / "Coming soon". Stage 1
  starts unlocked; clearing N unlocks N+1. Picking a stage → normal hero select (any hero) → run.
  - Signed out: banner — *"You're not signed in — progress is saved on this device only and clears won't grant
    crates."*
  - Cleared stage: "Already cleared — no crate for replays."
- **In run:** normal shop/board/runes/timer, except:
  - the 8-seat standings panel is replaced by one opponent portrait (tribe emblem + `opponentName`);
  - round counter **"Round N / 10"**;
  - current damage cap next to Resolve ("Max loss: 10" / "No cap").
- **Loss screen** (Resolve 0): "Defeated — Stage S, Round R" · **Retry** (→ hero select for the same stage) ·
  **Home**. No replay button.
- **Win screen:** "Stage cleared!" · crate reveal via the existing crate UI (first clear, signed in only) ·
  "Stage N+1 unlocked" · **Next stage** · **Home**.
- UI follows the repo conventions: portal into `stageHost()`, no raw `vw`/`vh`, gauntlet cursors (no bare
  `cursor: pointer`), no `title=` tooltips.

## 5. Practice mode change

- Remove "vs bots" from the **player-facing** Practice setup (`PracticeOptions.tsx`, `PracticeConfig.opponents`);
  Practice becomes vs-players only. Other Practice options are unaffected.
- Keep the bot lobby code (`packages/sim/src/lobby/practiceBots.ts`) for internal use: the Scene Builder runs on
  it and the Stage Builder's "Test this round" uses it.
- Persisted drafts with `opponents: 'bots'` (`ascent.practiceconfig`) are migrated/ignored on load.

## 6. Progress and rewards

- **Account (signed in):** Supabase table `gauntlet_progress` — one row per `(user_id, stage)`:
  `first_cleared_at`, `crate_granted`. Stage N is unlocked iff stage N−1 has a row (no separate unlock flag).
- **Clear claim:** the client calls an edge function (e.g. `gauntlet-clear`) with the stage number. The server
  inserts the row and, **only on the first clear of that stage**, grants one standard crate through the existing
  crate code. Repeat clears are no-ops. Offline clears queue through the existing progression queue
  (`ascent.progressionqueue`).
- **Trust model:** the server trusts the client's clear claim (owner decision 2026-09-29). Server-side
  re-simulation is deferred; exposure is at most one standard crate per stage.
- **Signed out:** clears/unlocks stored in local key `ascent.gauntlet.local`, device-only. Signing in later
  ignores it — no merge, no retroactive crates.

## 7. Testing

- **Engine:** cap table for rounds 1–10; round-10 loss/tie with Resolve > 0 = clear; Resolve 0 on any round ends
  the run; opponent runes fire in combat and stack from 6/9; authored minions field exactly as saved (stats,
  golden, added keywords).
- **Stage data (CI):** every stage file loads and validates (card/rune ids exist, ≤ 7 minions, tier 1–6, 10
  rounds). This is the guard against deleted cards.
- **Card drift:** Doc Bot reports boards whose `cardVersion` no longer matches (informational, not a CI failure);
  re-saving in the Stage Builder clears it.
- **Server:** first clear grants 1 crate, second grants 0; unlock gating N → N+1.
- **Oracle:** each pinned behaviour gets an approved `R-GAUNTLET-NN` rule in
  `packages/rules/src/registry/approved/` with its scenario test, per the repo's bug-fix/rule convention.
- **Performance:** shop and combat are reused, so the budget is unchanged; stage select and the Stage Builder
  get a `npm run perf` / DevTools pass before shipping.
- **Docs:** `docs/GAME-RULES.md` gains a Gauntlet section; `patchNotes.ts` gets an entry when the mode ships.

## 8. Delivery (one PR each)

1. **Engine** — `gauntlet` run mode, cap table, clear check, opponent runes, stage data format + validation.
2. **Stage Builder** — so Demons can be authored while 3–4 are built.
3. **Gauntlet screens** — Play-menu node, stage select, in-run HUD changes, loss/win screens; remove "vs bots"
   from Practice.
4. **Progress + crates** — `gauntlet_progress` migration, `gauntlet-clear` function, signed-out local store and
   warning.

## Out of scope (for now)

Opponent hero powers (reserved for stages 6–10), server-side clear validation, tiered crates, fixed-seed stages,
scouting, full-run replay, Stage Builder multi-step undo.
