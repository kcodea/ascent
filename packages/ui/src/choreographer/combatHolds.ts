/**
 * BEAT CHOREOGRAPHER PR 21 — combat consumes compiled timing, for KEYED triggers only (audit step 4).
 *
 * The first change that alters how a fight PLAYS, so its scope is deliberately the narrowest useful slice:
 *
 *   - Only `questTrigger` / `questComplete` moments — the quest/rune combat flags (Rune of Attacking Gems,
 *     King Oona's rune-granted kin). They carry a gameplay-stamped identity (`flag`), so their timing can be
 *     resolved honestly; everything else in a fight has no registry key and keeps its existing pacing.
 *   - Only the HOLD — the inter-beat pause `clock.holdMs` already owns. Attack contact, summon withholding
 *     and damage pacing are untouched (the blueprint's hard line, and the owner's: "what i will not do is
 *     change order of operations").
 *   - Behind an explicit dev flag, OFF by default: `localStorage.ascent.combatbeats = '1'`. Flag ON means
 *     keyed combat triggers pace from the Beat Lab's config — committed values, the LIVE session draft when
 *     enabled, and the mode defaults under both. Flag OFF is byte-identical to today.
 *
 * The store cannot be imported here (this module is reached from the choreo clock, which the store's own
 * combat-timeline composition transitively loads — a cycle). The LIVE draft arrives through an injected
 * provider instead, wired once at store setup.
 */
import { PRESENTATION_POLICIES } from '@game/core';
import { combatFlagOwner } from '@game/content';
import { shippedBeatConfig } from './beatConfig';
import { resolveTiming, type BeatConfigSnapshot } from './resolveTiming';
import { draftToEngine } from '../beatLab/labSchedule';
import type { BeatPolicyOverrides, BeatTimingOverrides } from '../beatLab/beatTiming';
import { modeForPolicy } from './adapters/presentationBatchAdapter';
import type { TimelineSourceNode } from './timelineTypes';

export interface LiveBeatDraft {
  timings: BeatTimingOverrides;
  policies: BeatPolicyOverrides;
}

let draftProvider: (() => LiveBeatDraft | null) | null = null;

/** Wired once by the store (DEV): lets the LIVE draft reach combat pacing without an import cycle. */
export function setCombatDraftProvider(fn: () => LiveBeatDraft | null): void {
  draftProvider = fn;
}

/** The dev opt-in. Read per call — it is one localStorage hit at beat cadence, and a stale cache here would
 *  mean "I flipped the flag and nothing changed", the exact confusion this project keeps paying down. */
export function combatBeatsEnabled(): boolean {
  try { return localStorage.getItem('ascent.combatbeats') === '1'; } catch { return false; }
}

/** The minimum of a combat event this needs: a quest/rune trigger carrying its flag. */
export interface KeyedPrimaryLike {
  type: string;
  flag?: string;
}

export interface CombatHoldOptions {
  /** Overridable for tests; defaults read the real flag / config / live draft. */
  enabled?: boolean;
  config?: BeatConfigSnapshot;
  draft?: LiveBeatDraft | null;
}

/**
 * The compiled HOLD for a keyed combat trigger, or null when this moment keeps its existing pacing.
 * Null means: flag off, not a quest/rune trigger, or a flag no content owns (never guess — PR 1's rule).
 */
export function combatKeyedHoldMs(primary: KeyedPrimaryLike, options: CombatHoldOptions = {}): number | null {
  const enabled = options.enabled ?? combatBeatsEnabled();
  if (!enabled) return null;
  if (primary.type !== 'questTrigger' && primary.type !== 'questComplete') return null;
  if (!primary.flag) return null;
  const owner = combatFlagOwner(primary.flag);
  if (!owner) return null;

  const entry = PRESENTATION_POLICIES[owner.key];
  // The node's trigger is the SURFACE's phase segment (`rune:X:combat` → 'combat'), NOT the event type.
  // The Library writes edit keys from the surface (`source:rune:X:combat`), so resolving on 'questTrigger'
  // here would mean an edit made through the actual UI never matches — found by walking the owner's real
  // path end to end rather than only the hand-crafted draft key.
  const surfaceTrigger = owner.key.split(':')[2] ?? primary.type;
  const node: TimelineSourceNode = {
    id: `hold:${primary.flag}`,
    phase: 'combat',
    source: { kind: owner.kind, id: owner.id },
    trigger: surfaceTrigger,
    policyKey: owner.key,
    family: entry?.family,
    emittedPolicy: modeForPolicy(entry?.policy ?? 'foldedCue'),
    step: 0,
    sequence: 0,
    dependencyIds: [],
    consequences: [],
    runtimeAdapter: 'combatMoment',
    runtimeRef: null,
  };

  const live = options.draft !== undefined ? options.draft : draftProvider?.() ?? null;
  const converted = live ? draftToEngine(live.timings, live.policies) : null;
  const { value } = resolveTiming(
    node,
    options.config ?? shippedBeatConfig(),
    converted?.draft ?? {},
    converted?.modeDraft ?? {},
  );
  // The full envelope (start → done) is the fight's pause for this beat. A silent-mode resolution means the
  // owner reclassified it to nothing — honor that as the minimum legible tick rather than a literal 0, so a
  // beat can be made quiet but the log line it anchors cannot be skipped entirely.
  return Math.max(40, value.completionOffsetMs);
}
