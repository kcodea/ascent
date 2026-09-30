/**
 * GAUNTLET PROGRESS — which stages this device has cleared, and what the stage-select slots show.
 *
 * Device-local for now (`localStorage`, like the other `ascent.*` keys); account storage layers on top of this
 * module's API later, so callers read progress ONLY through these functions. Every storage access is guarded:
 * private mode / blocked storage reads as "nothing cleared" and a failed write is dropped, never thrown.
 *
 * Rules (spec §1): stage 1 is always open, clearing N opens N+1. A stage is playable when it exists and is
 * `ready` — or, in a DEV build, when it is a `draft` with at least one non-empty round, so its author can test it.
 */
import { gauntletStage } from '@game/content';

export const GAUNTLET_LOCAL_KEY = 'ascent.gauntlet.local';

/** Every stage this device has cleared: sorted, unique, positive integers. [] when storage is empty or unreadable. */
export function clearedStages(): number[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(GAUNTLET_LOCAL_KEY); } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const ok = parsed.filter((n): n is number => Number.isInteger(n) && n > 0);
  return [...new Set(ok)].sort((a, b) => a - b);
}

/** Mark `stage` cleared. `firstClear` is true only the first time this device clears it. */
export function recordClear(stage: number): { firstClear: boolean } {
  const cleared = clearedStages();
  if (cleared.includes(stage)) return { firstClear: false };
  const next = [...cleared, stage].sort((a, b) => a - b);
  try { localStorage.setItem(GAUNTLET_LOCAL_KEY, JSON.stringify(next)); } catch { /* blocked storage: the clear still counts this session */ }
  return { firstClear: true };
}

/** Stage 1 is always open; any other stage opens once the stage before it is cleared. */
export function isStageUnlocked(stage: number, cleared: readonly number[] = clearedStages()): boolean {
  return stage === 1 || cleared.includes(stage - 1);
}

export type StageSlotState = 'locked' | 'available' | 'cleared' | 'soon' | 'draft';

/** Whether a run can start on `stage`: it exists and is `ready`, or (DEV only) a draft with a non-empty round. */
export function isStagePlayable(stage: number, dev: boolean): boolean {
  const s = gauntletStage(stage);
  if (!s) return false;
  if (s.status === 'ready') return true;
  return dev && s.rounds.some((r) => r.board.length > 0);
}

/** How the stage-select slot for `stage` reads. No playable data → `soon` (players never see a draft); then a
 *  DEV-playable draft reads `draft` REGARDLESS of unlock order, so its author can test stage 3 without clearing
 *  1–2; then `locked` unless unlocked; else `cleared` / `available`. */
export function stageSlotState(stage: number, opts: { dev: boolean; cleared: readonly number[] }): StageSlotState {
  if (!isStagePlayable(stage, opts.dev)) return 'soon';
  if (gauntletStage(stage)?.status === 'draft') return 'draft';
  if (!isStageUnlocked(stage, opts.cleared)) return 'locked';
  return opts.cleared.includes(stage) ? 'cleared' : 'available';
}
