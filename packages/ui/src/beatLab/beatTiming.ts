/**
 * BEAT SYSTEM — the Beat Lab's config-file layer (slimmed in CHOREOGRAPHER PR 18).
 *
 * This module used to carry a full v1 timing RESOLVER (`resolveBeatTiming`, `POLICY_TIMING`, provenance) —
 * a second engine beside the live compiler, which is exactly the "lab shows what the game won't play" drift
 * the pivot exists to end. The resolver is gone: every Lab preview now schedules through
 * `labSchedule.ts` → `compileTimeline`, the same engine and committed config live playback uses.
 *
 * What remains here is the file/draft plumbing the editor still needs:
 *   - the editor's v1 vocabulary types (wind-up / hold / recovery — the owner's plain-words dials);
 *   - reading `beat-defaults.json` back into that vocabulary (v2 → v1 on the way IN);
 *   - field-level draft merging for the Commit button;
 *   - the v1 key grammar (`timingKeysFor`) that edit keys are written in.
 */
import type { PresentationPolicy, SourceTriggerEvent } from '@game/core';
import { presentationPolicyFor } from '@game/core';
import beatDefaults from './beat-defaults.json';

export interface BeatTiming {
  windupMs: number;
  holdMs: number;
  recoveryMs: number;
}
export type BeatTimingPatch = Partial<BeatTiming>;

/** Sparse override map, keyed by the specificity chain's key strings. */
export type BeatTimingOverrides = Record<string, BeatTimingPatch>;

/** Committed, source-controlled timing overrides (PR 8b) — `beat-defaults.json`, written by the Beat Lab's
 *  "Commit to repo" button. Applied UNDER the session draft so a committed tune becomes the shipped baseline
 *  everywhere `resolveBeatTiming` is read. Empty until the owner commits something. */
/**
 * CHOREOGRAPHER PR 12 — read whichever format is on disk.
 *
 * `beat-defaults.json` is now a v2 file (delivery / completion), because that is what the live compiler reads.
 * This editor still thinks in v1 (windup / hold), so a v2 file has to be converted back on the way IN — read
 * only for `timings`, the Lab would show an empty editor over a file full of committed values, and the next
 * commit would look like a reset.
 *
 * The inverse of the documented migration: windup = delivery, hold = completion - delivery.
 */
export function readShippedOverrides(raw: unknown): BeatTimingOverrides {
  const f = raw as { version?: number; timings?: BeatTimingOverrides; overrides?: Record<string, { deliveryOffsetMs?: number; completionOffsetMs?: number; recoveryMs?: number }> };
  if (f?.version === 2) {
    const out: BeatTimingOverrides = {};
    for (const [key, patch] of Object.entries(f.overrides ?? {})) {
      const windupMs = patch.deliveryOffsetMs;
      const holdMs = patch.completionOffsetMs !== undefined ? patch.completionOffsetMs - (patch.deliveryOffsetMs ?? 0) : undefined;
      out[key] = {
        ...(windupMs !== undefined ? { windupMs } : {}),
        ...(holdMs !== undefined ? { holdMs } : {}),
        ...(patch.recoveryMs !== undefined ? { recoveryMs: patch.recoveryMs } : {}),
      };
    }
    return out;
  }
  return f?.timings ?? {};
}

export const SHIPPED_OVERRIDES: BeatTimingOverrides = readShippedOverrides(beatDefaults);

/** Sparse POLICY overrides (the policy toggle) — reclassify a source's beat, e.g. Re-Pete's hero power from
 *  `foldedCue` to `ownBeat` so it reads as its own paused moment. Keyed by the same specificity chain as
 *  timings; committed to `beat-defaults.json` `.policies`. Drives the base timing (ownBeat holds, foldedCue
 *  barely does) and the effective-policy display everywhere `resolveBeatTiming`/`resolvePolicy` is read. */
export type BeatPolicyOverrides = Record<string, PresentationPolicy>;
export const SHIPPED_POLICY_OVERRIDES: BeatPolicyOverrides = (beatDefaults as { policies?: BeatPolicyOverrides }).policies ?? {};

/** Field-level merge of two sparse override maps (b wins per field). Used to layer the session draft over the
 *  committed defaults, and by the Commit button to fold a draft into the committed file. */
export function mergeOverrides(a: BeatTimingOverrides, b: BeatTimingOverrides): BeatTimingOverrides {
  const out: BeatTimingOverrides = { ...a };
  for (const [k, patch] of Object.entries(b)) out[k] = { ...out[k], ...patch };
  return out;
}

/** The specificity chain for one trigger event, most-specific first (registry family included when known). */
export function timingKeysFor(t: Pick<SourceTriggerEvent, 'source' | 'trigger' | 'policy'>): string[] {
  const keys = [`source:${t.source.kind}:${t.source.id}:${t.trigger}`];
  // The registry family, when this source has an entry (minion effects key by factory, so the source-id key
  // won't hit the registry — the family lookup below serves rune/quest ids; factory families arrive when the
  // batch carries them. Absent family just skips this level).
  const entry = presentationPolicyFor(`${t.source.kind === 'minion' ? 'factory' : t.source.kind}:${t.source.id}:${t.trigger}`)
    ?? presentationPolicyFor(`rune:${t.source.id}:${t.trigger}`)
    ?? presentationPolicyFor(`quest:${t.source.id}:${t.trigger}`);
  if (entry?.family) keys.push(`family:${entry.family}`);
  keys.push(`trigger:${t.trigger}`, `policy:${t.policy}`);
  return keys;
}
