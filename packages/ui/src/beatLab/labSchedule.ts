/**
 * BEAT CHOREOGRAPHER PR 18 — the Beat Lab previews on the LIVE engine ("one engine").
 *
 * Until now the Lab previewed with its own v1 scheduler (`scheduleBeats` + `resolveBeatTiming`) while the
 * game played the shared compiler (`compileTimeline` + `resolveTiming`). Two engines is precisely the
 * "lab lies" failure the whole pivot exists to end — the Lab could show pacing (nesting, staggers, family
 * templates) the game would never play. This module is the ONLY way the Lab schedules anything now: it feeds
 * the same compiler live playback uses, with the same committed config, plus the session draft.
 *
 * The Lab's editor keeps its v1 vocabulary — wind-up / hold / recovery — because those are the owner's two
 * dials ("how long a trigger shows it proc'd") in plain words. The conversion to the engine's
 * delivery/completion terms happens HERE, via the same documented lossless mapping the config file uses
 * (delivery = windup, completion = windup + hold).
 */
import type { ConsequenceEvent, PresentationBatch, PresentationPolicy, SourceTriggerEvent } from '@game/core';
import { shippedBeatConfig } from '../choreographer/beatConfig';
import { compileTimeline } from '../choreographer/compileTimeline';
import { normalizePresentationBatch } from '../choreographer/adapters/presentationBatchAdapter';
import { migrateV1Patch } from '../choreographer/resolveTiming';
import type { AuthoredBeatConfig, CompiledBeat, CompiledTimeline, PresentationMode } from '../choreographer/timelineTypes';
import type { BeatPolicyOverrides, BeatTiming, BeatTimingOverrides } from './beatTiming';

/** The shape the Lab's views render — kept from v1 so the tree/strip/geometry stay untouched. */
export interface ScheduledBeat {
  id: string;
  trigger: SourceTriggerEvent;
  consequences: ConsequenceEvent[];
  startMs: number;
  /** When the consequence lands (the compiled DELIVERY marker). */
  consequenceMs: number;
  /** When the beat stops being the active one (compiled completion). */
  endMs: number;
  /** Completion + recovery. */
  nextMs: number;
}

export interface LabSchedule {
  beats: ScheduledBeat[];
  totalMs: number;
  /** Per-consequence landing times — STAGGERED, straight from the compiled deliveries. */
  consequenceAtMs: Map<string, number>;
  timeline: CompiledTimeline;
}

/** The editor's policy words → the engine's presentation modes. */
const MODE_BY_POLICY: Record<PresentationPolicy, PresentationMode> = {
  ownBeat: 'ownBeat',
  foldedCue: 'reactInsideParent',
  passive: 'silent',
  intentionallySilent: 'silent',
};

/** v1 session drafts → the engine's authored shape. Keys pass through — the v2 chain honors the v1 grammar. */
export function draftToEngine(draft: BeatTimingOverrides, policyDraft: BeatPolicyOverrides): {
  draft: Record<string, AuthoredBeatConfig>;
  modeDraft: Record<string, PresentationMode>;
} {
  const out: Record<string, AuthoredBeatConfig> = {};
  for (const [key, patch] of Object.entries(draft)) out[key] = migrateV1Patch(patch);
  const modeDraft: Record<string, PresentationMode> = {};
  for (const [key, policy] of Object.entries(policyDraft)) modeDraft[key] = MODE_BY_POLICY[policy] ?? 'ownBeat';
  return { draft: out, modeDraft };
}

/**
 * Schedule a batch exactly as live playback would, with the session draft layered on top.
 *
 * Note the honest consequence of "one engine": a folded cue now previews INSIDE its parent's window instead
 * of queueing sequentially, and committed family templates finally reach the preview — both are the live
 * behaviour the old scheduler could not show.
 */
export function labSchedule(
  batch: PresentationBatch,
  overrides: BeatTimingOverrides,
  policyOverrides: BeatPolicyOverrides = {},
): LabSchedule {
  const converted = draftToEngine(overrides, policyOverrides);
  const timeline = compileTimeline(normalizePresentationBatch(batch), {
    config: shippedBeatConfig(),
    draft: converted.draft,
    modeDraft: converted.modeDraft,
  });

  const consequenceAtMs = new Map<string, number>();
  const consByBeat = new Map<string, ConsequenceEvent[]>();
  for (const d of timeline.consequenceDeliveries) {
    consequenceAtMs.set(d.consequence.id, d.atMs);
    const list = consByBeat.get(d.beatId) ?? consByBeat.set(d.beatId, []).get(d.beatId)!;
    list.push(d.consequence.payload as ConsequenceEvent);
  }

  const beats: ScheduledBeat[] = timeline.beats.map((b) => ({
    id: b.nodeId,
    trigger: b.runtimeRef as SourceTriggerEvent,
    consequences: consByBeat.get(b.id) ?? [],
    startMs: b.startMs,
    consequenceMs: b.deliveryMs,
    endMs: b.completionMs,
    nextMs: b.recoveryEndMs,
  }));

  return { beats, totalMs: timeline.durationMs, consequenceAtMs, timeline };
}

/** The beat active at time `ms` (the last beat whose window has started), or -1 before the first. */
export function activeBeatIndex(beats: readonly ScheduledBeat[], ms: number): number {
  let idx = -1;
  for (let i = 0; i < beats.length; i++) {
    if (beats[i]!.startMs <= ms) idx = i;
    else break;
  }
  return idx;
}

export interface LabEffectiveTiming {
  timing: BeatTiming;
  /** Which config key supplied each editor field, in the engine's own provenance words. */
  prov: Record<keyof BeatTiming, string>;
  /** The effective presentation mode, for the policy dropdown. */
  mode: PresentationMode;
}

/**
 * The inspector's numeric fields, read FROM the compiled beat rather than from a second resolver — so the
 * numbers in the fields, the strip, the preview and the live game can only ever be the same numbers.
 */
export function labEffectiveTiming(beat: CompiledBeat): LabEffectiveTiming {
  const c = beat.config;
  return {
    timing: {
      windupMs: c.deliveryOffsetMs,
      holdMs: c.completionOffsetMs - c.deliveryOffsetMs,
      recoveryMs: c.recoveryMs,
    },
    prov: {
      windupMs: beat.provenance.deliveryOffsetMs,
      holdMs: beat.provenance.completionOffsetMs,
      recoveryMs: beat.provenance.recoveryMs,
    },
    mode: beat.mode,
  };
}

/** The engine's mode → the editor's policy word, preferring the registry's own word when it round-trips. */
export function modeToPolicyWord(mode: PresentationMode, registryPolicy?: PresentationPolicy): PresentationPolicy {
  if (registryPolicy && MODE_BY_POLICY[registryPolicy] === mode) return registryPolicy;
  switch (mode) {
    case 'ownBeat':
    case 'simultaneous':
      return 'ownBeat';
    case 'reactInsideParent':
      return 'foldedCue';
    case 'silent':
      return 'passive';
  }
}
