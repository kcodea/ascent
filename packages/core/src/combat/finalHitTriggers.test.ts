import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent, type CombatResult } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * THE FINAL HIT STILL FINISHES ITS TRIGGERS (owner ruling 2026-11-16, R-FINAL-HIT-01):
 * "Fix the final hit bug. We saw this with avenges recently too, looks like many or potentially all mechanics suffer
 * this. The final kill or death etc still needs to finish all triggers".
 *
 * The probe matrix. Every row runs the same decisive event twice:
 *   FINAL — the event ends the fight (the attacker kills the last enemy, the last friendly dies, a mutual kill);
 *   MID   — the identical fight with one extra 0/1 Stealth enemy (or friend) that can never be targeted and never
 *           attacks, so the same event happens with the fight still running.
 * The trigger's payout (gold, hand grants, summons, buffs, carry-backs) must be the same in both. The fight end is
 * judged only at the attack loop's head, after `settleBetweenAttacks` has drained everything the last swing set off,
 * so a row here fails only when an individual trigger reads the board in a way that the final event empties.
 *
 * The one family that did (fixed here): Flash x Ancient of War, "Pummel (400): get a copy of a random enemy minion.
 * Twice per combat." The crossing is noted at damage time, when the struck body is already at <=0 and out of the
 * living pool, so a crossing hit that felled the LAST enemy found no one to copy and still spent a payout.
 */
const avengeGold: CardDef = { id: 'zfh_avgold', name: 'Gold Avenger', tribe: 'beast', tier: 3, attack: 0, health: 50, keywords: [],
  effects: [{ on: 'avenge', do: 'avengeBonusGold', params: { count: 1, amount: 2 } }], text: '' } as unknown as CardDef;
const avengeSummon: CardDef = { id: 'zfh_avsummon', name: 'Pup Avenger', tribe: 'beast', tier: 3, attack: 0, health: 50, keywords: [],
  effects: [{ on: 'avenge', do: 'avengeSummon', params: { count: 1, cardId: 'pup' } }], text: '' } as unknown as CardDef;
const cards = { ...CARD_INDEX, zfh_avgold: avengeGold, zfh_avsummon: avengeSummon };

const bm = (cardId: string, attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, keywords } as unknown as BoardMinion);
/** Untargetable and harmless: it keeps the fight running past the decisive event (the MID twin). */
const bystander = (): BoardMinion => bm('sandbag', 0, 1, ['ST']);
const twin = (mid: boolean): BoardMinion[] => (mid ? [bystander()] : []);
const fight = (p: BoardMinion[], e: BoardMinion[], pmods: object = {}, emods: object = {}, first: 'player' | 'enemy' = 'player'): CombatResult =>
  simulate(p, e, makeRng(3), cards,
    combatSide({ tier: 6, questMods: pmods } as never), combatSide({ tier: 6, questMods: emods } as never),
    first === 'player' ? { playerAttacksFirst: true } : { enemyAttacksFirst: true });
const count = (ev: CombatEvent[], type: CombatEvent['type']): number => ev.filter((e) => e.type === type).length;

const FLASH_WAR = { ancientFlash: { pummel: { every: 400, dealt: 0, max: 2 }, label: 'Ancient of War' } };

/** Each row: what the trigger produced, for the FINAL fight (`false`) and its MID twin (`true`). */
const MATRIX: Record<string, (mid: boolean) => unknown> = {
  'Pummel, Ancient (Flash x War): the crossing hit kills the last enemy': (mid) =>
    fight([bm('sandbag', 450, 500)], [bm('sandbag', 1, 420, ['T']), ...twin(mid)], FLASH_WAR).playerHandGrants?.length ?? 0,
  'Pummel, Ancient (Albus x War): the crossing hit kills the last enemy': (mid) =>
    fight([bm('sandbag', 450, 500)], [bm('sandbag', 0, 420, ['T']), ...twin(mid)],
      { ancientPummel: { every: 400, dealt: 0, count: 1, cardId: 'pup' } }).playerHandGrants?.length ?? 0,
  'Pummel, keyword (Han Gover): the 40th damage kills the last enemy': (mid) =>
    fight([bm('dw3_hangover', 40, 500)], [bm('sandbag', 0, 40, ['T']), ...twin(mid)]).playerHandGrants?.length ?? 0,
  'Slaughter (Bounty Bot): the kill is the last enemy': (mid) =>
    fight([bm('bountybot', 5, 50)], [bm('sandbag', 0, 1, ['T']), ...twin(mid)]).playerBonusGold ?? 0,
  'Slaughter (Bounty Bot): a mutual kill on the last enemy': (mid) =>
    fight([bm('bountybot', 5, 1)], [bm('sandbag', 5, 1, ['T']), ...twin(mid)]).playerBonusGold ?? 0,
  'Avenge (gold): the attacker and the last enemy die together': (mid) =>
    fight([bm('sandbag', 5, 1), bm('zfh_avgold', 0, 50)], [bm('sandbag', 5, 1, ['T']), ...twin(mid)]).playerBonusGold ?? 0,
  'Avenge (summon): the attacker and the last enemy die together': (mid) =>
    count(fight([bm('sandbag', 5, 1), bm('zfh_avsummon', 0, 50)], [bm('sandbag', 5, 1, ['T']), ...twin(mid)]).events, 'summon'),
  'Rune Avenge (Blood and Coin): the 4th friendly death is the last friendly': (mid) =>
    fight([bm('sandbag', 1, 1), bm('sandbag', 1, 1), bm('sandbag', 1, 1), bm('sandbag', 1, 1), ...twin(mid)],
      [bm('sandbag', 50, 500)], { runeBloodAndCoin: 3 }).playerBonusGold ?? 0,
  'Echo summon: the last enemy dies (its Echo keeps the fight going)': (mid) =>
    count(fight([bm('sandbag', 5, 500)], [bm('pack', 1, 1, ['T']), ...twin(mid)]).events, 'summon'),
  'Echo summon: the last friendly dies': (mid) =>
    count(fight([bm('pack', 1, 1), ...twin(mid)], [bm('sandbag', 50, 500)]).events, 'summon'),
  'Rune on kill (Trophy): the first kill is the last enemy': (mid) =>
    fight([bm('sandbag', 5, 50)], [bm('pack', 0, 1, ['T']), ...twin(mid)], { runeTrophy: true }).playerSlaughterCopy,
  'Kill record (First / Last): the last kill': (mid) => {
    const r = fight([bm('sandbag', 5, 50)], [bm('pack', 0, 1, ['T']), ...twin(mid)]);
    return [r.playerFirstKill, r.playerLastKill];
  },
  'Damage watcher (sandbag): hit by the retaliation that ends the fight': (mid) =>
    count(fight([bm('sandbag', 5, 50)], [bm('sandbag', 1, 1, ['T']), ...twin(mid)]).events, 'buff'),
};

describe('R-FINAL-HIT-01: the final kill / death resolves its triggers exactly as mid-fight', () => {
  for (const [name, row] of Object.entries(MATRIX)) {
    it(name, () => {
      const mid = row(true);
      expect(mid, 'the MID twin must actually fire the trigger, or the row proves nothing').not.toEqual(0);
      expect(row(false)).toEqual(mid);
    });
  }
});

describe('Flash x Ancient of War: the crossing hit that ends the fight still copies', () => {
  it('one 450/500 vs one 1/420: the copy is the enemy the crossing hit felled', () => {
    const r = fight([bm('sandbag', 450, 500)], [bm('beatboxer', 1, 420, ['T'])], FLASH_WAR);
    expect(r.result).toBe('win');
    expect(r.playerHandGrants).toEqual(['beatboxer']);
    const toHand = r.events.filter((e) => e.type === 'toHand');
    expect(toHand).toHaveLength(1);
    expect(toHand[0]).toMatchObject({ cardId: 'beatboxer', side: 'player' });
  });

  it('a hit crossing 400 AND 800 on the last enemy pays both (twice per combat), both of the felled body', () => {
    const r = fight([bm('sandbag', 850, 900)], [bm('beatboxer', 0, 850, ['T'])], FLASH_WAR);
    expect(r.playerHandGrants).toEqual(['beatboxer', 'beatboxer']);
  });

  it('mid-fight the pick is unchanged: a living enemy is copied, never the body just felled', () => {
    const r = fight([bm('sandbag', 450, 500)], [bm('beatboxer', 1, 420, ['T']), bm('pack', 0, 1, ['ST'])], FLASH_WAR);
    expect(r.playerHandGrants).toEqual(['pack']);
  });

  it('symmetric: the ENEMY crossing 400 with the retaliation that kills the player\'s last minion copies it', () => {
    const r = fight([bm('beatboxer', 1, 420)], [bm('sandbag', 450, 500, ['T'])], {}, FLASH_WAR);
    expect(r.result).toBe('lose');
    expect(r.enemyCarry?.handGrants).toEqual(['beatboxer']);
  });
});
