import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, NEXT_COMBAT_BANK_KEYS, type BoardMinion, type QuestCombatMods } from '@game/core';
import { createRun, type RunState } from './state';
import { snapshotBoard } from './snapshot';
import { opponentBoard } from './opponents';
import { seatCombatSide } from './boardSide';

/**
 * THE GUARD (2026-10-07): a next-combat spell bank on `RunState` must reach a SERVED board.
 *
 * Six spells shipped player-only for months (Rallying Offensive, Marked Target, Fleeting Vigor, the three banked
 * keywords, Open the Gates) because nothing asked the question this test asks. Every RunState field whose name
 * reads like a bank (`pending*`, `next*`, `*Next*`) must be classified below: either it is a NEXT-COMBAT bank,
 * in which case arming it on a run must (1) survive `snapshotBoard` — the capture path — and (2) act for the
 * ENEMY when that snapshot is served — the application path — with its Start of Combat cast beat; or it is not
 * a next-combat bank, with the reason. A new field in either pattern fails here until it is classified, and a new
 * next-combat spell without a capture + an enemy-side application fails the check.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** RunState's own field names, parsed from the interface source (re-derived every run). */
function runStateKeys(): string[] {
  const src = readFileSync(join(ROOT, 'packages/sim/src/state.ts'), 'utf8');
  const i = src.indexOf('export interface RunState');
  const j = src.indexOf('\n}', i);
  return [...src.slice(i, j).matchAll(/\n {2}([a-zA-Z0-9]+)\??:/g)].map((m) => m[1]!);
}

const LOOKS_LIKE_A_BANK = /^pending|^next[A-Z]|Next/;

/** A next-combat bank: how to arm it on a run, the `QuestCombatMods` key it must be captured as, and the spell it
 *  announces when it casts for the enemy. */
interface Bank { arm: Partial<RunState>; modKey: keyof QuestCombatMods; spellId: string }
const NEXT_COMBAT_BANKS: Record<string, Bank> = {
  pendingWeaken: { arm: { pendingWeaken: 1 }, modKey: 'weakenTargets', spellId: 'weaken' },
  pendingDecoys: { arm: { pendingDecoys: 1 }, modKey: 'decoySigils', spellId: 'decoysigil' },
  summonTauntsNextCombat: { arm: { summonTauntsNextCombat: 2 }, modKey: 'summonTaunts', spellId: 'summoningbulwark' },
  rallyDoubleNext: { arm: { rallyDoubleNext: true }, modKey: 'rallyDouble', spellId: 'rallyoffensive' },
  pendingSCImps: { arm: { pendingSCImps: 3 }, modKey: 'bankedImps', spellId: 'openthegates' },
  pendingCombatKeywords: { arm: { pendingCombatKeywords: [{ uid: 'a', keyword: 'R' }] }, modKey: 'bankedKeywords', spellId: 'laststand' },
  // Not caught by the name pattern, so listed by hand (the same family):
  fleetingVigor: { arm: { fleetingVigor: { attack: 2, health: 1 } }, modKey: 'fleetingVigor', spellId: 'fleetingvigor' },
  markEnemyRightmostTaunt: { arm: { markEnemyRightmostTaunt: true }, modKey: 'markFoeRightmostTaunt', spellId: 'markedtarget' },
  solidGroundLeft: { arm: { solidGroundLeft: 3, solidGroundStat: 4 }, modKey: 'solidGroundLeft', spellId: 'sp_solidground' },
  containFirstEnemySummon: { arm: { containFirstEnemySummon: true }, modKey: 'containFirstEnemySummon', spellId: 'sp_containmentrune' },
  stolenInitiative: { arm: { stolenInitiative: true }, modKey: 'stolenInitiative', spellId: 'sp_stoleninitiative' },
};

/** PLAYER-ONLY banks: never captured on a snapshot, never applied or announced for an opponent, each with its ruling. */
const PLAYER_ONLY: Record<string, { modKey: keyof QuestCombatMods; why: string }> = {
  attackFirstNext: { modKey: 'attackFirstNext', why: 'Pre-emptive Assault: owner 2026-10-07, "pre-emptive assault is a player only carry. dont let enemies cast this" (R-PREEMPTIVE-PLAYER-01). The player\'s own fight reads CombatConfig.playerAttacksFirst.' },
};

/** Fields that match the name pattern but are not next-combat banks. */
const NOT_A_NEXT_COMBAT_BANK: Record<string, string> = {
  bonusEmbersNextTurn: 'Gold for the next SHOP turn, never a fight',
  nextTurnSpellCopies: 'spells granted at the next shop turn',
  nextSellBonus: 'Quick Sale: the next minion SOLD this turn',
  scoutedNextOpponent: 'Farseer\'s Report reveal (UI intel)',
  nextSpellExtraCasts: 'Nimbus: the next SHOP spell casts again',
  nextSpellBonus: 'the next SHOP spell is stronger',
  nextShopBuff: 'buffs the next SHOP\'s offers',
  pendingPowerOffer: 'a hero-power pick modal',
  equipmentFreeNextTurn: 'an Equipment charge for the next shop turn',
  pendingTavern: 'a queued tavern refresh',
  pendingSummonBuff: 'a shop summon buff, resolved in the recruit phase',
  pendingQuestRewards: 'queued quest reward modals',
  pendingEpicRuneforge: 'a queued Runeforge modal',
  pendingForgeDeferred: 'a queued Runeforge modal',
  pendingBasicForge: 'a queued Runeforge modal',
  nextCardFree: 'the next SHOP purchase is free',
  pendingDeath: 'a shop death awaiting resolution',
  pendingTarget: 'a targeting prompt in the shop',
  pendingCombatSide: 'the balance bot\'s parked deferred-fight side (it is the side, not a bank)',
};

const base = (over: Partial<RunState>): RunState => ({
  ...createRun(5), phase: 'recruit',
  board: [
    { uid: 'a', cardId: 'd2_cinderchef', tribe: 'dwarf', attack: 3, health: 8, keywords: ['RL'], golden: false },
    { uid: 'b', cardId: 'stray', tribe: 'beast', attack: 2, health: 3, keywords: [], golden: false },
  ],
  ...over,
} as RunState);

describe('the next-combat bank guard', () => {
  it('every bank-shaped RunState field is classified (a new one fails until it is)', () => {
    const unclassified = runStateKeys()
      .filter((k) => LOOKS_LIKE_A_BANK.test(k))
      .filter((k) => !(k in NEXT_COMBAT_BANKS) && !(k in PLAYER_ONLY) && !(k in NOT_A_NEXT_COMBAT_BANK));
    expect(unclassified, `classify these in nextCombatBanks.guard.test.ts — a next-combat bank needs a snapshot capture AND an enemy-side application:\n  ${unclassified.join('\n  ')}`).toEqual([]);
  });

  it('the core bank-key list (stale-serve stripping) covers every captured bank', () => {
    for (const b of [...Object.values(NEXT_COMBAT_BANKS), ...Object.values(PLAYER_ONLY)]) {
      expect(NEXT_COMBAT_BANK_KEYS, `${b.modKey} must be in NEXT_COMBAT_BANK_KEYS so a stale re-serve drops it`).toContain(b.modKey);
    }
  });

  for (const [field, bank] of Object.entries(NEXT_COMBAT_BANKS)) {
    it(`${field}: captured by snapshotBoard, applied for the ENEMY with a cast beat`, () => {
      const plain = snapshotBoard(base({}));
      const snap = snapshotBoard(base(bank.arm));
      // (1) the capture path
      expect(snap.questMods?.[bank.modKey], `${field} → questMods.${String(bank.modKey)}`).toBeTruthy();
      // (2) the application path: served as the enemy on its own round, it casts and changes the fight.
      const me: BoardMinion[] = [{ cardId: 'stray', attack: 2, health: 9 }, { cardId: 'alley', attack: 1, health: 2 }, { cardId: 'stray', attack: 2, health: 9 }];
      const fight = (s: typeof snap): string => {
        const seat = seatCombatSide({ minions: opponentBoard(s), tier: s.tier, snapshot: s }, s.wave, Object.keys(CARD_INDEX));
        const r = simulate(me, seat.minions, makeRng(9), CARD_INDEX, combatSide({ tier: 3 }), seat.state);
        expect(r.events.some((e) => e.type === 'bankedCast' && e.side === 'enemy' && e.spellId === bank.spellId) || s === plain, `${field}: no enemy cast beat`).toBe(true);
        return JSON.stringify(r.events.filter((e) => e.type !== 'bankedCast'));
      };
      const armed = fight(snap);
      const unarmed = fight(plain);
      // Containment acts on the PLAYER's first summon (Pennycat's Shout has none in combat) and Stolen Initiative /
      // Summoning Bulwark / Solid Ground need the right moment: the cast beat above is their proof here, and each
      // has its own behavioural test (core nextCombatSpells.test.ts, sim nextCombatSpells.test.ts).
      if (!['containFirstEnemySummon', 'summonTauntsNextCombat', 'solidGroundLeft', 'stolenInitiative', 'pendingDecoys'].includes(field)) {
        expect(armed, `${field}: armed and unarmed fights are identical — the bank never acted for the enemy`).not.toBe(unarmed);
      }
    });
  }

  for (const [field, c] of Object.entries(PLAYER_ONLY)) {
    it(`${field}: PLAYER-ONLY, never captured on the snapshot (${c.why.split(':')[0]})`, () => {
      const snap = snapshotBoard(base({ [field]: true } as Partial<RunState>));
      expect(snap.questMods?.[c.modKey]).toBeUndefined();
    });
  }
});
