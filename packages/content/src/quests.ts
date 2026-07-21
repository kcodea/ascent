import type { QuestDef } from '@game/core';
import { QuestDefSchema } from './schema';

/**
 * QUEST DATA — the full quest set (77 quests). Two quest turns per run — wave 5 (the "early" bucket: Lesser +
 * most Greater) and wave 11 (the "late" bucket: Capstones + a couple promoted Greater neutrals). Each quest
 * turn offers 4 (a neutral slot + 3 distinct-tribe slots, tier-bucketed); the player buys one. Objectives run
 * from simple recruit-action counters (buy / play / sell / roll / summon / shout) up to compound multi-part
 * goals, and rewards span flat board buffs, card generation, delayed repeats, keyword-doublers, Runeforge
 * trips, and more. Every tribe has quests in both buckets so the "most-played tribe" offer guarantee resolves.
 */
export const QUEST_DEFS: QuestDef[] = [
  // Turn buckets (owner 2026-07-13): `tier` still labels each quest's power band, but scheduling collapsed to
  // TWO quest turns — turn 5 (Lesser + Greater) and turn 11 (Capstone). Bucket is derived from `tier` (Capstone →
  // 11, else → 5); a quest sets `wave` explicitly only when it lands off that default (Umbral Energy + The Epic
  // Runeforge are Greater quests promoted into the turn-11 bucket). `questBucketFor` in @game/sim owns the mapping.
  // ── Lesser tier — turn-5 bucket ──
  // BEAST — the first fully authored tribe (owner spec 2026-07-08). Objectives span recruit + combat phases;
  // rewards span the full palette (grant / combat flags / persistent + scaling tribe auras / recurring grants).
  { id: 'q_forest_grove', name: 'Forest Grove', tribe: 'beast', tier: 'lesser', objective: { event: 'summon', count: 8, tribe: 'beast' }, reward: { kind: 'grant', randomTribe: 'beast', randomCount: 1 }, repeatable: true },
  { id: 'q_blood_trail', name: 'Blood Trail', tribe: 'beast', tier: 'lesser', objective: { event: 'buy', count: 5, tribe: 'beast' }, reward: { kind: 'combatFlag', flag: 'bloodTrail' } },
  { id: 'q_den_marker', name: 'Den Marker', tribe: 'beast', tier: 'lesser', objective: { event: 'spendGold', count: 27 }, reward: { kind: 'beastPlayBuff', attack: 2, health: 2, step: 2, per: 3 } },
  { id: 'q_foragers_trail', name: "Forager's Trail", tribe: 'beast', tier: 'lesser', objective: { event: 'attack', count: 10, tribe: 'beast' }, reward: { kind: 'grant', cards: ['trailforager'] } },
  // DRAGON — Shout / End-of-Turn / stat-growth engine. The keyword-based (not tribe-based) Dragon quests moved to
  // `neutral` (2026-07-08) — a Shout/EoT reward helps any build, not just Dragons.
  { id: 'q_hoard_spark', name: 'Hoard Spark', tribe: 'dragon', tier: 'lesser', objective: { event: 'buy', count: 4, tribe: 'dragon' }, reward: { kind: 'grant', randomTribe: 'dragon', randomCount: 1, randomSpell: 1 }, repeatable: true },
  { id: 'q_coin_hoard', name: 'Coin Hoard', tribe: 'dragon', tier: 'lesser', objective: { event: 'spendGold', count: 16 }, reward: { kind: 'grant', cards: ['hoardwhelp'] } },
  // UNDEAD — the Echo (Deathrattle) engine. `deathrattle` = Echo TRIGGERS (scale with doublers); `friendlyDeath`
  // = raw DEATHS (don't). Keyword-based (Echo) quests are `neutral` (2026-07-08).
  { id: 'q_bone_ledger', name: 'Bone Ledger', tribe: 'undead', tier: 'lesser', objective: { event: 'friendlyDeath', count: 9 }, reward: { kind: 'gainGold', amount: 12 } },
  { id: 'q_grave_robber', name: 'Grave Robber', tribe: 'undead', tier: 'lesser', objective: { event: 'sell', count: 6 }, reward: { kind: 'grant', cards: ['cryptbroker'] } },
  // MECH — Attachment (Magnetic) + Rally engine (owner spec 2026-07-08). Tribe-specific quests (buy/sell/play
  // Mechs/Attachments) are `mech`; the keyword-only Rally quests are `neutral`.
  { id: 'q_assembly_line', name: 'Assembly Line', tribe: 'mech', tier: 'lesser', objective: { event: 'buy', count: 4, tribe: 'mech' }, reward: { kind: 'combatFlag', flag: 'assemblyLine', amount: 4 } },
  { id: 'q_scrap_contract', name: 'Scrap Contract', tribe: 'mech', tier: 'lesser', objective: { event: 'sell', count: 5, tribe: 'mech' }, reward: { kind: 'grant', cards: ['scrapvendor'] }, repeatable: true },
  // DEMON — the Fodder / Imp / Consume engine (owner spec 2026-07-08). `consumeFodder`/`consumeStats` count Fodder
  // Consumed; `summonImp` counts Imps summoned (combat + recruit).
  { id: 'q_imp_census', name: 'Imp Census', tribe: 'demon', tier: 'lesser', objective: { event: 'summonImp', count: 4 }, reward: { kind: 'multi', rewards: [{ kind: 'grant', randomTribe: 'demon', randomCount: 1 }, { kind: 'impAura', attack: 1, health: 1 }] }, repeatable: true },
  { id: 'q_small_offering', name: 'Small Offering', tribe: 'demon', tier: 'lesser', objective: { event: 'consumeFodder', count: 8 }, reward: { kind: 'fodderReward', fodder: 1, attack: 1, health: 1 }, repeatable: true },
  { id: 'q_dark_bargain', name: 'Dark Bargain', tribe: 'demon', tier: 'lesser', objective: { event: 'sell', count: 8 }, reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['contractimp'] }, { kind: 'fodderReward', fodder: 1 }] }, repeatable: true },
  // NEUTRAL — the always-offered, build-agnostic slot: keyword-triggered quests (Shout / Echo / Rally) reassigned
  // from their tribes since they help ANY build with that keyword.
  { id: 'q_warm_embers', name: 'Warm Embers', tribe: 'neutral', tier: 'lesser', objective: { event: 'buy', count: 5, filter: 'shout' }, reward: { kind: 'shoutRepeat', scope: 'firstEachRound' } },
  { id: 'q_grave_contract', name: 'Grave Contract', tribe: 'neutral', tier: 'lesser', objective: { event: 'deathrattle', count: 7 }, reward: { kind: 'echoRepeat', scope: 'firstEachCombat' } },
  { id: 'q_spark_permit', name: 'Spark Permit', tribe: 'neutral', tier: 'lesser', objective: { event: 'castSpell', count: 10 }, reward: { kind: 'rallyRepeat', scope: 'firstEachCombat' } },
  // NEUTRAL "Rulebreaker" set (owner spec 2026-07-08): economy / spell / rule-bending payoffs.
  { id: 'q_shop_license', name: 'Shop License', tribe: 'neutral', tier: 'lesser', objective: { event: 'winRound', count: 2 }, reward: { kind: 'gainMaxGold', amount: 4 } },
  // Teleport Summit — the quest door to Tier 7. `reward.tier` is AUTHORED, so the reducer honours it as
  // written rather than clamping to the run's ceiling; that is what lets it reach Tier 7 with no rift active
  // (see the discover clamp in reducer.ts). Repeatable, so a buy-heavy run keeps opening the door.
  { id: 'q_teleport_summit', name: 'Teleport Summit', tribe: 'neutral', tier: 'greater', objective: { event: 'buy', count: 14 }, reward: { kind: 'discover', tier: 7 }, repeatable: true },
  { id: 'q_gilded_chance', name: 'Gilded Chance', tribe: 'neutral', tier: 'lesser', objective: { event: 'buy', count: 9 }, reward: { kind: 'grant', cards: ['goldcrafter'] } },
  { id: 'q_key_findings', name: 'Key Findings', tribe: 'neutral', tier: 'lesser', objective: { event: 'attack', count: 10 }, reward: { kind: 'grant', cards: ['keyfindings', 'keyfindings'] } },
  { id: 'q_odd_jobs', name: 'Odd Jobs', tribe: 'neutral', tier: 'lesser', objective: { event: 'slaughter', count: 8 }, reward: { kind: 'gainGold', amount: 10 } },
  { id: 'q_the_runeforge', name: 'The Runeforge', tribe: 'neutral', tier: 'lesser', objective: { event: 'buy', count: 9 }, reward: { kind: 'scheduleRuneforge', forge: 'basic', gold: 4 } },
  { id: 'q_spell_thesis', name: 'Spell Thesis', tribe: 'neutral', tier: 'lesser', objective: { event: 'buy', count: 7 }, reward: { kind: 'spellRepeat', scope: 'firstEachTurn' } },

  // ── Greater tier — turn-5 bucket (except Ancient Runes, promoted to the turn-11 bucket) ──
  // NEUTRAL greater slot — build-agnostic: spend Gold to earn a trip to the Epic Runeforge (opens next turn).
  { id: 'q_epic_commission', name: 'The Epic Runeforge', tribe: 'neutral', tier: 'greater', wave: 11, objective: { event: 'castSpell', count: 15 }, reward: { kind: 'multi', rewards: [{ kind: 'openEpicRuneforge' }, { kind: 'gainGold', amount: 8 }] } },
  { id: 'q_apex_hunt', name: 'Apex Hunt', tribe: 'beast', tier: 'greater', objective: { event: 'slaughter', count: 6, tribe: 'beast' }, reward: { kind: 'grant', cards: ['badgington'], grantKeywords: ['W', 'DS'] } },
  { id: 'q_pack_mentality', name: 'Pack Mentality', tribe: 'beast', tier: 'greater', objective: { event: 'summonCombat', count: 9, tribe: 'beast' }, reward: { kind: 'scalingTribeAura', tribe: 'beast', attack: 4, health: 4, per: 5, event: 'summonCombat', stepAttack: 4, stepHealth: 4 } },
  { id: 'q_trophy_den', name: 'Trophy Den', tribe: 'beast', tier: 'greater', objective: { event: 'attack', count: 11, tribe: 'beast' }, reward: { kind: 'grant', cards: ['trophystalker'] } },
  { id: 'q_feed_the_alpha', name: 'Feed the Alpha', tribe: 'beast', tier: 'greater', objective: { event: 'slaughter', count: 6 }, reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['babycub'] }, { kind: 'recurringGrant', cards: ['feedalpha'] }] } },
  { id: 'q_the_red_trail', name: 'The Red Trail', tribe: 'beast', tier: 'greater', objective: { event: 'spendGold', count: 18 }, reward: { kind: 'recurringGrant', cards: ['bloodlust'] } },
  { id: 'q_echoing_roar', name: 'Echoing Roar', tribe: 'dragon', tier: 'greater', objective: { event: 'shout', count: 7 }, reward: { kind: 'recurringEndOfTurn', effect: 'triggerLeftmostShout' } },
  { id: 'q_skybound_pact', name: 'Skybound Pact', tribe: 'dragon', tier: 'greater', objective: { event: 'tribeStats', count: 40, tribe: 'dragon' }, reward: { kind: 'grant', cards: ['skybound'] } },
  { id: 'q_umbral_energy', name: 'Umbral Energy', tribe: 'dragon', tier: 'greater', wave: 11, objective: { event: 'slaughter', count: 11, tribe: 'dragon' }, reward: { kind: 'combatFlag', flag: 'umbralEnergy' } },
  { id: 'q_forsaken_will', name: 'Forsaken Will', tribe: 'undead', tier: 'greater', objective: { event: 'spendGold', count: 26 }, reward: { kind: 'undeadSpellAura', attack: 3 } },
  { id: 'q_kingdom_of_bones', name: 'Kingdom of Bones', tribe: 'undead', tier: 'greater', objective: { event: 'summonCombat', count: 9 }, reward: { kind: 'grant', cards: ['bonetaxer'] } },
  { id: 'q_ossuary_rite', name: 'Ossuary Rite', tribe: 'undead', tier: 'greater', objective: { event: 'deathrattle', count: 11 }, reward: { kind: 'recurringGrant', cards: ['ossuaryrite'] } },
  { id: 'q_perfect_machine', name: 'Perfect Machine', tribe: 'mech', tier: 'greater', objective: { event: 'buy', count: 7 }, reward: { kind: 'grant', cards: ['perfectcore'] } },
  { id: 'q_machine_chorus', name: 'Machine Chorus', tribe: 'mech', tier: 'greater', objective: { event: 'attack', count: 7 }, reward: { kind: 'grant', cards: ['chorusengine'] } },
  { id: 'q_blueprint_cache', name: 'Blueprint Cache', tribe: 'mech', tier: 'greater', objective: { event: 'playAttachment', count: 6 }, reward: { kind: 'recurringEndOfTurn', effect: 'buffMechsPerAttachment' } },
  { id: 'q_deep_hunger', name: 'Deep Hunger', tribe: 'demon', tier: 'greater', objective: { event: 'slaughter', count: 13 }, reward: { kind: 'combatFlag', flag: 'deepHunger' } },
  { id: 'q_food_for_gold', name: 'Food for Gold', tribe: 'demon', tier: 'greater', objective: { event: 'buy', count: 11, tribe: 'demon' }, reward: { kind: 'goldFodder', per: 7, attack: 1, health: 1 } },
  { id: 'q_contract_rewrite', name: 'Contract Rewrite', tribe: 'demon', tier: 'greater', objective: { event: 'spendGold', count: 25 }, reward: { kind: 'combatFlag', flag: 'contractRewrite' } },
  { id: 'q_implosion', name: 'Implosion', tribe: 'demon', tier: 'greater', objective: { event: 'summonImp', count: 10 }, reward: { kind: 'recurringGrant', cards: ['implosion'] } },
  // NEUTRAL greater: "get a random <keyword> minion" + the keyword doubler (owner spec 2026-07-08).
  { id: 'q_hoardwake_ritual', name: 'Hoardwake Ritual', tribe: 'neutral', tier: 'greater', objective: { event: 'shout', count: 12 }, reward: { kind: 'multi', rewards: [{ kind: 'grant', randomFilter: 'shout' }, { kind: 'shoutRepeat', scope: 'always' }] } },
  { id: 'q_echo_chamber', name: 'Echo Chamber', tribe: 'neutral', tier: 'greater', objective: { event: 'summonCombat', count: 9 }, reward: { kind: 'grant', cards: ['echowarden'] } },
  { id: 'q_overclocked_core', name: 'Overclocked Core', tribe: 'neutral', tier: 'greater', objective: { event: 'rally', count: 9 }, reward: { kind: 'multi', rewards: [{ kind: 'grant', randomFilter: 'rally' }, { kind: 'rallyRepeat', scope: 'firstEachCombat' }] } },
  { id: 'q_dupes', name: 'Dupes', tribe: 'neutral', tier: 'greater', objective: { event: 'winRound', count: 2 }, reward: { kind: 'dupeFirstBuy' } },
  { id: 'q_pivot_door', name: 'The Pivot Door', tribe: 'neutral', tier: 'greater', objective: { event: 'spendGold', count: 40 }, reward: { kind: 'grant', cards: ['lazarus'] } },
  { id: 'q_merchants_mark', name: "Merchant's Mark", tribe: 'neutral', tier: 'greater', objective: { event: 'spendGold', count: 65 }, reward: { kind: 'minionCost', cost: 2 } },
  { id: 'q_ancient_runes', name: 'Ancient Runes', tribe: 'neutral', tier: 'capstone', objective: { event: 'spendGold', count: 60 }, reward: { kind: 'spellRepeat', scope: 'always' } },

  // ── Capstone tier — turn-11 bucket ──
  { id: 'q_leader_of_the_pack', name: 'Leader of the Pack', tribe: 'beast', tier: 'capstone', objective: { event: 'attack', count: 18, tribe: 'beast' }, reward: { kind: 'multi', rewards: [{ kind: 'grant', grantGolden: ['packleader'] }, { kind: 'gainGold', amount: 10 }] } },
  { id: 'q_law_of_teeth', name: 'Law of Teeth', tribe: 'beast', tier: 'capstone', objective: { event: 'slaughter', count: 8, tribe: 'beast' }, reward: { kind: 'combatFlag', flag: 'lawOfTeeth' } },
  { id: 'q_the_old_hunt', name: 'The Old Hunt', tribe: 'beast', tier: 'capstone', objective: { event: 'attack', count: 20, tribe: 'beast' }, reward: { kind: 'combatFlag', flag: 'oldHunt', amount: 3 } },
  { id: 'q_feeding_line', name: 'Feeding Line', tribe: 'beast', tier: 'capstone', objective: { event: 'slaughter', count: 18, tribe: 'beast' }, reward: { kind: 'combatFlag', flag: 'feedingLine' } },
  { id: 'q_taragosas_inheritance', name: "Taragosa's Inheritance", tribe: 'dragon', tier: 'capstone', objective: { event: 'tribeStats', count: 250, tribe: 'dragon' }, reward: { kind: 'grant', cards: ['taragosaheir'] } },
  { id: 'q_chimerus', name: 'Chimerus', tribe: 'dragon', tier: 'capstone', objective: { event: 'castSpell', count: 10 }, reward: { kind: 'grant', cards: ['chimerus'] } },
  { id: 'q_twin_sun_oath', name: 'Twin Sun Oath', tribe: 'dragon', tier: 'capstone', objective: { event: 'shout', count: 15 }, reward: { kind: 'shoutEdgeBuff', attack: 5, health: 5 } },
  { id: 'q_the_bone_throne', name: 'The Bone Throne', tribe: 'undead', tier: 'greater', objective: { event: 'spendGold', count: 35 }, reward: { kind: 'boneThrone', every: 4 } },
  { id: 'q_death_writes_twice', name: 'Death Writes Twice', tribe: 'undead', tier: 'capstone', objective: { event: 'deathrattle', count: 12 }, reward: { kind: 'grant', cards: ['gravetwin'] } },
  { id: 'q_empty_graves', name: 'Empty Graves', tribe: 'undead', tier: 'greater', objective: { event: 'friendlyDeath', count: 13 }, reward: { kind: 'combatFlag', flag: 'emptyGraves' } },
  { id: 'q_shared_circuit', name: 'Shared Circuit', tribe: 'mech', tier: 'capstone', objective: { event: 'playAttachment', count: 16 }, reward: { kind: 'combatFlag', flag: 'sharedCircuit', amount: 3 } },
  { id: 'q_anomalous_reactor', name: 'Anomalous Reactor', tribe: 'mech', tier: 'greater', objective: { event: 'spendGold', count: 15 }, reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['anomalyreactor'] }, { kind: 'grant', randomTier: 5, randomCount: 1 }] } },
  { id: 'q_attachment_issues', name: 'Attachment Issues', tribe: 'mech', tier: 'capstone', objective: { event: 'castSpell', count: 14 }, reward: { kind: 'attachmentDeal', cost: 1 } },
  { id: 'q_fried_circuits', name: 'Fried Circuits', tribe: 'mech', tier: 'capstone', objective: { event: 'spendGold', count: 40 }, reward: { kind: 'friedCircuits', stepAttack: 4, stepHealth: 5 } },
  { id: 'q_true_contract', name: 'The True Contract', tribe: 'demon', tier: 'capstone', objective: { event: 'spendGold', count: 38 }, reward: { kind: 'grant', cards: ['heraldapoc'] } },
  { id: 'q_pit_without_end', name: 'Pit Without End', tribe: 'demon', tier: 'capstone', objective: { event: 'summonImp', count: 12 }, reward: { kind: 'combatFlag', flag: 'pitWithoutEnd', amount: 7 } },
  { id: 'q_maw_of_the_run', name: 'Track and Fodder', tribe: 'demon', tier: 'capstone', objective: { event: 'slaughter', count: 14 }, reward: { kind: 'grant', cards: ['runmaw'] } },
  // NEUTRAL capstone: the keyword-doubler + random-keyword-minion payoffs (owner spec 2026-07-08).
  { id: 'q_echoing_coop', name: 'Echoing Coop', tribe: 'neutral', tier: 'capstone', objective: { event: 'buy', count: 18 }, reward: { kind: 'combatFlag', flag: 'echoingCoop' } },
  { id: 'q_parliament_of_flame', name: 'Parliament of Flame', tribe: 'neutral', tier: 'capstone', objective: { event: 'spendGold', count: 33 }, reward: { kind: 'multi', rewards: [{ kind: 'grant', randomFilter: 'endOfTurn' }, { kind: 'endOfTurnRepeat' }] } },
  { id: 'q_funeral_engine', name: 'Funeral Engine', tribe: 'neutral', tier: 'capstone', objective: { event: 'deathrattle', count: 12 }, reward: { kind: 'multi', rewards: [{ kind: 'grant', randomFilter: 'echo', randomFilterExactTier: true }, { kind: 'echoRepeat', scope: 'always' }] } },
  { id: 'q_infinite_assembly', name: 'Infinite Assembly', tribe: 'neutral', tier: 'capstone', objective: { event: 'slaughter', count: 13 }, reward: { kind: 'multi', rewards: [{ kind: 'grant', randomFilter: 'rally' }, { kind: 'rallyRepeat', scope: 'always' }] } },
  { id: 'q_rulebreakers_crown', name: "Rulebreaker's Crown", tribe: 'neutral', tier: 'capstone', objective: { event: 'attack', count: 14 }, reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['goldcrafter'] }, { kind: 'combatFlag', flag: 'doubleLeftmostAttack' }] } },
  { id: 'q_impossible_shop', name: 'Taurus Ascension', tribe: 'neutral', tier: 'greater', objective: { event: 'spendGold', count: 40 }, reward: { kind: 'grant', grantGolden: ['taurustruth'] } },

  // ── Turn-11 capstone additions (owner batch 2026-07-13). Each hangs a NEW recurring End-of-Turn / widen
  //    mechanic off a tribe's signature minion. Objective counts + reward magnitudes are starting dials. ──
  // UNDEAD — Spear Warden "pass the spears", the Undead speed aura, and Cratering Hulk's stat-hoard spread.
  { id: 'q_passing_spears', name: 'Passing Spears', tribe: 'undead', tier: 'capstone', objective: { event: 'friendlyDeath', count: 12 }, reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['knit'] }, { kind: 'combatFlag', flag: 'passingSpears' }] } },
  { id: 'q_forsaken_speed', name: 'Forsaken Speed', tribe: 'undead', tier: 'capstone', objective: { event: 'summonCombat', count: 10, tribe: 'undead' }, reward: { kind: 'recurringEndOfTurn', effect: 'undeadPlayedAtk' } },
  { id: 'q_cratering_missive', name: 'Cratering Missive', tribe: 'undead', tier: 'capstone', objective: { event: 'buy', count: 13 }, reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['thunderingabomination'] }, { kind: 'combatFlag', flag: 'crateringMissive' }] } },
  // DEMON — grant a Bane + widen its after-Battlecry payoff to all Demons.
  { id: 'q_banes_existence', name: "Bane's Existence", tribe: 'demon', tier: 'capstone', objective: { event: 'shout', count: 12 }, reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['bane'] }, { kind: 'baneDemonAura', attack: 2, health: 2 }] } },
  // MECH — Cling Drones self-magnetize onto your Mechs every End of Turn.
  { id: 'q_clinging_on', name: 'Clinging On', tribe: 'mech', tier: 'capstone', objective: { event: 'buy', count: 8, tribe: 'mech' }, reward: { kind: 'recurringEndOfTurn', effect: 'attachClingDrones' } },
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
