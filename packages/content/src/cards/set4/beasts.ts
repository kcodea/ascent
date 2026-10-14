import type { CardDef } from '@game/core';

/**
 * SET 4 — BEASTS (owner 2026-10-13): SELF-DAMAGE, in the Shop AND in combat (cross-phase by default). The damage
 * these Beasts deal to your own Beasts NEVER kills (R-WOUND-01): each hit lands together with its Health grant
 * (`woundAll`), so a 1-Health Beast takes the hit (firing Apua / Alan) and ends net neutral. Apua and Alan
 * answer ANY landed hit on a friendly Beast (an attack, a splash, a Blaster in the Shop), and their gains are
 * permanent in both phases ("permanently" is printed, so combat gains carry back). No art yet.
 *
 * Gilded: Hawg and Eatah repeat their whole effect (a second tick, so the damage watchers answer twice);
 * Apua and Alan double their stats.
 */
export const SET4_BEASTS: readonly CardDef[] = [
  {
    id: 'b4_hawg',
    name: 'Hawg',
    tribe: 'beast',
    tier: 1,
    attack: 1,
    health: 2,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'shoutWoundSelfMendTribe', params: { tribe: 'beast', damage: 1, health: 1 } }],
    text: '**Shout:** Deal 1 damage to this and give your Beasts **+1 Health**.',
    goldenText: '**Shout:** Deal 1 damage to this and give your Beasts **+1 Health**, twice.',
  },
  {
    id: 'b4_apua',
    name: 'Apua',
    tribe: 'beast',
    tier: 2,
    attack: 3,
    health: 3,
    keywords: [],
    effects: [{ on: 'onDamaged', do: 'onTribeDamagedBuffSelf', params: { tribe: 'beast', attack: 1, health: 1 } }],
    text: 'When your Beasts take damage, this gains **+1/+1** permanently.',
    goldenText: 'When your Beasts take damage, this gains **+2/+2** permanently.',
  },
  {
    id: 'b4_eatah',
    name: 'Eatah',
    tribe: 'beast',
    tier: 3,
    attack: 4,
    health: 5,
    keywords: ['T', 'R'],
    effects: [{ on: 'onDeath', do: 'deathrattleWoundMendTribe', params: { tribe: 'beast', damage: 1, health: 1 } }],
    text: '**Taunt. Rise. Echo:** Deal 1 damage to your Beasts and give them **+1 Health**.',
    goldenText: '**Taunt. Rise. Echo:** Deal 1 damage to your Beasts and give them **+1 Health**, twice.',
  },
  {
    id: 'b4_alan',
    name: 'Alan',
    tribe: 'beast',
    tier: 5,
    attack: 5,
    health: 6,
    keywords: [],
    effects: [{ on: 'onDamaged', do: 'onTribeDamagedBuffRandomTribe', params: { tribe: 'beast', attack: 1, health: 2 } }],
    text: 'When a friendly Beast takes damage, give another friendly Beast **+1/+2** permanently.',
    goldenText: 'When a friendly Beast takes damage, give another friendly Beast **+2/+4** permanently.',
  },
];
