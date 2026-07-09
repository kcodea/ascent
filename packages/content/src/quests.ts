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
  // BEAST — the first fully authored tribe (owner spec 2026-07-08). Objectives span recruit + combat phases;
  // rewards span the full palette (grant / combat flags / persistent + scaling tribe auras / recurring grants).
  { id: 'q_forest_grove', name: 'Forest Grove', tribe: 'beast', tier: 'lesser', objective: { event: 'summon', count: 4, tribe: 'beast' }, reward: { kind: 'grant', randomTribe: 'beast', randomCount: 1, repeatInTurns: 2 } },
  { id: 'q_blood_trail', name: 'Blood Trail', tribe: 'beast', tier: 'lesser', objective: { event: 'slaughter', count: 2 }, reward: { kind: 'combatFlag', flag: 'bloodTrail' } },
  { id: 'q_den_marker', name: 'Den Marker', tribe: 'beast', tier: 'lesser', objective: { event: 'summonCombat', count: 5 }, reward: { kind: 'tribeAura', tribe: 'beast', attack: 3, health: 0 } },
  { id: 'q_foragers_trail', name: "Forager's Trail", tribe: 'beast', tier: 'lesser', objective: { event: 'buy', count: 4, tribe: 'beast' }, reward: { kind: 'grant', cards: ['trailforager'] } },
  // DRAGON — Shout / End-of-Turn / stat-growth engine. The keyword-based (not tribe-based) Dragon quests moved to
  // `neutral` (2026-07-08) — a Shout/EoT reward helps any build, not just Dragons.
  { id: 'q_hoard_spark', name: 'Hoard Spark', tribe: 'dragon', tier: 'lesser', objective: { event: 'buy', count: 3, tribe: 'dragon' }, reward: { kind: 'grant', randomTribe: 'dragon', randomCount: 1, randomSpell: 1 } },
  { id: 'q_coin_hoard', name: 'Coin Hoard', tribe: 'dragon', tier: 'lesser', objective: { event: 'spendGold', count: 12 }, reward: { kind: 'grant', cards: ['hoardwhelp'] } },
  { id: 'q_grave_toll', name: 'Grave Toll', tribe: 'undead', tier: 'lesser', objective: { event: 'summon', count: 4, tribe: 'undead' }, reward: { kind: 'grant', randomTribe: 'undead', randomCount: 1 } },
  // UNDEAD — the Echo (Deathrattle) engine. `deathrattle` = Echo TRIGGERS (scale with doublers); `friendlyDeath`
  // = raw DEATHS (don't). Keyword-based (Echo) quests are `neutral` (2026-07-08).
  { id: 'q_bone_ledger', name: 'Bone Ledger', tribe: 'undead', tier: 'lesser', objective: { event: 'friendlyDeath', count: 12 }, reward: { kind: 'gainGold', amount: 10 } },
  { id: 'q_grave_robber', name: 'Grave Robber', tribe: 'undead', tier: 'lesser', objective: { event: 'sell', count: 5 }, reward: { kind: 'grant', cards: ['cryptbroker'] } },
  // MECH — Attachment (Magnetic) + Rally engine (owner spec 2026-07-08). Tribe-specific quests (buy/sell/play
  // Mechs/Attachments) are `mech`; the keyword-only Rally quests are `neutral`.
  { id: 'q_assembly_line', name: 'Assembly Line', tribe: 'mech', tier: 'lesser', objective: { event: 'buy', count: 4, tribe: 'mech' }, reward: { kind: 'grant', cards: ['moneybot'], repeatInTurns: 2 } },
  { id: 'q_scrap_contract', name: 'Scrap Contract', tribe: 'mech', tier: 'lesser', objective: { event: 'sell', count: 3, tribe: 'mech' }, reward: { kind: 'grant', cards: ['scrapvendor'] } },
  // DEMON — the Fodder / Imp / Consume engine (owner spec 2026-07-08). `consumeFodder`/`consumeStats` count Fodder
  // Consumed; `summonImp` counts Imps summoned (combat + recruit).
  { id: 'q_imp_census', name: 'Imp Census', tribe: 'demon', tier: 'lesser', objective: { event: 'summonImp', count: 6 }, reward: { kind: 'grant', randomTribe: 'demon', randomCount: 1, repeatInTurns: 2 } },
  { id: 'q_small_offering', name: 'Small Offering', tribe: 'demon', tier: 'lesser', objective: { event: 'consumeFodder', count: 3 }, reward: { kind: 'fodderReward', fodder: 2, attack: 2, health: 2 } },
  { id: 'q_dark_bargain', name: 'Dark Bargain', tribe: 'demon', tier: 'lesser', objective: { event: 'sell', count: 5 }, reward: { kind: 'grant', cards: ['contractimp'] } },
  // NEUTRAL — the always-offered, build-agnostic slot: keyword-triggered quests (Shout / Echo / Rally) reassigned
  // from their tribes since they help ANY build with that keyword.
  { id: 'q_warm_embers', name: 'Warm Embers', tribe: 'neutral', tier: 'lesser', objective: { event: 'buy', count: 3, filter: 'shout' }, reward: { kind: 'shoutRepeat', scope: 'firstEachRound' } },
  { id: 'q_grave_contract', name: 'Grave Contract', tribe: 'neutral', tier: 'lesser', objective: { event: 'deathrattle', count: 4 }, reward: { kind: 'echoRepeat', scope: 'firstEachCombat' } },
  { id: 'q_spark_permit', name: 'Spark Permit', tribe: 'neutral', tier: 'lesser', objective: { event: 'rally', count: 3 }, reward: { kind: 'rallyRepeat', scope: 'firstEachCombat' } },

  // ── Greater (wave 8) ──
  { id: 'q_apex_hunt', name: 'Apex Hunt', tribe: 'beast', tier: 'greater', objective: { event: 'slaughter', count: 6, tribe: 'beast' }, reward: { kind: 'grant', cards: ['badgington'], grantKeywords: ['W', 'DS'] } },
  { id: 'q_pack_mentality', name: 'Pack Mentality', tribe: 'beast', tier: 'greater', objective: { event: 'summonCombat', count: 8, tribe: 'beast' }, reward: { kind: 'scalingTribeAura', tribe: 'beast', attack: 3, health: 1, per: 5, event: 'summonCombat', stepAttack: 3, stepHealth: 1 } },
  { id: 'q_trophy_den', name: 'Trophy Den', tribe: 'beast', tier: 'greater', objective: { event: 'attack', count: 9, tribe: 'beast' }, reward: { kind: 'grant', cards: ['trophystalker'] } },
  { id: 'q_feed_the_alpha', name: 'Feed the Alpha', tribe: 'beast', tier: 'greater', objective: { event: 'sell', count: 7 }, reward: { kind: 'recurringGrant', cards: ['feedalpha'] } },
  { id: 'q_echoing_roar', name: 'Echoing Roar', tribe: 'dragon', tier: 'greater', objective: { event: 'shout', count: 6 }, reward: { kind: 'recurringEndOfTurn', effect: 'triggerLeftmostShout' } },
  { id: 'q_skybound_pact', name: 'Skybound Pact', tribe: 'dragon', tier: 'greater', objective: { event: 'tribeStats', count: 80, tribe: 'dragon' }, reward: { kind: 'grant', cards: ['skybound'] } },
  { id: 'q_kingdom_of_bones', name: 'Kingdom of Bones', tribe: 'undead', tier: 'greater', objective: { event: 'friendlyDeath', count: 18 }, reward: { kind: 'grant', cards: ['bonetaxer'] } },
  { id: 'q_ossuary_rite', name: 'Ossuary Rite', tribe: 'undead', tier: 'greater', objective: { event: 'deathrattle', count: 10 }, reward: { kind: 'grant', cards: ['ossuaryrite'] }, repeatable: true },
  { id: 'q_perfect_machine', name: 'Perfect Machine', tribe: 'mech', tier: 'greater', objective: { event: 'playAttachment', count: 6 }, reward: { kind: 'grant', cards: ['perfectcore'] } },
  { id: 'q_blueprint_cache', name: 'Blueprint Cache', tribe: 'mech', tier: 'greater', objective: { event: 'playAttachment', count: 8 }, reward: { kind: 'recurringEndOfTurn', effect: 'grantRandomAttachments' } },
  { id: 'q_deep_hunger', name: 'Deep Hunger', tribe: 'demon', tier: 'greater', objective: { event: 'consumeFodder', count: 12 }, reward: { kind: 'combatFlag', flag: 'deepHunger' } },
  { id: 'q_contract_rewrite', name: 'Contract Rewrite', tribe: 'demon', tier: 'greater', objective: { event: 'spendGold', count: 25 }, reward: { kind: 'combatFlag', flag: 'contractRewrite' } },
  { id: 'q_implosion', name: 'Implosion', tribe: 'demon', tier: 'greater', objective: { event: 'summonImp', count: 11 }, reward: { kind: 'recurringGrant', cards: ['implosion'] } },
  // NEUTRAL greater: "get a random <keyword> minion" + the keyword doubler (owner spec 2026-07-08).
  { id: 'q_hoardwake_ritual', name: 'Hoardwake Ritual', tribe: 'neutral', tier: 'greater', objective: { event: 'shout', count: 10 }, reward: { kind: 'multi', rewards: [{ kind: 'grant', randomFilter: 'shout' }, { kind: 'shoutRepeat', scope: 'always' }] } },
  { id: 'q_last_rites', name: 'Last Rites', tribe: 'neutral', tier: 'greater', objective: { event: 'deathrattle', count: 14 }, reward: { kind: 'multi', rewards: [{ kind: 'grant', randomFilter: 'echo' }, { kind: 'echoRepeat', scope: 'firstEachCombat' }] } },
  { id: 'q_overclocked_core', name: 'Overclocked Core', tribe: 'neutral', tier: 'greater', objective: { event: 'rally', count: 12 }, reward: { kind: 'multi', rewards: [{ kind: 'grant', randomFilter: 'rally' }, { kind: 'rallyRepeat', scope: 'firstEachCombat' }] } },

  // ── Capstone (wave 12) ──
  { id: 'q_law_of_teeth', name: 'Law of Teeth', tribe: 'beast', tier: 'capstone', objective: { event: 'slaughter', count: 11, tribe: 'beast' }, reward: { kind: 'combatFlag', flag: 'lawOfTeeth' } },
  { id: 'q_the_old_hunt', name: 'The Old Hunt', tribe: 'beast', tier: 'capstone', objective: { event: 'attack', count: 15, tribe: 'beast' }, reward: { kind: 'combatFlag', flag: 'oldHunt', amount: 7 } },
  { id: 'q_taragosas_inheritance', name: "Taragosa's Inheritance", tribe: 'dragon', tier: 'capstone', objective: { event: 'tribeStats', count: 250, tribe: 'dragon' }, reward: { kind: 'grant', cards: ['taragosaheir'] } },
  { id: 'q_the_bone_throne', name: 'The Bone Throne', tribe: 'undead', tier: 'capstone', objective: { event: 'friendlyDeath', count: 30 }, reward: { kind: 'boneThrone', every: 7 } },
  { id: 'q_death_writes_twice', name: 'Death Writes Twice', tribe: 'undead', tier: 'capstone', objective: { event: 'deathrattle', count: 20 }, reward: { kind: 'grant', cards: ['gravetwin'] } },
  { id: 'q_shared_circuit', name: 'Shared Circuit', tribe: 'mech', tier: 'capstone', objective: { event: 'playAttachment', count: 14 }, reward: { kind: 'combatFlag', flag: 'sharedCircuit', amount: 3 } },
  { id: 'q_machine_chorus', name: 'Machine Chorus', tribe: 'mech', tier: 'capstone', objective: { event: 'rally', count: 20 }, reward: { kind: 'grant', cards: ['chorusengine'] } },
  { id: 'q_true_contract', name: 'The True Contract', tribe: 'demon', tier: 'capstone', objective: { event: 'consumeFodder', count: 20 }, reward: { kind: 'grant', cards: ['heraldapoc'] } },
  { id: 'q_pit_without_end', name: 'Pit Without End', tribe: 'demon', tier: 'capstone', objective: { event: 'summonImp', count: 40 }, reward: { kind: 'combatFlag', flag: 'pitWithoutEnd', amount: 3 } },
  { id: 'q_maw_of_the_run', name: 'Maw of the Run', tribe: 'demon', tier: 'capstone', objective: { event: 'consumeStats', count: 200 }, reward: { kind: 'grant', cards: ['runmaw'] } },
  // NEUTRAL capstone: the keyword-doubler + random-keyword-minion payoffs (owner spec 2026-07-08).
  { id: 'q_echoing_coop', name: 'Echoing Coop', tribe: 'neutral', tier: 'capstone', objective: { event: 'deathrattle', count: 11 }, reward: { kind: 'combatFlag', flag: 'echoingCoop' } },
  { id: 'q_the_hoard_wakes', name: 'The Hoard Wakes', tribe: 'neutral', tier: 'capstone', objective: { event: 'shout', count: 22 }, reward: { kind: 'multi', rewards: [{ kind: 'shoutRepeat', scope: 'always' }, { kind: 'recurringEndOfTurn', effect: 'grantRandomShout' }] } },
  { id: 'q_parliament_of_flame', name: 'Parliament of Flame', tribe: 'neutral', tier: 'capstone', objective: { event: 'endOfTurn', count: 14 }, reward: { kind: 'multi', rewards: [{ kind: 'grant', randomFilter: 'endOfTurn' }, { kind: 'endOfTurnRepeat' }] } },
  { id: 'q_funeral_engine', name: 'Funeral Engine', tribe: 'neutral', tier: 'capstone', objective: { event: 'deathrattle', count: 20 }, reward: { kind: 'multi', rewards: [{ kind: 'grant', randomFilter: 'echo', randomFilterExactTier: true }, { kind: 'echoRepeat', scope: 'always' }] } },
  { id: 'q_infinite_assembly', name: 'Infinite Assembly', tribe: 'neutral', tier: 'capstone', objective: { event: 'rally', count: 30 }, reward: { kind: 'multi', rewards: [{ kind: 'grant', randomFilter: 'rally' }, { kind: 'rallyRepeat', scope: 'always' }] } },
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
