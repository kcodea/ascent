/**
 * BEAT CHOREOGRAPHER PR 2 — the shared timeline vocabulary (blueprint §8, §9, §11).
 *
 * These types are the contract between the four layers the pivot depends on:
 *
 *   gameplay events → ADAPTER → normalized nodes → COMPILER → CompiledTimeline → live player AND the tool
 *
 * The load-bearing idea: the compiler never touches a raw `PresentationBatch` or a combat `Moment[]`. Both are
 * normalized into `TimelineSourceNode` first, so ONE compiler serves every phase and the tool can never drift
 * from the live game by compiling something subtly different.
 *
 * Authored truth is RELATIVE (an anchor + offsets). Absolute milliseconds are compiler OUTPUT, never something
 * a human edits or a file stores — that is what keeps combat authoring from being brittle (§8.2).
 */
import type { PresentationPhase, TriggerSourceRef, ZoneTargetRef } from '@game/core';

/**
 * The four presentation modes the tool exposes (§7.4). Deliberately plain-language: the internal policy
 * vocabulary (`ownBeat` / `foldedCue` / `passive` / `intentionallySilent`) is an implementation detail the
 * owner should not have to learn. `foldedCue` maps to `reactInsideParent`; `passive`/`intentionallySilent`
 * both map to `silent` (they differ in gameplay meaning, not in presentation).
 */
export type PresentationMode = 'ownBeat' | 'reactInsideParent' | 'simultaneous' | 'silent';

/**
 * Where a beat starts, expressed against a MEANINGFUL moment rather than a wall-clock time. In combat an
 * absolute timestamp is worthless — the same Rally happens at a different millisecond every fight — so the
 * author says "at attack contact, +40ms" and the compiler resolves it per scenario.
 */
export type AnchorKind =
  | 'phaseStart'
  | 'afterPreviousBeat'
  | 'withParentActivation'
  | 'atParentDelivery'
  | 'atAttackContact'
  | 'afterDeathCompletes'
  | 'whenSummonAppears'
  | 'afterAllStartOfCombat';

export interface BeatAnchor {
  kind: AnchorKind;
  offsetMs?: number;
}

/** How a repeated activation (Chronos doubling End of Turn) presents. Gameplay still resolves each repeat. */
export type RepeatMode = 'full' | 'compressed' | 'simultaneous' | 'counter';

/**
 * What a human actually authors for a beat — SPARSE. Every field is optional because the resolver merges the
 * specificity chain field-by-field: a source override that only sets `completionOffsetMs` still inherits its
 * family's delivery and its policy's recovery.
 */
export interface AuthoredBeatConfig {
  mode?: PresentationMode;
  anchor?: BeatAnchor;
  /** When consequences become visible, relative to the beat's start. */
  deliveryOffsetMs?: number;
  /** When the beat has been readable long enough to proceed, relative to its start. */
  completionOffsetMs?: number;
  /** Optional spacing before the NEXT sequential beat. */
  recoveryMs?: number;
  /** Spacing between multiple targets of one consequence, so a 5-minion buff reads as a wave. */
  targetStaggerMs?: number;
  repeatMode?: RepeatMode;
  repeatGapMs?: number;
  /** Named sub-markers ('consume.depart', 'summon.appear') as offsets from the beat's start. */
  deliveryMarkers?: Record<string, number>;
}

/** A fully-resolved config — every field present, because the compiler cannot work with holes. */
export type ResolvedBeatConfig = Required<Omit<AuthoredBeatConfig, 'deliveryMarkers'>> & {
  deliveryMarkers: Record<string, number>;
};

/** Which key in the specificity chain supplied each field. Powers "Inherited from the Echo family". */
export type BeatProvenance = Record<keyof AuthoredBeatConfig, string>;

/** One consequence, phase-independent. */
export interface TimelineConsequenceNode {
  id: string;
  kind: string;
  sequence: number;
  /** Which of its source's markers delivers it; `primary` = the source's delivery marker. */
  deliveryKey: string;
  targetRefs: ZoneTargetRef[];
  payload: unknown;
  /** The original event, for the presenter that will render it. Opaque to the compiler. */
  runtimeRef: unknown;
}

/**
 * One source activation, phase-independent. Produced by an adapter; consumed by the compiler.
 *
 * `emittedPolicy` is what GAMEPLAY declared. The authored config may override the presentation mode, but the
 * emitted policy is preserved so diagnostics can say "you reclassified this" and so a reset is possible.
 */
export interface TimelineSourceNode {
  id: string;
  phase: PresentationPhase;
  source: TriggerSourceRef;
  trigger: string;
  /** The registry key gameplay stamped. Absent = un-migrated emitter → a diagnostic, never a guess. */
  policyKey?: string;
  family?: string;
  occurrenceKey?: string;
  emittedPolicy: PresentationMode;
  /** Authoritative coarse resolution boundary from the collector. Presentation may reorder only WITHIN a step. */
  step: number;
  sequence: number;
  parentId?: string;
  dependencyIds: string[];
  simultaneousGroupId?: string;
  repeat?: { index: number; count: number };
  consequences: TimelineConsequenceNode[];
  runtimeAdapter: 'presentationBatch' | 'combatMoment';
  runtimeRef: unknown;
}

export interface TimelineDiagnostic {
  severity: 'info' | 'warn' | 'error';
  /** Stable machine code, so the coverage matrix can group without parsing prose. */
  code:
    | 'missingPolicyKey'
    | 'missingFamily'
    | 'unknownParent'
    | 'unknownDependency'
    | 'dependencyCycle'
    | 'parentCycle'
    | 'decreasingStep'
    | 'phaseMismatch'
    | 'duplicateId'
    | 'orphanConsequence'
    | 'invalidTiming'
    | 'unknownAnchor';
  message: string;
  nodeId?: string;
}

export interface NormalizedTimelineInput {
  phase: PresentationPhase;
  /** Stable id for memoizing compilation (batch id + config revision). */
  id: string;
  nodes: TimelineSourceNode[];
  diagnostics: TimelineDiagnostic[];
}

export interface CompiledConsequenceDelivery {
  id: string;
  beatId: string;
  /** Absolute ms on the timeline — OUTPUT. Nothing authors this. */
  atMs: number;
  /** Position within its target group, so the player can stagger a wave deterministically. */
  staggerIndex: number;
  consequence: TimelineConsequenceNode;
}

export interface CompiledBeat {
  id: string;
  nodeId: string;
  parentBeatId?: string;
  mode: PresentationMode;
  /** Which lane the tool draws it in — a nested reaction never occupies a root row. */
  lane: 'source' | 'reaction';
  startMs: number;
  deliveryMs: number;
  completionMs: number;
  recoveryEndMs: number;
  source: TriggerSourceRef;
  trigger: string;
  family?: string;
  policyKey?: string;
  repeat?: { index: number; count: number; mode: RepeatMode };
  /** Resolved config + where each field came from, for the inspector. */
  config: ResolvedBeatConfig;
  provenance: BeatProvenance;
  runtimeRef: unknown;
}

export interface CompiledTimeline {
  id: string;
  phase: PresentationPhase;
  durationMs: number;
  beats: CompiledBeat[];
  consequenceDeliveries: CompiledConsequenceDelivery[];
  diagnostics: TimelineDiagnostic[];
  /** Identifies the config that produced these numbers, so a stale compile is detectable. */
  configRevision: string;
}
