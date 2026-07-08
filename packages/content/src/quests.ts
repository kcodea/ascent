import type { QuestDef } from '@game/core';
import { QuestDefSchema } from './schema';

/**
 * QUEST DATA — the SKINNY first pass: pure TEST quests, just enough to prove the framework end-to-end. Each
 * has a trivial objective (a recruit-action counter) and a flat board buff. There's exactly one per tribe +
 * neutral per tier, so the offer generator always has a neutral slot and ≥2 distinct tribe slots to draw
 * from, and every tribe has a quest at every tier (so the wave-8/12 "most-played tribe" guarantee resolves).
 *
 * `tribe: 'neutral'` is the build-agnostic slot offered every quest-turn. The remaining `Test ·` quests use
 * throwaway objectives (buy / play / sell / roll) and a flat board buff to exercise the tick routing. Real
 * content is landing tribe by tribe: the LESSER beast/dragon/undead quests below (Trail Rations, Warm Embers,
 * Grave Toll) are the first — meaningful `summon` / `shout` objectives and the richer reward palette (card
 * generation, delayed repeats, Shout-doubling). The rest grow the same way.
 */
export const QUEST_DEFS: QuestDef[] = [
  // ── Lesser (wave 4) ──
  { id: 'q_lesser_neutral', name: 'Test · Warm-Up', tribe: 'neutral', tier: 'lesser', objective: { event: 'buy', count: 2 }, reward: { kind: 'buffBoard', attack: 1, health: 1 } },
  // First REAL lesser content (replaces the throwaway beast/dragon/undead tests):
  { id: 'q_trail_rations', name: 'Trail Rations', tribe: 'beast', tier: 'lesser', objective: { event: 'summon', count: 3 }, reward: { kind: 'grant', randomTribe: 'beast', randomCount: 1, cards: ['emberpouch'], repeatInTurns: 2 } },
  { id: 'q_warm_embers', name: 'Warm Embers', tribe: 'dragon', tier: 'lesser', objective: { event: 'shout', count: 2 }, reward: { kind: 'shoutDouble', count: 2 } },
  { id: 'q_grave_toll', name: 'Grave Toll', tribe: 'undead', tier: 'lesser', objective: { event: 'summon', count: 4, tribe: 'undead' }, reward: { kind: 'grant', randomTribe: 'undead', randomCount: 1 } },
  { id: 'q_lesser_mech', name: 'Test · Test Bench', tribe: 'mech', tier: 'lesser', objective: { event: 'roll', count: 2 }, reward: { kind: 'buffBoard', attack: 1, health: 1 } },
  { id: 'q_lesser_demon', name: 'Test · First Rite', tribe: 'demon', tier: 'lesser', objective: { event: 'play', count: 2 }, reward: { kind: 'buffBoard', attack: 2, health: 0 } },

  // ── Greater (wave 8) ──
  { id: 'q_greater_neutral', name: 'Test · Steady Hand', tribe: 'neutral', tier: 'greater', objective: { event: 'buy', count: 3 }, reward: { kind: 'buffBoard', attack: 2, health: 2 } },
  { id: 'q_greater_beast', name: 'Test · Wild Hunt', tribe: 'beast', tier: 'greater', objective: { event: 'play', count: 3 }, reward: { kind: 'buffBoard', attack: 3, health: 2 } },
  { id: 'q_greater_dragon', name: 'Test · Sky Muster', tribe: 'dragon', tier: 'greater', objective: { event: 'play', count: 3 }, reward: { kind: 'buffBoard', attack: 2, health: 3 } },
  { id: 'q_greater_undead', name: 'Test · Reap', tribe: 'undead', tier: 'greater', objective: { event: 'sell', count: 3 }, reward: { kind: 'buffBoard', attack: 2, health: 2 } },
  { id: 'q_greater_mech', name: 'Test · Assembly', tribe: 'mech', tier: 'greater', objective: { event: 'roll', count: 3 }, reward: { kind: 'buffBoard', attack: 2, health: 2 } },
  { id: 'q_greater_demon', name: 'Test · Dark Pact', tribe: 'demon', tier: 'greater', objective: { event: 'play', count: 3 }, reward: { kind: 'buffBoard', attack: 3, health: 1 } },

  // ── Capstone (wave 12) ──
  { id: 'q_capstone_neutral', name: 'Test · Culmination', tribe: 'neutral', tier: 'capstone', objective: { event: 'buy', count: 4 }, reward: { kind: 'buffBoard', attack: 3, health: 3 } },
  { id: 'q_capstone_beast', name: 'Test · Alpha', tribe: 'beast', tier: 'capstone', objective: { event: 'play', count: 4 }, reward: { kind: 'buffBoard', attack: 4, health: 3 } },
  { id: 'q_capstone_dragon', name: 'Test · Ascendant', tribe: 'dragon', tier: 'capstone', objective: { event: 'play', count: 4 }, reward: { kind: 'buffBoard', attack: 3, health: 4 } },
  { id: 'q_capstone_undead', name: 'Test · Harvest', tribe: 'undead', tier: 'capstone', objective: { event: 'sell', count: 4 }, reward: { kind: 'buffBoard', attack: 3, health: 3 } },
  { id: 'q_capstone_mech', name: 'Test · Overclock', tribe: 'mech', tier: 'capstone', objective: { event: 'roll', count: 4 }, reward: { kind: 'buffBoard', attack: 3, health: 3 } },
  { id: 'q_capstone_demon', name: 'Test · Damnation', tribe: 'demon', tier: 'capstone', objective: { event: 'play', count: 4 }, reward: { kind: 'buffBoard', attack: 4, health: 2 } },
];

export const QUEST_INDEX: Record<string, QuestDef> = Object.fromEntries(
  QUEST_DEFS.map((q) => [q.id, q]),
);

/** Validate every quest against the schema + reject duplicate ids; throws on the first problem (mirrors
 *  `validateCards`). Run in `npm test` so a malformed test quest surfaces there, not at runtime. */
export function validateQuests(quests: QuestDef[] = QUEST_DEFS): void {
  const seen = new Set<string>();
  for (const q of quests) {
    QuestDefSchema.parse(q);
    if (seen.has(q.id)) throw new Error(`Duplicate quest id: ${q.id}`);
    seen.add(q.id);
  }
}
