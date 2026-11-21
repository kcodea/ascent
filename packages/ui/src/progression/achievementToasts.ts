/**
 * MID-GAME ACHIEVEMENT TOASTS (owner ask 2026-11-20, R-ACH-TOAST-01): "can we add something mid-game when it unlocks? so
 * it shows when you get achievements done mid game etc? this should prob span all achievements where possible. it
 * should just like duck in from the left side and say the achievement you got."
 *
 * Settings > Game > "Achievement pop-ups" (achievementToastPrefs.ts, on by default) switches both off.
 *
 * Two sources feed ONE queue (`useAchievementToasts`), each id announced once per game:
 *   1. MID-GAME. After each of the player's own actions (the store's `replayActions` grows), on idle time, the run
 *      observer's metrics so far go through `midRunUnlockedAchievements` (@game/progression) against what the account
 *      had completed when the game began. Only for a game that can settle achievements: a rated lobby (Ranked) or a
 *      standard Practice (Normal Health and a turn timer). Never a sandbox / God Mode / Duos / tutorial game, a
 *      replay, or a watched game (spectating or a teammate's view: the run on screen is not the player's).
 *   2. AT THE END. The settlement's answer (`useProgression.current`, confirmed, not a duplicate) lists the ids the
 *      server granted: whatever the mid-game check could not know (placements, server facts, the final board) ducks in
 *      then, minus any already shown for that game.
 * A forecast for presentation only: the server still grants, at settlement, exactly as before.
 *
 * COST. One reference compare per store update; the evaluation itself (O(achievements), a few hundred cheap checks) runs
 * at most once per player action, on idle time, and only when the metrics actually moved. Three small reads per game
 * (completions + own progress; the retired list once per session), and none without a signed-in account with
 * achievements switched on.
 */
import { create } from 'zustand';
import { achievementOf, midRunUnlockedAchievements, type AchievementBaseline, type MidRunAchievementContext } from '@game/progression';
import { lobbyIsUnrated, progressionFactsOf, setIdOf, type RunState } from '@game/sim';
import { useGame } from '../store';
import { useSpectate } from '../versus/spectate';
import { currentUserId } from '../identity';
import { achievementsVisible, useProgression } from './progressionStore';
import { achievementPopupsOn, onAchievementPopupsChange } from './achievementToastPrefs';
import { fetchAchievementCompletions, fetchOwnAchievementProgress, fetchRetiredAchievementIds } from './progressionRemote';

// ── The queue ────────────────────────────────────────────────────────────────────────────────────────────────

export interface AchievementToastItem { key: number; id: string }
interface ToastState { queue: AchievementToastItem[] }
export const useAchievementToasts = create<ToastState>(() => ({ queue: [] }));
let nextKey = 1;

export function enqueueAchievementToasts(ids: readonly string[]): void {
  if (!achievementPopupsOn()) return; // Settings > Game > Achievement pop-ups is off
  const known = ids.filter((id) => achievementOf(id)); // an id from a newer server has nothing to name: skipped
  if (known.length === 0) return;
  useAchievementToasts.setState((s) => ({ queue: [...s.queue, ...known.map((id) => ({ key: nextKey++, id }))] }));
}
/** The head toast finished its slide out. */
export function shiftAchievementToast(key: number): void {
  useAchievementToasts.setState((s) => (s.queue[0]?.key === key ? { queue: s.queue.slice(1) } : s));
}

// ── Which game can toast ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The game on screen as its settlement will see it, or null when it can settle no achievement (so nothing toasts
 * mid-game). Mirrors the settlement's `any` gate: Ranked = a rated lobby; Practice counts only with Normal Health AND a
 * turn timer. Pure.
 */
export function achievementToastContextOf(run: RunState): MidRunAchievementContext | null {
  if (run.sandbox || run.godMode || run.duos) return null;
  if (run.phase === 'gameover' || run.phase === 'victory') return null; // the settlement's answer takes it from here
  const setId = setIdOf(run);
  if (run.mode === 'lobby') {
    if (!run.lobby || lobbyIsUnrated(run.lobby)) return null;
    return { mode: 'ranked', eligibleRun: true, setId, heroId: run.heroId };
  }
  if (run.mode === 'practice') {
    const cfg = run.practiceConfig;
    if (!cfg || cfg.health !== 'normal' || !(cfg.timeMult >= 1)) return null;
    return { mode: 'practice', eligibleRun: true, setId, heroId: null };
  }
  return null;
}

// ── Announced once per game (kept across a reload of the same game) ──────────────────────────────────────────

const SHOWN_KEY = 'ascent.achtoast.shown';
let shown: { game: string; ids: Set<string> } = { game: '', ids: new Set() };
function shownFor(game: string): Set<string> {
  if (shown.game === game) return shown.ids;
  let ids = new Set<string>();
  try {
    const o = JSON.parse(localStorage.getItem(SHOWN_KEY) ?? 'null') as { game?: unknown; ids?: unknown } | null;
    if (o && o.game === game && Array.isArray(o.ids)) ids = new Set(o.ids.filter((x): x is string => typeof x === 'string'));
  } catch { /* a blocked storage just forgets across reloads */ }
  shown = { game, ids };
  return ids;
}
function markShown(game: string, ids: readonly string[]): void {
  const set = shownFor(game);
  for (const id of ids) set.add(id);
  try { localStorage.setItem(SHOWN_KEY, JSON.stringify({ game, ids: [...set] })); } catch { /* ignore */ }
}

// ── What the account had when the game began ─────────────────────────────────────────────────────────────────

let retiredOnce: Promise<string[]> | null = null;
let baseline: { userId: string; game: string; data: AchievementBaseline | null; loading: boolean } | null = null;

function baselineFor(userId: string, game: string): AchievementBaseline | null {
  if (baseline && baseline.userId === userId && baseline.game === game) return baseline.data;
  const b = { userId, game, data: null as AchievementBaseline | null, loading: true };
  baseline = b;
  retiredOnce ??= fetchRetiredAchievementIds().then((r) => r ?? []);
  void Promise.all([fetchAchievementCompletions(userId), fetchOwnAchievementProgress(), retiredOnce]).then(([completions, progress, retired]) => {
    b.loading = false;
    // Without the completions nothing can be told apart from "already done": no toasts this game.
    if (!completions) return;
    b.data = { completed: completions.map((c) => c.id), progress: progress ?? null, retired };
    if (baseline === b) scheduleCheck();
  });
  return null;
}

// ── The check ────────────────────────────────────────────────────────────────────────────────────────────────

let lastMetrics = '';
let pending = false;

function scheduleCheck(): void {
  if (pending) return;
  pending = true;
  const run = (): void => { pending = false; checkNow(); };
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(run, { timeout: 600 }); else setTimeout(run, 0);
}

/** Evaluate the player's game right now (exported for tests). */
export function checkNow(): void {
  if (!achievementPopupsOn()) return;
  const g = useGame.getState();
  if (g.replaySession || g.liveReplay) return;
  const sp = useSpectate.getState();
  if (sp.active || sp.teammate) return;
  const ctx = achievementToastContextOf(g.run);
  if (!ctx) return;
  if (!achievementsVisible(useProgression.getState())) return;
  const userId = currentUserId();
  if (!userId) return;
  const game = String(g.run.seed);
  const base = baselineFor(userId, game);
  if (!base) return;
  const metrics = progressionFactsOf(g.deriveState, g.run, { runId: '', mode: ctx.mode, patch: '' }).metrics ?? {};
  const sig = `${game}|${JSON.stringify(metrics)}`;
  if (sig === lastMetrics) return;
  lastMetrics = sig;
  const ids = midRunUnlockedAchievements(metrics, ctx, base, shownFor(game));
  if (ids.length === 0) return;
  markShown(game, ids);
  enqueueAchievementToasts(ids);
}

/** The settlement answered: announce what it granted that was not already shown for that game. */
function onSettled(): void {
  if (!achievementPopupsOn()) return;
  const cur = useProgression.getState().current;
  if (!cur || cur.state !== 'confirmed' || cur.deduped || !cur.result) return;
  const granted = cur.result.achievements;
  if (!granted.length || !achievementsVisible(useProgression.getState())) return;
  const seen = shownFor(cur.localKey);
  const ids = granted.filter((id) => !seen.has(id));
  if (ids.length === 0) return;
  markShown(cur.localKey, ids);
  enqueueAchievementToasts(ids);
}

let installed = false;
/** Start listening (idempotent). Returns the stop function. */
export function installAchievementToasts(): () => void {
  if (installed) return () => {};
  installed = true;
  let actions = useGame.getState().replayActions;
  const unGame = useGame.subscribe((s) => {
    if (s.replayActions === actions) return;
    actions = s.replayActions;
    scheduleCheck();
  });
  let current = useProgression.getState().current;
  const unProg = useProgression.subscribe((s) => {
    if (s.current === current) return;
    current = s.current;
    onSettled();
  });
  // Switched off: whatever is waiting goes too.
  const unPref = onAchievementPopupsChange(() => { if (!achievementPopupsOn()) useAchievementToasts.setState({ queue: [] }); });
  return () => { unGame(); unProg(); unPref(); installed = false; };
}

/** Tests only. */
export function resetAchievementToastsForTests(): void {
  shown = { game: '', ids: new Set() };
  baseline = null;
  retiredOnce = null;
  lastMetrics = '';
  pending = false;
  useAchievementToasts.setState({ queue: [] });
}
