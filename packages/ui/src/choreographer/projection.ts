/**
 * BEAT CHOREOGRAPHER PR 4 — the presentation projection (blueprint §6).
 *
 * The prepared transaction (PR 3) already holds the FINAL End-of-Turn state. Rendering that directly would
 * make every number snap the instant End Turn is pressed — the exact "gameplay state becomes visible too
 * early" risk in §21. So the recruit scene keeps rendering `before`, and this projection layers the
 * consequences on top **as their delivery markers fire**.
 *
 * Two rules keep it from becoming a second gameplay model (the §25 trap):
 *
 *   1. It stores **visual deltas and previews only** — never a cloned `RunState`. There is nothing here to
 *      drift from gameplay because there is no gameplay here.
 *   2. It is a **pure fold**. Seeking backward rebuilds from zero by re-folding the deliveries up to the
 *      target time, so scrubbing can never leave a half-applied state.
 *
 * What it is NOT: a place to run effects. Applying a consequence to the projection mutates nothing outside
 * the returned object, and dispatches nothing.
 */
import type { ConsequenceEvent } from '@game/core';
import type { CompiledTimeline } from './timelineTypes';

export interface StatDelta { attack: number; health: number }

export interface ProjectedCardGrant {
  uid: string;
  cardId: string;
  /** Where it landed — 'hand' (a conjure/grant) or 'board' (a summon). Lets the UI show a board arrival on the
   *  board and a hand arrival in the hand, instead of conflating both into the hand preview. */
  zone: 'hand' | 'board';
  /** The consequence that produced it, so a presenter can anchor the arrival animation. */
  eventId: string;
  /** Board summons only: the slot the minion was inserted at (from the emitted consequence), so the ghost
   *  renders adjacent to its summoner during playback instead of appended right-most. Absent = append. */
  index?: number;
}

export interface PresentationProjection {
  deliveredEventIds: ReadonlySet<string>;
  boardStats: ReadonlyMap<string, StatDelta>;
  handStats: ReadonlyMap<string, StatDelta>;
  shopStats: ReadonlyMap<string, StatDelta>;
  keywordChanges: ReadonlyMap<string, ReadonlySet<string>>;
  grantedCards: readonly ProjectedCardGrant[];
  destroyedUids: ReadonlySet<string>;
  transformedCards: ReadonlyMap<string, string>;
  /** Deltas against the pre-action value: Gold, max Gold, upgrade cost, … */
  resources: ReadonlyMap<string, number>;
  /** Two-axis auras (spell power, imp aura) as accumulated deltas. */
  auras: ReadonlyMap<string, StatDelta>;
  counters: ReadonlyMap<string, number>;
  /** Rubies delivered per target uid, so the gem cascade fires with the right count. */
  rubies: ReadonlyMap<string, number>;
}

export const EMPTY_PROJECTION: PresentationProjection = {
  deliveredEventIds: new Set(),
  boardStats: new Map(),
  handStats: new Map(),
  shopStats: new Map(),
  keywordChanges: new Map(),
  grantedCards: [],
  destroyedUids: new Set(),
  transformedCards: new Map(),
  resources: new Map(),
  auras: new Map(),
  counters: new Map(),
  rubies: new Map(),
};

const bumpStat = (map: ReadonlyMap<string, StatDelta>, uid: string, attack: number, health: number): Map<string, StatDelta> => {
  const next = new Map(map);
  const cur = next.get(uid) ?? { attack: 0, health: 0 };
  next.set(uid, { attack: cur.attack + attack, health: cur.health + health });
  return next;
};
const bumpNum = (map: ReadonlyMap<string, number>, key: string, by: number): Map<string, number> => {
  const next = new Map(map);
  next.set(key, (next.get(key) ?? 0) + by);
  return next;
};

/**
 * Fold ONE consequence into the projection. Pure: returns a new projection, never mutates the input.
 *
 * An unknown consequence type is deliberately a no-op rather than an error — a new gameplay consequence must
 * never be able to break End Turn. It shows up as a coverage gap (no presenter), which is the honest place
 * for it, instead of as a crash mid-animation.
 */
export function applyConsequenceToProjection(
  projection: PresentationProjection,
  c: ConsequenceEvent,
): PresentationProjection {
  if (projection.deliveredEventIds.has(c.id)) return projection; // idempotent: a re-crossed marker changes nothing
  const delivered = new Set(projection.deliveredEventIds);
  delivered.add(c.id);
  const base = { ...projection, deliveredEventIds: delivered };

  switch (c.type) {
    case 'statsChanged': {
      const zone = c.target.zone;
      const uid = c.target.uid;
      if (!uid) return base;
      if (zone === 'hand') return { ...base, handStats: bumpStat(projection.handStats, uid, c.attack, c.health) };
      if (zone === 'shop' || zone === 'spellShop') return { ...base, shopStats: bumpStat(projection.shopStats, uid, c.attack, c.health) };
      return { ...base, boardStats: bumpStat(projection.boardStats, uid, c.attack, c.health) };
    }
    case 'shopChanged': {
      const uid = c.target.uid;
      if (!uid) return base;
      if (c.change === 'consumed' || c.change === 'destroyed') {
        const gone = new Set(projection.destroyedUids);
        gone.add(uid);
        return { ...base, destroyedUids: gone };
      }
      return { ...base, shopStats: bumpStat(projection.shopStats, uid, c.attack ?? 0, c.health ?? 0) };
    }
    case 'keywordChanged': {
      const uid = c.target.uid;
      if (!uid) return base;
      const next = new Map(projection.keywordChanges);
      const cur = new Set(next.get(uid) ?? []);
      if (c.gained) cur.add(c.keyword); else cur.delete(c.keyword);
      next.set(uid, cur);
      return { ...base, keywordChanges: next };
    }
    case 'cardGranted':
      return {
        ...base,
        grantedCards: [...projection.grantedCards, { uid: c.target.uid ?? c.id, cardId: c.cardId, zone: 'hand', eventId: c.id }],
      };
    case 'echoFired':
      return base; // the fire itself changes no projected state — its effects arrive as their own consequences
    case 'cardSummoned':
      // A summon is a BOARD arrival — tagged so the UI shows it on the board, not in the hand preview.
      // `index` rides through so the ghost renders in its committed slot (adjacent to its summoner).
      return {
        ...base,
        grantedCards: [...projection.grantedCards, { uid: c.target.uid ?? c.id, cardId: c.cardId, zone: 'board', eventId: c.id, ...(c.index !== undefined ? { index: c.index } : {}) }],
      };
    case 'cardDestroyed': {
      const gone = new Set(projection.destroyedUids);
      if (c.target.uid) gone.add(c.target.uid);
      return { ...base, destroyedUids: gone };
    }
    case 'cardTransformed': {
      if (!c.target.uid) return base;
      const next = new Map(projection.transformedCards);
      next.set(c.target.uid, c.toCardId);
      return { ...base, transformedCards: next };
    }
    case 'resourceChanged':
      return { ...base, resources: bumpNum(projection.resources, c.resource, c.amount) };
    case 'counterChanged':
      return { ...base, counters: bumpNum(projection.counters, c.counter, c.amount) };
    case 'auraChanged': {
      const next = new Map(projection.auras);
      const cur = next.get(c.aura) ?? { attack: 0, health: 0 };
      // Single-axis auras carry only `amount`; two-axis ones carry both parts.
      next.set(c.aura, { attack: cur.attack + (c.attack ?? c.amount), health: cur.health + (c.health ?? 0) });
      return { ...base, auras: next };
    }
    case 'rubyPlayed': {
      if (!c.target.uid) return base;
      // Rubies move BOTH channels: the gem cascade reads `rubies`, the numbers read the stat delta. Tracking
      // only the count meant the cascade played while the stats stayed frozen until commit.
      const withCount = { ...base, rubies: bumpNum(projection.rubies, c.target.uid, c.count) };
      if (!c.attack && !c.health) return withCount;
      const zone = c.target.zone;
      const bumped = bumpStat(zone === 'hand' ? projection.handStats : projection.boardStats, c.target.uid, c.attack ?? 0, c.health ?? 0);
      return zone === 'hand' ? { ...withCount, handStats: bumped } : { ...withCount, boardStats: bumped };
    }
    case 'fodderEaten': {
      // The eater's stat gain arrives as its own `statsChanged`; this records the DEPARTURE so the token
      // stops rendering the moment it is eaten rather than at commit.
      const gone = new Set(projection.destroyedUids);
      gone.add(`fodder:${c.fodderId}`);
      return { ...base, destroyedUids: gone };
    }
    default:
      return base; // spellResolved and anything new: no visual delta of its own
  }
}

/**
 * Rebuild the projection at an arbitrary time by folding every delivery at or before `ms`. Used for backward
 * seek and restart — cheaper to reason about than undoing, and batches are small enough that folding from
 * zero is imperceptible (§6.2). Deterministic: deliveries are already sorted by the compiler.
 */
export function projectionAt(timeline: CompiledTimeline, ms: number): PresentationProjection {
  let p = EMPTY_PROJECTION;
  for (const d of timeline.consequenceDeliveries) {
    if (d.atMs > ms) break;
    p = applyConsequenceToProjection(p, d.consequence.payload as ConsequenceEvent);
  }
  return p;
}

/** Convenience for tests + the hand-off check: the projection with everything delivered. */
export const finalProjection = (timeline: CompiledTimeline): PresentationProjection =>
  projectionAt(timeline, Number.POSITIVE_INFINITY);

/** Read helpers the render layer uses instead of scattering `?? 0` at every call site. */
export const projectedStat = (map: ReadonlyMap<string, StatDelta>, uid: string): StatDelta =>
  map.get(uid) ?? { attack: 0, health: 0 };
export const projectedResource = (p: PresentationProjection, resource: string, base: number): number =>
  base + (p.resources.get(resource) ?? 0);
