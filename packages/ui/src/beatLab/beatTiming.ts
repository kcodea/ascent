/**
 * BEAT SYSTEM PR 7 — the beat-timing layer: shipped defaults + a specificity-ordered override resolver.
 *
 * Timing for a beat resolves through a fallback chain (blueprint §14.2), most-specific first:
 *   1. `source:<kind>:<id>:<trigger>` — one exact card/rune/quest trigger (make ONE thing more deliberate)
 *   2. `family:<family>`              — a registry timing family ('avenge', 'castPayoff', …)
 *   3. `trigger:<trigger>`            — every 'endOfTurn', every 'onPlay', …
 *   4. `policy:<policy>`              — the per-policy shipped defaults (ownBeat holds, foldedCue barely does)
 *   5. global fallback
 * Overrides are SPARSE patches — a draft that sets only `holdMs` inherits the rest from the next level down.
 *
 * Shipped defaults reproduce the PR-6 player exactly (equivalence first, tuning after — blueprint §14.3).
 * Drafts live in the Beat Lab store, session-only, never auto-active on load (the old pacing-tuner failure).
 */
import type { PresentationPolicy, SourceTriggerEvent } from '@game/core';
import { presentationPolicyFor } from '@game/core';

export interface BeatTiming {
  windupMs: number;
  holdMs: number;
  recoveryMs: number;
}
export type BeatTimingPatch = Partial<BeatTiming>;

/** Shipped per-policy defaults — identical to the PR-6 player's DEFAULT_TIMING (behavior-preserving). */
export const POLICY_TIMING: Record<PresentationPolicy, BeatTiming> = {
  ownBeat: { windupMs: 120, holdMs: 420, recoveryMs: 170 },
  foldedCue: { windupMs: 0, holdMs: 160, recoveryMs: 60 },
  passive: { windupMs: 0, holdMs: 0, recoveryMs: 0 },
  intentionallySilent: { windupMs: 0, holdMs: 0, recoveryMs: 0 },
};

export const GLOBAL_TIMING: BeatTiming = POLICY_TIMING.ownBeat;

/** Sparse override map, keyed by the specificity chain's key strings. */
export type BeatTimingOverrides = Record<string, BeatTimingPatch>;

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

/**
 * Resolve one beat's effective timing: start from the per-policy shipped default (then global), then merge
 * sparse overrides from LEAST to MOST specific so the most specific field wins.
 */
export function resolveBeatTiming(
  t: Pick<SourceTriggerEvent, 'source' | 'trigger' | 'policy'>,
  overrides: BeatTimingOverrides = {},
): BeatTiming {
  const base = POLICY_TIMING[t.policy] ?? GLOBAL_TIMING;
  let out: BeatTiming = { ...base };
  const chain = timingKeysFor(t);
  for (let i = chain.length - 1; i >= 0; i--) {
    const patch = overrides[chain[i]!];
    if (patch) out = { ...out, ...patch };
  }
  return out;
}

/** Which override key actually supplies each field (for the inspector's "inherited from" readout). */
export function timingProvenance(
  t: Pick<SourceTriggerEvent, 'source' | 'trigger' | 'policy'>,
  overrides: BeatTimingOverrides = {},
): Record<keyof BeatTiming, string> {
  const chain = timingKeysFor(t);
  const prov: Record<keyof BeatTiming, string> = {
    windupMs: `policy:${t.policy}`, holdMs: `policy:${t.policy}`, recoveryMs: `policy:${t.policy}`,
  };
  for (let i = chain.length - 1; i >= 0; i--) {
    const patch = overrides[chain[i]!];
    if (!patch) continue;
    for (const f of ['windupMs', 'holdMs', 'recoveryMs'] as const) if (patch[f] !== undefined) prov[f] = chain[i]!;
  }
  return prov;
}
