/**
 * The durability flush must persist EVERY accumulator the turn-boundary autosave does.
 *
 * `writeSave` only serializes what it is handed, so an omitted argument does not merely skip an update — it
 * REWRITES `ascent.save` without that field, and the boot fallback (`BOOT_SAVE?.derive ?? beginDerive(run)`)
 * then restarts the accumulator at the resumed wave. `flushSave` omitted `deriveState` until 2026-08-20,
 * which silently truncated the derived balance telemetry of every run that was ever quit or tab-hidden. It
 * surfaced in a public `run_telemetry` row whose offers and combats began at wave 7 of an 18-round run.
 *
 * `flushSave` fires on quit-to-title, `pagehide`, and `visibilitychange → hidden`, so this is not a rare path:
 * it is every departure that isn't a crash.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BOT, beginDerive, createLobbyRun, observeAction, reduce, type DeriveState, type RunState } from '@game/sim';

/** A localStorage stand-in — the test runs in node, and the store reads storage at module load. */
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
});

const { useGame } = await import('./store');

const SAVE_KEY = 'ascent.save';
const readSave = (): { derive?: DeriveState; telemetry?: unknown; actions?: unknown[] } | null => {
  const raw = mem.get(SAVE_KEY);
  return raw ? JSON.parse(raw) : null;
};

/** A run mid-shop with a genuinely non-empty derivation: buy something, so offers/acquisitions/gold all move. */
function runWithDerivation(): { run: RunState; derive: DeriveState } {
  let run: RunState = { ...createLobbyRun(4242, 'brackus'), phase: 'recruit' };
  let derive = beginDerive(run);
  // Drive REAL bot actions through the REAL reducer so the accumulator holds real offers/buys/gold events —
  // a hand-written action list would silently no-op the day an action is renamed.
  for (let i = 0; i < 40 && run.phase === 'recruit'; i++) {
    const action = DEFAULT_BOT.act(run);
    const next = reduce(run, action);
    if (next === run) break;
    derive = observeAction(derive, run, action, next);
    run = next;
  }
  return { run, derive };
}

describe('flushSave persists the derived-telemetry accumulator', () => {
  beforeEach(() => { mem.clear(); });

  it('writes `derive` into the save, not just the run and the action log', () => {
    const { run, derive } = runWithDerivation();
    expect(derive.playerActions, 'the fixture must actually accumulate something').toBeGreaterThan(0);

    useGame.setState({ run, deriveState: derive, showTitle: false, replaying: false, replayActions: [], capturedBoards: [] });
    useGame.getState().flushSave();

    const saved = readSave();
    expect(saved, 'flushSave must write a save at all').not.toBeNull();
    expect(saved!.derive, 'the accumulator must survive the departure').toBeDefined();
    expect(saved!.derive).toEqual(derive);
  });

  it('keeps every derivation array and counter intact through the round trip', () => {
    const { run, derive } = runWithDerivation();
    useGame.setState({ run, deriveState: derive, showTitle: false, replaying: false, replayActions: [], capturedBoards: [] });
    useGame.getState().flushSave();

    const back = readSave()!.derive!;
    // Named individually rather than by deep-equal alone: a future field added to `DeriveState` that this
    // path forgets to carry should be visible as a specific loss, not a diff.
    for (const key of ['offers', 'acquisitions', 'gold', 'upgrades', 'combats', 'triggers', 'boards'] as const) {
      expect(back[key], `${key} must round-trip`).toEqual(derive[key]);
    }
    expect(back.playerActions).toBe(derive.playerActions);
    expect(back.offerIdx).toEqual(derive.offerIdx);
    expect(back.acqIdx).toEqual(derive.acqIdx);
    expect(back.goldSpentThisTurn).toBe(derive.goldSpentThisTurn);
    expect(back.boughtThisTurn).toBe(derive.boughtThisTurn);
  });

  it('does not reset or duplicate the derivation across repeated flushes', () => {
    // pagehide and visibilitychange BOTH fire on a single departure — the second write must be the same bytes.
    const { run, derive } = runWithDerivation();
    useGame.setState({ run, deriveState: derive, showTitle: false, replaying: false, replayActions: [], capturedBoards: [] });
    useGame.getState().flushSave();
    const first = mem.get(SAVE_KEY);
    useGame.getState().flushSave();
    expect(mem.get(SAVE_KEY)).toBe(first);
    expect(readSave()!.derive!.offers).toHaveLength(derive.offers.length);
  });

  it('still refuses to write the paths that must never become a Continue', () => {
    const { run, derive } = runWithDerivation();
    // A Scene Builder run, the title screen, and an active replay each own a guard in `flushSave`; the added
    // argument must not have loosened any of them.
    for (const patch of [{ run: { ...run, sandbox: true } }, { showTitle: true }, { replaying: true }]) {
      mem.clear();
      useGame.setState({ run, deriveState: derive, showTitle: false, replaying: false, ...patch } as never);
      useGame.getState().flushSave();
      expect(readSave()).toBeNull();
    }
  });
});
