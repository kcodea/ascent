import { describe, it, expect } from 'vitest';
import { combatSide, damageMeterOf, damageMeterReading, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { applyEndOfTurn } from './recruit';

/**
 * OWNER CHANGES 2026-10-03.
 *
 *  - "Tauntbreaker -> Rally: Remove Taunt and Rise from the target. Pummel (25): Get a random Shop Spell."
 *    + ruling on PR #1939: "give tauntbreaker a once per combat flag".
 *    The Rally strip is unchanged; the new Pummel (25) is the shared damage meter (`noteDamageDealt`) with a
 *    random-Shop-Spell body (`dealtDamageGetRandomSpell` → `grantRandomSpell`), at most ONCE per combat (the
 *    `maxPerCombat` default of 1); the lifetime tally still carries between combats. Gilded: 2 spells per payout.
 *  - "Venom -> Execute. just needs the text keyword added to body". Venom already carried the V (Execute)
 *    keyword; only the body text changes.
 */

const SET2 = poolFor('set2').all.map((c) => c.id);
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set2', phase: 'recruit', embers: 20, tier: 6, ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;

const foe = (attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId: 'sandbag', attack, health, keywords } as unknown as BoardMinion);
/** Tauntbreaker with its printed keywords (Ward + Flurry + Rally). */
const tb = (over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX['tauntbreaker']!;
  return { cardId: 'tauntbreaker', attack: d.attack, health: 200, keywords: [...d.keywords], sourceUid: 'tb', ...over } as unknown as BoardMinion;
};
const fight = (board: BoardMinion[], foes: BoardMinion[], tier = 6) =>
  simulate(board, foes, makeRng(5), CARD_INDEX, combatSide({ tier, poolIds: SET2 }), combatSide({ tier: 6 }));
const spellsGranted = (r: ReturnType<typeof fight>) => (r.playerHandGrants ?? []).filter((id) => CARD_INDEX[id]?.spell);
const triggers = (r: ReturnType<typeof fight>) => r.events.filter((e) => e.type === 'pummelTrigger');

describe('Tauntbreaker: "Rally: Remove Taunt and Rise from the target. Pummel (25): Get a random Shop Spell. (Once per combat)"', () => {
  it('the card: the Rally strip is unchanged and a passive Pummel (25) meter with a random-Shop-Spell body is added', () => {
    const c = CARD_INDEX['tauntbreaker']!;
    expect([c.tribe, c.tier, c.attack, c.health]).toEqual(['neutral', 4, 6, 4]);
    expect(c.keywords).toEqual(['DS', 'W', 'RL']);
    expect(c.effects).toEqual([
      { on: 'onAttack', do: 'onAttackStripKeywords', params: { keywords: ['T', 'R'] } },
      { on: 'passive', do: 'dealtDamageGetRandomSpell', params: { every: 25, count: 1 } },
    ]);
    expect(c.text).toBe('**Rally:** Remove **Taunt** and **Rise** from the target. **Pummel (25):** Get a random **Shop Spell**. (Once per combat)');
    expect(c.goldenText).toBe('**Rally:** Remove **Taunt** and **Rise** from the target. **Pummel (25):** Get **2** random **Shop Spells**. (Once per combat)');
    expect(damageMeterOf(c)).toEqual({ do: 'dealtDamageGetRandomSpell', every: 25 });
  });

  it('COMBAT Rally: the struck enemy loses Taunt AND Rise, so the killing blow keeps it dead', () => {
    const r = fight([tb()], [foe(0, 3, ['T', 'R'])]);
    const lost = r.events.flatMap((e) => (e.type === 'keywordLost' ? [e.keyword] : []));
    expect(lost).toEqual(expect.arrayContaining(['T', 'R']));
    expect(r.events.some((e) => e.type === 'reborn')).toBe(false);
    expect(r.result).toBe('win');
  });

  it('SHOP Rally (Rune of Lasting Cadence fires it at End of Turn): there is no target, so no friendly is disarmed', () => {
    const s = run({ board: [body('tb', 'tauntbreaker'), body('t', 'stray', { keywords: ['T', 'R'] })], runeLastingCadence: true });
    expect(() => applyEndOfTurn(s)).not.toThrow();
    expect(at(s, 't').keywords).toEqual(['T', 'R']);
  });

  it('24 damage: nothing; 25: one random Shop Spell flies to hand mid-fight (a live toHand from Tauntbreaker) with a pummelTrigger', () => {
    const none = fight([tb({ attack: 24 })], [foe(0, 24)]);
    expect(spellsGranted(none)).toEqual([]);
    expect(triggers(none)).toHaveLength(0);
    const r = fight([tb({ attack: 25 })], [foe(0, 25)]);
    expect(spellsGranted(r)).toHaveLength(1);
    expect(triggers(r)).toHaveLength(1);
    const uid = r.initial.player[0]!.uid;
    const trig = r.events.findIndex((e) => e.type === 'pummelTrigger');
    const hand = r.events.findIndex((e) => e.type === 'toHand' && e.source === uid);
    expect(hand, 'the spell is handed over the moment the meter crosses, right after the trigger').toBeGreaterThan(trig);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'tb', total: 25 }]);
  });

  it('the spell is a SHOP Spell from the run\'s set pool, at or below the shop tier (never a reward-only token)', () => {
    const r = fight([tb({ attack: 25 })], [foe(0, 25)], 2);
    const [id] = spellsGranted(r);
    const d = CARD_INDEX[id!]!;
    expect(d.spell).toBe(true);
    expect(d.token).toBeFalsy();
    expect(d.tier).toBeLessThanOrEqual(2);
    expect(SET2).toContain(id);
  });

  it('ONCE PER COMBAT: 50 damage in one fight (two hits of 25, or one 50 hit) pays ONE spell; the tally still reaches 50', () => {
    const two = fight([tb({ attack: 25 })], [foe(0, 25), foe(0, 25)]);
    expect(spellsGranted(two)).toHaveLength(1);
    expect(triggers(two)).toHaveLength(1);
    expect(two.playerDamageMeters).toEqual([{ sourceUid: 'tb', total: 50 }]);
    const one = fight([tb({ attack: 50 })], [foe(0, 1)]);
    expect(spellsGranted(one)).toHaveLength(1);
    expect(triggers(one)).toHaveLength(1);
  });

  it('ONCE PER COMBAT re-arms next fight: seeded at 50, a 25 hit crosses 75 and pays again', () => {
    const next = fight([tb({ attack: 25, damageDealt: 50 })], [foe(0, 25)]);
    expect(spellsGranted(next)).toHaveLength(1);
    expect(next.playerDamageMeters).toEqual([{ sourceUid: 'tb', total: 75 }]);
  });

  it('GILDED: 2 Shop Spells per payout, still once per combat', () => {
    expect(spellsGranted(fight([tb({ attack: 25, golden: true })], [foe(0, 25)]))).toHaveLength(2);
    expect(spellsGranted(fight([tb({ attack: 50, golden: true })], [foe(0, 1)]))).toHaveLength(2);
  });

  it('the spells carry into the real hand at settle, and the meter persists combat → shop → next combat', () => {
    const r1 = fight([tb({ attack: 20 })], [foe(0, 20)]);
    expect(spellsGranted(r1)).toEqual([]);
    let s = run({ phase: 'combat', board: [body('tb', 'tauntbreaker')], hand: [], lastCombat: r1 });
    s = act(s, { type: 'settleCombat' });
    expect(at(s, 'tb').damageDealt).toBe(20);
    expect(damageMeterReading(20, damageMeterOf(CARD_INDEX['tauntbreaker'])!), 'the shop reads 20/25').toEqual({ current: 20, total: 25 });
    // Next fight, seeded at 20: a 6 hit reaches 26 and pays.
    const r2 = fight([tb({ attack: 6, damageDealt: at(s, 'tb').damageDealt })], [foe(0, 6)]);
    expect(spellsGranted(r2)).toHaveLength(1);
    s = act({ ...s, phase: 'combat', lastCombat: r2, combatSettled: false } as RunState, { type: 'settleCombat' });
    expect(s.hand.map((h) => h.cardId)).toEqual(r2.playerHandGrants);
    expect(CARD_INDEX[s.hand[0]!.cardId]!.spell).toBe(true);
    expect(at(s, 'tb').damageDealt).toBe(26);
  });

  it('a hit that never lands (a Ward) adds nothing to the meter', () => {
    const r = fight([tb({ attack: 25 })], [foe(0, 25, ['DS'])]);
    // The first swing pops the Ward (no dmg), the Flurry swing lands 25.
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'tb', total: 25 }]);
  });
});

describe('Venom: "Execute" (owner 2026-10-03, text only)', () => {
  it('already has the Execute behaviour (the V keyword) and now prints it; nothing else changed', () => {
    const c = CARD_INDEX['venom']!;
    expect([c.tribe, c.tier, c.attack, c.health]).toEqual(['neutral', 3, 1, 1]);
    expect(c.keywords).toEqual(['V']);
    expect(c.effects).toEqual([]);
    expect(c.text).toBe('**Execute.**');
  });

  it('the Execute it prints is real: any damage it deals destroys the minion', () => {
    const r = simulate([{ cardId: 'venom', attack: 1, health: 50, keywords: ['V'] } as unknown as BoardMinion], [foe(0, 40)],
      makeRng(1), CARD_INDEX);
    expect(r.result).toBe('win');
  });
});
