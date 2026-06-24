/**
 * Persisted board library — the player's own finished-run boards, saved to localStorage and loaded back
 * into the opponent pool at startup, so future runs face boards you actually built (the groundwork for
 * async PvP, which swaps localStorage for a shared backend).
 *
 * Replay-safe by construction: boards are loaded ONCE at startup (a static pool for the session, the way
 * `OPPONENT_POOL` requires) and only *written* when a run ends — never mutated mid-run. Capture is
 * deterministic: a finished run is `{ seed, heroId, actions }`, and `replayRun` re-derives its per-wave
 * boards byte-identically, so we store the replay's snapshots rather than capturing live.
 */
import { registerOpponents, replayRun, type BoardSnapshot, type Replay } from '@game/sim';

const KEY = 'ascent.boards';
const CAP = 300; // keep the most recent N captured boards (≈ 15–30 runs); FIFO so the pool stays fresh
const EXPORT_FORMAT = 1;

/** A stable identity for a board, so re-imports / duplicate captures collapse to one. */
const signature = (s: BoardSnapshot): string =>
  `${s.wave}|${s.heroId}|${s.minions.map((m) => `${m.cardId}:${m.attack}/${m.health}:${(m.keywords ?? []).slice().sort().join('')}${m.golden ? 'g' : ''}`).sort().join(',')}`;

const dedupe = (boards: BoardSnapshot[]): BoardSnapshot[] => {
  const seen = new Set<string>();
  return boards.filter((s) => {
    const k = signature(s);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** Load the player's persisted boards. Best-effort: returns [] on any missing/parse/shape problem. */
export function loadStoredBoards(): BoardSnapshot[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Drop anything that isn't a current-schema snapshot (migration = bump BoardSnapshot.v + drop here).
    return (arr as BoardSnapshot[]).filter((s) => s && s.v === 1 && Array.isArray(s.minions));
  } catch {
    return [];
  }
}

/** Capture a finished run's per-wave boards (deterministically, via `replayRun`) and append them to the
 *  stored library, capped to the most recent CAP. Stamps your attribution (origin:'self' + name + date) so
 *  these boards carry "by you" when served — and so they can be exported with provenance for a friend's pool.
 *  Best-effort — board capture never blocks the game. */
export function saveRunBoards(replay: Replay, author?: string): void {
  try {
    const { final, snapshots } = replayRun(replay);
    // ONLY persist a run that actually FINISHED — won (victory) or lost (gameover). The caller already gates
    // on the gameover/victory transition; this guard makes it impossible for an in-progress / abandoned run
    // to be snapshotted even if anything ever calls this wrongly.
    if (final.phase !== 'gameover' && final.phase !== 'victory') return;
    // Only keep boards with minions — an empty board (power 0) is never a useful opponent.
    const capturedAt = new Date().toISOString().slice(0, 10);
    const fresh = snapshots
      .filter((s) => s.minions.length > 0)
      .map((s) => ({ ...s, origin: 'self' as const, ...(author ? { author } : {}), capturedAt }));
    if (fresh.length === 0) return;
    const all = dedupe([...loadStoredBoards(), ...fresh]).slice(-CAP);
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore — capture is best-effort, never fatal */
  }
}

/**
 * Serialize this browser's captured boards into a shareable file payload (your name + date + the boards).
 * Send the file to a friend; they Import it and start facing your boards. The same shape can be dropped into
 * `docs/board-exports/` and baked into the committed pool with `npm run pool`.
 */
export function exportBoardsJson(author: string): string {
  return JSON.stringify({
    app: 'ascent',
    format: EXPORT_FORMAT,
    author: author || undefined,
    exportedAt: new Date().toISOString().slice(0, 10),
    boards: loadStoredBoards(),
  });
}

/**
 * Import a friend's exported boards: tag them `origin:'friend'` (with the file's author + date), merge into
 * the stored library (deduped, capped) AND register them live this session — so you face them immediately and
 * next launch. Accepts the wrapped `{author, boards}` shape or a raw `BoardSnapshot[]`. Returns how many were
 * added (and the new total), or null on a malformed / empty file.
 */
export function importBoardsJson(text: string): { imported: number; total: number } | null {
  try {
    const parsed: unknown = JSON.parse(text);
    const wrapped = !!parsed && typeof parsed === 'object' && Array.isArray((parsed as { boards?: unknown }).boards);
    const raw = (wrapped ? (parsed as { boards: BoardSnapshot[] }).boards : (parsed as BoardSnapshot[])) ?? [];
    if (!Array.isArray(raw)) return null;
    const meta = wrapped ? (parsed as { author?: string; exportedAt?: string }) : {};
    const date = meta.exportedAt || new Date().toISOString().slice(0, 10);
    const fresh = raw
      .filter((s) => s && s.v === 1 && Array.isArray(s.minions) && s.minions.length > 0)
      .map((s) => ({ ...s, origin: 'friend' as const, author: s.author ?? meta.author, capturedAt: s.capturedAt ?? date }));
    if (fresh.length === 0) return null;
    const merged = dedupe([...loadStoredBoards(), ...fresh]).slice(-CAP);
    localStorage.setItem(KEY, JSON.stringify(merged));
    registerOpponents(fresh); // live this session too — no reload needed to start facing them
    return { imported: fresh.length, total: merged.length };
  } catch {
    return null;
  }
}
