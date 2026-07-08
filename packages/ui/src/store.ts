import { create } from 'zustand';
import { CARD_INDEX } from '@game/content';
import { HEROES, OPPONENT_POOL, OPPONENT_POOL_DATA, registerOpponents, createRun, deserialize, initialProfile, isPlayerAction, reduce, resolveRunRating, runRecord, serialize, type Action, type BoardSnapshot, type PlayerProfile, type RatingChange, type Replay, type RunState } from '@game/sim';
import type { Tribe } from '@game/core';
import type { CardView } from './Card';
import type { CombatBuffDelta } from './runBuffs';

/** Combat quest-objective progress landed so far in the live replay (same shape as `CombatResult.playerQuestTally`
 *  plus a Deathrattle/Echo total). Drives the QuestPanel's live-tick. */
export interface CombatQuestDelta {
  attack: number; summonCombat: number; slaughter: number; deathrattle: number;
  attackByTribe: Partial<Record<Tribe, number>>;
  summonCombatByTribe: Partial<Record<Tribe, number>>;
  slaughterByTribe: Partial<Record<Tribe, number>>;
}
import { sfx } from './sfx';
import { loadStoredBoards, saveRunBoards } from './boardLibrary';
import { fetchAndRegisterPool, uploadBoards, uploadVictory } from './remoteBoards';
import { buildRunHistoryEntry, clearRunHistory, saveRunHistoryEntry } from './runHistory';
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

/** How many heroes the pre-run picker offers (or all of them, if fewer exist). */
const HERO_SELECT_COUNT = 3;

/** A fresh shuffle of hero ids for the picker. UI-level randomness — the hero *choice* is a
 *  meta decision, not part of the seeded run, so Math.random is fine here (and not in the sim). */
function rollHeroChoices(): string[] {
  const ids = HEROES.map((h) => h.id);
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
  /** Combat quest-objective progress landed so far this fight — bridges useCombatReplay → the QuestPanel so
   *  combat objectives (attack / summonCombat / slaughter / Echo) LIVE-TICK during the replay. `null` outside
   *  combat (the panel reads only the run state's progress). */
  combatQuestDelta: CombatQuestDelta | null;
  setCombatQuestDelta: (d: CombatQuestDelta | null) => void;
  /** Increments on each sell — drives the gold "+1" flash on the Embers chip. */
  sellTick: number;
  /** The card being inspected (right-click) in a centred, enlarged overlay, or null. */
  inspect: CardView | null;
  /** Hero ids offered by the pre-run picker; non-null = the hero-select overlay is showing. */
  heroChoices: string[] | null;
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
  /** Discard the saved in-progress run (from the title) — clears the autosave + `savedRun` so Continue
   *  disappears. Destructive + irreversible; the caller confirms first. */
  clearRun: () => void;
  /** The title screen is shown at boot + after a run ends — the front door to the modes. */
  showTitle: boolean;
  /** The mode the next run will start in (set by startAscent/startPractice, read by pickHero). */
  pendingMode: 'ascent' | 'practice';
  /** Title → Ascent: open the 3-hero picker for a scored run. */
  startAscent: () => void;
  /** Title → Practice: open an ALL-hero picker for a practice run (Ascent's full course, unlimited health). */
  startPractice: () => void;
  /** Return to the title screen (from the end screen). */
  openTitle: () => void;
  /** The leaderboard overlay (Hall of Champions — latest victory runs) is open. */
  showLeaderboard: boolean;
  openLeaderboard: () => void;
  closeLeaderboard: () => void;
  /** The Career overlay (your local match history + per-hero stats) is open. */
  showCareer: boolean;
  openCareer: () => void;
  closeCareer: () => void;
  /** The Minion Book codex overlay (Tab) is open — a filterable reference of every minion + spell
   *  findable this run. UI-only; reads the run's pool + active tribes. */
  showBook: boolean;
  toggleBook: () => void;
  closeBook: () => void;
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
  heroArmed: false,
  endTurnAnimating: false,
  combatEnemyDeaths: 0,
  combatBuffs: null,
  combatQuestDelta: null,
  sellTick: 0,
  inspect: null,
  // Boot into the title screen (the front door); the hero picker opens once a mode is chosen.
  heroChoices: null,
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
      const next = reduce(s.run, action);
      actionSfx(action, s.run, next);
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
        const won = next.phase === 'victory';
        // Capture locally (→ this browser's pool next launch) AND push to the shared backend (→ everyone's pool).
        // A victory also logs a leaderboard run (its final warband for the hover). Deferred so it never hitches
        // the end screen; all best-effort and never throw.
        setTimeout(() => {
          const fresh = saveRunBoards(replay, author);
          set({ lastRunBoards: fresh.length }); // A6: surface "you contributed N boards" on the end screen
          void uploadBoards(fresh);
          const finalBoard = fresh.reduce<BoardSnapshot | null>((best, b) => (!best || b.wave > best.wave ? b : best), null);
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
          saveRunHistoryEntry(buildRunHistoryEntry(next, { date, boardsContributed: fresh.length, board: finalBoard, apt, cardsPlayed, rating: change }));
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
      // Autosave (A3): persist an in-progress run on every change; clear it once the run finishes (a
      // finished run isn't resumable). `savedRun` mirrors the persisted state so the title's Continue works.
      let savedRun = s.savedRun;
      if (changed) {
        if (finished) { clearSave(); savedRun = null; }
        else { writeSave(next, replayActions); savedRun = next; }
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
  inspectCard: (view) => { sfx.inspect(); set({ inspect: view }); },
  clearInspect: () => set({ inspect: null }),
  startHeroSelect: () => set({ heroChoices: rollHeroChoices() }),
  pickHero: (heroId) =>
    set((s) => {
      // The run's par comes from the player's rating-derived Line (career skill pressure).
      const run = createRun(randomSeed(), heroId, s.pendingMode, s.profile.currentLine);
      writeSave(run, []); // the new run is now the resumable save
      return { run, savedRun: run, lastRunBoards: 0, heroArmed: false, endTurnAnimating: false, sellTick: 0, inspect: null, heroChoices: null, showTitle: false, avatarPickerOpen: false, replayActions: [] };
    }),
  newRun: (seed, heroId) =>
    set((s) => {
      const run = createRun(seed ?? randomSeed(), heroId, s.pendingMode, s.profile.currentLine);
      writeSave(run, []);
      return { run, savedRun: run, lastRunBoards: 0, heroArmed: false, endTurnAnimating: false, sellTick: 0, inspect: null, heroChoices: null, showTitle: false, avatarPickerOpen: false, replayActions: [] };
    }),
  startAscent: () => set({ showTitle: false, pendingMode: 'ascent', heroChoices: rollHeroChoices(), avatarPickerOpen: false }),
  startPractice: () => set({ showTitle: false, pendingMode: 'practice', heroChoices: HEROES.map((h) => h.id), avatarPickerOpen: false }),
  openTitle: () => set({ showTitle: true, heroChoices: null }),
  openLeaderboard: () => set({ showLeaderboard: true }),
  closeLeaderboard: () => set({ showLeaderboard: false }),
  showCareer: false,
  openCareer: () => set({ showCareer: true }),
  closeCareer: () => set({ showCareer: false }),
  showBook: false,
  toggleBook: () => set((s) => ({ showBook: !s.showBook })),
  closeBook: () => set({ showBook: false }),
}));

// DEV-only debug handle: stage arbitrary state from the console (e.g. useGame.setState to preview the
// Discover / game-over / End-of-Turn UI). Stripped from production builds.
if (import.meta.env.DEV) {
  (window as unknown as { useGame?: typeof useGame }).useGame = useGame;
}
