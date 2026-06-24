import { create } from 'zustand';
import { CARD_INDEX } from '@game/content';
import { HEROES, OPPONENT_POOL, OPPONENT_POOL_DATA, registerOpponents, createRun, reduce, type Action, type Replay, type RunState } from '@game/sim';
import type { CardView } from './Card';
import { sfx } from './sfx';
import { loadStoredBoards, saveRunBoards } from './boardLibrary';

// Serve real, buildable boards as enemies: load the COMMITTED opponent pool (`OPPONENT_POOL_DATA`, baked by
// `npm run pool` from seeded bot runs + any imported you/friend board exports) plus this browser's own
// captured boards, once at startup while OPPONENT_POOL is still empty. The headless harnesses + tests don't
// load this module, so they keep their empty-pool procedural baseline. `registerOpponents` drops any board
// referencing a card this build no longer has, so a stale committed/stored board can never crash combat.
if (OPPONENT_POOL.length === 0) registerOpponents([...OPPONENT_POOL_DATA, ...loadStoredBoards()]);

/** How many heroes the pre-run picker offers (or all of them, if fewer exist). */
const HERO_SELECT_COUNT = 2;

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
}

const randomSeed = (): number => Math.floor(Math.random() * 0x7fffffff);

/** Your persisted display name (empty if unset). Best-effort — localStorage may be unavailable. */
function loadPlayerName(): string {
  try { return localStorage.getItem('ascent.playername') ?? ''; } catch { return ''; }
}

export const useGame = create<GameStore>((set, get) => ({
  run: createRun(randomSeed()),
  heroArmed: false,
  endTurnAnimating: false,
  combatEnemyDeaths: 0,
  sellTick: 0,
  inspect: null,
  // Open on a fresh hero pick — the player chooses before the first wave loads.
  heroChoices: rollHeroChoices(),
  // Default to the compact, art-forward card (full rules text on hover). Flip in the Esc menu.
  compactCards: true,
  toggleCompact: () => set((s) => ({ compactCards: !s.compactCards })),
  playerName: loadPlayerName(),
  setPlayerName: (name) => {
    const playerName = name.slice(0, 24).trim();
    try { localStorage.setItem('ascent.playername', playerName); } catch { /* ignore */ }
    set({ playerName });
  },
  replayActions: [],
  exportReplay: () => ({ seed: get().run.seed, heroId: get().run.heroId, actions: get().replayActions }),
  dispatch: (action) =>
    set((s) => {
      const next = reduce(s.run, action);
      actionSfx(action, s.run, next);
      // A run just ended → capture its boards into the library (loaded into the opponent pool next
      // startup, so you face boards you actually built). Deferred so it never hitches the end screen.
      if (
        (next.phase === 'gameover' || next.phase === 'victory') &&
        s.run.phase !== 'gameover' &&
        s.run.phase !== 'victory'
      ) {
        const replay = { seed: next.seed, heroId: next.heroId, actions: [...s.replayActions, action] };
        const author = s.playerName || undefined;
        setTimeout(() => saveRunBoards(replay, author), 0);
      }
      return {
        run: next,
        heroArmed: false, // any action clears targeting
        inspect: null, // …and closes the inspect overlay
        sellTick: action.type === 'sell' ? s.sellTick + 1 : s.sellTick,
        // Record only state-changing actions — together with the seed they replay the run deterministically.
        replayActions: next === s.run ? s.replayActions : [...s.replayActions, action],
      };
    }),
  armHero: () => set((s) => ({ heroArmed: !s.heroArmed })),
  setEndTurnAnimating: (v) => set({ endTurnAnimating: v }),
  setCombatEnemyDeaths: (n) => set({ combatEnemyDeaths: n }),
  inspectCard: (view) => { sfx.inspect(); set({ inspect: view }); },
  clearInspect: () => set({ inspect: null }),
  startHeroSelect: () => set({ heroChoices: rollHeroChoices() }),
  pickHero: (heroId) =>
    set({ run: createRun(randomSeed(), heroId), heroArmed: false, endTurnAnimating: false, sellTick: 0, inspect: null, heroChoices: null, replayActions: [] }),
  newRun: (seed, heroId) =>
    set({ run: createRun(seed ?? randomSeed(), heroId), heroArmed: false, endTurnAnimating: false, sellTick: 0, inspect: null, heroChoices: null, replayActions: [] }),
}));

// DEV-only debug handle: stage arbitrary state from the console (e.g. useGame.setState to preview the
// Discover / game-over / End-of-Turn UI). Stripped from production builds.
if (import.meta.env.DEV) {
  (window as unknown as { useGame?: typeof useGame }).useGame = useGame;
}
