import type { RuneDef } from '@game/core';
import { RuneDefSchema } from './schema';

/**
 * Runes — the Runesmith's Runeforge stock. On turn 6 the forge offers a random 3 of these; the player buys ONE
 * for its Gold `cost` and its `reward` applies for the rest of the run (no objective — it just takes effect).
 * Each rune reuses the quest `QuestReward` application engine (see `applyQuestReward`), so a rune's effect is a
 * reward: some reuse existing kinds (combatFlag / recurringEndOfTurn / grant), some use rune-only kinds.
 *
 * These are ONLY available in the Runeforge (never in the shop / Discover / quest pool).
 */
export const RUNES: RuneDef[] = [
  {
    id: 'rune_spellslinging',
    name: 'Rune of Spellslinging',
    cost: 5,
    text: 'Every **5 Gold** spent, get a random spell.',
    reward: { kind: 'runeSpellDrip', per: 5 },
  },
  {
    id: 'rune_warding',
    name: 'Rune of Warding',
    cost: 4,
    text: '**Start of Combat:** give your left-most minion **Ward**.',
    reward: { kind: 'combatFlag', flag: 'runeWarding' },
  },
  {
    id: 'rune_structure',
    name: 'Rune of Structure',
    cost: 3,
    text: 'Attachments played from your hand also give a random spell.',
    reward: { kind: 'runeStructure' },
  },
  {
    id: 'rune_slaying',
    name: 'Rune of Slaying',
    cost: 3,
    text: 'Every time you **Slaughter**, gain **+2 Gold** next turn.',
    reward: { kind: 'combatFlag', flag: 'runeSlaying', amount: 2 },
  },
  {
    id: 'rune_spending',
    name: 'Rune of Spending',
    cost: 6,
    text: '**End of Turn:** gain **+1 max Gold** and grant **+1/+1 per Gold spent** to your left-most minion.',
    reward: { kind: 'recurringEndOfTurn', effect: 'runeSpending' },
  },
  {
    id: 'rune_consumption',
    name: 'Rune of Consumption',
    cost: 4,
    text: 'Every time you **Consume** Fodder, increase Fodder stats by **+2/+1**.',
    reward: { kind: 'runeConsume', attack: 2, health: 1 },
  },
  {
    id: 'rune_pillaging',
    name: 'Rune of Pillaging',
    cost: 8,
    text: 'Get a **Pillager**. Your **Gold Pouches** are worth **2 Gold** for the rest of the run.',
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['pillager'] }, { kind: 'goldPouchValue', value: 2 }] },
  },
  {
    id: 'rune_fury',
    name: 'Rune of Fury',
    cost: 5,
    text: 'Your **Avenges** trigger twice.',
    reward: { kind: 'combatFlag', flag: 'runeFury' },
  },
  {
    id: 'rune_summoning',
    name: 'Rune of Summoning',
    cost: 5,
    text: 'Casting spells improve your **Imps** by **+1/+1** wherever they are.',
    reward: { kind: 'runeSummoning' },
  },
  {
    id: 'rune_forthcoming',
    name: 'Rune of Forthcoming',
    cost: 3,
    text: '**Always attack first.**',
    reward: { kind: 'combatFlag', flag: 'runeForthcoming' },
  },
];

/**
 * Epic Runes — the **Epic Runeforge's** stock. A second, higher-power forge that functions identically to the
 * normal Runeforge (offer a random few, buy ONE for Gold, re-roll once for 2 Gold) but draws from THIS set and is
 * NOT tied to a hero power — reached by a quest reward (`openEpicRuneforge`, the Epic Commission quest).
 *
 * `requiresDoublePower`: a rune only offered to heroes whose hero power gets value from a double trigger (the sim's
 * DOUBLEABLE_POWERS set) — Empowerment is meaningless on a targeted / passive power, so it's filtered out for them.
 */
export const EPIC_RUNES: RuneDef[] = [
  {
    id: 'rune_empowerment',
    name: 'Rune of Empowerment',
    cost: 4,
    epic: true,
    requiresDoublePower: true,
    text: 'Your **hero power** triggers twice.',
    reward: { kind: 'runeEmpowerment' },
  },
  {
    id: 'rune_rallying',
    name: 'Rune of Rallying',
    cost: 6,
    epic: true,
    text: '**Start of Combat:** trigger your **Rally** effects.',
    reward: { kind: 'combatFlag', flag: 'runeRallying' },
  },
  {
    id: 'rune_scale',
    name: 'Rune of Scale',
    cost: 5,
    epic: true,
    text: 'Spending Gold gives **2 random allies +2/+2**.',
    reward: { kind: 'runeScale', count: 2, attack: 2, health: 2 },
  },
  {
    id: 'rune_copies',
    name: 'Rune of Copies',
    cost: 5,
    epic: true,
    text: 'Get a **copy** of a minion on your board. Get another every turn.',
    reward: { kind: 'runeCopies' },
  },
  {
    id: 'rune_action',
    name: 'Rune of Action',
    cost: 8,
    epic: true,
    text: '**End of Turn:** give your left-most minion **+1/+1** for every card you played this turn.',
    reward: { kind: 'recurringEndOfTurn', effect: 'runeAction' },
  },
];

/** Lookup across BOTH runesets — the normal forge stock and the Epic forge stock share one id space so the
 *  owned-rune badges / card lookups resolve any rune the run has picked up. */
export const RUNE_INDEX: Record<string, RuneDef> = Object.fromEntries(
  [...RUNES, ...EPIC_RUNES].map((r) => [r.id, r]),
);

/** Zod-validate every rune in BOTH sets (shape + reward palette). Throws on a malformed rune. */
export function validateRunes(runes: RuneDef[] = [...RUNES, ...EPIC_RUNES]): void {
  for (const r of runes) RuneDefSchema.parse(r);
}
