# 2026-09-23 — The announcer (voice lines on game moments) + the Audio panel

Owner asks (verbatim): *"i added announcer sfx here: C:\Game Assets\Ascent Art\SFX\Announcer — can you look at them? I
named them for when they should trigger. they shouldn't trigger more than once per game, though. and they shouldn't
trigger back to back for things like equipment or triples etc."* and *"with this we'll need an announcer toggle and
audio channel as well, similar to music. i think it's best we put an "audio" button in the settings window that
expands/collapses these 3 channels with mute toggles for each."* The queue logic below was shared with the owner
first (*"i like your logic you've shared here"*).

Stacks on the background-music PR (#1652, `feat/lobby-background-music`): the announcer reuses the music's gate, its
AudioContext seam and its store-driven shape.

## What shipped

- **`packages/ui/src/announcer.ts`** — the module: the detectors (`syncAnnouncer(state, prev)` on every store
  update, React-free, a handful of reads when the run object did not change), the priority queue, the channel and
  the DEV surface (`window.__announcer.log` / `.debug()`). Wired in `Game.tsx` beside the music.
- **`packages/ui/src/announcerSlice.ts`** — the persisted slice (a leaf module: no imports, so the store can hold
  it without a load-order cycle): `{ seed, fired: { event: [waves] }, count }`.
- **Store (`store.ts`)**: `announced` (fresh on every new run via `freshObservers`, restored from the boot save,
  discarded when its seed is not the run's), `markAnnounced(event, wave)` (records + schedules the idle autosave),
  `combatOdds` (the rail's real odds mirrored from `stampReplayOdds`, keyed by wave), and the save round-trip
  (`writeSave` / `loadSave` / `flushSave` carry `announced`).
- **`sfx.ts`**: `onStopAllAudio(cb)` so a Skip's `stopAllAudio` cancels the announcer's queue + playing line (the
  announcer sits on its own gain outside the mute bus, so the bus snap alone would not reach it).
- **`Recruit.tsx`**: `observeCombatBoard(replay.frame.player, wave)` per beat for MinionHits100Stats in a fight
  (seven reads, no allocation; the module reports once per fight and only while unfired). Never the enemy side.
- **Assets**: the 34 clips copied to `apps/web/public/announcer/<kebab-name>.mp3` (public files, `BASE_URL`-relative,
  fetched + `decodeAudioData` LAZILY on first need into a cached buffer; never the eager `import.meta.glob` bank).
  Name map: `GameStart1` → `game-start-1`, `BackToShop2` → `back-to-shop-2`, `Runeforge` / `Runeforge2` →
  `runeforge-1` / `-2`, `EpicRuneforge` → `epic-runeforge-1`, `EnteringCombat` → `entering-combat-1`,
  `EnteringCombatAfterLoss` → `entering-combat-after-loss`, `StartCombatUnder10hp` → `start-combat-under-10hp`,
  `SurviveUnder10hp` → `survive-under-10hp`, `LosingLowOddsFight2` → `losing-low-odds-fight-2`,
  `WinningLowOddsFight` → `winning-low-odds-fight-1`, `ThreeWinStreak` → `three-win-streak`,
  `MinionHits100Stats` → `minion-hits-100-stats`, `TopFour2` → `top-four-2`, `TopTwo` → `top-two-1`, `GameWon` →
  `game-won`, `GameLoss3` → `game-loss-3`, and so on (`ANNOUNCER_LINES` is the table).
  **Known asset issue:** `GameWon.mp3` is byte-identical to `TopTwo2.mp3` (md5 `18110e46…`), a mis-export the owner
  will replace; the corrected file drops in as `game-won.mp3`. The brief mentioned a `Win.mp3` as a second GameWon
  variant; no such file was delivered (34 files, all accounted for), so GameWon has one variant today.
- **Settings (`EscMenu.tsx`)**: the flat Audio section is now ONE "Audio" button (`aria-expanded`, `aria-controls`)
  that expands a panel of three channel rows, Game sounds / Music / Announcer, each a slider + a mute pill
  (`.escmute`, `aria-pressed`). Collapsed by default; open / closed remembered in `ascent.audiopanel`. No cursor
  keyword anywhere (the global gauntlet rule paints the pill), no `title=`, no dashes.
- **Patch note** (Systems, 2026-09-23, "Announcer") and **oracle rule `R-PRESENT-07`** (foundation).

## The triggers, as implemented

| Event | Moment (detected from the store) | Delay / floor | Shelf | Repeat |
|---|---|---|---|---|
| GameStart | wave 1's first shop lands (fresh run or a Continue that never heard it) | 4 s after the shop (`ANNOUNCER_GAME_START_DELAY_MS` = music start 3 s + 1 s, past the 600 ms fade-in) | shop | once |
| BackToShop | combat → recruit | none | shop | ≤ 2 per game, first at wave ≥ 2, second ≥ 5 waves later |
| Equipment | `run.equipment.available` grew | 400 ms (the equipment SFX first) | shop | once |
| Triple | golden count on board + hand grew | none | shop | ≤ 2 per game, ≥ 5 waves apart |
| TierSix | `tier` reached 6 | none | shop | once |
| Runeforge / EpicRuneforge | `runeforgeOffer` appeared (`runeforgeEpic` picks) | none | shop | once each |
| EnteringCombat | recruit → combat (Face Omen), still eligible through wave 3 if the first was dropped | 600 ms (the stinger + wipe) | combat | once |
| EnteringCombatAfterLoss | Face Omen with the last two `history` entries `lose` | 600 ms | combat | once |
| StartCombatUnder10hp | Face Omen at `resolve` ≤ 10 (Armor ignored) | 600 ms | combat | once |
| SurviveUnder10hp | the verdict (`combatSettled` flips) of a fight entered at ≤ 10, seat still standing | 3 s combat silence floor | combat | once; bypasses the cooldown when this round's line was StartCombatUnder10hp, and then outranks the other verdict lines (the round's only line) |
| LosingLowOddsFight | verdict `lose` with `combatOdds.win` ≥ 0.65 for this wave (absent → skip) | 3 s floor | combat | once |
| WinningLowOddsFight | verdict `win` with `combatOdds.win` ≤ 0.35 | 3 s floor | combat | once |
| ThreeWinStreak | verdict: the last three `history` entries `win` | 3 s floor | combat | once |
| MinionHits100Stats | a player board minion reaches ≥ 100 Attack or Health in the shop, or the replay's player frame does in a fight | none / 3 s floor | shop / combat | once |
| TopFour / TopTwo | combat → recruit (the rail settles on `resolveCombat`) with ≤ 4 / ≤ 2 seats alive, the player among them | none | shop | once each |
| GameWon / GameLoss | phase → gameover / victory; placement 1 (seat 0's stamped placement, else the standing count, as EndScreen reads it) → GameWon, else GameLoss | 1 s | never | once; outside the cap |

Gate: `isMusicWanted` (lobby / practice on screen, no sandbox, no replay, no title / picker / Practice setup); the
tutorial is mode `tutorial`, so it never qualifies.

## The queue

- **Constants** (`announcer.ts`): `ANNOUNCER_COOLDOWN_MS` 12 000 (from the previous line's END, or its cut),
  `ANNOUNCER_LINE_CAP` 8, `ANNOUNCER_GAME_START_DELAY_MS` 4000, `ANNOUNCER_TURN_ONE_QUIET_MS` 3600 (no line over the
  music's fade-in on a wave-1 entry), `ANNOUNCER_COMBAT_SILENCE_MS` 3000, `ANNOUNCER_FACE_OMEN_DELAY_MS` 600,
  `ANNOUNCER_END_DELAY_MS` 1000, `ANNOUNCER_EQUIPMENT_DELAY_MS` 400, `ANNOUNCER_STOP_FADE_MS` 100,
  `ANNOUNCER_LOW_RESOLVE` 10, `ANNOUNCER_HIGH_ODDS` 0.65, `ANNOUNCER_LOW_ODDS` 0.35, `ANNOUNCER_BIG_STAT` 100,
  `ANNOUNCER_BACK_TO_SHOP_MAX` 2, `ANNOUNCER_BACK_TO_SHOP_MIN_WAVE` 2, `ANNOUNCER_TRIPLE_MAX` 2,
  `ANNOUNCER_REPEAT_GAP_WAVES` 5, `ANNOUNCER_ENTERING_COMBAT_MAX_WAVE` 3, default level 0.9.
- **Priority** (`ANNOUNCER_PRIORITY`): GameWon = GameLoss 100 > TopTwo 90 > TopFour 85 > SurviveUnder10hp 80 >
  LosingLowOdds = WinningLowOdds 70 > ThreeWinStreak 65 > StartCombatUnder10hp 60 > EnteringCombatAfterLoss 55 >
  MinionHits100Stats 50 > TierSix 45 > EpicRuneforge 40 > Runeforge 35 > Triple 30 > Equipment 25 >
  EnteringCombat 20 > GameStart 15 > BackToShop 10.
- **The pump runs on its own task** (a 0 ms timer after an enqueue), never inside the store update that fed it, so a
  burst from one moment is weighed together: the ready line with the highest priority speaks, the other ready
  lines are dropped ("outranked"); lines whose time has not come stay and meet the cooldown when it does.
- **Cooldown**: a ready capped line inside the cooldown (or while a line plays) is DROPPED, not queued, and stays
  unfired, so it may speak later if its moment recurs and is still valid. GameWon / GameLoss wait it out.
- **Shelf life**: `expire('shop')` at the Face Omen, `expire('combat')` at the return to the shop; the end lines
  never expire. A Skip (`stopAllAudio`) or leaving the run cancels everything (100 ms fade on the playing line).
- **Cap**: checked at speak time from the live slice; the end lines are exempt.
- **Variant**: `announcerVariant(seed, event, occurrence, n)`, an integer hash, so a replayed run hears the same
  line and a second BackToShop draws its own index.
- **Marking** happens at speak time through `markAnnounced` (the store), which schedules the idle autosave, so a
  reload seconds after a line does not replay it; `flushSave` (Save & Quit) writes it synchronously.

## Judgement calls (flag for the owner)

- **Face Omen lines play 600 ms after the flip**, not after the 3 s silence: "Entering combat" belongs at the
  entry; the 3 s silence is applied to everything detected during the resolution (the verdict lines, the combat
  board stat). Move to the 3 s floor by changing `ANNOUNCER_FACE_OMEN_DELAY_MS` to `ANNOUNCER_COMBAT_SILENCE_MS`.
- **EnteringCombat stays eligible through wave 3**: a turn-1 Equipment bought late puts the first Face Omen inside
  the cooldown, and "the first Face Omen" would then never be heard at all.
- **Events that land during a cooldown are dropped rather than held**: holding them would still produce three lines
  on one turn, 12 s apart, which is the chatter the owner asked to stop.
- **The slice lives in the store** (not a private localStorage key) so the save, the boot restore and the new-run
  reset are the same paths every other accumulator uses.
- **The 12 s cooldown counts from the previous line's end**, so two lines are never closer than 12 s of silence.
- **Practice speaks** (it is a lobby, the music's gate); the invulnerable seat can still hear SurviveUnder10hp.

## Verification

- `packages/ui/src/announcer.test.ts` (46, jsdom + fake timers + a stub player through the injected seams): the
  gate (seven never-cases + lobby / practice), GameStart (4 s, seed variant, Continue never replays, seed-mismatch
  slice discarded, the turn-1 quiet window), the queue (priority drop, the Equipment → Triple cooldown drop,
  never-while-playing + 12 s from the end, shop / combat expiry, once per run, the cap with GameLoss on top,
  GameWon waiting out the cooldown, a failed load freeing the announcer), every detector with its threshold
  (BackToShop waves [2, 7], Equipment 400 ms, Triple ≤ 2 five waves apart, TierSix, Basic vs Epic forge,
  EnteringCombat, AfterLoss needs two, ≤ 10 vs 11 Resolve, SurviveUnder10hp + its bypass, 0.64 / 0.65 and 0.36 /
  0.35 odds + absent + stale, ThreeWinStreak third not second, 100-stat in the shop and in the fight, TopFour /
  TopTwo + player standing, GameWon / GameLoss timing), the silence rules (3 s combat floor, Skip fade, leaving the
  run, a new seed), and the channel's persisted level / mute.
- `packages/ui/src/escMenuAudioPanel.test.tsx` (6): the Audio button collapsed by default → three rows (labels,
  sliders, mute pills), open state remembered, per-channel mute persistence + live apply (slider disabled, Off),
  the Announcer slider → `ascent.announcervol`, no `title=` / no dashes, and the store round-trip (`markAnnounced`
  → `flushSave` → `ascent.save.announced`, `announcedFor` adopts / discards by seed).
- Browser (a worktree vite on 5253, own tab, Practice run, `window.__announcer.log` timestamps relative to the
  run start): GameStart queued at +0 ms, played at **+4013 ms** (music `playing`), ended +5707; Face Omen at
  +53292 → EnteringCombat played **+53915** (+623 ms); `combatOdds` mirrored `{ wave 1, win 0 }`; `resolveCombat`
  at +110740 → BackToShop played **+110768**; 13.5 s later an Equipment (store-emulated grant) queued +125762,
  played **+126164** (+402 ms), a Triple 1 s later queued +126774 and **dropped (cooldown)** at +127327 when the
  Equipment line ended; Save & Quit persisted `announced` (count 4) and Continue replayed nothing; a new run
  (seed 1937734141) heard `game-start-2` (the first seed heard `game-start-1`), Save & Quit mid-line cancelled it
  ("left the run"), Continue replayed nothing; the Audio button expands / collapses (aria-expanded, stored
  `ascent.audiopanel`), the Announcer mute pill persists (`ascent.announcermuted`, slider disabled, value Off,
  level 0) and survives a reload, the pill's computed cursor is the gauntlet URL; the Tutorial run
  (`startTutorial(LEARN_ASCENT)`, 6.5 s on screen) left the announcer inactive with an empty log.
