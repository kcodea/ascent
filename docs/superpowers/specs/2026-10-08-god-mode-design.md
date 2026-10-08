# God Mode (Practice) — design

Owner: Mike · Date: 2026-10-08 · Status: approved in chat, awaiting spec review

## Intent

A Practice option for **players** (not a dev tool) that turns the game into a learning playground: all the Gold,
no clock, and a panel to put any minion or spell in the shop and take any rune, then fight a real player board from
any round they choose. Owner's words: "give players access to all the money, search and print out minions in the
shop to buy, to start learning interactions."

It is **separate** from the DEV Scene Builder and Stage Builder: those stay as they are, DEV-only, and nothing in
God Mode depends on them.

## Decisions (owner, 2026-10-08)

| Question | Answer |
|---|---|
| What does a God Mode game count for? | **Nothing persists**: no XP, no crate, no save/Continue, no practice upload, no replay, no telemetry. |
| How is it chosen? | A **Standard / God Mode** switch on the Practice setup screen. Time row hidden in God Mode; Heroes, Health and Tribes still apply. Then the normal hero select. |
| Panel placement | **Floating, draggable, collapsible** to a "God Mode" tab; position and collapse remembered. **Hidden during fights.** |
| How does it end? | **Never on its own** (no round-15 finish). Health = Normal → the normal loss screen at 0; otherwise play until Home/Leave. |
| Build approach | Reuse `sandbox: true` (one switch already turns off every persistent write) plus a new `godMode` flag. |
| Opponent | On **End Turn**: "What round should your opponent board be on?" — buttons **1–15**. Clicking one fetches a random real player board from that round and **the fight starts immediately** (no preview). |
| Lobby rail | **Hidden** in God Mode. |
| Filters | Multi-select **Tier (1–6)** and **Tribe** chips for minions/spells; spells ignore Tribe. |

## 1. Setup and launch

- `PracticeConfig` gains `godMode: boolean` (default `false`). `PracticeOptions.tsx` gets a **Standard / God Mode**
  switch at the top; in God Mode the **Time** row is hidden (God Mode has no clock). Heroes / Health / Tribes behave
  as in normal Practice. The setting is remembered like the other practice knobs.
- Launch is unchanged up to the run: Practice setup → the standard `HeroSelect` → `pickHero` → `createLobbyRun(...,
  'practice', practiceDraft)`. When `practiceDraft.godMode` is set, the new run is stamped
  **`sandbox: true`, `godMode: true`, `embers: 999`**.
- `RunState` gains `godMode?: true`. It is the one flag every God Mode behaviour keys on; `sandbox` stays the write
  barrier.

## 2. Game rules (all keyed on `run.godMode`)

- **No clock.** `Recruit.tsx`'s `infiniteClock` becomes true when `run.godMode` (independent of the DEV
  `sbRules` preference). The Gold Fuse never starts.
- **Gold.** Set to 999 at the start of every shop turn, and topped back up to 999 whenever it drops below 900.
  Buying, rolling, freezing and tiering up behave exactly as normal; only the wallet refills. Done in the store
  (after each dispatch), mirroring the Scene Builder's top-up, so the reducer's Gold-spent tallies are unaffected.
- **Print a card** — new reducer action `godPrint { cardId }`: appends the card to `run.shop` (any tier, even
  above the shop's tier; may exceed the normal slot count). **Refused unless `run.godMode`** and the phase is
  `recruit`. Printed cards are ordinary shop cards: buy at the normal price, Freeze keeps them, a roll replaces
  them, three copies triple.
- **Take a rune** — new reducer action `godGrantRune { runeId }`: grants a rune or epic rune free, through the same
  path a bought rune takes (`applyQuestReward(..., 'rune')` + `ownedRunes`). **Refused unless `run.godMode`** and
  the phase is `recruit`. A rune already owned behaves as the game already treats a second copy (verified per rune
  during the build; any rune that can't stack is greyed out in the list as "owned").
  The ungated `devGrant` is **not** reused, so the dev path stays dev-only.
- **Never ends on its own.** The practice round-15 curtain is already skipped for sandbox runs. In addition, for
  `godMode` the game does **not** end when the background lobby finishes (`lobby.finished`); it ends only when the
  player's seat is eliminated (Health = Normal) or the player leaves. The lobby's stalemate backstop
  (`maxRounds: 60`) is lifted for God Mode as well.

## 3. Choosing the opponent each round

- In God Mode, **End Turn** opens a small prompt instead of fighting: *"What round should your opponent board be
  on?"* with buttons **1–15** (the last pick highlighted). **Clicking a button starts the fight.** Esc / ✕ closes the
  prompt and stays in the shop.
- On click: fetch **one random real player board for that wave** from Supabase `boards` — filtered to the run's
  set (`snapshot->>setId`) and the current patch prefix, excluding `origin = 'synthetic'`, randomised server-side
  (new RPC `god_board_sample(p_wave, p_set, p_patch_prefix)`, anon-executable, `boards` already has `select using
  (true)`). **~4 s timeout.**
- **Fallback:** if the fetch fails or returns nothing, pick a random board from the in-memory `OPPONENT_POOL`
  (downloaded at boot) with `wave === N`, the run's set, and a non-synthetic origin. If that is empty too, the
  prompt shows *"No boards found for round N — try another"* and no fight starts.
- The board is pinned as the round's foe through the existing sandbox path — `servedBoards[wave] = board`,
  `sandboxFoeWave = wave` — then `faceOmen` is dispatched (through the normal End Turn / choreography path, so End
  of Turn beats still play). Damage is the normal damage against that board.
- While fetching, the buttons show a busy state and can't be double-clicked.
- The background lobby still exists (the run infrastructure needs it) but is invisible: the **lobby rail is hidden**
  in God Mode, and its results never end the game (§2).

## 4. The God Mode panel

- New component `packages/ui/src/godMode/GodModePanel.tsx`, **lazy-loaded only when `run.godMode`**, in every
  build (not DEV-gated). Portaled into `stageHost()`. Wears the shared UI theme (`--ui-*` tokens / Gem plate).
- **Floating, draggable by its header, collapsible** to a small "God Mode" tab. Position and collapsed state persist
  in localStorage (try/catch). **Not rendered at all during combat** (phase ≠ recruit).
- **Filter bar** (above Minions / Spells):
  - **Tier chips 1–6**, multi-select, applied to minions and spells.
  - **Tribe chips**, multi-select — one per tribe present in the run's set pool, plus **Neutral** (`neutral`).
    Applied to minions; **Spells ignore Tribe.**
  - Nothing selected in a group = no filter. Chips combine with each dropdown's search text (AND).
  - Selections persist like the panel position.
- **Four searchable dropdowns:**
  - **Minions** — the run's set pool minions (tokens excluded), plus Rubies and gifts.
  - **Spells** — the run's set pool spells.
  - **Runes** — `RUNES` available in the run's set.
  - **Epic runes** — `EPIC_RUNES` available in the run's set.
  - Archived cards and runes are never listed.
  - Search = the Scene Builder's AND-of-terms match over name, tribe, text and keywords (shared helper, below).
- **Hover** a row: minions/spells show the full `<Card>` preview, runes show `<RuneCard>` — the existing
  `SceneBuilderPreview` (portaled into the stage, so it scales).
- **Click** a row: minion/spell → `godPrint` (panel stays open, so several can be printed in a row); rune →
  `godGrantRune`, with a short confirmation ("Gained Rune of …").
- **Shared code:** the Scene Builder's card/rune list building and search matching move into a small shared module
  (e.g. `packages/ui/src/cardSearch.ts`) used by both panels. No behaviour change to the Scene Builder.

## 5. Feel exceptions to the sandbox flag

`sandbox: true` was built for a dev rig, so a few presentation gates need a `godMode` exception:

- **Music** plays (`music.ts`).
- The **good-luck intro** plays (`goodLuckIntroStore.ts`).
- The **DEV Scene Builder / Stage Builder panels** never mount over a God Mode run, even in DEV (`Game.tsx`'s
  `SandboxDevPanels` gate becomes `sandbox && !godMode`).

Everything persistent stays off via `sandbox` (save, Continue, uploads, XP, crates, replay drafts, telemetry, bug
report capture).

## 6. Edge cases

- Printing into a full shop still adds the card. Roll clears printed cards; Freeze keeps them.
- Supabase slow/unreachable → 4 s timeout → boot pool fallback → "no boards" message; never an empty-board fight.
- Leaving mid-game: Home/Leave as normal; nothing saved, so Continue never offers a God Mode game.
- Health = Unlimited: the game only ends when the player leaves.

## 7. Testing

- **Sim:** `godPrint` / `godGrantRune` refused outside God Mode and outside the shop phase, applied inside it; a
  God Mode run is not ended by `lobby.finished` or round 15 / 60; the pinned board is the board fought.
- **Persistence:** a God Mode run never writes a save, an upload, XP, a crate or a replay draft (store-level test
  over a played round).
- **UI:** panel only mounts for `run.godMode` and not during combat; DEV panels never mount over God Mode; End Turn
  opens the round prompt and a button click dispatches the fight against the fetched board; lobby rail hidden;
  setup screen hides Time in God Mode; tier/tribe chips filter correctly (spells ignore tribe); fetch fallback order
  (RPC → boot pool → "no boards").
- **Oracle:** `R-GODMODE-*` rules for: nothing persists; gated actions; no clock + Gold refill; round prompt + real
  board; never ends on its own; panel hidden in fights; lobby rail hidden.
- **Patch notes:** a player-facing entry in `patchNotes.ts`.
- **Supabase:** a migration adding `god_board_sample`; owner deploys it (runbook in the PR). Until deployed, the
  boot-pool fallback carries the feature.

## Out of scope

Editing the opponent's board, choosing a specific player's board, adding cards straight to hand/board, a board
preview/reroll step, switching card sets mid-game.
