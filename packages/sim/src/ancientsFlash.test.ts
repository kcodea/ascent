/**
 * ANCIENTS × FLASH (owner pairings 2026-10-09). First or Last (1 Gold): "Claim a copy of the first or last minion you kill
 * next combat." Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { BoardMinion, CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, activePowers, ancientCombatMods, ancientOfferText, createRun, enableAncients, heroPowerText, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';

const BASE = 'Claim a copy of the **first** or **last** minion you kill next combat.';
const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && !c.henchman).map((c) => c.id);
const N = (i: number) => NEUTRALS[i % NEUTRALS.length]!;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'flash'), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
/** Three distinct, weak enemy bodies in a fixed order (the first / 2nd / last kill are knowable). */
const foeBoard = (wave: number, minions: BoardMinion[]): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: 9, minions, seed: 1, origin: 'self',
});
const weak = (): BoardMinion[] => [0, 1, 2].map((i) => ({ cardId: N(i + 3), attack: 1, health: 1, keywords: [] }) as unknown as BoardMinion);
const fightVs = (s: RunState, minions: BoardMinion[]): RunState => reduce({ ...s, servedBoards: { [s.wave]: foeBoard(s.wave, minions) } }, { type: 'faceOmen' });
const events = (s: RunState): CombatEvent[] => s.lastCombat!.events as CombatEvent[];
const toHand = (s: RunState) => events(s).filter((e): e is Extract<CombatEvent, { type: 'toHand' }> => e.type === 'toHand' && e.side === 'player').map((e) => e.cardId);
const arm = (s: RunState, pick: 'first' | 'last'): RunState => {
  const t = reduce(s, { type: 'heroPower', flashPick: pick });
  expect(t, `armed ${pick}`).not.toBe(s);
  return t;
};
const strong = () => [card('a', N(0), { attack: 50, health: 500 })];

describe('Flash × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('flash', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('flash', id)).not.toMatch(/—|--/);
    }
  });
});

describe('Flash × DEATH: "Also get a copy of the 2nd minion that dies."', () => {
  it('armed: the first kill AND the 2nd enemy kill fly to hand, live', () => {
    let s = arm(picked('death', { board: strong() }), 'first');
    expect(heroPowerText(s)).toBe(`${BASE} Also get a copy of the **2nd** minion you kill.`);
    expect(ancientCombatMods(s).ancientFlash).toEqual({ second: true, label: 'Ancient of Death' });
    s = fightVs(s, weak());
    const kills = events(s).filter((e) => e.type === 'death' && (e as { side?: string }).side === 'enemy').map((e) => (e as { target: string }).target);
    const ids = kills.map((uid) => s.lastCombat!.initial.enemy.find((m) => m.uid === uid)?.cardId);
    expect(toHand(s)).toEqual([ids[0], ids[1]]);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.hand.map((c) => c.cardId)).toEqual([ids[0], ids[1]]);
  });
  it('not armed: nothing (it rides First or Last\'s claim)', () => {
    const s = fightVs(picked('death', { board: strong() }), weak());
    expect(toHand(s)).toEqual([]);
  });
});

describe('Flash × FORTUNE (ancient pass 2, owner 2026-11-16): "The minion you get from First or Last is Gilded if you lose the combat."', () => {
  const losing = (): BoardMinion[] => [
    { cardId: N(3), attack: 1, health: 1, keywords: [] } as unknown as BoardMinion,
    { cardId: N(4), attack: 200, health: 5000, keywords: [] } as unknown as BoardMinion,
  ];
  it('a LOST fight: the claimed copy lands Gilded; the power keeps its price', () => {
    let s = picked('fortune', { board: [card('a', N(0), { attack: 10, health: 10 })] });
    expect(activePowers(s)[0]!.cost).toBe(1);
    expect(heroPowerText(s)).toBe(`${BASE} If you lose that combat, the minion you get is **Gilded**.`);
    expect(ancientOfferText('flash', 'fortune')).toBe('The minion you get from First or Last is **Gilded** if you lose the combat.');
    s = arm(s, 'first');
    expect(ancientCombatMods(s).ancientFlash).toEqual({ gildOnLoss: true, label: 'Ancient of Fortune' });
    s = fightVs(s, losing());
    expect(s.lastCombat!.result).toBe('lose');
    expect(toHand(s)).toEqual([N(3)]);
    s = reduce(s, { type: 'resolveCombat' });
    const got = s.hand.find((c) => c.cardId === N(3))!;
    expect(got.golden).toBe(true);
    expect(got.attack).toBe(CARD_INDEX[N(3)]!.attack * 2);
  });
  it('a WON fight: the claimed copy is plain', () => {
    let s = arm(picked('fortune', { board: strong() }), 'first');
    s = fightVs(s, weak());
    expect(s.lastCombat!.result).toBe('win');
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.hand.find((c) => c.cardId === N(3))!.golden).toBe(false);
  });
  it('without Fortune a lost claim stays plain', () => {
    let s = arm(picked('death', { board: [card('a', N(0), { attack: 10, health: 10 })] }), 'first');
    s = fightVs(s, losing());
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.hand.find((c) => c.cardId === N(3))!.golden).toBe(false);
  });
});

describe('Flash × WAR (ancient pass 2, owner 2026-11-16): "Pummel (400): get a copy of a random enemy minion. Twice per combat."', () => {
  it('pays at most TWO copies a fight however many 400s it crosses, live; the tally carries', () => {
    let s = picked('war', { board: [card('a', N(0), { attack: 300, health: 9000 })] });
    expect(heroPowerText(s)).toContain('Twice per combat (**2** left this combat)');
    expect(heroPowerText(s)).toContain('(**0/400**)');
    s = { ...s, ancients: { ...s.ancients!, pummelDealt: 350 } };
    expect(ancientCombatMods(s).ancientFlash).toEqual({ pummel: { every: 400, dealt: 350, max: 2 }, label: 'Ancient of War' });
    const foes = [0, 1, 2, 3].map((i) => ({ cardId: N(i + 3), attack: 1, health: 400 }) as unknown as BoardMinion);
    s = fightVs(s, foes);
    const dealt = s.lastCombat!.playerAncientPummelDealt!;
    expect(Math.floor(dealt / 400) - Math.floor(350 / 400), 'crossed 400 three times or more').toBeGreaterThanOrEqual(3);
    expect(toHand(s).length).toBe(2);
    expect(heroPowerText(s, 0, { friendlyDamage: 50 }), 'one crossing on screen: one left').toContain('(**1** left this combat)');
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.ancients!.pummelDealt).toBe(dealt);
    expect(heroPowerText(s)).toContain(`(**${dealt % 400}/400**)`);
  });
});

describe('Flash × GENESIS: "First or Last grants 2 copies."', () => {
  it('the claim grants 2 copies of the first kill', () => {
    let s = arm(picked('genesis', { board: strong() }), 'first');
    expect(heroPowerText(s)).toBe('Claim **2** copies of the **first** or **last** minion you kill next combat.');
    s = fightVs(s, weak());
    const t = toHand(s);
    expect(t.length).toBe(2);
    expect(t[0]).toBe(t[1]);
  });
  it('with Rune of Wishbone it multiplies (4)', () => {
    let s = arm(picked('genesis', { board: strong() }), 'last');
    s = reduce(s, { type: 'devGrant', kind: 'rune', id: 'rune_wishbone' });
    s = fightVs(s, weak());
    expect(toHand(s).length).toBe(4);
  });
});

describe('Flash × TIME (ancient pass 2, owner 2026-11-16): "minions granted from first or last grant its stats to a random friendly minion"', () => {
  const total = (st: RunState) => st.board.reduce((n, c) => ({ attack: n.attack + c.attack, health: n.health + c.health }), { attack: 0, health: 0 });
  it('the claimed copy also gives its printed stats to a random friendly minion, in the fight and permanently', () => {
    let s = picked('time', { board: [card('a', N(0), { attack: 50, health: 500 }), card('b', N(1), { attack: 1, health: 900 })] });
    expect(heroPowerText(s)).toBe(`${BASE} The minion you get also gives its stats to a random friendly minion, permanently.`);
    s = arm(s, 'first');
    expect(ancientCombatMods(s).ancientFlash).toEqual({ claimStats: true, label: 'Ancient of Time' });
    const before = total(s);
    s = fightVs(s, weak());
    const d = CARD_INDEX[N(3)]!;
    expect(toHand(s)).toEqual([N(3)]);
    expect(events(s).some((e) => e.type === 'buff' && e.attack === d.attack && e.health === d.health)).toBe(true);
    s = reduce(s, { type: 'resolveCombat' });
    expect(total(s)).toEqual({ attack: before.attack + d.attack, health: before.health + d.health });
  });
  it('no claim armed: nothing', () => {
    let s = picked('time', { board: [card('a', N(0), { attack: 50, health: 500 })] });
    const before = total(s);
    s = reduce(fightVs(s, weak()), { type: 'resolveCombat' });
    expect(toHand({ ...s, lastCombat: s.lastCombat })).toEqual([]);
    expect(total(s)).toEqual(before);
  });
});

describe('Flash × BONDS: "The minion you get is an exact copy."', () => {
  it('the copy keeps the killed body\'s stats, keywords and Gilded', () => {
    let s = arm(picked('bonds', { board: strong() }), 'first');
    expect(heroPowerText(s)).toBe(`${BASE} It is an **exact** copy: it keeps its stats, keywords and **Gilded**.`);
    const big = { cardId: N(3), attack: 13, health: 17, keywords: ['T'], golden: true } as unknown as BoardMinion;
    s = fightVs(s, [big]);
    expect(toHand(s)).toEqual([N(3)]);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.hand[0]).toMatchObject({ cardId: N(3), attack: 13, health: 17, golden: true });
    expect(s.hand[0]!.keywords).toContain('T');
  });
  it('without Bonds the copy is the printed card', () => {
    let s = arm(picked('fortune', { board: strong() }), 'first');
    s = reduce(fightVs(s, [{ cardId: N(3), attack: 13, health: 17, keywords: ['T'], golden: true } as unknown as BoardMinion]), { type: 'resolveCombat' });
    expect(s.hand[0]).toMatchObject({ cardId: N(3), attack: CARD_INDEX[N(3)]!.attack, golden: false });
  });
});

describe('Flash × determinism', () => {
  it('every pairing replays identically from the same state', () => {
    for (const id of ANCIENT_IDS) {
      const run = () => {
        let s = arm(picked(id, { wave: 4, board: [card('a', N(0), { attack: 200, health: 900 }), card('b', N(1), { attack: 3, health: 3 })] }), 'last');
        s = { ...s, ancients: { ...s.ancients!, pummelDealt: 390 } };
        return reduce(fightVs(s, weak()), { type: 'resolveCombat' });
      };
      const a = run();
      const b = run();
      expect(JSON.stringify(a.lastCombat?.events), id).toBe(JSON.stringify(b.lastCombat?.events));
      expect(JSON.stringify(a.hand), id).toBe(JSON.stringify(b.hand));
      expect(JSON.stringify(a.ancients), id).toBe(JSON.stringify(b.ancients));
    }
  });
});
