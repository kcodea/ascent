import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { applyEndOfTurn } from './recruit';

/**
 * THE OWNER'S KOBOLD NERF BATCH (2026-10-11, "kobolds are overtuned") through the real reducer / End-of-Turn
 * paths: four Ruby-strength gains come down, Gemling casts one Veinstorm fewer, and Assembler replaces the
 * archived Frenzied Excavator.
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set2', phase: 'recruit', embers: 20, tier: 6, hand: [], board: [], shop: [], ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const rubies = (c: BoardCard) => (c.buffs ?? []).filter((b) => b.source === 'Ruby');
const rubyBuff = (c: BoardCard) => rubies(c).reduce((n, b) => ({ attack: n.attack + b.attack, health: n.health + b.health }), { attack: 0, health: 0 });

describe('Ruby strength gains come down', () => {
  it.each([[false, 1], [true, 2]] as const)('Ruby Mender (golden=%s): Shout +%i Health', (golden, health) => {
    const s = act(run({ hand: [body('m', 'k_deepvein', { golden })] }), { type: 'play', uid: 'm' });
    expect(s.rubyBonus).toEqual({ attack: 0, health });
  });
  it.each([[false, { attack: 2, health: 1 }], [true, { attack: 4, health: 2 }]] as const)('Cave Cutter (golden=%s): the strength branch is %o', (golden, gain) => {
    let s = act(run({ hand: [body('c', 'k_veinbreaker', { golden })] }), { type: 'play', uid: 'c' });
    s = act(s, { type: 'chooseOne', index: 0 });
    expect(s.rubyBonus).toEqual(gain);
  });
  it('Crownvein: Rally +1/+2', () => {
    const d = CARD_INDEX['k_crownvein']!;
    expect(d.effects.map((e) => [e.on, e.do, e.params])).toEqual([['onAttack', 'rallyRubyStatGain', { attack: 1, health: 2 }]]);
  });
  it('Portsmith: Avenge (3) +1/+1, still 2 Kobolds and Ward', () => {
    const d = CARD_INDEX['k_portsmith']!;
    expect(d.keywords).toContain('DS');
    expect(d.effects.map((e) => [e.on, e.do, e.params])).toEqual([
      ['avenge', 'avengeRubyStatGain', { count: 3, attack: 1, health: 1 }],
      ['avenge', 'avengeGrantRandomTribeMinion', { count: 3, tribe: 'kobold', grant: 2 }],
    ]);
  });
  it('the printed numbers match the params (plain and Gilded)', () => {
    const text = (id: string) => [CARD_INDEX[id]!.text, CARD_INDEX[id]!.goldenText];
    expect(text('k_deepvein')).toEqual(['**Shout:** Your Rubies gain **+1 Health**.', '**Shout:** Your Rubies gain **+2 Health**.']);
    expect(text('k_veinbreaker').map((t) => /\*\*\+(\d)\/\+(\d)\*\*/.exec(t!)!.slice(1, 3))).toEqual([['2', '1'], ['4', '2']]);
    expect(CARD_INDEX['k_veinbreaker']!.chooseOne![0]).toMatchObject({ text: 'Give your Rubies **+2/+1**.', goldenText: 'Give your Rubies **+4/+2**.' });
    expect(text('k_crownvein')).toEqual(['**Rally:** Give your Rubies **+1/+2**.', '**Rally:** Give your Rubies **+2/+4**.']);
    expect(text('k_portsmith').map((t) => /\*\*\+(\d)\/\+(\d)\*\*/.exec(t!)!.slice(1, 3))).toEqual([['1', '1'], ['2', '2']]);
  });
});

// Gemling's "2 casts" from this batch became "cast once and get a Ruby Transfer" on 2026-10-13: see
// koboldBalance1013.test.ts.

describe('Assembler: "End of Turn: Cast 2 Rubies on your other Kobolds"', () => {
  const board = (golden = false): BoardCard[] => [
    body('k1', 'k_beggy'), body('as', 'k_assembler', { golden }), body('k2', 'k_geode'), body('n', 'sandbag'),
  ];

  it.each([[false, 2], [true, 4]] as const)('golden=%s: %i Rubies on every OTHER Kobold, none on itself or a non-Kobold', (golden, n) => {
    const s = run({ board: board(golden) });
    applyEndOfTurn(s);
    for (const uid of ['k1', 'k2']) {
      expect(rubyBuff(at(s, uid)), uid).toEqual({ attack: n, health: n });
      // N separate Rubies, not one of N times the size (each is a real Ruby play).
      expect(rubies(at(s, uid)).reduce((c, b) => c + (b.count ?? 1), 0), `${uid} Ruby count`).toBe(n);
    }
    expect(rubyBuff(at(s, 'as')), 'never itself').toEqual({ attack: 0, health: 0 });
    expect(rubyBuff(at(s, 'n')), 'Kobolds only').toEqual({ attack: 0, health: 0 });
  });

  it('each Ruby carries the run Ruby strength', () => {
    const s = run({ rubyBonus: { attack: 2, health: 1 }, board: board() });
    applyEndOfTurn(s);
    expect(rubyBuff(at(s, 'k1'))).toEqual({ attack: 6, health: 4 }); // 2 Rubies of 3/2
  });

  it('a second Assembler IS another Kobold: the two feed each other', () => {
    const s = run({ board: [body('a1', 'k_assembler'), body('a2', 'k_assembler')] });
    applyEndOfTurn(s);
    expect(rubyBuff(at(s, 'a1'))).toEqual({ attack: 2, health: 2 });
    expect(rubyBuff(at(s, 'a2'))).toEqual({ attack: 2, health: 2 });
  });

  it('alone on the board it does nothing', () => {
    const s = run({ board: [body('as', 'k_assembler')] });
    applyEndOfTurn(s);
    expect(rubyBuff(at(s, 'as'))).toEqual({ attack: 0, health: 0 });
  });

  // ("Alchemist Brisbane is unchanged: her End of Turn still includes herself" lived here. Her End of Turn was removed
  // on 2026-10-13, so Assembler is the only card on `endOfTurnPlayRuby` and it always passes `excludeSelf`.)
});

describe('Frenzied Excavator is archived; Assembler holds its slot', () => {
  it('Excavator is in no set but still resolves by id', () => {
    expect(CARD_INDEX['k_frenzied']?.name).toBe('Frenzied Excavator');
    for (const set of ['set2', 'set3'] as const) expect(poolFor(set).all.some((c) => c.id === 'k_frenzied'), set).toBe(false);
  });
  it('Assembler is a Tier 4 4/3 Kobold, drawable in set 2 only (as the Excavator was)', () => {
    const d = CARD_INDEX['k_assembler']!;
    expect([d.tribe, d.tier, d.attack, d.health, !!d.token]).toEqual(['kobold', 4, 4, 3, false]);
    expect(poolFor('set2').buyable.some((c) => c.id === 'k_assembler')).toBe(true);
    expect(poolFor('set3').all.some((c) => c.id === 'k_assembler')).toBe(false);
  });
});
