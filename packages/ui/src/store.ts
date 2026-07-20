import { create } from 'zustand';
import { CARD_INDEX } from '@game/content';
import { HEROES, OPPONENT_POOL, OPPONENT_POOL_DATA, registerOpponents, createRun, deserialize, initialProfile, isPlayerAction, nextOpponent, reconstructRunTelemetry, reduce, resolveRunRating, runRecord, serialize, snapshotBoard, socBoard, type Action, type BoardMinion, type BoardSnapshot, type PlayerProfile, type RatingChange, type Replay, type RunMode, type RunState } from '@game/sim';
import type { Tribe } from '@game/core';
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
import { liveBoardView } from './instView';
import { loadStoredBoards, saveRunBoards } from './boardLibrary';
import { perfMonitor } from './perfMonitor';
import { fetchAndRegisterBoardRecords, fetchAndRegisterPool, recordFightResult, refreshOpponentPoolAndRecords, uploadBoards, uploadPlayerProfile, uploadRunTelemetry, uploadVictory } from './remoteBoards';
import { buildRunHistoryEntry, careerStats, clearRunHistory, saveRunHistoryEntry } from './runHistory';
import { clearProfile, loadProfile, saveProfile } from './profileStore';
import { turnClock } from './turnClock';

// Serve real, buildable boards as enemies: load the COMMITTED opponent pool (`OPPONENT_POOL_DATA`, baked by
// `npm run pool` from seeded bot runs + any imported you/friend board exports) plus this browser's own
// captured boards, once at startup while OPPONENT_POOL is still empty. The headless harnesses + tests don't
// load this module, so they keep their empty-pool procedural baseline. `registerOpponents` drops any board
// referencing a card this build no longer has, so a stale committed/stored board can never crash combat.
if (OPPONENT_POOL.length === 0) registerOpponents([...OPPONENT_POOL_DATA, ...loadStoredBoards()]);

// Additively fold in the live SHARED pool (Supabase) for this build's version — fetched ONCE at startup (now,
// on the title screen, long before any run faces combat) and kept static for the session like the committed
// pool, so replays stay faithful. Matches by version prefix (`<version>+`) so per-commit SHA churn doesn't hide
// boards. No-ops entirely when no backend is configured; the committed OPPONENT_POOL_DATA is the offline floor.
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
      if (card && CARD_INDEX[card.cardId]?.spell) sfx.castSpell();
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
  /** The current run's action log (only state-changing actions), reset on a fresh run. With the run
   *  seed it forms a deterministic replay — the basis for board capture + async-PvP snapshots. */
  replayActions: Action[];
  /** Export the current run as a tiny deterministic replay `{ seed, heroId, actions }` (DEV: grab it
   *  via `useGame.getState().exportReplay()`; feed it to `replayRun` / the replay harness). */
  exportReplay: () => Replay;
  /** Apply an engine action — the only way run state changes. Pure reducer under the hood. */
  dispatch: (action: Action) => void;
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
  /** The Career overlay (your local match history + per-hero stats) is open. */
  showCareer: boolean;
  openCareer: () => void;
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
interface SavedGame { run: RunState; actions: Action[]; }
function loadSave(): SavedGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { run: string; actions?: Action[] };
    const run = deserialize(o.run); // heals older-schema saves
    if (run.phase === 'gameover' || run.phase === 'victory') return null; // finished → not resumable
    return { run, actions: o.actions ?? [] };
  } catch { return null; }
}
function writeSave(run: RunState, actions: Action[]): void {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ run: serialize(run), actions })); } catch { /* ignore */ }
}
function clearSave(): void {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
const BOOT_SAVE = loadSave();

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
  continueRun: () => { turnClock.set(0); set({ showTitle: false, heroChoices: null, avatarPickerOpen: false }); },
  // Discard the saved run: wipe the autosave + `savedRun`, and reset the dormant `run` to a fresh throwaway so
  // state mirrors a boot with no save (Play/Practice will replace it). Stays on the title. Irreversible.
  clearRun: () => { clearSave(); set({ savedRun: null, run: createRun(randomSeed()) }); },
  // Mid-turn durability for the turn-boundary autosave. Guarded on `showTitle` because the `run` held while
  // the title is up is a dormant throwaway (see clearRun) — persisting it would resurrect a phantom Continue.
  flushSave: () => {
    const s = get();
    if (s.showTitle || s.run.phase === 'gameover' || s.run.phase === 'victory') return;
    writeSave(s.run, s.replayActions);
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
  },
  playerAvatar: loadPlayerAvatar(),
  setPlayerAvatar: (id) => {
    try { if (id) localStorage.setItem('ascent.avatar', id); else localStorage.removeItem('ascent.avatar'); } catch { /* ignore */ }
    set({ playerAvatar: id });
  },
  avatarPickerOpen: false,
  openAvatarPicker: () => set({ avatarPickerOpen: true }),
  closeAvatarPicker: () => set({ avatarPickerOpen: false }),
  combatSpeed: loadCombatSpeed(),
  setCombatSpeed: (speed) => {
    const combatSpeed = Math.min(5, Math.max(0.5, Math.round(speed * 10) / 10)); // clamp 0.5–5×, snap to 0.1
    try { localStorage.setItem('ascent.combatspeed', String(combatSpeed)); } catch { /* ignore */ }
    set({ combatSpeed });
  },
  replayActions: BOOT_SAVE?.actions ?? [],
  exportReplay: () => ({ seed: get().run.seed, heroId: get().run.heroId, actions: get().replayActions }),
  dispatch: (action) =>
    set((s) => {
      // MEASURED for the perf HUD, keyed by action type: `reduce` is the single chokepoint for all run
      // logic (shop rolls, combat resolution, end-of-turn), so if a hitch is game logic it shows up here
      // with the action that caused it. No-op passthrough when the monitor is off.
      const next = perfMonitor.measure(`reduce:${action.type}`, () => reduce(s.run, action));
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
        const replay = { seed: next.seed, heroId: next.heroId, actions: [...s.replayActions, action] };
        const author = s.playerName || undefined;
        const heroOffer = s.lastHeroOffer;
        const won = next.phase === 'victory';
        // Capture locally (→ this browser's pool next launch) AND push to the shared backend (→ everyone's pool).
        // A victory also logs a leaderboard run (its final warband for the hover). Deferred so it never hitches
        // the end screen; all best-effort and never throw.
        setTimeout(() => {
          const fresh = saveRunBoards(replay, author);
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
          const date = new Date().toISOString().slice(0, 10);
          // A7: append this run to the local match history (win or loss) for the Career screen. APT + cards
          // played come from the action log (the replay), which the run state itself doesn't track.
          const actions = replay.actions;
          // APT = player decisions per round (buys, plays, rolls, discovers, …) — exclude the automatic
          // combat-flow transitions, which fire ~once/round regardless of how you build.
          const apt = Math.round((actions.filter(isPlayerAction).length / Math.max(1, next.wave)) * 10) / 10;
          const cardsPlayed = actions.filter((a) => a.type === 'play').length;
          // Rating (career): grade this scored run against its Line and update the persisted profile. Pure
          // math in @game/sim; the change is surfaced on the end screen (lastRating) + stamped into history.
          // `wonFinal` = won the last round (round 17) — a victory means the last history entry is the round-17
          // result; winning it earns the big final-win bonus on top of the summit bonus. Winning the two rounds
          // before it (15 & 16) earns the escalating end-game ramp (+8 / +12). `history` is 0-indexed by round.
          const wonRound = (round: number): boolean => next.history[round - 1] === 'win';
          const wonFinal = won && next.history[next.history.length - 1] === 'win';
          const change = resolveRunRating(s.profile, {
            scoredWins: runRecord(next).wins, line: next.line, completed: won,
            wonFinal, wonRound15: wonRound(15), wonRound16: wonRound(16),
          });
          saveProfile(change.profile);
          set({ profile: change.profile, lastRating: change });
          const history = saveRunHistoryEntry(buildRunHistoryEntry(next, { date, boardsContributed: fresh.length, board: finalBoard, apt, cardsPlayed, rating: change }));
          // Player Leaderboard: upsert this named player's slot — rating (the "MMR") + total games + favorite
          // hero, both derived from the just-updated local history (games = runs, favorite = most-played hero).
          // Best-effort + skipped for anonymous players (see uploadPlayerProfile).
          const career = careerStats(history);
          void uploadPlayerProfile({
            author, rating: change.profile.rating, gamesPlayed: career.runs,
            favoriteHero: career.perHero[0]?.heroId, patch: `${__APP_VERSION__}+${__BUILD_SHA__}`,
          });
          // Player Balance Report: reconstruct this run's offers/picks from its replay (deterministic, deferred so
          // it never hitches the end screen) + upload one telemetry row. `lastHeroOffer` = the picked hero's trio.
          try {
            const telemetry = reconstructRunTelemetry(replay, heroOffer);
            void uploadRunTelemetry(telemetry, { author, patch: `${__APP_VERSION__}+${__BUILD_SHA__}` });
          } catch { /* best-effort — telemetry must never disrupt the end screen */ }
          if (won) {
            void uploadVictory({
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
        else if (next.phase !== s.run.phase) {
          perfMonitor.measure('autosave', () => writeSave(next, replayActions));
          savedRun = next;
        }
      }
      return {
        run: next,
        savedRun,
        heroArmed: false, // any action clears targeting
        inspect: null, // …and closes the inspect overlay
        sellTick: action.type === 'sell' ? s.sellTick + 1 : s.sellTick,
        // Record only state-changing actions — together with the seed they replay the run deterministically.
        replayActions,
      };
    }),
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
  pickHero: (heroId) =>
    set((s) => {
      // The run's par comes from the player's rating-derived Line (career skill pressure).
      const run = createRun(randomSeed(), heroId, s.pendingMode, s.profile.currentLine);
      writeSave(run, []); // the new run is now the resumable save
      return { run, savedRun: run, lastRunBoards: 0, heroArmed: false, endTurnAnimating: false, sellTick: 0, inspect: null, heroChoices: null, lastHeroOffer: s.heroChoices ?? [heroId], showTitle: false, avatarPickerOpen: false, replayActions: [] };
    }),
  newRun: (seed, heroId) =>
    set((s) => {
      const run = createRun(seed ?? randomSeed(), heroId, s.pendingMode, s.profile.currentLine);
      writeSave(run, []);
      return { run, savedRun: run, lastRunBoards: 0, heroArmed: false, endTurnAnimating: false, sellTick: 0, inspect: null, heroChoices: null, showTitle: false, avatarPickerOpen: false, replayActions: [] };
    }),
  startAscent: () => set({ showTitle: false, pendingMode: 'ascent', heroChoices: rollHeroChoices(), avatarPickerOpen: false }),
  startPractice: () => set({ showTitle: false, pendingMode: 'practice', heroChoices: HEROES.map((h) => h.id), avatarPickerOpen: false }),
  startRift: () => set({ showTitle: false, pendingMode: 'rift', heroChoices: rollHeroChoices(), avatarPickerOpen: false }),
  // Quitting mid-turn: persist first (while `showTitle` is still false, so flushSave's guard lets it through),
  // otherwise the turn in progress would roll back to the last phase boundary on Continue.
  openTitle: () => { get().flushSave(); set({ showTitle: true, heroChoices: null }); },
  openLeaderboard: () => set({ showLeaderboard: true }),
  closeLeaderboard: () => set({ showLeaderboard: false }),
  showRankings: false,
  openRankings: () => set({ showRankings: true }),
  closeRankings: () => set({ showRankings: false }),
  showCareer: false,
  openCareer: () => set({ showCareer: true }),
  closeCareer: () => set({ showCareer: false }),
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

// DEV-only debug handle: stage arbitrary state from the console (e.g. useGame.setState to preview the
// Discover / game-over / End-of-Turn UI). Stripped from production builds.
if (import.meta.env.DEV) {
  (window as unknown as { useGame?: typeof useGame }).useGame = useGame;
}
