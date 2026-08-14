/**
 * BEAT CHOREOGRAPHER PR 16 — combat `Moment[]` → the timeline vocabulary (blueprint §8.2, §17).
 *
 * READ-ONLY, and deliberately so. Combat already has the strongest choreography in the game: attack contact,
 * summon withholding, step groups, cue scheduling, and a large regression suite. The blueprint is explicit
 * that the first combat milestone must ADAPT that runtime rather than replace it — *"Do not begin by rewriting
 * combat around recruit batches"* — because contact physics and GSAP ownership are exactly what a rewrite
 * would quietly break.
 *
 * So this module changes nothing about playback. It re-describes moments that ALREADY happened in the shared
 * vocabulary, which buys two things immediately:
 *
 *   1. Combat becomes inspectable on the same timeline as End of Turn — one mental model, not two.
 *   2. The ~200 classified-but-unobserved combat keys get a real source, so the coverage report can finally
 *      distinguish "combat does not narrate this" from "the probe never looked".
 *
 * What it does NOT do: emit `policyKey`s that gameplay did not stamp. A moment carries a card id and a kind,
 * not the factory identity a registry key needs, so most combat nodes are honestly identity-less until the
 * simulator itself is instrumented. Inventing a key here would recreate the exact trap PR 1 closed.
 */
import type { CombatEvent } from '@game/core';
import type { Moment } from '../../choreo/compile';
import type { MomentKind } from '../../choreo/kinds';
import type {
  NormalizedTimelineInput,
  PresentationMode,
  TimelineConsequenceNode,
  TimelineDiagnostic,
  TimelineSourceNode,
} from '../timelineTypes';

/**
 * Moment kind → the timing FAMILY it belongs to (blueprint §17.2). Families are what make a template reach a
 * whole class of moments at once, so an author tunes "deaths" rather than every death.
 */
export const FAMILY_BY_MOMENT: Record<MomentKind, string> = {
  attackExchange: 'attack',
  damage: 'damage',
  shieldPop: 'shield',
  shieldGain: 'keywordGrant',
  poisonTick: 'damage',
  venomSpent: 'keywordGrant',
  death: 'death',
  riseDeath: 'death',
  scCast: 'startOfCombat',
  scNarrate: 'reaction',
  summon: 'summon',
  buffWave: 'stats',
  reborn: 'reborn',
  ascend: 'stats',
  rally: 'rally',
  toHand: 'generatedCard',
  maxGold: 'resource',
  improve: 'improve',
  keyword: 'keywordGrant',
  keywordLost: 'keywordGrant',
  hpGrant: 'stats',
  spellProgress: 'improve',
  reveal: 'reveal',
  tribeAura: 'stats',
  questTrigger: 'quest',
  questComplete: 'quest',
};

/**
 * Which moments read as a REACTION to the beat before them rather than a beat of their own.
 *
 * `scNarrate` is the clearest case: it exists to explain a Start-of-Combat cast that just happened. Giving it
 * its own sequential slot is the fake-pause problem the compiler fixed for recruit — it should occur inside
 * the thing it is narrating.
 */
const REACTION_KINDS = new Set<MomentKind>(['scNarrate', 'shieldPop', 'poisonTick', 'venomSpent']);

/** The combat events a moment carries that are worth showing as consequences of it. */
const CONSEQUENCE_TYPES = new Set<CombatEvent['type']>([
  'dmg', 'buff', 'summon', 'death', 'improve', 'toHand', 'maxGold', 'keyword', 'shieldUp', 'rally', 'reveal',
]);

/** A source label for a moment, preferring the unit it happened to. */
function sourceOf(primary: CombatEvent): { id: string; uid?: string; side?: 'player' | 'enemy' } {
  const p = primary as { source?: string; target?: string; attacker?: string; side?: 'player' | 'enemy' };
  const uid = p.source ?? p.attacker ?? p.target;
  return { id: uid ?? primary.type, uid, side: p.side };
}

export interface CombatAdapterOptions {
  /** uid → cardId for the whole fight, so a node can name the CARD rather than an opaque uid. */
  cardIdOf?: (uid: string) => string | null;
  /** Absolute ms each moment began, when the caller has measured them. Display-only. */
  startedAtMs?: (momentIndex: number) => number | undefined;
}

/**
 * Adapt compiled combat moments into normalized timeline nodes.
 *
 * Ordering and grouping come straight from the existing pipeline — this reads `Moment.stepGroups` and the
 * moment order as authoritative rather than re-deriving them, because the combat engine's ordering is the
 * gameplay truth and second-guessing it here is how presentation and simulation drift apart.
 */
export function adaptCombatMoments(
  moments: readonly Moment[],
  events: readonly CombatEvent[],
  options: CombatAdapterOptions = {},
): NormalizedTimelineInput {
  const diagnostics: TimelineDiagnostic[] = [];
  const nodes: TimelineSourceNode[] = [];
  let lastRootId: string | undefined;

  moments.forEach((moment, index) => {
    const family = FAMILY_BY_MOMENT[moment.kind] ?? 'combat';
    const src = sourceOf(moment.primary);
    const cardId = src.uid ? options.cardIdOf?.(src.uid) ?? undefined : undefined;
    const isReaction = REACTION_KINDS.has(moment.kind);

    const consequences: TimelineConsequenceNode[] = [];
    for (const group of moment.stepGroups) {
      for (const i of group) {
        const e = events[i];
        if (!e || e === moment.primary || !CONSEQUENCE_TYPES.has(e.type)) continue;
        const target = (e as { target?: string }).target;
        consequences.push({
          id: `combat:c:${index}:${i}`,
          kind: e.type,
          sequence: i,
          // Contact is the anchor a damage number belongs on; everything else lands on the source's delivery.
          deliveryKey: e.type === 'dmg' ? 'attack.contact' : 'primary',
          targetRefs: target ? [{ zone: 'board', uid: target }] : [],
          payload: e,
          runtimeRef: e,
        });
      }
    }

    const node: TimelineSourceNode = {
      id: `combat:m:${index}`,
      phase: 'combat',
      source: {
        kind: 'minion',
        id: cardId ?? src.id,
        uid: src.uid,
        side: src.side,
        label: cardId ?? moment.kind,
      },
      trigger: moment.kind,
      // NO policyKey. A moment carries a card id and a kind, not the factory identity a registry key needs.
      // Inventing one would be the very trap PR 1 closed — a plausible-but-wrong key that resolves to the
      // wrong timing with no error anywhere. The diagnostic below says so out loud.
      family,
      emittedPolicy: (isReaction ? 'reactInsideParent' : 'ownBeat') as PresentationMode,
      step: index,
      sequence: index,
      // A reaction hangs off the previous ROOT, which is the moment it is reacting to.
      parentId: isReaction ? lastRootId : undefined,
      dependencyIds: [],
      repeat: undefined,
      consequences,
      runtimeAdapter: 'combatMoment',
      runtimeRef: moment,
    };
    if (!isReaction) lastRootId = node.id;
    nodes.push(node);
  });

  if (nodes.length) {
    diagnostics.push({
      severity: 'info',
      code: 'missingPolicyKey',
      message:
        `${nodes.length} combat moments adapted for DISPLAY. They carry no policyKey because the simulator does ` +
        'not stamp one yet, so they resolve on family/mode timing only and cannot be tuned per source. ' +
        'Instrumenting the simulator is what turns these into authorable beats.',
    });
  }

  return { phase: 'combat', id: 'combat:adapted', nodes, diagnostics };
}
