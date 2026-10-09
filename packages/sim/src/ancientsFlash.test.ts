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

describe('Flash × FORTUNE: "First or Last costs 0 Gold."', () => {
  it('arming costs nothing', () => {
    const s = picked('fortune');
    expect(activePowers(s)[0]!.cost).toBe(0);
    expect(heroPowerText(s)).toBe(`${BASE} It costs **0 Gold**.`);
    const t = arm(s, 'last');
    expect(t.embers).toBe(s.embers);
    expect(arm(base(), 'last').embers).toBe(base().embers - 1);
  });
});

describe('Flash × WAR: "Pummel (400): get a copy of a random enemy minion (once per combat)."', () => {
  it('the first 400 crossed in a fight pays ONE copy of a living enemy minion, live; the tally carries', () => {
    let s = picked('war', { board: [card('a', N(0), { attack: 300, health: 9000 })] });
    expect(heroPowerText(s)).toContain('(**0/400**)');
    s = { ...s, ancients: { ...s.ancients!, pummelDealt: 350 } };
    expect(ancientCombatMods(s).ancientFlash).toEqual({ pummel: { every: 400, dealt: 350 }, label: 'Ancient of War' });
    const foes = [0, 1].map((i) => ({ cardId: N(i + 3), attack: 1, health: 400 }) as unknown as BoardMinion);
    s = fightVs(s, foes);
    expect(toHand(s).length).toBe(1);
    expect([N(3), N(4)]).toContain(toHand(s)[0]);
    const dealt = s.lastCombat!.playerAncientPummelDealt!;
    expect(dealt).toBeGreaterThanOrEqual(1150);
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

describe('Flash × TIME: "Start of Combat: get a copy of a random enemy minion."', () => {
  it('Start of Combat: a copy of one enemy minion flies to hand, with no arming', () => {
    let s = picked('time', { board: [card('a', N(0), { attack: 1, health: 900 })] });
    expect(heroPowerText(s)).toBe(`${BASE} **Start of Combat:** get a copy of a random enemy minion.`);
    s = fightVs(s, weak());
    const t = toHand(s);
    expect(t.length).toBe(1);
    expect([N(3), N(4), N(5)]).toContain(t[0]);
    const firstAttack = events(s).findIndex((e) => e.type === 'attack');
    const grant = events(s).findIndex((e) => e.type === 'toHand');
    expect(grant).toBeLessThan(firstAttack);
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
