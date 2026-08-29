import type { CardDef } from '@game/core';

/**
 * ── SET 3 — THE EQUIP MINIONS (owner handoff 2026-08-28) ──────────────────────────────────────────────────
 *
 * A minion with an `equip` effect grants the player an EQUIPMENT: a Shop-phase ability that lives in the
 * second hero-power slot, costs Gold, and spends from a shared per-turn allowance. The Equipment itself is
 * defined once in `content/equipment.ts` and named here by id — several cards may grant the same Equipment,
 * which is exactly why the duplicate / Gilded precedence rules exist.
 *
 * ONE CARD ON PURPOSE. The handoff is explicit: "Do not implement the wider Equipment card roster yet.
 * Implement only Alchemist Frank as the reference card." Frank is the vertical slice — acquisition, selection,
 * targeting, activation, the Gilded upgrade, the rebuild and removal — with the simplest possible payload so
 * a failing test points at the SYSTEM rather than at a clever effect.
 *
 * These live in a SIBLING file to `celestials.ts` rather than being appended to a set-1/set-2 tribe file: a
 * set's pool order and size are load-bearing (shop draws index into it), so set-3 content authored anywhere
 * else would perturb the other sets' seeds.
 */
export const SET3_EQUIPMENT: readonly CardDef[] = [
  {
    // The reference Equip minion. Tier 1 and Neutral so it can be reached on turn 1 in any run, which is what
    // makes it usable as a test fixture; the Gilded half exists to exercise version precedence, not power.
    id: 'e3_frank',
    name: 'Alchemist Frank',
    tribe: 'neutral',
    tier: 1,
    attack: 3,
    health: 3,
    keywords: [],
    // `equipmentId` is the ONLY place the card names its Equipment — cost, target mode, wording and effect
    // all come from the registry entry, so a card and its Equipment can never drift apart.
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'bloodpot' } }],
    text: '**Equip Bloodpot (1):** Give a friendly minion **+3/+3**.',
    goldenText: '**Equip Bloodpot (1):** Give a friendly minion **+6/+6**.',
  },
  {
    // The second Equip minion (owner 2026-08-28), and the first to put TWO Equipment in play at once — which
    // is what the slot's selector, the board-order fallback and last-used restoration exist for. A T6 body
    // because the Chisel is a finisher: it does not scale a board, it decides one minion.
    id: 'e3_sculptor',
    name: 'Titan Sculptor',
    tribe: 'neutral',
    tier: 6,
    attack: 10,
    health: 8,
    keywords: [],
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'titan_chisel' } }],
    text: "**Equip Titan Chisel (3):** Set a friendly minion's stats to **50/50**.",
    goldenText: "**Equip Titan Chisel (3):** Set a friendly minion's stats to **100/100**.",
  },
];
