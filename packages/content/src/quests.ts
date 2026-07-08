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
  // BEAST — the first fully authored tribe (owner spec 2026-07-08). Objectives span recruit + combat phases;
  // rewards span the full palette (grant / combat flags / persistent + scaling tribe auras / recurring grants).
  { id: 'q_forest_grove', name: 'Forest Grove', tribe: 'beast', tier: 'lesser', objective: { event: 'summon', count: 4, tribe: 'beast' }, reward: { kind: 'grant', randomTribe: 'beast', randomCount: 1, repeatInTurns: 2 } },
  { id: 'q_blood_trail', name: 'Blood Trail', tribe: 'beast', tier: 'lesser', objective: { event: 'slaughter', count: 2 }, reward: { kind: 'combatFlag', flag: 'bloodTrail' } },
  { id: 'q_den_marker', name: 'Den Marker', tribe: 'beast', tier: 'lesser', objective: { event: 'summonCombat', count: 5 }, reward: { kind: 'tribeAura', tribe: 'beast', attack: 3, health: 0 } },
  { id: 'q_foragers_trail', name: "Forager's Trail", tribe: 'beast', tier: 'lesser', objective: { event: 'buy', count: 4, tribe: 'beast' }, reward: { kind: 'grant', cards: ['trailforager'] } },
  // Other tribes — still first-pass TEST quests (fill the neutral + tribe offer slots until each tribe is authored).
  // DRAGON — the second fully authored tribe (owner spec 2026-07-08): Shout / End-of-Turn / stat-growth engine.
  { id: 'q_hoard_spark', name: 'Hoard Spark', tribe: 'dragon', tier: 'lesser', objective: { event: 'buy', count: 3, tribe: 'dragon' }, reward: { kind: 'grant', randomTribe: 'dragon', randomCount: 1, randomSpell: 1 } },
  { id: 'q_warm_embers', name: 'Warm Embers', tribe: 'dragon', tier: 'lesser', objective: { event: 'buy', count: 3, filter: 'shout' }, reward: { kind: 'shoutRepeat', scope: 'firstEachRound' } },
  { id: 'q_coin_hoard', name: 'Coin Hoard', tribe: 'dragon', tier: 'lesser', objective: { event: 'spendGold', count: 12 }, reward: { kind: 'grant', cards: ['hoardwhelp'] } },
  { id: 'q_grave_toll', name: 'Grave Toll', tribe: 'undead', tier: 'lesser', objective: { event: 'summon', count: 4, tribe: 'undead' }, reward: { kind: 'grant', randomTribe: 'undead', randomCount: 1 } },
  // UNDEAD — the third fully authored tribe (owner spec 2026-07-08): the Echo (Deathrattle) engine. Objectives
  // count Echo TRIGGERS (`deathrattle`, scales with Sylus/doublers) or raw friendly DEATHS (`friendlyDeath`, an
  // entity count that does NOT). Echo-doubler rewards stack ADDITIVELY with Sylus + each other.
  { id: 'q_grave_contract', name: 'Grave Contract', tribe: 'undead', tier: 'lesser', objective: { event: 'deathrattle', count: 4 }, reward: { kind: 'echoRepeat', scope: 'firstEachCombat' } },
  { id: 'q_bone_ledger', name: 'Bone Ledger', tribe: 'undead', tier: 'lesser', objective: { event: 'friendlyDeath', count: 12 }, reward: { kind: 'gainGold', amount: 10 } },
  { id: 'q_grave_robber', name: 'Grave Robber', tribe: 'undead', tier: 'lesser', objective: { event: 'sell', count: 5 }, reward: { kind: 'grant', cards: ['cryptbroker'] } },
  { id: 'q_lesser_mech', name: 'Test · Test Bench', tribe: 'mech', tier: 'lesser', objective: { event: 'roll', count: 2 }, reward: { kind: 'buffBoard', attack: 1, health: 1 } },
  { id: 'q_lesser_demon', name: 'Test · First Rite', tribe: 'demon', tier: 'lesser', objective: { event: 'play', count: 2 }, reward: { kind: 'buffBoard', attack: 2, health: 0 } },

  // ── Greater (wave 8) ──
  { id: 'q_greater_neutral', name: 'Test · Steady Hand', tribe: 'neutral', tier: 'greater', objective: { event: 'buy', count: 3 }, reward: { kind: 'buffBoard', attack: 2, health: 2 } },
  { id: 'q_apex_hunt', name: 'Apex Hunt', tribe: 'beast', tier: 'greater', objective: { event: 'slaughter', count: 6, tribe: 'beast' }, reward: { kind: 'grant', cards: ['badgington'], grantKeywords: ['W', 'DS'] } },
  { id: 'q_pack_mentality', name: 'Pack Mentality', tribe: 'beast', tier: 'greater', objective: { event: 'summonCombat', count: 8, tribe: 'beast' }, reward: { kind: 'scalingTribeAura', tribe: 'beast', attack: 3, health: 1, per: 5, event: 'summonCombat', stepAttack: 3, stepHealth: 1 } },
  { id: 'q_trophy_den', name: 'Trophy Den', tribe: 'beast', tier: 'greater', objective: { event: 'attack', count: 9, tribe: 'beast' }, reward: { kind: 'grant', cards: ['trophystalker'] } },
  { id: 'q_feed_the_alpha', name: 'Feed the Alpha', tribe: 'beast', tier: 'greater', objective: { event: 'sell', count: 7 }, reward: { kind: 'recurringGrant', cards: ['feedalpha'] } },
  { id: 'q_echoing_roar', name: 'Echoing Roar', tribe: 'dragon', tier: 'greater', objective: { event: 'shout', count: 6 }, reward: { kind: 'recurringEndOfTurn', effect: 'triggerLeftmostShout' } },
  { id: 'q_hoardwake_ritual', name: 'Hoardwake Ritual', tribe: 'dragon', tier: 'greater', objective: { event: 'shout', count: 10 }, reward: { kind: 'shoutRepeat', scope: 'always' } },
  { id: 'q_skybound_pact', name: 'Skybound Pact', tribe: 'dragon', tier: 'greater', objective: { event: 'tribeStats', count: 80, tribe: 'dragon' }, reward: { kind: 'grant', cards: ['skybound'] } },
  { id: 'q_last_rites', name: 'Last Rites', tribe: 'undead', tier: 'greater', objective: { event: 'deathrattle', count: 14 }, reward: { kind: 'echoRepeat', scope: 'firstEachCombat' } },
  { id: 'q_kingdom_of_bones', name: 'Kingdom of Bones', tribe: 'undead', tier: 'greater', objective: { event: 'friendlyDeath', count: 18 }, reward: { kind: 'grant', cards: ['bonetaxer'] } },
  { id: 'q_ossuary_rite', name: 'Ossuary Rite', tribe: 'undead', tier: 'greater', objective: { event: 'deathrattle', count: 10 }, reward: { kind: 'grant', cards: ['ossuaryrite'] }, repeatable: true },
  { id: 'q_greater_mech', name: 'Test · Assembly', tribe: 'mech', tier: 'greater', objective: { event: 'roll', count: 3 }, reward: { kind: 'buffBoard', attack: 2, health: 2 } },
  { id: 'q_greater_demon', name: 'Test · Dark Pact', tribe: 'demon', tier: 'greater', objective: { event: 'play', count: 3 }, reward: { kind: 'buffBoard', attack: 3, health: 1 } },

  // ── Capstone (wave 12) ──
  { id: 'q_capstone_neutral', name: 'Test · Culmination', tribe: 'neutral', tier: 'capstone', objective: { event: 'buy', count: 4 }, reward: { kind: 'buffBoard', attack: 3, health: 3 } },
  { id: 'q_law_of_teeth', name: 'Law of Teeth', tribe: 'beast', tier: 'capstone', objective: { event: 'slaughter', count: 11, tribe: 'beast' }, reward: { kind: 'combatFlag', flag: 'lawOfTeeth' } },
  { id: 'q_the_old_hunt', name: 'The Old Hunt', tribe: 'beast', tier: 'capstone', objective: { event: 'attack', count: 15, tribe: 'beast' }, reward: { kind: 'combatFlag', flag: 'oldHunt', amount: 7 } },
  { id: 'q_echoing_coop', name: 'Echoing Coop', tribe: 'beast', tier: 'capstone', objective: { event: 'deathrattle', count: 11 }, reward: { kind: 'combatFlag', flag: 'echoingCoop' } },
  { id: 'q_the_hoard_wakes', name: 'The Hoard Wakes', tribe: 'dragon', tier: 'capstone', objective: { event: 'shout', count: 22 }, reward: { kind: 'multi', rewards: [{ kind: 'shoutRepeat', scope: 'always' }, { kind: 'recurringEndOfTurn', effect: 'grantRandomShout' }] } },
  { id: 'q_parliament_of_flame', name: 'Parliament of Flame', tribe: 'dragon', tier: 'capstone', objective: { event: 'endOfTurn', count: 14 }, reward: { kind: 'endOfTurnRepeat' } },
  { id: 'q_taragosas_inheritance', name: "Taragosa's Inheritance", tribe: 'dragon', tier: 'capstone', objective: { event: 'tribeStats', count: 250, tribe: 'dragon' }, reward: { kind: 'grant', cards: ['taragosaheir'] } },
  { id: 'q_the_bone_throne', name: 'The Bone Throne', tribe: 'undead', tier: 'capstone', objective: { event: 'friendlyDeath', count: 30 }, reward: { kind: 'boneThrone', every: 7 } },
  { id: 'q_funeral_engine', name: 'Funeral Engine', tribe: 'undead', tier: 'capstone', objective: { event: 'deathrattle', count: 20 }, reward: { kind: 'echoRepeat', scope: 'always' } },
  { id: 'q_death_writes_twice', name: 'Death Writes Twice', tribe: 'undead', tier: 'capstone', objective: { event: 'deathrattle', count: 20 }, reward: { kind: 'grant', cards: ['gravetwin'] } },
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
