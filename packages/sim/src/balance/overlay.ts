/**
 * CONTENT OVERLAYS — a candidate DATA patch for a `balance:compare` experiment (roadmap "Experiment identity and
 * isolation": "A data patch may use validated overlays where supported … Never mutate the checkout's content to
 * run a parameter sweep").
 *
 * An overlay is applied IN-PROCESS to the live card definitions before the job's identity is computed — each job
 * is its own process, so a baseline and a candidate never share a registry — and it is validated through the
 * content zod schema so an overlay can only produce a card the game could have shipped. Because
 * `contentDigest` hashes the live definitions in pool order, an applied overlay changes it truthfully; the
 * manifest digest carries the overlay text besides. Effect-CODE changes are NOT overlays: those need a separate
 * build (a different `engineRevision` / `effectDigest`).
 *
 * Shape (per card id): top-level numbers (`attack`, `health`, `tier`, `cost`) and `params` per effect index —
 * e.g. `{ "ce3_starseed": { "params": { "0": { "attack": 2, "health": 2 } } } }` halves Star Seed's buff.
 */
import { CARD_INDEX, CardDefSchema } from '@game/content';

export interface CardOverlay {
  attack?: number;
  health?: number;
  tier?: number;
  cost?: number;
  /** Effect index → param patch (merged over the existing params). */
  params?: Record<string, Record<string, number | string | boolean>>;
}
export type ContentOverlay = Record<string, CardOverlay>;

export interface OverlayApplied {
  cardId: string;
  before: string;
  after: string;
}

/** Apply `overlay` to the live definitions. Throws on an unknown card, an invalid result, or a re-application of
 *  the same id (an overlay is applied exactly once per process). Returns a human-readable diff per card. */
export function applyContentOverlay(overlay: ContentOverlay | undefined): OverlayApplied[] {
  if (!overlay) return [];
  const out: OverlayApplied[] = [];
  for (const [cardId, patch] of Object.entries(overlay)) {
    const def = CARD_INDEX[cardId];
    if (!def) throw new Error(`balance overlay: unknown card "${cardId}"`);
    if (APPLIED.has(cardId)) throw new Error(`balance overlay: "${cardId}" already overlaid in this process`);
    const before = summarize(def);
    const next = { ...def, effects: def.effects.map((e) => ({ ...e, params: e.params ? { ...e.params } : e.params })) };
    if (patch.attack !== undefined) next.attack = patch.attack;
    if (patch.health !== undefined) next.health = patch.health;
    if (patch.tier !== undefined) next.tier = patch.tier as typeof def.tier;
    if (patch.cost !== undefined) next.cost = patch.cost;
    for (const [idx, params] of Object.entries(patch.params ?? {})) {
      const i = Number(idx);
      const eff = next.effects[i];
      if (!eff) throw new Error(`balance overlay: "${cardId}" has no effect at index ${idx}`);
      eff.params = { ...(eff.params ?? {}), ...params };
    }
    CardDefSchema.parse(next); // the overlay can only produce a card the game could ship
    // Mutate the LIVE object in place: the pool arrays and every index share the same reference.
    Object.assign(def, next);
    APPLIED.add(cardId);
    out.push({ cardId, before, after: summarize(def) });
  }
  return out;
}

const APPLIED = new Set<string>();

function summarize(d: { attack: number; health: number; tier: number; cost?: number; effects: readonly { do: string; params?: unknown }[] }): string {
  return `${d.attack}/${d.health} T${d.tier}${d.cost !== undefined ? ` c${d.cost}` : ''} ${d.effects.map((e) => `${e.do}${e.params ? JSON.stringify(e.params) : ''}`).join(' ; ')}`;
}
