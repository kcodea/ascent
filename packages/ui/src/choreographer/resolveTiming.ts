/**
 * BEAT CHOREOGRAPHER PR 2 — timing resolution (blueprint §9, §10).
 *
 * One job: given a normalized node and the authored config, produce a COMPLETE `ResolvedBeatConfig` plus
 * field-level provenance. Two properties matter more than anything else here:
 *
 *   1. **Sparse merge.** Resolution is per FIELD, not per key. A source override that sets only
 *      `completionOffsetMs` inherits delivery from its family and recovery from its policy. Whole-object
 *      "most specific wins" would silently discard the family's careful pacing.
 *   2. **Provenance.** Every field records WHICH key supplied it, so the inspector can say "inherited from the
 *      Echo family" instead of showing a number with no explanation. Without this the owner cannot tell a
 *      deliberate tune from an accidental default — the exact confusion this pivot exists to end.
 *
 * The v1 → v2 mapping (§9.4) is deliberately lossless: `delivery = windup`, `completion = windup + hold`,
 * `recovery = recovery`. Migrating must not re-feel the game; families get tuned deliberately, later.
 */
import type {
  AuthoredBeatConfig,
  BeatProvenance,
  PresentationMode,
  ResolvedBeatConfig,
  TimelineSourceNode,
} from './timelineTypes';

/** The authored file's shape (`beat-defaults.json` v2). Templates are family/policy/trigger-level defaults. */
export interface BeatConfigSnapshot {
  version: 2;
  templates: Record<string, AuthoredBeatConfig>;
  overrides: Record<string, AuthoredBeatConfig>;
  /** Reclassification: force a source into a different presentation mode than gameplay emitted. */
  policies?: Record<string, PresentationMode>;
  /** Identifies this config for cache/staleness checks. */
  revision?: string;
}

export const EMPTY_CONFIG: BeatConfigSnapshot = { version: 2, templates: {}, overrides: {} };

/**
 * The floor every beat starts from, per mode. These reproduce the SHIPPED v1 per-policy pacing exactly
 * (ownBeat 120/420/170 → delivery 120, completion 540, recovery 170; foldedCue 0/160/60), so the migration is
 * a re-expression, not a re-tuning.
 */
export const MODE_DEFAULTS: Record<PresentationMode, ResolvedBeatConfig> = {
  ownBeat: {
    mode: 'ownBeat',
    anchor: { kind: 'afterPreviousBeat', offsetMs: 0 },
    deliveryOffsetMs: 120,
    completionOffsetMs: 540,
    recoveryMs: 170,
    targetStaggerMs: 45,
    repeatMode: 'full',
    repeatGapMs: 0,
    deliveryMarkers: {},
  },
  reactInsideParent: {
    mode: 'reactInsideParent',
    // A reaction hangs off its parent's DELIVERY: Oona reacts when the summon actually lands, not when the
    // parent beat began. This is what makes folded cues read as "inside" rather than "after".
    anchor: { kind: 'atParentDelivery', offsetMs: 0 },
    deliveryOffsetMs: 0,
    completionOffsetMs: 160,
    recoveryMs: 60,
    targetStaggerMs: 35,
    repeatMode: 'compressed',
    repeatGapMs: 0,
    deliveryMarkers: {},
  },
  simultaneous: {
    mode: 'simultaneous',
    anchor: { kind: 'afterPreviousBeat', offsetMs: 0 },
    deliveryOffsetMs: 120,
    completionOffsetMs: 540,
    recoveryMs: 170,
    targetStaggerMs: 45,
    repeatMode: 'simultaneous',
    repeatGapMs: 0,
    deliveryMarkers: {},
  },
  silent: {
    mode: 'silent',
    anchor: { kind: 'afterPreviousBeat', offsetMs: 0 },
    deliveryOffsetMs: 0,
    completionOffsetMs: 0,
    recoveryMs: 0,
    targetStaggerMs: 0,
    repeatMode: 'counter',
    repeatGapMs: 0,
    deliveryMarkers: {},
  },
};

/**
 * The specificity chain, LEAST specific first (later keys win per field). Mirrors blueprint §10.1.
 *
 * Both a `templates` and an `overrides` lookup happen per key: templates hold family/policy-level defaults,
 * overrides hold hand-tuned exceptions. Overrides win at the same specificity — a source-level override should
 * beat a source-level template.
 */
export function timingKeysFor(node: TimelineSourceNode): string[] {
  const s = node.source;
  const keys = [
    'global',
    `policy:${node.emittedPolicy}`,
    `trigger:${node.trigger}`,
    ...(node.family ? [`family:${node.family}`] : []),
    `source:${s.kind}:${s.id}`,
    `source:${s.kind}:${s.id}:phase:${node.phase}`,
    `source:${s.kind}:${s.id}:phase:${node.phase}:trigger:${node.trigger}`,
  ];
  if (node.occurrenceKey) keys.push(`occurrence:${node.occurrenceKey}`);
  return keys;
}

/**
 * Resolve the presentation MODE. Gameplay's emitted policy is the baseline; an authored `policies` entry (the
 * folded ↔ own-beat reclassification) overrides it. Checked most-specific-first, unlike the field merge —
 * a mode is one indivisible choice, so there is nothing to merge.
 */
export function resolveMode(node: TimelineSourceNode, config: BeatConfigSnapshot, draft: Record<string, PresentationMode> = {}): { mode: PresentationMode; from: string } {
  const all = { ...config.policies, ...draft };
  const chain = timingKeysFor(node);
  for (let i = chain.length - 1; i >= 0; i--) {
    const mode = all[chain[i]];
    if (mode) return { mode, from: chain[i] };
  }
  // A `mode` set inside an authored timing patch also reclassifies (the inspector writes it there).
  for (let i = chain.length - 1; i >= 0; i--) {
    const patch = config.overrides[chain[i]] ?? config.templates[chain[i]];
    if (patch?.mode) return { mode: patch.mode, from: chain[i] };
  }
  return { mode: node.emittedPolicy, from: 'emitted' };
}

const FIELDS: (keyof AuthoredBeatConfig)[] = [
  'mode', 'anchor', 'deliveryOffsetMs', 'completionOffsetMs', 'recoveryMs', 'targetStaggerMs', 'repeatMode', 'repeatGapMs', 'deliveryMarkers',
];

export interface TimingResolution {
  value: ResolvedBeatConfig;
  provenance: BeatProvenance;
}

/**
 * Merge the chain field-by-field. `draft` is the tool's unsaved session edit and always wins — that is what
 * makes dragging feel immediate without touching the committed file.
 */
export function resolveTiming(
  node: TimelineSourceNode,
  config: BeatConfigSnapshot = EMPTY_CONFIG,
  draft: Record<string, AuthoredBeatConfig> = {},
  modeDraft: Record<string, PresentationMode> = {},
): TimingResolution {
  const { mode, from: modeFrom } = resolveMode(node, config, modeDraft);
  const base = MODE_DEFAULTS[mode];
  const value = { ...base, deliveryMarkers: { ...base.deliveryMarkers } } as ResolvedBeatConfig;
  const provenance = FIELDS.reduce((acc, f) => { acc[f] = `default:${mode}`; return acc; }, {} as BeatProvenance);
  provenance.mode = modeFrom;
  value.mode = mode;

  const apply = (patch: AuthoredBeatConfig | undefined, key: string): void => {
    if (!patch) return;
    for (const f of FIELDS) {
      if (f === 'mode') continue; // handled by resolveMode — never merged field-wise
      const v = patch[f];
      if (v === undefined) continue;
      if (f === 'deliveryMarkers') {
        // Markers MERGE rather than replace: a source adding one staged marker must not erase its family's.
        value.deliveryMarkers = { ...value.deliveryMarkers, ...(v as Record<string, number>) };
      } else {
        (value as Record<string, unknown>)[f] = v;
      }
      provenance[f] = key;
    }
  };

  for (const key of timingKeysFor(node)) {
    apply(config.templates[key], key);
    apply(config.overrides[key], key);
    apply(draft[key], `draft:${key}`);
  }
  return { value, provenance };
}

/**
 * Timing invariants (§9.3). Returns the reasons a config is illegal — the compiler clamps and reports rather
 * than throwing, because a bad number in a dev file must never softlock End Turn in production.
 */
export function timingViolations(c: ResolvedBeatConfig): string[] {
  const out: string[] = [];
  if (c.deliveryOffsetMs < 0) out.push('delivery is negative');
  if (c.completionOffsetMs < c.deliveryOffsetMs) out.push('completion is before delivery');
  if (c.recoveryMs < 0) out.push('recovery is negative');
  if (c.targetStaggerMs < 0) out.push('target stagger is negative');
  return out;
}

/** Clamp an illegal config into a legal one, preserving intent as far as possible. */
export function clampTiming(c: ResolvedBeatConfig): ResolvedBeatConfig {
  const deliveryOffsetMs = Math.max(0, c.deliveryOffsetMs);
  return {
    ...c,
    deliveryOffsetMs,
    completionOffsetMs: Math.max(deliveryOffsetMs, c.completionOffsetMs),
    recoveryMs: Math.max(0, c.recoveryMs),
    targetStaggerMs: Math.max(0, c.targetStaggerMs),
  };
}

/** v1 (`windup`/`hold`/`recovery`) → v2. Explicit, never applied automatically on load (§9.4). */
export function migrateV1Patch(v1: { windupMs?: number; holdMs?: number; recoveryMs?: number }): AuthoredBeatConfig {
  const out: AuthoredBeatConfig = {};
  if (v1.windupMs !== undefined) out.deliveryOffsetMs = v1.windupMs;
  if (v1.holdMs !== undefined) out.completionOffsetMs = (v1.windupMs ?? 0) + v1.holdMs;
  if (v1.recoveryMs !== undefined) out.recoveryMs = v1.recoveryMs;
  return out;
}
