import { create } from 'zustand';
import { CARD_INDEX, activeSet, type SetId } from '@game/content';
import { CONFIG, HEROES, OPPONENT_POOL, OPPONENT_POOL_DATA, registerOpponents, createRun, deserialize, adoptServerRating, initialProfile, isPlayerAction, missingCardIds, nextOpponent, reconstructRunTelemetry, recordTelemetryAction, emptyTelemetryLog, withLiveTelemetry, type TelemetryLog, beginDerive, observeAction, finishDerive, type DeriveState, reduce, reduceWithPresentation, resolveLobbyRating, serialize, snapshotBoard, socBoard, type Action, type BoardSnapshot, type PlayerProfile, type RatingChange, type Replay, type RunMode, type RunState, createLobbyRun, createTutorialRun, type TutorialCourse, warmLobbySeat, prepareActionWithPresentation, type PreparedPresentationAction } from '@game/sim';
import type { PresentationBatch } from '@game/core';
import { combatTimelineFrom } from './choreographer/combatTimeline';
import { setCombatDraftProvider, setCombatLiveProvider } from './choreographer/combatHolds';
import type { CompiledTimeline } from './choreographer/timelineTypes';
import type { BoardMinion, Tribe } from '@game/core';
/** The player whose Career is being viewed, when it is not your own. This is the leaderboard row verbatim —
 *  `userId` is what the run history is fetched by, and `author` is display-only. */
/** When a Career is opened from a specific game (a Recent Games row), this pins WHICH run to expand + scroll to.
 *  run_telemetry and run_history are written from the same run-end flow, so `createdAt` lines up within seconds
 *  — enough to disambiguate two otherwise-identical runs by nearest time. */
export interface CareerFocus {
  heroId: string;
  wins: number;
  placement: number | null;
  createdAt: string | null;
}

export interface CareerView {
  userId: string;
  author: string;
  rating: number;
  gamesPlayed: number;
  favoriteHero?: string;
  /** Set only when opened from a single game (Recent Games) — the run to auto-expand + scroll to. */
  focus?: CareerFocus;
}

import type { CardView } from './Card';
import type { CombatBuffDelta } from './runBuffs';

/** Combat quest-objective progress landed so far in the live replay (same shape as `CombatResult.playerQuestTally`
 *  plus a Deathrattle/Echo total). Drives the quest nodes' live-tick. */
export interface CombatQuestDelta {
  attack: number; summonCombat: number; slaughter: number; slaughterKeyword: number; deathrattle: number; friendlyDeath: number; rally: number; summonImp: number;
  attackByTribe: Partial<Record<Tribe, number>>;
  summonCombatByTribe: Partial<Record<Tribe, number>>;
  slaughterByTribe: Partial<Record<Tribe, number>>;
}
import { sfx } from './sfx';
import { releaseAllStats } from './fx/statHold';
import { clearAllSpellBuffs } from './spellBuffFx';
import { liveBoardView } from './instView';
import { saveCapturedBoards, saveRunBoards } from './boardLibrary';
import { perfMonitor } from './perfMonitor';
import { fetchPlayerRating, fetchAndRegisterBoardRecords, fetchAndRegisterPool, recordFightResult, refreshOpponentPoolAndRecords, supabaseAuthProvider, uploadBoards, uploadPlayerProfile, uploadRunHistory, uploadRunTelemetry, uploadVictory, fetchRunHistory, claimHandle, flushUploadQueue } from './remoteBoards';
import { initIdentity, currentIdentity } from './identity';
import { notifyTutorialActions } from './tutorial/actionBus';
import { gateBlocks, notifyGateNudge } from './tutorial/gateBus';
import { buildRunHistoryEntry, careerStats, clearRunHistory, type RunHistoryEntry } from './runHistory';
import { clearProfile, loadProfile, saveProfile } from './profileStore';
import { turnClock } from './turnClock';


// Serve real, buildable boards as enemies: load the COMMITTED opponent pool (`OPPONENT_POOL_DATA`, baked by
// `npm run pool` from seeded bot runs + any imported you/friend board exports) plus this browser's own
// captured boards, once at startup while OPPONENT_POOL is still empty. The headless harnesses + tests don't
// load this module, so they keep their empty-pool procedural baseline. `registerOpponents` drops any board
// referencing a card this build no longer has, so a stale committed/stored board can never crash combat.
// LOCAL BOARDS ARE NOT OPPONENTS (owner call 2026-08-03: "I ONLY want it to be bots or online opponents").
// `loadStoredBoards()` used to be registered here, which meant this browser's own captured runs could be
// seated against you. Now the ONLY player-run source is the shared Supabase pool below; the committed
// `OPPONENT_POOL_DATA` stays as the procedural floor (every board in it is `origin: 'synthetic'`, which
// `playerRunsFrom` already excludes from lobby seats, so it never competes for a player slot).
//
// Local capture still happens — it is the buffer that feeds `uploadBoards` and the export path — it simply
// no longer feeds matchmaking. Consequence, accepted: an OFFLINE lobby has no player seats at all and fills
// entirely with bots, which is the literal shape asked for.
if (OPPONENT_POOL.length === 0) registerOpponents([...OPPONENT_POOL_DATA]);

// Additively fold in the live SHARED pool (Supabase) for this build's version — fetched ONCE at startup (now,
// on the title screen, long before any run faces combat) and kept static for the session like the committed
// pool, so replays stay faithful. Matches by version prefix (`<version>+`) so per-commit SHA churn doesn't hide
// boards. No-ops entirely when no backend is configured; the committed OPPONENT_POOL_DATA is the offline floor.
// ACCOUNTS C1: establish the player's identity FIRST — every upload path refuses to write an unowned row,
// so the session has to exist before a run can finish. Anonymous, so there is no login screen and no
// friction; it persists across reloads, and C2 upgrades it in place to a real account keeping the same
// `user_id`. Never blocks boot: a failure just means this session uploads nothing, exactly as an
// unconfigured backend already behaves.
// ACCOUNTS C1/C2: establish identity first, and seed + subscribe the account mirror. Wired at the bottom of
// this module (after `useGame` exists) — see `initAccounts()`.
void fetchAndRegisterPool(`${__APP_VERSION__}+`);
// Board win-rate records for matchmaking weighting — same startup moment, same session-static contract.
void fetchAndRegisterBoardRecords();

/** How many heroes the pre-run picker offers (or all of them, if fewer exist). */
const HERO_SELECT_COUNT = 3;

/** A fresh shuffle of hero ids for the picker. UI-level randomness — the hero *choice* is a
 *  meta decision, not part of the seeded run, so Math.random is fine here (and not in the sim). */
function rollHeroChoices(): string[] {
  const ids = HEROES.filter((h) => !h.wip).map((h) => h.id); // WIP heroes (Runesmith pre-UI) stay out of the picker
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids.slice(0, Math.min(HERO_SELECT_COUNT, ids.length));
}

const countGolden = (s: RunState): number =>
  [...s.board, ...s.hand].filter((c) => c.golden).length;

/**
 * Drop every piece of per-body FX state the store keeps OUTSIDE React, because the bodies it describes are
 * about to stop existing.
 *
 * Both of these are keyed by minion uid and live in module globals, so nothing unmounts them: a withheld
 * stat delta (`fx/statHold.ts`) and a spell-buff sparkle (`spellBuffFx.ts`) survive any amount of React
 * teardown. uids are reused across runs — `createRun` starts its counter from scratch — so a survivor
 * silently withholds SOMEONE ELSE'S number, and `heldFor` only sweeps on read, which means the wrong number
 * can sit on a badge indefinitely.
 *
 * Called from every point where the set of live bodies is replaced wholesale: the phase flip (recruit board
 * → combat board), and each of the run swaps, which build a fresh `RunState` through `set()` and so never
 * reach the dispatch path at all. The phase check alone missed all of them — and misses the run-to-run case
 * outright, since a new run starting in `recruit` from an old run in `recruit` is no phase change.
 */
function dropBoardFx(): void {
  releaseAllStats();
  clearAllSpellBuffs();
}

/** Fire the sound for a dispatched action (+ a sparkle when a triple just formed). */
function actionSfx(action: Action, prev: RunState, next: RunState): void {
  // The reducer returns the *same* reference for a rejected action (can't afford, board/hand
  // full, timer up). For the actions a player actively triggers expecting something to happen,
  // play a clear "wrong" buzz instead of the success blip — and skip the success sound.
  if (next === prev) {
    if (action.type === 'buy' || action.type === 'play' || action.type === 'roll' || action.type === 'upgrade') {
      sfx.deny();
    }
    return;
  }
  switch (action.type) {
    case 'buy': sfx.buy(); break;
    case 'play': {
      // A minion landing on the board vs a spell being cast get different sounds (spells get per-spell
      // sounds later). Look up the played card in the pre-dispatch hand.
      const card = prev.hand.find((c) => c.uid === action.uid);
      const def = card ? CARD_INDEX[card.cardId] : undefined;
      // THREE kinds of played card, not two. A Ruby is spell-LIKE but not a spell, so it fell to the else and
      // played the minion-landing thump — a card that never lands on the board, thumping. It now makes NO cast
      // sound: `sfx.gemApply` fires when the gem lands on its target, and for a hand-played Ruby the cast IS
      // the land (owner ruling 2026-08-02). One event, one sound.
      if (def?.ruby) { /* silent here — the gem's own land carries it */ }
      else if (def?.spell) sfx.castSpell();
      else sfx.play();
      // Layer the card's own unique voiceline/SFX (if it has one) over the general landing/cast sound.
      if (card) {
        sfx.cardVoice(card.cardId);
        // A minion whose Battlecry (an onPlay effect) fires as it's played → its effect-proc SFX
        // (cards/<id>.effect.mp3), layered over the landing. Spells get their own cast sound, not this.
        const def = CARD_INDEX[card.cardId];
        if (def && !def.spell && def.effects.some((e) => e.on === 'onPlay')) sfx.cardEffect(card.cardId);
        // A Battlecry that summons a token (e.g. Alleycat → Stray) → play the summon cue (general SFX +
        // the token's own clip). Read the card's onPlay effects for a tokenId.
        for (const eff of CARD_INDEX[card.cardId]?.effects ?? []) {
          const tokenId = eff.on === 'onPlay' ? eff.params?.tokenId : undefined;
          if (typeof tokenId === 'string') sfx.summon(tokenId);
        }
      }
      // A minion that arrives WITH Taunt (innate or self-granted on play) — fire the bulwark "thunk" as the
      // silver shield deploys behind it. (The board-wide grant check below skips it: it's new to the board.)
      if (next.board.find((m) => m.uid === action.uid)?.keywords.includes('T')) sfx.taunt();
      break;
    }
    case 'sell': sfx.sell(); break;
    case 'roll': sfx.roll(); break;
    case 'freeze': (next.frozen ? sfx.freeze : sfx.unfreeze)(); break; // toggle → freeze vs unfreeze cue
    case 'reposition': case 'reorderShop': sfx.reorder(); break;
    case 'upgrade': sfx.upgrade(); break;
    // hero power: the "pulse" cue plays on the button press (StatusBar), so no per-action sound here.
    case 'discover': sfx.buy(); break;
    case 'faceOmen': sfx.combatStart(); break;
    default: break;
  }
  // The recruit board and the combat board are different sets of bodies; anything withheld for one of them
  // has nothing left to deliver it once the other is on screen. See `dropBoardFx`.
  if (prev.phase !== next.phase) dropBoardFx();
  // A Discover choice just OPENED (any action that set run.discover — playing a Discover spell, a golden's
  // reward, etc.): play the discover cue, on top of the triggering action's own sound.
  if (!prev.discover && next.discover) sfx.discover();
  // A friendly minion was just GIVEN Taunt — it existed on the board WITHOUT Taunt and now has it (so this
  // skips minions bought/played already-Taunt; only granted Taunt, e.g. Bulwark/a hero power, fires it).
  const wasTaunt = new Map(prev.board.map((m) => [m.uid, m.keywords.includes('T')]));
  if (next.board.some((m) => m.keywords.includes('T') && wasTaunt.get(m.uid) === false)) sfx.taunt();
  if (countGolden(next) > countGolden(prev)) sfx.triple();
}

interface GameStore {
  run: RunState;
  /** UI flag: Hero Power is armed and waiting for a target minion. */
  heroArmed: boolean;
  /** UI flag: the end-of-turn proc animation is playing — recruit actions stay locked until it ends. */
  endTurnAnimating: boolean;
  /** Set the end-of-turn animation lock (Recruit drives it around the proc beat sequence). */
  setEndTurnAnimating: (v: boolean) => void;
  /** Enemy minions killed in the live combat replay — bridges useCombatReplay → Cassen's StatusBar counter. */
  combatEnemyDeaths: number;
  setCombatEnemyDeaths: (n: number) => void;
  /** Run-buff gains telegraphed so far this fight (spell power, max Gold) — bridges useCombatReplay → the live
   *  Buffs window so it ticks up in sync with the replay. `null` outside combat (the row reads the run state). */
  combatBuffs: CombatBuffDelta | null;
  setCombatBuffs: (b: CombatBuffDelta | null) => void;
  /** Combat quest-objective progress landed so far this fight — bridges useCombatReplay → QuestBadges so
   *  combat objectives (attack / summonCombat / slaughter / Echo) LIVE-TICK during the replay. `null` outside
   *  combat (the panel reads only the run state's progress). */
  combatQuestDelta: CombatQuestDelta | null;
  setCombatQuestDelta: (d: CombatQuestDelta | null) => void;
  /** Badge id → how many times its combat effect has FIRED so far in the current replay. QuestBadges plays a
   *  one-shot pulse on the matching node each time the count bumps (keyed by the count), then it goes dormant. */
  combatTriggeredQuests: Record<string, number>;
  setCombatTriggeredQuests: (counts: Record<string, number>) => void;
  /** Quest ids that COMPLETED mid-combat so far in the current replay — QuestBadges renders + pulses these live
   *  (their node hasn't settled as `completed` yet). Cleared out of combat. */
  combatCompletedQuests: string[];
  setCombatCompletedQuests: (ids: string[]) => void;
  /** Increments on each sell — drives the gold "+1" flash on the Embers chip. */
  sellTick: number;
  /** The card being inspected (right-click) in a centred, enlarged overlay, or null. */
  inspect: CardView | null;
  /** Hero ids offered by the pre-run picker; non-null = the hero-select overlay is showing. */
  heroChoices: string[] | null;
  /** The hero trio the current run was picked from (captured at pickHero) — for run telemetry (hero offer rate).
   *  Not in the seeded replay (the picker rolls off UI randomness), so it's stashed here at pick time. */
  lastHeroOffer: string[];
  /** UI: cards show compact (art + keyword glyphs, full text on hover) vs. always-on rules text. */
  compactCards: boolean;
  /** Flip the compact / full-text card display (Esc menu). */
  toggleCompact: () => void;
  /** Your display name — stamped onto boards you capture (origin:'self') so they carry "by you" when served
   *  and when exported for a friend's pool. Persisted; set in Settings. Empty = anonymous. */
  playerName: string;
  setPlayerName: (name: string) => void;
  /** ACCOUNTS C2 — the live account state, mirrored from the identity seam. `anonymous` true = a device-bound
   *  session that is lost if site data clears; once a magic link is confirmed, `email` fills in and
   *  `anonymous` flips false, and the SAME account (boards, runs, rating) becomes portable across devices. */
  account: { userId: string | null; email: string | null; anonymous: boolean; discriminator: string | null };
  /** Whether the account panel overlay is open (from the Title/Settings). */
  accountPanelOpen: boolean;
  openAccountPanel: () => void;
  closeAccountPanel: () => void;
  /** Send a sign-in email (a 6-digit code + a link). Resolves whether it WAS SENT. The player then either
   *  types the code (`verifyEmailCode`, works in the exe) or clicks the link on web (lands via `onChange`). */
  sendMagicLink: (email: string) => Promise<{ ok: boolean; error?: string }>;
  /** Finish sign-in by entering the emailed 6-digit code — the desktop path (no web origin needed). On success
   *  the account state updates through the identity `onChange` subscription. */
  verifyEmailCode: (email: string, code: string) => Promise<{ ok: boolean; error?: string }>;
  /** Sign out of a real account (drops back to a fresh anonymous session on next load). */
  signOutAccount: () => Promise<void>;
  /** The player's chosen profile avatar — an art id (`hero:<id>` / `minion:<cardId>` / `power:<heroId>`),
   *  or null for the default initial glyph. Cosmetic, local, persisted. Set via the avatar picker. */
  playerAvatar: string | null;
  setPlayerAvatar: (id: string | null) => void;
  /** Whether the avatar picker overlay is open (openable from the Title chip + Career profile card). */
  avatarPickerOpen: boolean;
  openAvatarPicker: () => void;
  closeAvatarPicker: () => void;
  /** Combat replay speed multiplier (0.5×–5×). 1 = the tuned default. Set by the in-combat slider; persisted. */
  combatSpeed: number;
  setCombatSpeed: (speed: number) => void;
  /** PRACTICE-only shop-timer multiplier (1–4×), chosen from the dropdown beside the clock. 1× is the scored
   *  mode's clock exactly; 3× is the default (what practice was fixed at before). Persisted. */
  practiceTimer: number;
  setPracticeTimer: (mult: number) => void;
  /** The current run's action log (only state-changing actions), reset on a fresh run. With the run
   *  seed it forms a deterministic replay — the basis for board capture + async-PvP snapshots. */
  replayActions: Action[];
  /** REPLAY VIEWER — per-action wall-clock deltas (ms since the previous recorded action), parallel to
   *  `replayActions`. UI metadata only (never fed to the sim), so a viewer can play back the real cadence. */
  /** Live-captured acquisition streams for the Balance Report — see `TelemetryLog`. */
  telemetryLog: TelemetryLog;
  /** The live balance derivation for the run in progress (see `sim/runDerive.ts`). Fed on every dispatch,
   *  persisted with the save, uploaded at run end. */
  deriveState: DeriveState;
  /** LOBBY runs only: the per-wave boards captured AS THEY WERE PLAYED, rather than re-derived from the action
   *  log when the run ends. Replaying a lobby run re-simulates all seven opponent seats (~20 s of blocked main
   *  thread, measured), and the boards come out identical either way — so a lobby keeps them as it goes.
   *  Persisted with the save so a quit-and-resume doesn't lose the boards played before the reload. */
  capturedBoards: BoardSnapshot[];
  /** BEAT SYSTEM (PR 3) — the latest recruit presentation batch, published by `dispatch` in DEV only (prod +
   *  headless keep the zero-alloc path). Ephemeral: never serialized into a save. Read by the Beat Lab viewer
   *  (PR 4); `beatRevision` bumps on each publish so subscribers can react even when a batch repeats. */
  latestBatch: PresentationBatch | null;
  beatRevision: number;
  /** CHOREOGRAPHER PR 16 — the last resolved COMBAT, adapted into the shared timeline vocabulary for the Beat
   *  Lab to inspect (DEV only; null in prod). Read-only: combat still plays on its own runtime, this only
   *  re-describes the fight. */
  latestCombatTimeline: CompiledTimeline | null;
  /**
   * CHOREOGRAPHER PR 19 — the Beat Lab's session draft, published for LIVE playback (blueprint §15).
   * Ephemeral and never serialized: closing the app loses it, exactly like the Lab's own state. `beatDraftLive`
   * is the explicit opt-in — normal play uses shipped config unless the owner flips it, and a persistent
   * banner shows whenever draft values are pacing the real game. DEV only; prod never reads either field.
   */
  beatDraft: { timings: Record<string, { windupMs?: number; holdMs?: number; recoveryMs?: number }>; policies: Record<string, string> } | null;
  beatDraftLive: boolean;
  setBeatDraft: (draft: GameStore['beatDraft']) => void;
  setBeatDraftLive: (on: boolean) => void;
  /** Export the current run as a tiny deterministic replay `{ seed, heroId, actions }` (DEV: grab it
   *  via `useGame.getState().exportReplay()`; feed it to `replayRun` / the replay harness). */
  exportReplay: () => Replay;
  /** Apply an engine action — the only way run state changes. Pure reducer under the hood. */
  dispatch: (action: Action) => void;
  /**
   * CHOREOGRAPHER PR 3 — the prepared presentation transaction (blueprint §5.3). EPHEMERAL: resolved
   * gameplay held off-screen while its emitted batch animates, so the recruit scene stays mounted and
   * End of Turn is resolved EXACTLY ONCE instead of being projected and then resolved.
   * Never serialized (a save only ever holds committed state).
   */
  presentationTx: PreparedPresentationAction | null;
  /** Resolve `action` now and hold it. Returns the prepared transaction so the caller can compile its batch. */
  preparePresentationAction: (action: Action) => PreparedPresentationAction | null;
  /** Commit the held transaction through the SAME path an ordinary dispatch uses. Idempotent. */
  commitPresentationAction: () => void;
  /** Abandon a held transaction WITHOUT committing (only when the run itself is going away). */
  cancelPresentationAction: (reason: string) => void;
  /** Toggle Hero Power targeting mode. */
  armHero: () => void;
  /** Open / close the inspect overlay for a card. */
  inspectCard: (view: CardView) => void;
  clearInspect: () => void;
  /** Open the hero picker (a fresh roll of choices) — the gate before a run starts. */
  startHeroSelect: () => void;
  /** Commit a chosen hero: start a fresh run as that hero and close the picker. */
  pickHero: (heroId: string) => void;
  /** Start a fresh run directly (optionally with a seed / hero), bypassing the picker. */
  newRun: (seed?: number, heroId?: string) => void;
  /** Boards this run contributed to the pool (captured on run-end) — shown on the post-run summary (A6).
   *  0 until the deferred capture runs; stays 0 for Practice (read-only). */
  lastRunBoards: number;
  /** The player's career profile (rating + Line + high-water marks). Loaded at boot, updated on each scored
   *  run's finish. The run's par is set from `profile.currentLine` at start. See `@game/sim` playerRating. */
  profile: PlayerProfile;
  /** The most recent scored run's rating change, for the end screen to show (+N / −N, promotion, etc.).
   *  null until a scored run finishes this session; stays null for Practice. */
  lastRating: RatingChange | null;
  /** Reset the local career: wipe the persisted profile (rating/Line) + match history back to a fresh start.
   *  Does NOT touch the in-progress run, captured boards, or the shared Supabase pool/leaderboard. */
  resetCareer: () => void;
  /** Bumps whenever the career data changes out-of-band (a reset) — the Career page keys its history read on
   *  it so an open view refreshes immediately instead of showing stale insights / hero stats. */
  careerVersion: number;
  /** A resumable in-progress run (loaded from localStorage at boot, kept in sync during play), or null when
   *  there's nothing to continue. Drives the title's "Continue" entry. */
  savedRun: RunState | null;
  /** Resume the saved in-progress run (from the title). */
  continueRun: () => void;
  /** Persist the live run NOW, outside the normal turn-boundary autosave (see `writeSave`). Called when the
   *  player leaves the run mid-turn — quitting to the title, or the tab being hidden/closed — so an
   *  interrupted shop turn is never lost. No-op at the title (the dormant `run` there is a throwaway) and
   *  once a run has finished (a finished run isn't resumable). */
  flushSave: () => void;
  /** Discard the saved in-progress run (from the title) — clears the autosave + `savedRun` so Continue
   *  disappears. Destructive + irreversible; the caller confirms first. */
  clearRun: () => void;
  /** The title screen is shown at boot + after a run ends — the front door to the modes. */
  showTitle: boolean;
  /** The mode the next run will start in (set by startAscent/startPractice, read by pickHero). */
  pendingMode: RunMode;
  /** Title → Ascent: open the 3-hero picker for a scored run. */
  startAscent: () => void;
  /** Title → Practice: open an ALL-hero picker for a practice run (Ascent's full course, unlimited health). */
  startPractice: () => void;
  /** Start a RIFT run — the same climb, with the active rift's rules. */
  startRift: () => void;
  startLobby: () => void;
  /** Title → Learn: launch the scripted tutorial course (Learn Ascent). Bypasses the hero picker entirely
   *  (the course forces its own hero, Aster) and builds an authored `tutorial`-mode lobby run directly, exactly
   *  like the Scene Builder skips the picker. The coaching layer keys off `run.mode === 'tutorial'`. */
  startTutorial: (course: TutorialCourse) => void;
  /** Launch the Scene Builder sandbox (dev) — a fresh run flagged `sandbox`, bypassing the hero picker, with
   *  a big Gold float. Its own entry from the title, not a mode in the picker. Optionally pick the hero (the
   *  panel's hero dropdown re-launches to swap, so the hero's createRun setup runs). */
  startSceneBuilder: (heroId?: string, setId?: SetId) => void;
  /** SANDBOX ONLY (dev). Click-to-edit is armed: a click on a board minion opens the unit editor instead of
   *  starting a drag / a buy. A MODE rather than a modifier because a bare click already means something on
   *  both rows, and the rig has to leave normal play intact — the shop phase is where some of the
   *  interactions under test only ever happen. */
  sbEditMode: boolean;
  setSbEditMode: (on: boolean) => void;
  /** SANDBOX ONLY (dev). What the tavern row renders: the shop offers (false, the default and exactly the
   *  shipped behaviour) or the opponent pinned for the coming fight (true). A RENDER switch — flipping it
   *  changes no run state, so returning to the shop leaves it precisely as it was. */
  sbTavernShowsEnemy: boolean;
  setSbTavernShowsEnemy: (on: boolean) => void;
  /** SANDBOX ONLY (dev). Watch the last fight again: same boards, same seed, same beats. */
  replayLastCombat: () => void;
  /**
   * SANDBOX ONLY (dev). True while the combat phase we are in is a REPLAY of an already-resolved fight
   * rather than a fight that still has to be resolved. Set by `replayLastCombat`, cleared by `exitReplay`
   * and by any dispatched action that changes the run's phase (a real fight starting or ending).
   *
   * It exists because "am I in combat?" is not enough to tell those two apart, and the combat view's exits
   * behave completely differently for each: a real fight leaves through `resolveCombat` (which advances the
   * wave), a replay must leave through nothing at all.
   */
  sandboxReplay: boolean;
  /**
   * SANDBOX ONLY (dev). Leave a replay: flip the phase straight back to `recruit` and drop the flag.
   * Dispatches NOTHING — that is the entire point (see `replayLastCombat`).
   */
  exitReplay: () => void;
  /** Return to the title screen (from the end screen). */
  openTitle: () => void;
  /** The Hall of Champions overlay (latest victory runs + their warbands) is open. */
  showLeaderboard: boolean;
  openLeaderboard: () => void;
  closeLeaderboard: () => void;
  /** The player Leaderboard overlay (top players by rating / "MMR") is open. */
  showRankings: boolean;
  openRankings: () => void;
  closeRankings: () => void;
  /** The Recent Games overlay (last 20 games across all players) is open. */
  showRecentGames: boolean;
  openRecentGames: () => void;
  closeRecentGames: () => void;
  /** The Career overlay (match history + per-hero stats) is open. */
  showCareer: boolean;
  /** WHOSE career is on screen. `null` = your own. Set when opening another player's from the leaderboard
   *  (owner ask 2026-08-04) — carries the leaderboard row itself, because the numbers on the profile card
   *  (rating, games) come from `profiles` and are NOT derivable from someone else's run history alone. */
  careerOf: CareerView | null;
  openCareer: (of?: CareerView) => void;
  closeCareer: () => void;
  /** The Minion Book codex overlay (Tab) is open — a filterable reference of every minion + spell
   *  findable this run. UI-only; reads the run's pool + active tribes. */
  showBook: boolean;
  toggleBook: () => void;
  closeBook: () => void;
  /** DEV-only balance-report panel (runs greedy-bot games in-browser + shows offer/pick/win tables). */
  showBalance: boolean;
  openBalance: () => void;
  closeBalance: () => void;
}

const randomSeed = (): number => Math.floor(Math.random() * 0x7fffffff);

/** Your persisted display name (empty if unset). Best-effort — localStorage may be unavailable. */
function loadPlayerAvatar(): string | null {
  try { return localStorage.getItem('ascent.avatar') || null; } catch { return null; }
}
function loadPlayerName(): string {
  try { return localStorage.getItem('ascent.playername') ?? ''; } catch { return ''; }
}

/** ACCOUNTS C2b — the display handle: `Kevin#4821` when a discriminator is known, else the bare name. One
 *  place so the leaderboard, the account panel and anywhere else render a handle identically. */
export const formatHandle = (name: string, discriminator?: string | null): string =>
  name && discriminator ? `${name}#${discriminator}` : name;

// A friendly temp name for a player who never set one. DERIVED FROM the account's `user_id`, so it is stable
// (the same account always gets the same name) and unique-ish per account — never `Math.random`, which would
// re-roll every render. The trailing number widens the space so two anonymous players rarely collide.
const TEMP_ADJ = ['Swift', 'Brave', 'Crimson', 'Silent', 'Golden', 'Fabled', 'Iron', 'Ember', 'Frost', 'Storm', 'Shadow', 'Verdant', 'Ivory', 'Rapid', 'Lucky', 'Grim', 'Bold', 'Amber', 'Cobalt', 'Wild'];
const TEMP_NOUN = ['Fox', 'Otter', 'Badger', 'Falcon', 'Wyrm', 'Golem', 'Raven', 'Marmot', 'Boar', 'Lynx', 'Drake', 'Stag', 'Owl', 'Wolf', 'Bear', 'Hare', 'Heron', 'Ibex', 'Moth', 'Newt'];
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** e.g. `SwiftMarmot42` — a stable temporary handle for an unnamed (anonymous) account, keyed on its id. */
export function tempHandle(userId: string | null | undefined): string {
  const h = hashStr(userId || 'anon');
  return `${TEMP_ADJ[h % TEMP_ADJ.length]}${TEMP_NOUN[(h >>> 8) % TEMP_NOUN.length]}${(h >>> 16) % 90 + 10}`;
}

/** The name to SHOW for a leaderboard/career row: the real handle if set, else the account's temp handle. */
export const displayHandle = (author: string | null | undefined, discriminator: string | null | undefined, userId: string | null | undefined): string =>
  formatHandle(author ?? '', discriminator) || tempHandle(userId);

/** Persisted PRACTICE shop-timer multiplier (1–4×), defaulting to 3 — the fixed multiplier practice used before
 *  it was made choosable (owner 2026-07-25), so an existing player's practice runs feel unchanged. 1× is exactly
 *  the scored mode's clock. Best-effort, like the combat speed. */
function loadPracticeTimer(): number {
  try {
    const v = Number(localStorage.getItem('ascent.practicetimer'));
    return v >= 1 && v <= 4 ? Math.round(v) : 3;
  } catch { return 3; }
}

/** Persisted combat speed (0.5–5×), defaulting to 1 on anything missing/out-of-range. Best-effort. */
function loadCombatSpeed(): number {
  try {
    const v = Number(localStorage.getItem('ascent.combatspeed'));
    return v >= 0.5 && v <= 5 ? v : 1;
  } catch { return 1; }
}

// Save & continue (A3): the in-progress run is persisted to localStorage on every state change, so the
// player can quit mid-run and resume from the title. A finished run (victory/gameover) is not resumable —
// the save is cleared when the run ends. The run's action log rides along so board capture still works on a
// resumed run's finish. All best-effort — localStorage may be unavailable; failures never break play.
const SAVE_KEY = 'ascent.save';
interface SavedGame { run: RunState; actions: Action[]; boards: BoardSnapshot[]; telemetry?: TelemetryLog; derive?: DeriveState; }
function loadSave(): SavedGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { run: string; actions?: Action[]; boards?: BoardSnapshot[]; telemetry?: TelemetryLog; derive?: DeriveState };
    const run = deserialize(o.run); // heals older-schema saves
    if (run.phase === 'gameover' || run.phase === 'victory') return null; // finished → not resumable
    // A save can reference a card this build no longer has — a card deleted or renamed during content work, a
    // save carried between branches, or a patch that retired a card mid-run. `deserialize` deliberately doesn't
    // throw, so without this check the run loads and dies on the first `CARD_INDEX[id]` deref, deep in a render
    // (`shopView` reading `.spell` of undefined) with nothing pointing at the cause. Refusing the save turns an
    // unrecoverable white screen into "no Continue offered", which is the same contract `registerOpponents`
    // already applies to stale opponent boards. Found the hard way on 2026-07-22 by deleting a set-2 card while
    // a Scene Builder run holding it was autosaved.
    const missing = missingCardIds(run);
    if (missing.length > 0) {
      console.warn(`[ascent] discarding a saved run that references ${missing.length} card(s) this build no longer has:`, missing.join(', '));
      clearSave();
      return null;
    }
    return { run, actions: o.actions ?? [], boards: o.boards ?? [], telemetry: o.telemetry, derive: o.derive };
  } catch { return null; }
}
function writeSave(run: RunState, actions: Action[], boards: BoardSnapshot[] = [], telemetry?: TelemetryLog, derive?: DeriveState): void {
  // NEVER persist a Scene Builder run. It's a disposable dev rig with 999 Gold and hand-placed boards; letting
  // it reach the autosave overwrites the player's real in-progress run and offers the sandbox as "Continue"
  // (owner hit this on 2026-07-22 — a sandbox session clobbered a live save). The run is already flagged for us.
  if (run.sandbox) return;
  // `boards` rides along for the same reason `actions` does: it's what board capture reads when the run ends.
  // A lobby run captures its boards live instead of replaying for them (see `capturedBoards`), so without this
  // a quit-and-resume would finish the run having lost every board played before the reload.
  try {
    // `telemetry` rides along for the same reason `boards` does: it is captured live, so a quit-and-resume
    // would otherwise finish the run having lost every buy made before the reload.
    // `derive` rides along for the same reason `telemetry` does — a lobby run is OBSERVED LIVE (its replay
    // is not guaranteed faithful), so a quit-and-resume would otherwise lose every offer and buy seen
    // before the reload. Plain JSON by construction; see `DeriveState`.
    localStorage.setItem(SAVE_KEY, JSON.stringify({ run: serialize(run), actions, ...(boards.length ? { boards } : {}), ...(telemetry ? { telemetry } : {}), ...(derive ? { derive } : {}) }));
  } catch { /* ignore */ }
}
function clearSave(): void {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
const BOOT_SAVE = loadSave();

/**
 * Build the lobby's opponent drivers during the OPENING SHOP PHASE, one seat per idle slice.
 *
 * A generated seat's board comes from an autoplayed run (~100ms each, seven of them). Built eagerly they froze
 * the hero-select → game transition; built lazily they all land at once inside round 1's combat. Neither is a
 * moment the player is willing to lose. The opening shop phase is: the run is on screen and interactive, the
 * work has ~30s of slack, and `warmLobbySeat` is idempotent — so a seat the player reaches first simply finds
 * its driver already built.
 *
 * Best-effort by design. Every seat this misses is built on demand exactly as before.
 */
function warmLobbyDrivers(run: RunState): void {
  const lobby = run.lobby;
  if (!lobby) return;
  const queue = lobby.seats.map((_, i) => i).filter((i) => i > 0); // seat 0 is the player — no driver
  const idle = (cb: () => void): void => {
    // `requestIdleCallback` yields to anything the player is doing; the timeout stops a busy shop phase from
    // starving it into round 1. Safari <16.4 has no rIC — a macrotask is a fine substitute here.
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => cb(), { timeout: 2000 });
    else setTimeout(cb, 0);
  };
  const step = (): void => {
    const i = queue.shift();
    if (i === undefined) return;
    try { warmLobbySeat(lobby, i); } catch { /* a seat that won't build is built on demand later, or skipped */ }
    idle(step);
  };
  idle(step);
}

/** Build the run's END-STATE board for the leaderboard / Career: a snapshot of the post-combat `run.board`
 *  (combat carry-backs already baked in), with each minion enriched by the same live view the end screen shows
 *  — final Attack/Health incl. run-wide auras + the live, scaling rule text — so the static leaderboard/Career
 *  cards read the end-of-run magnitude rather than the printed base. Null for an empty board. */
function endStateBoard(run: RunState): BoardSnapshot | null {
  if (run.board.length === 0) return null;
  const snap = snapshotBoard(run);
  snap.minions = snap.minions.map((m, i): BoardMinion => {
    const card = run.board[i];
    if (!card) return m;
    const view = liveBoardView(card, run);
    return {
      ...m,
      attack: view.attack,
      health: view.health,
      ...(view.text ? { text: view.text } : {}),
      ...(view.goldenText ? { goldenText: view.goldenText } : {}),
    };
  });
  snap.power = snap.minions.reduce((sum, m) => sum + m.attack + m.health, 0);
  return snap;
}

/**
 * The board the player fought their LAST combat with, captured at Start of Combat AFTER SoC effects fire (buffs /
 * keywords / shields / SoC summons) but BEFORE the first attack — so the Hall of Champions shows the *buffed* board
 * (e.g. Pack Leader's Beast buff, a Whelp summoned at SoC), not the base recruit warband. It merges the SoC-buffed
 * combat stats onto the live-text recruit snapshot (matched by combat-start index, so scaling cards keep their live
 * text) and appends any SoC-summoned minions. Falls back to the plain end-state board when there's no combat to read.
 */
function combatStartBoard(run: RunState): BoardSnapshot | null {
  const base = endStateBoard(run);
  const lc = run.lastCombat;
  if (!base || !lc || lc.initial.player.length === 0) return base;
  const soc = socBoard(lc); // the SoC-buffed combat board (buffs / keywords / shields / summons applied)
  // Keep each recruit minion's live text but take the SoC-buffed stats/keywords (matched by combat-start order);
  // append any SoC-summoned minions beyond the recruit board.
  const merged: BoardMinion[] = base.minions.map((m, i) => (soc[i] ? { ...m, attack: soc[i]!.attack, health: soc[i]!.health, keywords: soc[i]!.keywords } : m));
  for (let i = base.minions.length; i < soc.length; i++) merged.push(soc[i]!);
  base.minions = merged;
  base.power = merged.reduce((sum, m) => sum + m.attack + m.health, 0);
  return base;
}


/** Zustand's setter, narrowed — the helper below needs it only for deferred (post-run) writes. */
type StoreSet = (partial: Partial<GameStore> | ((st: GameStore) => Partial<GameStore>)) => void;

/**
 * BEAT CHOREOGRAPHER PR 3 — the SHARED commit path (blueprint §5.5).
 *
 * Everything that must happen exactly once when an action resolves: action SFX, phase marker, fight-result
 * ledger, telemetry, derivation, captured boards, run-end handling, replay log, autosave, batch publication.
 *
 * It was inline in `dispatch`, which meant the prepared End-of-Turn transaction (resolve now, animate, commit
 * after playback) would have had to DUPLICATE ~200 lines of it — and any divergence would show up as a run
 * that telemetered twice, or a fight recorded twice, or an autosave that never happened. Extracting it is
 * what makes "resolve gameplay exactly once, commit through one path" true rather than aspirational.
 *
 * Pure w.r.t. the run: it derives the next store slice from (state, action, resolved next) and never resolves
 * gameplay itself. `set` is passed in for the DEFERRED run-end work only (a `setTimeout` that must never
 * hitch the end screen).
 */
function commitResolvedAction(
  s: GameStore,
  action: Action,
  next: RunState,
  batch: PresentationBatch | null,
  captureBeats: boolean,
  set: StoreSet,
): Partial<GameStore> {
    actionSfx(action, s.run, next);
    // Phase flips are where both real captures put their bad frames — annotate them so a spike in the
    // log can be read as "this was the shop opening" rather than an unexplained gap.
    if (next.phase !== s.run.phase) perfMonitor.mark(`phase:${s.run.phase}->${next.phase}`);
    // Fight-result ledger: on each combat (faceOmen resolves it), attribute the outcome to the SERVED opponent
    // board, so leaderboard slots + the Career per-round log can show how a board fares when others face it.
    // The served board is recomputed deterministically from the pre-faceOmen state — the exact input faceOmen
    // used (nextOpponent is seeded by seed+wave+power). Record any TRACKED (id'd) board, from the BOARD's
    // perspective (you lose → it wins). We do NOT skip your own boards: this is a single-player game whose pool
    // is mostly (early: entirely) your own uploads, so skipping them left the ledger empty — a served board is
    // always a PAST run's board, never your live one, so counting it is a real datapoint. Practice never counts.
    if (action.type === 'faceOmen' && next !== s.run && next.lastCombat && next.mode !== 'practice') {
      const served = nextOpponent(s.run);
      if (served?.id) {
        const result = next.lastCombat.result;
        const outcome = result === 'lose' ? 'win' : result === 'win' ? 'loss' : 'tie'; // the board's perspective
        void recordFightResult({ boardId: served.id, round: s.run.wave, outcome, patch: `${__APP_VERSION__}+${__BUILD_SHA__}` });
      }
    }
    // LOBBY: capture this wave's board NOW, at the same point `replayRun` would have (`faceOmen` landed and
    // the combat resolved), so the run never has to be replayed for its boards when it ends. Costs one
    // `snapshotBoard` per round; replaying for the same result costs ~20 s of re-simulated opponent seats.
    // Fold this action into the live acquisition log. Mutates in place and returns the same object — this
    // runs on EVERY dispatched action, so it must not allocate (nothing subscribes to it either). Computed
    // HERE, above the run-end block, so the deferred upload closure below can capture it.
    const telemetryLog = recordTelemetryAction(s.telemetryLog, s.run, action, next);
    // …and the richer derivation, from the SAME (before, action, after) triple. Mutates in place and
    // returns the same object, exactly like the log above — this runs per dispatched action (a click),
    // never per frame, so its cost is a handful of object touches at human cadence.
    const deriveState = observeAction(s.deriveState, s.run, action, next);
    const capturedBoards = action.type === 'faceOmen' && next !== s.run && next.lastCombat && next.mode === 'lobby'
      ? [...s.capturedBoards, snapshotBoard(next)]
      : s.capturedBoards;
    // A run just ended → capture its boards into the library (loaded into the opponent pool next
    // startup, so you face boards you actually built). Deferred so it never hitches the end screen.
    // PRACTICE runs are read-only against the snapshot DB: they fight real captured boards but never
    // write back (no local capture, no shared upload, no leaderboard) — only scored Ascent runs do.
    if (
      (next.phase === 'gameover' || next.phase === 'victory') &&
      s.run.phase !== 'gameover' &&
      s.run.phase !== 'victory' &&
      next.mode !== 'practice'
    ) {
      // `mode` is load-bearing: a lobby run replayed as an Ascent run diverges immediately, so its captured
      // boards were wrong. See `saveRunBoards`.
      // The action log + seed reconstruct this run's boards (non-lobby) and its balance telemetry
      // (`reconstructRunTelemetry`). It is NOT a faithful spectator replay — that needs state replay, see
      // docs/replay-v2-handoff.md.
      const replay = { seed: next.seed, heroId: next.heroId, mode: next.mode, actions: [...s.replayActions, action] };
      // A LOBBY run already holds its boards (captured live above) and must NOT be replayed for them —
      // replaying re-simulates seven opponent seats and froze the end screen for ~20 s.
      const lobbyBoards = next.mode === 'lobby' ? capturedBoards : null;
      const setId = next.setId;
      // An unnamed (anonymous) player is ASSIGNED a stable temp handle keyed on their account id, so their
      // leaderboard row + captured boards carry a friendly name instead of a blank (owner ask 2026-08-10).
      // It's overwritten the moment they set a real name.
      const author = s.playerName || tempHandle(s.account.userId);
      const heroOffer = s.lastHeroOffer;
      // Capture locally (→ this browser's pool next launch) AND push to the shared backend (→ everyone's pool).
      // A victory also logs a leaderboard run (its final warband for the hover). Deferred so it never hitches
      // the end screen; all best-effort and never throw.
      setTimeout(() => {
        const fresh = lobbyBoards ? saveCapturedBoards(lobbyBoards, setId, author) : saveRunBoards(replay, author);
        set({ lastRunBoards: fresh.length }); // A6: surface "you contributed N boards" on the end screen
        void uploadBoards(fresh);
        // Between-runs pool + win-rate refresh (owner ask 2026-07-18): the NEXT run in this session sees
        // fresh remote boards (registerOpponents dedupes) + fresh ledger weights. Delayed a beat so this
        // run's own uploads above land first and can flow back in. Never mid-run — the run just ended.
        setTimeout(() => refreshOpponentPoolAndRecords(`${__APP_VERSION__}+`), 4000);
        // The final board shown on the leaderboard + Career: the END-STATE board (the post-combat run.board,
        // with combat carry-backs baked in), enriched with the SAME live view the end screen renders — final
        // stats incl. run-wide auras + live scaling text (a maxed-out Sergeant reads its real grant, not the
        // printed base). This replaces the old pre-combat, printed-text replay snapshot. Falls back to that
        // snapshot only if the end-state board is empty (shouldn't happen for a real finish).
        const highestFresh = fresh.reduce<BoardSnapshot | null>((best, b) => (!best || b.wave > best.wave ? b : best), null);
        // Show the board WITH its final combat's Start-of-Combat buffs (owner request) — the impressive version the
        // player actually fought with — falling back to the plain end-state board, then a captured pool board.
        const finalBoard = combatStartBoard(next) ?? highestFresh;
        // Link the leaderboard/Career final board to the SAME id as the highest-wave pool board (the one served
        // as the round-17 opponent), so a fight-result recorded against that served board also counts for this
        // leaderboard slot.
        if (finalBoard && highestFresh?.id) finalBoard.id = highestFresh.id;
        const nowIso = new Date().toISOString();
        const date = nowIso.slice(0, 10);
        // A7: append this run to the local match history (win or loss) for the Career screen. APT + cards
        // played come from the action log (the replay), which the run state itself doesn't track.
        const actions = replay.actions;
        // APT = player decisions per round (buys, plays, rolls, discovers, …) — exclude the automatic
        // combat-flow transitions, which fire ~once/round regardless of how you build.
        const apt = Math.round((actions.filter(isPlayerAction).length / Math.max(1, next.wave)) * 10) / 10;
        const cardsPlayed = actions.filter((a) => a.type === 'play').length;
        // Rating (career): grade this scored run against its Line and update the persisted profile. Pure
        // math in @game/sim; the change is surfaced on the end screen (lastRating) + stamped into history.
        // MMR comes from the LOBBY only (owner rework 2026-07-31): a lobby finish resolves a placement-based
        // rating change; a course/rift finish no longer touches the profile (its end screen shows the Oath
        // verdict with no rating movement — `lastRating` stays null and the block self-hides).
        // A LOBBY NEVER REACHES phase 'victory' — `advanceCombat` ends every lobby at 'gameover' whether you
        // won or lost (its victory branch explicitly excludes lobby mode, because a lobby has no course
        // clock to complete). So `won` is ALWAYS false here, and a lobby win is placement #1 instead.
        const lobbySeat = next.lobby?.seats.find((seat) => seat.id === 's0');
        const lobbyPlacement = next.lobby
          // `settleRunLobbyRound` stamps a placement on every seat — on elimination, and `1` on whoever is
          // still standing when the lobby finishes — so the fallback is for a lobby that ended without
          // finishing (practice's round-15 curtain, which neither rates nor uploads).
          ? lobbySeat?.placement ?? next.lobby.seats.filter((seat) => seat.alive).length + 1
          : null;
        const lobbyWon = lobbyPlacement === 1;
        const change = lobbyPlacement != null ? resolveLobbyRating(s.profile, lobbyPlacement) : null;
        if (change) {
          saveProfile(change.profile);
          set({ profile: change.profile, lastRating: change });
        } else {
          set({ lastRating: null });
        }
        // CAREER (server-side since 2026-08-03): the entry posts to `run_history` rather than localStorage, so
        // a career follows the PLAYER instead of the browser.
        const entry = buildRunHistoryEntry(next, { date, at: nowIso, boardsContributed: fresh.length, board: finalBoard, apt, cardsPlayed, rating: change ?? undefined });
        void uploadRunHistory({ ...entry, placement: lobbyPlacement ?? undefined, mode: next.mode, patch: `${__APP_VERSION__}+${__BUILD_SHA__}` })
          .then(() => fetchRunHistory<RunHistoryEntry>())
          .then((remote) => {
            // A FAILED read returns null, and we skip the profile write entirely rather than upserting
            // games-played 0 over a real number — the read is the only source of those totals now.
            if (!remote) return;
            const career = careerStats(remote);
            void uploadPlayerProfile({
              author, rating: (change ?? { profile: s.profile }).profile.rating, gamesPlayed: career.runs,
              favoriteHero: career.perHero[0]?.heroId, patch: `${__APP_VERSION__}+${__BUILD_SHA__}`,
              // C3: the SERVER derives the rating from the placement — `rating` above is only the pre-deploy
              // fallback. `runId` (the run seed) dedupes so one lobby run rates exactly once. Non-lobby runs
              // pass no placement and don't move the ladder.
              runId: String(next.seed), placement: lobbyPlacement ?? undefined,
            });
            set((st: GameStore) => ({ careerVersion: st.careerVersion + 1 })); // an open Career view picks the new run up
          });
        // Player Balance Report: reconstruct this run's offers/picks from its replay (deterministic, deferred so
        // it never hitches the end screen) + upload one telemetry row. `lastHeroOffer` = the picked hero's trio.
        // Balance-report telemetry: LOBBY runs only (owner rework 2026-07-31) — the report is a read on the
        // real ladder, and course/rift rows would dilute it.
        if (next.mode === 'lobby') {
          try {
            // `won` MUST be overridden here: the reconstruction reads phase 'victory', which a lobby never
            // reaches, so every lobby row uploaded as a loss (owner report 2026-08-02 — the shop curve was
            // all "lost runs"). A lobby win is placement 1, exactly as the Hall of Champions gate reads it.
            // The acquisition streams come from the LIVE log, not the replay: a lobby replay is not
            // guaranteed faithful (the same reason `saveRunBoards` refuses to replay one), and a divergence
            // silently keeps every sighting while dropping every buy. See `withLiveTelemetry`.
            const base = withLiveTelemetry(reconstructRunTelemetry(replay, heroOffer), telemetryLog);
            const telemetry = { ...base, mode: 'lobby', won: lobbyWon, placement: lobbyPlacement ?? undefined };
            // The BALANCE DERIVATION rides alongside the legacy summary: `derived` is the observed-live
            // streams (offers / acquisitions-by-source / Gold ledger / upgrades / combats / Avenge details),
            // and `replay` is the raw material to RE-derive them later — a metric we haven't thought of yet
            // is then a new function over runs already banked, not a migration plus a fresh data window.
            const derived = finishDerive(deriveState, next, {
              heroId: next.heroId, mode: 'lobby', seed: next.seed, won: lobbyWon,
            });
            void uploadRunTelemetry(telemetry, {
              author, patch: `${__APP_VERSION__}+${__BUILD_SHA__}`, derived, replay,
            });
          } catch { /* best-effort — telemetry must never disrupt the end screen */ }
        }
        // Hall of Champions: WINNING LOBBY BOARDS only (owner rework 2026-07-31) — placement #1 finishes.
        // Gated on `lobbyWon`, NOT `won`: a lobby never sets phase 'victory' (see above), so the original
        // `won &&` here meant the Hall could never populate at all (owner report 2026-07-31).
        if (lobbyWon && next.mode === 'lobby') {
          void uploadVictory({
            mode: 'lobby',
            heroId: next.heroId, author, wave: next.wave,
            wins: next.history.filter((r) => r === 'win').length, seed: next.seed,
            board: finalBoard, patch: `${__APP_VERSION__}+${__BUILD_SHA__}`,
            capturedAt: date,
            // Per-round W/L spread for the Hall of Champions — one char per round (W/L/D), calibration included.
            history: next.history.map((r) => (r === 'win' ? 'W' : r === 'lose' ? 'L' : 'D')).join(''),
          });
        }
      }, 0);
    }
    const changed = next !== s.run;
    const replayActions = changed ? [...s.replayActions, action] : s.replayActions;
    const finished = next.phase === 'gameover' || next.phase === 'victory';
    // Autosave (A3): persist an in-progress run, and clear it once the run finishes (a finished run isn't
    // resumable). `savedRun` mirrors the persisted state so the title's Continue works.
    //
    // This used to write on EVERY state change, which meant each buy/sell/roll/reorder synchronously
    // serialized the whole run AND the whole action log to JSON and pushed it through localStorage —
    // main-thread disk I/O on the interactions that decide whether the shop feels snappy, growing as the
    // action log grew. Now it writes at PHASE BOUNDARIES only (recruit→combat when the board is committed,
    // combat→recruit when the next turn's state has settled): the points where something worth resuming
    // from actually happened. A shop turn is a scratchpad until you commit it.
    //
    // Leaving a run mid-turn is covered separately by `flushSave` (quit-to-title + tab hide/close), so the
    // shorter save cadence costs no durability — see the listeners at the bottom of this file.
    let savedRun = s.savedRun;
    if (changed) {
      if (finished) { clearSave(); savedRun = null; }
      // `next.sandbox` — a Scene Builder run never reaches the autosave OR the Continue slot. Both are
      // guarded here rather than only inside `writeSave`, because `savedRun` is what the title offers.
      else if (next.phase !== s.run.phase && !next.sandbox) {
        perfMonitor.measure('autosave', () => writeSave(next, replayActions, capturedBoards, telemetryLog, deriveState));
        savedRun = next;
      }
    }
    return {
      run: next,
      savedRun,
      heroArmed: false, // any action clears targeting
      inspect: null, // …and closes the inspect overlay
      sellTick: action.type === 'sell' ? s.sellTick + 1 : s.sellTick,
      // BEAT SYSTEM (PR 3): publish this action's presentation batch (DEV only — null in prod). `beatRevision`
      // bumps every publish so a viewer re-reads even when two actions produce structurally equal batches.
      ...(captureBeats ? { latestBatch: batch, beatRevision: s.beatRevision + 1 } : {}),
      // CHOREOGRAPHER PR 16: when a combat just resolved, publish its adapted timeline too (DEV only). Uses
      // the SAME moment composition the live replay folds, so the Lab inspects exactly what the game plays.
      ...(captureBeats && action.type === 'faceOmen' && next.lastCombat ? { latestCombatTimeline: combatTimelineFrom(next.lastCombat) } : {}),
      // Record only state-changing actions — together with the seed they reconstruct the run's board /
      // telemetry (deterministic for the balance report; NOT a faithful spectator replay — see
      // docs/replay-v2-handoff.md).
      replayActions,
      capturedBoards,
      telemetryLog,
      deriveState,
      // A REDUCER-driven phase change is by definition a real fight starting (`faceOmen`) or a real fight
      // being resolved — either way the combat we may now be in is not the sandbox's re-watch. Cleared
      // here rather than unconditionally so a dispatch that happens to land mid-replay can't strand the
      // flag off and re-open the "leaving a replay advances the wave" hole.
      sandboxReplay: next.phase !== s.run.phase ? false : s.sandboxReplay,
    };
}

export const useGame = create<GameStore>((set, get) => ({
  // Boot into the saved in-progress run if there is one (behind the title, which shows a Continue entry);
  // otherwise a throwaway fresh run that Play/Practice will replace.
  run: BOOT_SAVE?.run ?? createRun(randomSeed()),
  savedRun: BOOT_SAVE?.run ?? null,
  lastRunBoards: 0,
  profile: loadProfile(),
  lastRating: null,
  // Reset the local career (rating + match history) to a fresh start. Doesn't touch the in-progress run,
  // captured boards, or the shared backend (those are separate resets). The Career reads history fresh on
  // open, so wiping the store fields + localStorage is enough.
  careerVersion: 0,
  resetCareer: () => {
    clearProfile();
    clearRunHistory();
    set((s) => ({ profile: initialProfile(), lastRating: null, careerVersion: s.careerVersion + 1 }));
  },
  // Resuming a run starts the turn with the clock ALREADY expired (you can End Turn / reorder, but not shop),
  // so leaving to the title mid-shop can't be used to bank thinking time / reset the timer. A fresh combat
  // resume is unaffected; the next recruit turn (wave change) gets its full timer back via Recruit's reset.
  continueRun: () => {
    turnClock.set(0);
    dropBoardFx(); // the dormant throwaway run behind the title is being swapped for the saved one
    // A resumed lobby run has an EMPTY driver cache (drivers are closures, rebuilt from seed rather than saved),
    // so every seat has to be rebuilt and re-advanced to the round the lobby is on. Do it while the player is
    // looking at the shop, not when the round resolves.
    warmLobbyDrivers(get().run);
    set({ showTitle: false, heroChoices: null, avatarPickerOpen: false });
  },
  // Discard the saved run: wipe the autosave + `savedRun`, and reset the dormant `run` to a fresh throwaway so
  // state mirrors a boot with no save (Play/Practice will replace it). Stays on the title. Irreversible.
  clearRun: () => {
    clearSave();
    dropBoardFx();
    const fresh = createRun(randomSeed());
    set({ savedRun: null, run: fresh, replayActions: [], capturedBoards: [], telemetryLog: emptyTelemetryLog(), deriveState: beginDerive(fresh) });
  },
  // Mid-turn durability for the turn-boundary autosave. Guarded on `showTitle` because the `run` held while
  // the title is up is a dormant throwaway (see clearRun) — persisting it would resurrect a phantom Continue.
  flushSave: () => {
    const s = get();
    if (s.showTitle || s.run.phase === 'gameover' || s.run.phase === 'victory') return;
    if (s.run.sandbox) return; // a Scene Builder run is disposable — it must never become the offered Continue
    writeSave(s.run, s.replayActions, s.capturedBoards, s.telemetryLog);
    set({ savedRun: s.run });
  },
  heroArmed: false,
  endTurnAnimating: false,
  combatEnemyDeaths: 0,
  combatBuffs: null,
  combatQuestDelta: null,
  combatTriggeredQuests: {},
  combatCompletedQuests: [],
  sellTick: 0,
  inspect: null,
  // Boot into the title screen (the front door); the hero picker opens once a mode is chosen.
  heroChoices: null,
  lastHeroOffer: [],
  showTitle: true,
  showLeaderboard: false,
  pendingMode: 'ascent',
  // Default to the compact, art-forward card (full rules text on hover). Flip in the Esc menu.
  compactCards: true,
  toggleCompact: () => set((s) => ({ compactCards: !s.compactCards })),
  playerName: loadPlayerName(),
  setPlayerName: (name) => {
    const playerName = name.slice(0, 24).trim();
    try { localStorage.setItem('ascent.playername', playerName); } catch { /* ignore */ }
    set({ playerName });
    // Keep the identity's display name in step (rides on rows as `author`).
    void supabaseAuthProvider.setDisplayName(playerName);
    // C2b: claim/keep the `#tag` for this name, and mirror the resulting handle into `account`.
    if (playerName) void claimHandle(playerName).then((h) => { if (h) set((st) => ({ account: { ...st.account, discriminator: h.discriminator } })); });
    syncProfileFromServer(playerName); // the server row (if any) is authoritative — now keyed on user_id
  },
  // ACCOUNTS C2 — mirrored from the identity seam; seeded at boot + updated by the onChange subscription above.
  // `discriminator` (the `#4821` tag) comes from the profile row, not auth — filled in by `claimHandle`.
  account: { userId: currentIdentity()?.userId ?? null, email: currentIdentity()?.email ?? null, anonymous: currentIdentity()?.anonymous ?? true, discriminator: null },
  accountPanelOpen: false,
  openAccountPanel: () => set({ accountPanelOpen: true }),
  closeAccountPanel: () => set({ accountPanelOpen: false }),
  sendMagicLink: (email) => supabaseAuthProvider.signInWithEmail(email),
  verifyEmailCode: (email, code) => supabaseAuthProvider.verifyEmailCode(email, code),
  signOutAccount: async () => {
    await supabaseAuthProvider.signOut();
    // Sign-out drops the session; a fresh anonymous one is minted on next load (restore()). Reflect the
    // signed-out state immediately so the panel updates without a reload.
    set({ account: { userId: null, email: null, anonymous: true, discriminator: null } });
  },
  playerAvatar: loadPlayerAvatar(),
  setPlayerAvatar: (id) => {
    try { if (id) localStorage.setItem('ascent.avatar', id); else localStorage.removeItem('ascent.avatar'); } catch { /* ignore */ }
    set({ playerAvatar: id });
  },
  avatarPickerOpen: false,
  openAvatarPicker: () => set({ avatarPickerOpen: true }),
  closeAvatarPicker: () => set({ avatarPickerOpen: false }),
  practiceTimer: loadPracticeTimer(),
  setPracticeTimer: (mult) => {
    const practiceTimer = Math.min(4, Math.max(1, Math.round(mult)));
    try { localStorage.setItem('ascent.practicetimer', String(practiceTimer)); } catch { /* ignore */ }
    set({ practiceTimer });
  },
  combatSpeed: loadCombatSpeed(),
  setCombatSpeed: (speed) => {
    const combatSpeed = Math.min(5, Math.max(0.5, Math.round(speed * 10) / 10)); // clamp 0.5–5×, snap to 0.1
    try { localStorage.setItem('ascent.combatspeed', String(combatSpeed)); } catch { /* ignore */ }
    set({ combatSpeed });
  },
  replayActions: BOOT_SAVE?.actions ?? [],
  latestBatch: null,
  beatRevision: 0,
  latestCombatTimeline: null,
  beatDraft: null,
  beatDraftLive: false,
  setBeatDraft: (beatDraft) => set({ beatDraft }),
  setBeatDraftLive: (beatDraftLive) => set({ beatDraftLive }),
  telemetryLog: BOOT_SAVE?.telemetry ?? emptyTelemetryLog(),
  deriveState: BOOT_SAVE?.derive ?? beginDerive(BOOT_SAVE?.run ?? createRun(randomSeed())),
  capturedBoards: BOOT_SAVE?.boards ?? [],
  exportReplay: () => ({ seed: get().run.seed, heroId: get().run.heroId, mode: get().run.mode, actions: get().replayActions }),
  dispatch: (action) => {
    // TUTORIAL gate: a guided shop/lobby step can block End Turn (`faceOmen`) so a new player can't skip the
    // lesson into an empty-board fight. Inert on every non-tutorial run (no gate set). Never blocks anything
    // but `faceOmen`, so it cannot soft-lock the game (see gateBus). Dropped actions fire a coach nudge.
    const gate = gateBlocks(action);
    if (gate.blocked) { if (gate.reason) notifyGateNudge(gate.reason); return; }
    // The run BEFORE the action — the tutorial bus reads it to resolve a buy/play/sell uid back to its cardId
    // (the card is gone from the committed run). Captured only to hand to the bus; the reducer never sees it.
    const prev = get().run;
    set((s) => {
      // MEASURED for the perf HUD, keyed by action type: `reduce` is the single chokepoint for all run
      // logic (shop rolls, combat resolution, end-of-turn), so if a hitch is game logic it shows up here
      // with the action that caused it. No-op passthrough when the monitor is off.
      // BEAT SYSTEM (PR 3): in DEV, resolve through `reduceWithPresentation` to capture the source-attributed
      // batch for the Beat Lab viewer; prod stays on plain `reduce` (zero collector allocation). Gameplay
      // result is identical either way — the collector only records (proven by the equivalence test).
      const captureBeats = import.meta.env.DEV;
      const beat = perfMonitor.measure(`reduce:${action.type}`, () =>
        captureBeats ? reduceWithPresentation(s.run, action, true) : { state: reduce(s.run, action), batch: null },
      );
      // CHOREOGRAPHER PR 3: resolution and commit are now separate steps sharing ONE commit path, so the
      // prepared End-of-Turn transaction commits identically to an ordinary dispatch.
      return commitResolvedAction(s, action, beat.state, beat.batch, captureBeats, set);
    });
    // Feed the tutorial action bus AFTER the commit — a no-op (one set-size check) on every non-tutorial run,
    // so it's safe on the hot path. Only the tutorial controller subscribes, and only while a course is live.
    notifyTutorialActions(action, prev, get().run);
  },
  presentationTx: null,
  /**
   * CHOREOGRAPHER PR 3 (blueprint §5.2–§5.4). Resolve the action NOW, keep `before` on screen, hand the
   * caller the batch to compile and play. No reducer action is dispatched per beat while it plays — the
   * consequences are a visual projection over `before`, never a second gameplay pass.
   */
  preparePresentationAction: (action) => {
    const s = get();
    if (s.presentationTx) return s.presentationTx; // already prepared — never resolve twice
    const prepared = prepareActionWithPresentation(s.run, action);
    set({ presentationTx: prepared });
    return prepared;
  },
  /**
   * Commit the held transaction. Routes through `commitResolvedAction`, the SAME helper `dispatch` uses, so
   * telemetry, the fight ledger, the replay log, autosave and captured boards all happen exactly once and
   * identically to an ordinary dispatch. Idempotent: a double-commit (playback finishing as the component
   * unmounts) is a no-op rather than a duplicated action.
   */
  commitPresentationAction: () => {
    const s = get();
    const tx = s.presentationTx;
    if (!tx) return;
    set({ presentationTx: null }); // cleared FIRST, so a re-entrant call can't commit twice
    set((st) => commitResolvedAction(st, tx.action, tx.after, tx.batch, import.meta.env.DEV, set));
  },
  /**
   * Drop a prepared transaction without committing. Only legitimate when the run itself is being abandoned
   * (quit to title, new run) — otherwise End Turn would resolve and then silently un-resolve. Anything else
   * should commit; the blueprint's failure rule is "never softlock End Turn" (§5.6).
   */
  cancelPresentationAction: (reason) => {
    if (!get().presentationTx) return;
    if (import.meta.env.DEV) console.warn(`[choreographer] prepared action cancelled: ${reason}`);
    set({ presentationTx: null });
  },
  armHero: () => set((s) => ({ heroArmed: !s.heroArmed })),
  setEndTurnAnimating: (v) => set({ endTurnAnimating: v }),
  setCombatEnemyDeaths: (n) => set({ combatEnemyDeaths: n }),
  setCombatBuffs: (b) => set({ combatBuffs: b }),
  setCombatQuestDelta: (d) => set({ combatQuestDelta: d }),
  setCombatTriggeredQuests: (ids) => set({ combatTriggeredQuests: ids }),
  setCombatCompletedQuests: (ids) => set({ combatCompletedQuests: ids }),
  inspectCard: (view) => { sfx.inspect(); set({ inspect: view }); },
  clearInspect: () => set({ inspect: null }),
  startHeroSelect: () => set({ heroChoices: rollHeroChoices() }),
  pickHero: (heroId) => {
    dropBoardFx(); // outside the updater: `set`'s callback is a pure state derivation, not a place for effects
    set((s) => {
      // The run's par comes from the player's rating-derived Line (career skill pressure).
      // A lobby run needs its 8 seats built alongside it, so it goes through its own constructor.
      const seed = randomSeed();
      // Practice is a lobby too (2026-07-31): same seats + recorded opponents, its own rules on top. It
      // reads the shared board pool but never writes (every upload path is gated on mode !== 'practice').
      const run = s.pendingMode === 'lobby' || s.pendingMode === 'practice'
        ? createLobbyRun(seed, heroId, {}, s.pendingMode)
        : createRun(seed, heroId, s.pendingMode, s.profile.currentLine);
      // Get the opponent seats built while the player reads their opening shop, not while they wait for it.
      if (run.lobby) warmLobbyDrivers(run);
      writeSave(run, []); // the new run is now the resumable save
      return { run, savedRun: run, lastRunBoards: 0, presentationTx: null, heroArmed: false, endTurnAnimating: false, sellTick: 0, inspect: null, heroChoices: null, lastHeroOffer: s.heroChoices ?? [heroId], showTitle: false, avatarPickerOpen: false, replayActions: [], capturedBoards: [] };
    });
  },
  newRun: (seed, heroId) => {
    dropBoardFx();
    set((s) => {
      const run = createRun(seed ?? randomSeed(), heroId, s.pendingMode, s.profile.currentLine);
      writeSave(run, []);
      return { run, savedRun: run, lastRunBoards: 0, presentationTx: null, heroArmed: false, endTurnAnimating: false, sellTick: 0, inspect: null, heroChoices: null, showTitle: false, avatarPickerOpen: false, replayActions: [], capturedBoards: [] };
    });
  },
  startAscent: () => set({ showTitle: false, pendingMode: 'ascent', heroChoices: rollHeroChoices(), avatarPickerOpen: false }),
  // Practice shows EVERY hero — but "every" still means every PICKABLE one. It was reading the raw registry, so
  // a disabled hero stayed selectable here after being pulled from the Ascent picker (owner 2026-07-28).
  startPractice: () => set({ showTitle: false, pendingMode: 'practice', heroChoices: HEROES.filter((h) => !h.wip).map((h) => h.id), avatarPickerOpen: false }),
  startRift: () => set({ showTitle: false, pendingMode: 'rift', heroChoices: rollHeroChoices(), avatarPickerOpen: false }),
  // LOBBY: eight seats, elimination, no fixed round count. Uses the ASCENT offer — three heroes, not the whole
  // roster (owner 2026-07-29). A lobby is a real run you can lose, so the pick should be a decision made under
  // the same constraint as Ascent's; Practice's all-heroes list is a sandbox affordance and reads as one.
  startLobby: () => set({ showTitle: false, pendingMode: 'lobby', heroChoices: rollHeroChoices(), avatarPickerOpen: false }),
  startTutorial: (course) => {
    dropBoardFx();
    set(() => {
      // Build the authored `tutorial` run directly — the course forces its own hero (Aster), so there is no
      // picker to route through (mirrors startSceneBuilder). The omen board table and the scripted shop are
      // derived from the course's turns; the run stamps the course id so a reload rehydrates the coaching.
      const seed = randomSeed();
      const authoredBoards = course.turns.map((t) => t.omenBoard);
      const shopScript = course.turns.map((t) => t.shopRolls);
      const run = createTutorialRun(seed, course.heroId, course.id, authoredBoards, course.opponentNames, course.rounds, shopScript);
      if (run.lobby) warmLobbyDrivers(run); // authored drivers are cheap; keep the warm path uniform
      writeSave(run, []);
      return { run, savedRun: run, lastRunBoards: 0, presentationTx: null, heroArmed: false, endTurnAnimating: false, sellTick: 0, inspect: null, heroChoices: null, showTitle: false, avatarPickerOpen: false, replayActions: [], capturedBoards: [] };
    });
  },
  startSceneBuilder: (heroId = 'warden', setId = activeSet().id) => {
    dropBoardFx();
    set(() => {
      // Sandbox runs on `practice` mechanics (unscored, generous timer) but is flagged `sandbox` and skips the
      // hero picker — it's a testing rig, not a scored climb. Re-creating the run per hero runs that hero's
      // own createRun setup (Chaos / Disco Dan / Brackus openers). 999 Gold to start.
      // `setId` lets the rig play an UNRELEASED set (set 2 in development) without flipping the global switch
      // and moving real players onto it — the run pins it like any other, so nothing leaks into set 1.
      const run: RunState = { ...createRun(randomSeed(), heroId, 'practice', CONFIG.defaultLine, setId), sandbox: true, embers: 999, tier: 1 };
      return { run, savedRun: null, lastRunBoards: 0, presentationTx: null, heroArmed: false, endTurnAnimating: false, sellTick: 0, inspect: null, heroChoices: null, showTitle: false, avatarPickerOpen: false, replayActions: [], capturedBoards: [], sandboxReplay: false };
    });
  },
  sbEditMode: false,
  setSbEditMode: (on) => set({ sbEditMode: on }),
  sbTavernShowsEnemy: false,
  setSbTavernShowsEnemy: (on) => set({ sbTavernShowsEnemy: on }),
  /**
   * Re-enter the combat phase on the CombatResult already stored, so `useCombatReplay` remounts and animates
   * it from beat 0. Byte-identical by construction rather than by luck: nothing re-simulates.
   *
   * Deliberately NOT a re-dispatch of the action that produced the fight. Resolving a real combat also
   * settles Resolve, the wave, quests, telemetry and the autosave; a second `faceOmen` would reach all of
   * that, and the run would silently advance behind a button labelled "watch that again".
   *
   * `combatSettled` is left exactly as it is (already `true` — a fight only reaches `recruit`, where this is
   * callable, once `settleCombat` has run). Recruit.tsx's own "settle once the replay finishes" effect
   * (~line 1422) and its loss-damage sequence (~line 1478) both re-check `!run.combatSettled` before doing
   * anything, so leaving it `true` is what stops the replay from RE-SETTLING. Closing the settle path is
   * only half the job, though: the combat view's exit (`endCombat` → `resolveCombat`) is guarded on
   * `phase === 'combat' && lastCombat` and NOT on `combatSettled`, so merely *leaving* a replay used to
   * settle the lobby round and advance the wave a second time. `sandboxReplay` is what closes that: the
   * exit reads it and calls `exitReplay` instead of dispatching. It is NOT what
   * restarts the animation: `useCombatReplay`'s beat index only resets on `[combat]` — i.e. on `run.lastCombat`
   * changing OBJECT IDENTITY, not on the phase flipping — so the fight is reshuffled into a shallow clone
   * below purely to trip that effect. Same events, same frames — a clone reads identically, it just isn't
   * `===` the last one.
   *
   * Sandbox-gated, and a no-op with no stored fight — the button is hidden in that state, but a store action
   * must not depend on its caller's guard.
   */
  sandboxReplay: false,
  replayLastCombat: () => {
    const s = get();
    // `phase === 'recruit'` is part of the guard, not just the button's: replaying from INSIDE a live fight
    // would swallow that fight's own resolution (the phase never changes, so nothing downstream notices).
    if (!s.run.sandbox || !s.run.lastCombat || s.run.phase !== 'recruit') return;
    set({ run: { ...s.run, phase: 'combat', lastCombat: { ...s.run.lastCombat } }, sandboxReplay: true });
  },
  exitReplay: () => {
    const s = get();
    if (!s.run.sandbox || !s.sandboxReplay) return;
    set({ run: { ...s.run, phase: 'recruit' }, sandboxReplay: false });
  },
  // Quitting mid-turn: persist first (while `showTitle` is still false, so flushSave's guard lets it through),
  // otherwise the turn in progress would roll back to the last phase boundary on Continue.
  openTitle: () => { get().flushSave(); set({ showTitle: true, heroChoices: null }); },
  openLeaderboard: () => set({ showLeaderboard: true }),
  closeLeaderboard: () => set({ showLeaderboard: false }),
  showRankings: false,
  openRankings: () => set({ showRankings: true }),
  closeRankings: () => set({ showRankings: false }),
  showRecentGames: false,
  openRecentGames: () => set({ showRecentGames: true }),
  closeRecentGames: () => set({ showRecentGames: false }),
  showCareer: false,
  careerOf: null,
  openCareer: (of) => set({ showCareer: true, careerOf: of ?? null }),
  // Clear WHOSE career on close, so reopening your own from the title never inherits the last player viewed.
  closeCareer: () => set({ showCareer: false, careerOf: null }),
  showBook: false,
  toggleBook: () => set((s) => ({ showBook: !s.showBook })),
  closeBook: () => set({ showBook: false }),
  showBalance: false,
  openBalance: () => set({ showBalance: true }),
  closeBalance: () => set({ showBalance: false }),
}));

// The autosave writes at turn boundaries (see `dispatch`), so leaving mid-turn needs an explicit flush or the
// shop turn in progress would roll back on Continue. Two events, deliberately both:
//   `pagehide`        — tab close, navigation, and bfcache entry. The reliable "the page is going away" signal.
//   `visibilitychange` (→ hidden) — tab switch, window minimise, and mobile backgrounding, where a browser may
//                       kill the page later without ever firing pagehide. This is the one iOS actually honours.
// Both can fire for a single departure; a duplicate write is harmless (same bytes) and only happens on the way
// out, never during play. Neither survives a hard crash or power loss — that remains a turn-boundary rollback.
// `beforeunload` is deliberately NOT used: it blocks bfcache and is unreliable on mobile.
if (typeof window !== 'undefined') {
  const flush = (): void => useGame.getState().flushSave();
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

/** The server's `profiles` row is AUTHORITATIVE over the local rating (owner control 2026-07-31): at launch —
 *  and whenever the player (re)names themselves — a named player's server rating, if present, replaces the
 *  local one. Editing a row in Supabase therefore overrides any client on its next launch; a missing row (a
 *  fresh season, a new player, offline) leaves the local profile alone. Best-effort and deferred — never
 *  blocks startup. */
export function syncProfileFromServer(name: string): void {
  // The NAME no longer selects the row — `fetchPlayerRating` reads this user's own profile. The parameter is
  // kept so callers (and the rename path) read unchanged, and because C2's handle model will want it back.
  void fetchPlayerRating(name).then((serverRating) => {
    if (serverRating == null) return;
    const s = useGame.getState();
    if (s.profile.rating === serverRating) return;
    const adopted = adoptServerRating(s.profile, serverRating);
    saveProfile(adopted);
    useGame.setState({ profile: adopted });
  });
}
if (typeof window !== 'undefined') syncProfileFromServer(loadPlayerName());

// ACCOUNTS C1/C2 — identity boot, wired here (after `useGame` + `syncProfileFromServer` exist).
//   C1: establish the session (anonymous, no login screen) so every upload path has a `user_id`.
//   C2: mirror the identity into `account`, and subscribe to backend-driven changes — the magic-link upgrade
//       landing after the redirect, a token refresh, or a sign-out in another tab. The "check your inbox →
//       click the link" flow completes HERE: the click reloads the app, Supabase parses the session out of the
//       URL, `onChange` fires with the now-permanent user, and we pull that account's authoritative profile.
function initAccounts(): void {
  const name = loadPlayerName();
  void initIdentity(supabaseAuthProvider, name).then((id) => {
    if (!id) return;
    useGame.setState((st) => ({ account: { ...st.account, userId: id.userId, email: id.email, anonymous: id.anonymous } }));
    void flushUploadQueue(); // a session now exists — replay anything queued while offline
    // Ensure this account carries a `#tag` (and its author/email are current) once identity exists.
    if (name) void claimHandle(name).then((h) => { if (h) useGame.setState((st) => ({ account: { ...st.account, discriminator: h.discriminator } })); });
  });
  supabaseAuthProvider.onChange((id) => {
    useGame.setState((st) => ({
      account: id
        ? { ...st.account, userId: id.userId, email: id.email, anonymous: id.anonymous }
        : { userId: null, email: null, anonymous: true, discriminator: null },
    }));
    if (id) void flushUploadQueue(); // session (re)established → flush the offline queue
    if (id && !id.anonymous) {
      syncProfileFromServer(loadPlayerName()); // a real account just landed — pull its authoritative row
      // Re-claim so the now-known email is written onto the profile, and mirror the tag back.
      const nm = loadPlayerName();
      if (nm) void claimHandle(nm).then((h) => { if (h) useGame.setState((st) => ({ account: { ...st.account, discriminator: h.discriminator } })); });
    }
  });
}
initAccounts();

// CHOREOGRAPHER PR 21: hand the LIVE Beat-Lab draft to combat pacing through a provider — the clock module
// cannot import the store (cycle through the combat-timeline composition). DEV-only, like the draft itself.
if (import.meta.env.DEV) {
  setCombatDraftProvider(() => {
    const s = useGame.getState();
    return s.beatDraftLive && s.beatDraft ? (s.beatDraft as { timings: Record<string, { windupMs?: number; holdMs?: number; recoveryMs?: number }>; policies: Record<string, string> } as never) : null;
  });
  // The LIVE toggle is the SINGLE switch: when it's on, combat consumes Beat Lab timing too — not just End of
  // Turn — so flipping a combat row (Oona's onSummon → ownBeat, say) in the Lab re-paces real fights with no
  // console step. Off → fights are byte-identical to today. (Owner ask 2026-08-14.)
  setCombatLiveProvider(() => useGame.getState().beatDraftLive === true);
}

// DEV-only debug handle: stage arbitrary state from the console (e.g. useGame.setState to preview the
// Discover / game-over / End-of-Turn UI). Stripped from production builds. The `typeof window` guard matters:
// vitest runs with `DEV` true but in a Node (no-window) environment, so any test that transitively imports
// this module would otherwise crash here with `window is not defined`.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { useGame?: typeof useGame }).useGame = useGame;
}
