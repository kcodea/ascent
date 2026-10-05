import { create } from 'zustand';
import { gauntletStage, validateStage, type GauntletStage } from '@game/content';
import type { BoardSnapshot, RunState } from '@game/sim';
import { useGame } from '../store';
import { loadStage, saveStage } from './stageBuilderApi';
import { roundToSnapshot, roundsEqual, snapshotToRound, stampForSave } from './stageDraft';

/**
 * The Stage Builder's state (DEV only): which Gauntlet stage is open, its editable draft, the selected round, and
 * the two-way link between that round and the Scene Builder sandbox's pinned opponent board.
 *
 * A separate zustand store so the hot `store.ts` only gains a launch action. The link:
 *   - OUT: every change to the draft or the selected round re-pins `servedBoards[wave]` + `sandboxFoeWave` (the
 *     marker that makes the lobby fight serve the pin instead of the paired seat — see `faceOmen`'s `rigPinned`).
 *   - IN: an edit made on the tavern row (Recruit's `applyFoe`) replaces the pin object; the `useGame` subscription
 *     sees a pin it did not write and folds it back into the draft (`syncFromPin`).
 *   - A new wave (a Test fight resolved) re-pins the selected round at that wave.
 */

const ROUNDS = 10;
const STAGES = 10;

export interface StageBuilderState {
  open: boolean;
  /** 1..10 */
  stageNumber: number;
  /** Last loaded/saved copy — the dirty baseline and what Discard restores. */
  saved: GauntletStage | null;
  draft: GauntletStage | null;
  /** 1..10 */
  round: number;
  /** Last load/save/pin message for the panel. */
  status: string | null;
  openBuilder(n?: number): Promise<void>;
  /** Refused (status set) while the draft is dirty, unless `force`. */
  selectStage(n: number, force?: boolean): Promise<void>;
  selectRound(r: number): void;
  editDraft(fn: (s: GauntletStage) => GauntletStage): void;
  syncFromPin(): void;
  discard(): void;
  save(): Promise<void>;
  /** Refused (status set) while the draft is dirty, unless `force`. */
  close(force?: boolean): void;
  /** Rounds whose board/tier/run-buff overrides differ from `saved`; stage-level fields (name, runes, …) count as round 0. */
  dirtyRounds(): number[];
}

const clamp = (n: number, hi: number): number => Math.min(Math.max(Math.round(n) || 1, 1), hi);
const emptyMessage = (round: number): string => `Round ${round} is empty — add a minion`;
const EMPTY_RE = /^Round \d+ is empty — add a minion$/;

/** The pin the RIG authored for the current wave, if any (a seat's board or a stale pin is not ours to sync). */
const authoredPin = (run: RunState | undefined): BoardSnapshot | undefined =>
  (run && run.sandboxFoeWave === run.wave ? run.servedBoards?.[run.wave] : undefined) ?? undefined;

const stageFieldsEqual = (a: GauntletStage, b: GauntletStage): boolean =>
  a.number === b.number && a.name === b.name && a.opponentName === b.opponentName && a.portraitCardId === b.portraitCardId && a.tribe === b.tribe &&
  a.status === b.status && a.runes.round6 === b.runes.round6 && a.runes.round9 === b.runes.round9;

/** Disk first (the builder always edits the file); the bundled copy if the dev endpoint is unreachable. */
async function fetchStage(n: number): Promise<{ stage: GauntletStage | null; status: string | null }> {
  try {
    return { stage: await loadStage(n), status: null };
  } catch (e) {
    const bundled = gauntletStage(n);
    const why = (e as Error).message;
    return bundled
      ? { stage: structuredClone(bundled), status: `Loaded the bundled copy of stage ${n} (${why})` }
      : { stage: null, status: `Stage ${n} has no file yet (${why})` };
  }
}

// Subscription bookkeeping lives outside the store: it is plumbing, not state the panel renders.
let unsubscribe: (() => void) | null = null;
/** The snapshot object this store last wrote as the pin — any OTHER pin object for the wave is an external edit. */
let lastPinned: BoardSnapshot | null = null;
let lastWave: number | null = null;

export const useStageBuilder = create<StageBuilderState>()((set, get) => {
  /** Write the selected round as the sandbox's rig-authored foe for the current wave (or clear it when empty). */
  const pinRound = (): void => {
    const { draft, round, status } = get();
    const run = useGame.getState().run;
    if (!draft || !run?.sandbox) return;
    lastWave = run.wave;
    if ((draft.rounds[round - 1]?.board.length ?? 0) === 0) {
      // The rig refuses an empty board (it would end the fight before it starts): drop our pin so the lobby seat
      // fights instead, and say why. Only a RIG-authored pin is removed — a turn-boundary pool stamp isn't ours.
      lastPinned = null;
      set({ status: emptyMessage(round) });
      if (authoredPin(run)) {
        const servedBoards = { ...(run.servedBoards ?? {}) };
        delete servedBoards[run.wave];
        useGame.setState({ run: { ...run, servedBoards, sandboxFoeWave: undefined } });
      }
      return;
    }
    const snap = roundToSnapshot(draft, round, run.wave);
    lastPinned = snap; // before setState: the subscription fires synchronously and must recognise this write
    if (status && EMPTY_RE.test(status)) set({ status: null });
    useGame.setState({ run: { ...run, servedBoards: { ...(run.servedBoards ?? {}), [run.wave]: snap }, sandboxFoeWave: run.wave } });
  };

  const onGame = (): void => {
    if (!get().open || !get().draft) return;
    const run = useGame.getState().run;
    // The game left the sandbox: the run this draft was pinned into is gone, so close (forced — there is nothing
    // left to confirm against) and unsubscribe. Staying open would pin a stage round into the NEXT plain Scene
    // Builder launch.
    if (!run?.sandbox) return get().close(true);
    if (run.wave !== lastWave) return pinRound(); // a fight resolved: pin the selected round at the new wave
    const pin = authoredPin(run);
    if (pin && pin !== lastPinned) return get().syncFromPin(); // edited on the tavern row
    // Our pin vanished at the same wave (the rig was reset / relaunched): put it back.
    if (!pin && lastPinned) pinRound();
  };

  const load = async (n: number): Promise<void> => {
    const { stage, status } = await fetchStage(n);
    set({ stageNumber: n, saved: stage, draft: stage ? structuredClone(stage) : null, status });
    pinRound();
  };

  return {
    open: false,
    stageNumber: 1,
    saved: null,
    draft: null,
    round: 1,
    status: null,

    async openBuilder(n = 1) {
      unsubscribe?.();
      lastPinned = null;
      lastWave = null;
      set({ open: true, round: 1, status: null });
      unsubscribe = useGame.subscribe(onGame);
      await load(clamp(n, STAGES));
    },

    async selectStage(n, force = false) {
      if (!force && get().dirtyRounds().length > 0) {
        set({ status: 'Unsaved edits — save or discard them before switching stage' });
        return;
      }
      await load(clamp(n, STAGES));
    },

    selectRound(r) {
      set({ round: clamp(r, ROUNDS) });
      pinRound();
    },

    editDraft(fn) {
      const { draft } = get();
      if (!draft) return;
      set({ draft: fn(draft) });
      pinRound();
    },

    syncFromPin() {
      const { draft, round } = get();
      const pin = authoredPin(useGame.getState().run);
      if (!draft || !pin) return;
      lastPinned = pin;
      const prev = draft.rounds[round - 1];
      if (!prev) return;
      const next = snapshotToRound(pin, prev);
      if (roundsEqual(next, prev)) return;
      set({ draft: { ...draft, rounds: draft.rounds.map((r, i) => (i === round - 1 ? next : r)) } });
    },

    discard() {
      const { saved } = get();
      set({ draft: saved ? structuredClone(saved) : null });
      pinRound();
    },

    async save() {
      const { draft } = get();
      if (!draft) return;
      const issues = validateStage(draft);
      if (issues.length > 0) {
        set({ status: `Can't save: ${issues.join('; ')}` });
        return;
      }
      const stamped = stampForSave(draft);
      const res = await saveStage(stamped);
      if (!res.ok) {
        set({ status: `Save failed: ${res.error}` });
        return;
      }
      // Stamping only moves `cardVersion`, which the pinned board never carries — no re-pin needed.
      set({ saved: stamped, draft: structuredClone(stamped), status: `Saved stage ${stamped.number} → ${res.path}` });
    },

    close(force = false) {
      if (!force && get().dirtyRounds().length > 0) {
        set({ status: 'Unsaved edits — confirm to close and discard them' });
        return;
      }
      unsubscribe?.();
      unsubscribe = null;
      lastPinned = null;
      lastWave = null;
      set({ open: false, saved: null, draft: null, round: 1, status: null });
    },

    dirtyRounds() {
      const { draft, saved } = get();
      if (!draft || !saved) return [];
      const out: number[] = stageFieldsEqual(draft, saved) ? [] : [0];
      draft.rounds.forEach((r, i) => {
        const base = saved.rounds[i];
        if (!base || !roundsEqual(r, base)) out.push(i + 1);
      });
      return out;
    },
  };
});
