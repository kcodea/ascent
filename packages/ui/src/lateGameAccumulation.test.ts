// @vitest-environment jsdom
/**
 * NOTHING THE STORE HOLDS GROWS FASTER LATE THAN EARLY (R-PERF-LATE-FLAT-01, owner top priority 2026-10-29:
 * "Performance degrades over the course of a game ... massively by end game ... and even faster on mobile").
 *
 * The browser hunts (devlogs 2026-10-29 parts 1-2, 2026-11-08 phone pass) found no input that costs more late than
 * early. What CAN turn into exactly that kind of degradation, and has before (the bug-report ring hashing the whole run,
 * R-PERF-RING-LAZY-01), is state that grows with the game's HISTORY and is then walked, copied or serialized on a hot
 * path: the autosave serializes `run` + `deriveState` + `telemetryLog` + `replayActions`; the replay draft writes
 * `replayFrames`; every commit copies `replayActions` / `replayFrames`. Growth that is linear in the actions taken is
 * expected and fine. Growth that ACCELERATES (a list re-appended whole, a per-round snapshot of everything so far, a
 * map never pruned) is what makes round 14 cost more than round 4 for the same click.
 *
 * So this drives one real lobby game through the real store (reducer, lobby, observers, replay capture: only the
 * uploads are mocked) with the default bot for 14 rounds, and checks per store slice that:
 *   1. the bytes it adds per round in rounds 10-14 are at most 1.5x what it added per round in rounds 5-10, plus 1 KB
 *      (a slice that accelerates fails: a list re-appended whole, a per-round copy of the history so far), and
 *   2. it stays under an absolute per-round ceiling (a slice that suddenly holds far more per round fails).
 * `run` itself is held to a total size: it is the state every commit hands to every selector.
 *
 * It does not time anything (CI timing is noise); it measures what timing would follow from.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BOT, modalOpen } from '@game/sim';

vi.mock('./remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./remoteBoards')>();
  return {
    ...mod,
    uploadBoards: vi.fn(async () => {}),
    uploadVictory: vi.fn(async () => {}),
    uploadRunTelemetry: vi.fn(async () => {}),
    uploadRunHistory: vi.fn(async () => {}),
    uploadPlayerProfile: vi.fn(async () => {}),
    refreshOpponentPoolAndRecords: vi.fn(),
  };
});

import { useGame } from './store';

const ROUNDS = 14;
/** Slices whose per-round growth is checked, with their absolute per-round ceiling in bytes of JSON. Measured
 *  2026-11-08 (this game, rounds 5-10 -> 10-14, B/round): deriveState 2,820 -> 3,140; telemetryLog 170 -> 130;
 *  replayActions 95 -> 75; replayFrames 27,300 -> 33,200 (combat frames grow with the boards' fights);
 *  capturedBoards 1,160 -> 1,890. Natural late/mid ratios are 0.8-1.2 (capturedBoards 1.6, inside the 1 KB floor).
 *  The ceilings are ~3-5x the late rates: a real change in what a round records fails, ordinary drift does not. */
const PER_ROUND_CEILING: Record<string, number> = {
  deriveState: 16_000,
  telemetryLog: 4_000,
  replayActions: 4_000,
  replayFrames: 48_000,
  capturedBoards: 16_000,
};
/** `run` is not history: it is the live state. Measured 5.6 KB at round 1, 35-41 KB from round 8 (lastCombat is most of it). */
const RUN_CEILING = 120_000;

const size = (v: unknown): number => {
  try { return JSON.stringify(v)?.length ?? 0; } catch { return -1; }
};

function playShopTurn(): void {
  for (let i = 0; i < 80; i++) {
    const s = useGame.getState();
    const run = s.run;
    if (run.phase !== 'recruit') return;
    if (modalOpen(run) && run.discover) { s.dispatch({ type: 'discover', index: 0 }); if (useGame.getState().run === run) return; continue; }
    const a = DEFAULT_BOT.act(run);
    if (!a || a.type === 'faceOmen') return;
    s.dispatch(a);
    if (useGame.getState().run === run) return;
  }
}

describe('late-game accumulation (R-PERF-LATE-FLAT-01)', () => {
  it('no store slice grows faster per round late than early, and none blows its per-round ceiling', () => {
    localStorage.clear();
    useGame.setState({ pendingMode: 'lobby', pendingSeed: 424242 });
    useGame.getState().pickHero('warden');
    expect(useGame.getState().run.mode).toBe('lobby');
    expect(useGame.getState().run.seed).toBe(424242);

    const rows: Record<string, number>[] = [];
    for (let r = 1; r <= ROUNDS; r++) {
      // Keep the player alive: the point is a 14-round history, not the lobby's verdict.
      const live = useGame.getState().run;
      const seats = live.lobby!.seats.map((seat, i) => (i === 0 ? { ...seat, resolve: 99, armor: 0, eliminated: false } : seat));
      useGame.setState({ run: { ...live, resolve: 99, lobby: { ...live.lobby!, seats } } });
      playShopTurn();
      const s = useGame.getState();
      rows.push({
        wave: s.run.wave,
        run: size(s.run),
        ...Object.fromEntries(Object.keys(PER_ROUND_CEILING).map((k) => [k, size((s as unknown as Record<string, unknown>)[k])])),
      });
      s.dispatch({ type: 'faceOmen' });
      if (useGame.getState().run.phase === 'combat') useGame.getState().dispatch({ type: 'resolveCombat' });
      expect(useGame.getState().run.phase, `round ${r} did not come back to the shop`).toBe('recruit');
    }

    expect(rows.map((x) => x.wave)).toEqual(Array.from({ length: ROUNDS }, (_, i) => i + 1));
    const perRound = (k: string, from: number, to: number): number => (rows[to - 1]![k]! - rows[from - 1]![k]!) / (to - from);
    const report: string[] = [];
    for (const k of Object.keys(PER_ROUND_CEILING)) {
      const early = perRound(k, 5, 10);
      const late = perRound(k, 10, 14);
      report.push(`${k}: early ${early.toFixed(0)} B/round, late ${late.toFixed(0)} B/round, total ${rows[ROUNDS - 1]![k]}`);
      expect(late, `${k} grows faster late (${late.toFixed(0)} B/round) than early (${early.toFixed(0)}): ${report.join('; ')}`).toBeLessThanOrEqual(early * 1.5 + 1_000);
      expect(late, `${k} adds ${late.toFixed(0)} B a round late, over its ceiling ${PER_ROUND_CEILING[k]}`).toBeLessThanOrEqual(PER_ROUND_CEILING[k]!);
    }
    for (const row of rows) expect(row.run, `run is ${row.run} B at wave ${row.wave}`).toBeLessThanOrEqual(RUN_CEILING);
    console.log(['late-game accumulation:', ...report, `run: ${rows.map((x) => x.run).join(' ')}`].join('\n  '));
  }, 120_000);
});
