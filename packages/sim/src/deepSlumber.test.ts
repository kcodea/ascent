/**
 * DEEP SLUMBER (Set 3 Epic Spirit rune, owner Yes vote 2026-11-23): "Minions in your hand gain double stats from every
 * source." One test per path a held card can gain stats on, each gain doubled exactly ONCE, and the writes that are
 * NOT gains (starting stats, a Gild, the settle carry-back of a combat gain). Real reducer throughout.
 * Combat half on its own: `packages/core/src/combat/set3NewRunesSpirits.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { ANCIENT_IDS, createRun, enableAncients, reduce, type Action, type BoardCard, type BoardSnapshot, type RunState } from './index';
import { createVersusRun } from './versus/run';
import { addBuff, applyWhisperBuff, conjureToHand, gildMinion, projectEndOfTurnSteps, stampDeepSlumber } from './recruit';
import { duosLinkSync, receiveLinkGain } from './duosLinks';
import { expireWhisperBuffs } from './whisper';

const probe = (id: string, over: Partial<CardDef>): CardDef => ({ id, name: id, tribe: 'spirit', tier: 1, attack: 1, health: 1, keywords: [], effects: [], text: '', ...over });
const SPIRIT = probe('dbg_ds_spirit', { attack: 2, health: 2 });
const SPIRIT_B = probe('dbg_ds_spiritb', { attack: 2, health: 2 });
const NEU = probe('dbg_ds_neu', { tribe: 'neutral', attack: 2, health: 2 });
const HAND_BUFF = { do: 'battlecryBuffRandomTribeBoardAndHand', params: { tribe: 'spirit', attack: 3, health: 4 } } as const;
const EOT = probe('dbg_ds_eot', { tribe: 'neutral', attack: 0, health: 400, effects: [{ on: 'endOfTurn', ...HAND_BUFF }] });
const SOT = probe('dbg_ds_sot', { tribe: 'neutral', attack: 0, health: 400, effects: [{ on: 'startOfTurn', ...HAND_BUFF }] });
for (const c of [SPIRIT, SPIRIT_B, NEU, EOT, SOT]) CARD_INDEX[c.id] = c;

const card = (id: string, uid: string, over: Partial<BoardCard> = {}): BoardCard => {
  const c = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: c.tribe, attack: c.attack, health: c.health, keywords: [...c.keywords], golden: false, ...over } as BoardCard;
};
const run = (board: BoardCard[], runes: string[], hand: BoardCard[] = []): RunState => {
  let s: RunState = { ...createRun(11, 'warden', 'ascent', undefined, 'set3'), phase: 'recruit', embers: 60, hand: [], board } as RunState;
  for (const id of runes) s = reduce(s, { type: 'devGrant', kind: 'rune', id });
  return { ...s, discover: undefined, discoverQueue: undefined, hand };
};
const DS = 'rune_deep_slumber';
const at = (s: RunState, uid: string) => [...s.board, ...s.hand].find((c) => c.uid === uid)!;
const stats = (s: RunState, uid: string): [number, number] => [at(s, uid).attack, at(s, uid).health];
const foe = (s: RunState, attack: number, health: number): BoardSnapshot => ({
  v: 1, wave: s.wave, heroId: 'indy', resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 1,
  minions: [{ cardId: 'sandbag', attack, health, keywords: [] }], seed: 1, origin: 'self',
});
const faceOmen = (s: RunState, attack: number, health: number): RunState => reduce({ ...s, servedBoards: { [s.wave]: foe(s, attack, health) } }, { type: 'faceOmen' });
type Summon = Extract<CombatEvent, { type: 'summon' }>;
const handSummons = (s: RunState): Summon[] => (s.lastCombat!.events as CombatEvent[]).filter((e): e is Summon => e.type === 'summon' && e.side === 'player' && !!(e as { fromHandUid?: string }).fromHandUid);
const play = (s: RunState, uid: string): RunState => reduce(s, { type: 'play', uid, toIndex: 0 });

describe('Deep Slumber: every path a held minion gains stats on', () => {
  it('SHOP ACTION: a Spirit played (Chosen Vessel +2/+2) lands +4/+4, its extra on its own breakdown row', () => {
    const go = (runes: string[]) => play(run([], ['rune_chosen_vessel', ...runes], [card(NEU.id, 'h'), card(SPIRIT.id, 'p')]), 'p');
    expect(stats(go([]), 'h')).toEqual([4, 4]);
    const on = go([DS]);
    expect(stats(on, 'h')).toEqual([6, 6]);
    expect(at(on, 'h').buffs).toEqual([
      { source: 'Chosen Vessel', attack: 2, health: 2, count: 1 }, { source: 'Deep Slumber', attack: 2, health: 2, count: 1 },
    ]);
    expect(on.runeProcs?.[DS]).toBe(1);
  });
  it('END OF TURN, then a hand-summon in the SAME fight: the summoned body carries the doubled gain', () => {
    const go = (runes: string[]) => faceOmen(run([card(EOT.id, 'e'), card('sp3_dreamtide', 'c', { attack: 1, health: 1, keywords: ['T'] })], runes, [card(SPIRIT.id, 'h')]), 50, 900);
    const off = go([]), on = go([DS]);
    expect(stats(off, 'h')).toEqual([5, 6]);
    expect(stats(on, 'h'), 'doubled exactly once').toEqual([8, 10]);
    expect(handSummons(off).map((e) => [e.minion.attack, e.minion.health])).toEqual([[5, 6]]);
    expect(handSummons(on).map((e) => [e.minion.attack, e.minion.health]), 'this fight already reads it').toEqual([[8, 10]]);
  });
  it('END OF TURN projection: the beat the Shop plays shows the doubled gain and leaves the run untouched', () => {
    const s = run([card(EOT.id, 'e')], [DS], [card(SPIRIT.id, 'h')]);
    const { steps } = projectEndOfTurnSteps(s);
    expect(steps.some((m) => m['h']?.attack === 8 && m['h']?.health === 10)).toBe(true);
    expect(stats(s, 'h')).toEqual([2, 2]);
  });
  it('START OF TURN: a gain while leaving combat is doubled exactly once, inside its own beat', () => {
    const go = (runes: string[]): RunState => {
      let s = run([card(SOT.id, 'm')], runes, [card(SPIRIT.id, 'h')]);
      s = faceOmen(s, 0, 1);
      expect(stats(s, 'h'), 'nothing before the turn starts').toEqual([2, 2]);
      s = reduce(s, { type: 'resolveCombat' });
      expect(s.phase).toBe('recruit');
      return s;
    };
    expect(stats(go([]), 'h')).toEqual([5, 6]);
    const on = go([DS]);
    expect(stats(on, 'h')).toEqual([8, 10]);
    // The rune's pulse belongs to that source's own Start of Turn beat (the recorder lists board gains only, so a hand
    // gain has no row of its own there).
    const beat = (on.sotBeatFx ?? []).find((b) => b.procs?.[DS]);
    expect([beat?.source.uid, beat?.procs?.[DS]]).toEqual(['m', 1]);
  });
  it('COMBAT then SETTLE: the fight doubles the hand gain, the carry-back reports it, and settle does not double again', () => {
    const go = (runes: string[]) => faceOmen(run([card('sp3_hearthwhisperer', 'w', { attack: 0, health: 60 })], runes, [card(SPIRIT.id, 'h')]), 2, 900);
    const sum = (s: RunState) => (s.lastCombat!.playerHandBuffs ?? []).reduce((a, b) => [a[0]! + b.attack, a[1]! + b.health], [0, 0]);
    const off = go([]), on = go([DS]);
    const [oa, oh] = sum(off) as [number, number];
    expect(oa).toBeGreaterThan(0);
    expect(sum(on), 'the carry-back is the doubled gain').toEqual([2 * oa, 2 * oh]);
    const offEnd = reduce(off, { type: 'settleCombat' }), onEnd = reduce(on, { type: 'settleCombat' });
    expect(stats(offEnd, 'h')).toEqual([2 + oa, 2 + oh]);
    expect(stats(onEnd, 'h'), 'twice the gain, never four times').toEqual([2 + 2 * oa, 2 + 2 * oh]);
  });
  it('SETTLE of a run-wide gain (Rune of Overflow reaching the hand): doubled once as it lands', () => {
    const go = (runes: string[]): RunState => {
      const s = { ...run([card(NEU.id, 'n')], runes, [card(SPIRIT.id, 'h')]), phase: 'combat', lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, playerBoardBuffGain: { attack: 2, health: 3 } } } as unknown as RunState;
      return reduce(s, { type: 'settleCombat' });
    };
    expect(stats(go([]), 'h')).toEqual([4, 5]);
    const on = go([DS]);
    expect(stats(on, 'h')).toEqual([6, 8]);
    expect(stats(on, 'n'), 'the board is never doubled').toEqual([4, 5]);
  });
  it('two copies pay three times the gain', () => {
    const on = play(run([], ['rune_chosen_vessel', DS, DS], [card(NEU.id, 'h'), card(SPIRIT.id, 'p')]), 'p');
    expect(stats(on, 'h')).toEqual([8, 8]);
  });
  it('DOZER: +4/+4 per Spirit played becomes +8/+8, and each Spirit pays once', () => {
    const go = (runes: string[]): RunState => {
      const s = run([], runes, [card('sp3_slumbering', 'd'), card(SPIRIT.id, 'p'), card(SPIRIT_B.id, 'q')]);
      return play(play(s, 'p'), 'q');
    };
    expect(stats(go([]), 'd')).toEqual([12, 14]);
    expect(stats(go([DS]), 'd')).toEqual([20, 22]);
  });
  it('HANDY FLAME: the chain is bounded (a doubled payout never fires a Flame again this action)', () => {
    const go = (runes: string[]) => play(run([], ['rune_chosen_vessel', ...runes], [card('sp3_handyflame', 'f1'), card('sp3_handyflame', 'f2'), card(SPIRIT.id, 'p')]), 'p');
    const off = go([]), on = go([DS]);
    expect([stats(off, 'f1'), stats(off, 'f2')]).toEqual([[4, 15], [8, 17]]);
    expect([stats(on, 'f1'), stats(on, 'f2')], 'f1 +4/+4, f2 one payout of +12/+8').toEqual([[6, 17], [14, 21]]);
  });
  it('DREAM MIRROR reads the doubled gain', () => {
    const go = (runes: string[]) => play(run([card(NEU.id, 'b')], ['rune_chosen_vessel', 'rune_dream_mirror', ...runes], [card(NEU.id, 'h'), card(SPIRIT.id, 'p')]), 'p');
    const total = (s: RunState) => s.board.reduce((n, c) => n + c.attack + c.health, 0);
    expect(total(go([DS])) - total(go([]))).toBe(4);
  });
});

describe('Deep Slumber: what is NOT a gain', () => {
  it('a board minion is never doubled', () => {
    const go = (runes: string[]) => play(run([card(SPIRIT_B.id, 'b')], ['rune_deep_currents', ...runes], [card(SPIRIT.id, 'p')]), 'p');
    expect(stats(go([DS]), 'b')).toEqual(stats(go([]), 'b'));
    expect(go([DS]).runeProcs?.[DS] ?? 0).toBe(0);
  });
  it('a card entering the hand in the same action keeps its starting stats (bought with Shop buffs, conjured with an enchant)', () => {
    const buy = (runes: string[]): RunState => {
      const s = run([], runes);
      return reduce({ ...s, hand: [], tavernBuyBonus: { atk: 3, hp: 1 }, shop: [{ uid: 'o1', cardId: SPIRIT.id, atk: 2, hp: 2 }] } as RunState, { type: 'buy', uid: 'o1' } as Action);
    };
    const bought = (s: RunState) => s.hand.map((c) => [c.cardId, c.attack, c.health]);
    expect(bought(buy([]))).toEqual([[SPIRIT.id, 7, 5]]);
    expect(bought(buy([DS]))).toEqual([[SPIRIT.id, 7, 5]]);
    const conj = (runes: string[]) => { const s = { ...run([], runes), cardBuffs: { [SPIRIT.id]: { attack: 5, health: 6 } } } as RunState; stampDeepSlumber(s); conjureToHand(s, [SPIRIT], 1); return s.hand.map((c) => [c.attack, c.health]); };
    expect(conj([DS])).toEqual(conj([]));
    expect(conj([DS])).toEqual([[7, 8]]);
  });
  it('a card that entered this action and THEN gains is doubled on that gain only', () => {
    const s = run([], [DS]);
    stampDeepSlumber(s);
    conjureToHand(s, [SPIRIT], 1);
    addBuff(s.hand[0]!, 'X', 1, 1);
    expect([s.hand[0]!.attack, s.hand[0]!.health]).toEqual([4, 4]);
  });
  it('GILDING in hand doubles the base once (the Gild is not a gain); a real gain beside it is still doubled', () => {
    const s = run([], [DS], [card(SPIRIT.id, 'h')]);
    stampDeepSlumber(s);
    gildMinion(s.hand[0]!, s);
    expect(stats(s, 'h')).toEqual([4, 4]);
    addBuff(s.hand[0]!, 'X', 1, 2);
    expect(stats(s, 'h')).toEqual([6, 8]);
  });
  it('a loss, a spell and a Ruby in hand are never doubled', () => {
    const ruby = Object.values(CARD_INDEX).find((c) => c!.ruby)!;
    const s = run([], [DS], [card(SPIRIT.id, 'h'), card('crescendo', 'sp'), card(ruby.id, 'r')]);
    stampDeepSlumber(s);
    addBuff(at(s, 'h'), 'X', -1, 0);
    expect(stats(s, 'h')).toEqual([1, 2]);
    const [sa, sh] = stats(s, 'sp'), [ra, rh] = stats(s, 'r');
    addBuff(at(s, 'sp'), 'X', 1, 1); addBuff(at(s, 'r'), 'X', 1, 1);
    expect(stats(s, 'sp')).toEqual([sa + 1, sh + 1]);
    expect(stats(s, 'r')).toEqual([ra + 1, rh + 1]);
  });
});

describe('Deep Slumber: the paths that mirror or take back a gain', () => {
  it('a temporary Whisper grant on a held minion comes off whole', () => {
    const s = run([], [DS], [card(SPIRIT.id, 'h')]);
    stampDeepSlumber(s);
    applyWhisperBuff(s.hand[0]!, 'Whisper', 3, 2);
    expect(stats(s, 'h')).toEqual([8, 6]);
    expireWhisperBuffs(s);
    expect(stats(s, 'h')).toEqual([2, 2]);
    expect(at(s, 'h').buffs).toBeUndefined();
  });
  it('Xerox × Bonds: two held bound copies both end on the doubled gain (never doubled twice)', () => {
    let s = enableAncients({ ...createRun(7, 'xerox'), phase: 'recruit', embers: 60, hand: [], board: [card(NEU.id, 'a')] } as RunState);
    s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: ['bonds', ...ANCIENT_IDS.filter((a) => a !== 'bonds').slice(0, 2)] } };
    s = reduce(s, { type: 'pickAncient', id: 'bonds' });
    s = reduce(s, { type: 'heroPower', uid: 'a' });
    const bond = s.ancients!.xeroxBond!;
    s = reduce(s, { type: 'devGrant', kind: 'rune', id: DS });
    s = { ...s, hand: [...s.board], board: [] };
    s = reduce(s, { type: 'devGrant', kind: 'rune', id: 'rune_chosen_vessel' }); // restamps the bond on this hand
    s = { ...s, discover: undefined, discoverQueue: undefined, hand: [...s.hand.filter((c) => c.uid === bond.a || c.uid === bond.b), card(SPIRIT.id, 'p')] };
    s = play(s, 'p');
    expect([stats(s, bond.a), stats(s, bond.b)]).toEqual([[6, 6], [6, 6]]);
  });
  it('a Linked twin\'s gain is doubled here and never sent back', () => {
    const s = { ...createVersusRun(11, 'cindy', 'set2', { v: 1, mode: 'duos', modifiers: [] }, 'warden'), phase: 'recruit', board: [], hand: [card(NEU.id, 'h', { duosLink: { id: 'L', a: 2, h: 2 } })], questFlags: { runeDeepSlumber: true } } as unknown as RunState;
    stampDeepSlumber(s);
    duosLinkSync(s);
    const sent = s.duos!.outbox.length;
    receiveLinkGain(s, 'L', 3, 1);
    expect(stats(s, 'h')).toEqual([8, 4]);
    duosLinkSync(s);
    expect(s.duos!.outbox.length, 'nothing echoes back to the twin').toBe(sent);
  });
});
