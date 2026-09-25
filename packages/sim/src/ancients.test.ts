/**
 * ANCIENTS proof of concept (owner rulings 2026-09-25): the meter, the flag, the seeded offer, and Indy's five
 * pairings in the phases the owner named.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, ANCIENT_NOT_WRITTEN, ancientOfferText, createRun, enableAncients, heroPowerText, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import * as recruitMod from './recruit';
import { deserialize, serialize } from './index';

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (heroId = 'indy', over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, heroId), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
const withAncients = (heroId = 'indy', over: Partial<RunState> = {}): RunState => enableAncients(base(heroId, over));
/** A run with `id` already picked (the offer + pick went through the real reducer). */
const picked = (id: AncientId, over: Partial<RunState> = {}, heroId = 'indy'): RunState => {
  let s = withAncients(heroId, over);
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const dummies = (wave: number, attack: number, health: number, n = 1): BoardSnapshot => ({
  v: 1, wave, heroId: 'warden', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health * n,
  minions: Array.from({ length: n }, () => ({ cardId: 'sandbag', attack, health, keywords: [] })), seed: 1, origin: 'self',
});

describe('Ancients — the meter', () => {
  it('starts empty (0 of 16); a refresh adds 1 (paid or free alike)', () => {
    let s = withAncients();
    expect([s.ancients!.points, s.ancients!.cost]).toEqual([0, 16]);
    s = reduce(s, { type: 'roll' });
    expect(s.ancients!.points).toBe(1);
    s = reduce({ ...s, freeRolls: 1 }, { type: 'roll' }); // a banked free refresh counts the same
    expect(s.ancients!.points).toBe(2);
  });

  it('a combat adds 2, as the next Shop opens', () => {
    let s = withAncients('indy', { board: [card('a', 'sandbag')] });
    s = { ...s, servedBoards: { [s.wave]: dummies(s.wave, 0, 3) } };
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.phase).toBe('recruit');
    expect(s.ancients!.points).toBe(2);
  });

  it('awakens EXACTLY once when full: the offer opens, the Shop pauses, and it never re-opens', () => {
    let s = withAncients();
    s = { ...s, ancients: { ...s.ancients!, points: 14 } };
    s = reduce(s, { type: 'roll' });
    expect(s.ancients!.offer).toBeUndefined();
    s = reduce(s, { type: 'roll' });
    expect(s.ancients!.points).toBe(16);
    expect(s.ancients!.offer).toHaveLength(3);
    expect(s.ancients!.offerSeq).toBe(1);
    // Paused: a refresh is refused while the offer is open.
    const gold = s.embers;
    expect(reduce(s, { type: 'roll' }).embers).toBe(gold);
    s = reduce(s, { type: 'pickAncient', id: s.ancients!.offer![0]! });
    expect(s.ancients!.offer).toBeUndefined();
    s = reduce(s, { type: 'roll' });
    expect(s.ancients!.offer).toBeUndefined();
    expect(s.ancients!.offerSeq).toBe(1);
  });

  it('refuses a pick that was not offered', () => {
    let s = withAncients();
    s = reduce(s, { type: 'ancientSetMeter', points: 16 });
    const notOffered = ANCIENT_IDS.find((a) => !s.ancients!.offer!.includes(a))!;
    expect(reduce(s, { type: 'pickAncient', id: notOffered })).toBe(s);
  });

  it('the rig can set the meter; full awakens it', () => {
    let s = withAncients();
    s = reduce(s, { type: 'ancientSetMeter', points: 5 });
    expect(s.ancients!.points).toBe(5);
    s = reduce(s, { type: 'ancientSetMeter', points: 16 });
    expect(s.ancients!.offer).toHaveLength(3);
  });
});

describe('Ancients — off by default', () => {
  it('a normal run carries no Ancient state and its refreshes / combats / actions are untouched', () => {
    let s = base('indy', { board: [card('a', 'sandbag')] });
    expect(s.ancientsEnabled).toBeUndefined();
    s = reduce(s, { type: 'roll' });
    expect(s.ancients).toBeUndefined();
    expect(reduce(s, { type: 'ancientSetMeter', points: 16 })).toBe(s);
    expect(reduce(s, { type: 'pickAncient', id: 'war' })).toBe(s);
  });

  it('a normal run plays byte-identically with the module present (same actions, same state)', () => {
    const run = (s0: RunState): RunState => {
      let s = s0;
      for (const a of [{ type: 'roll' }, { type: 'roll' }, { type: 'freeze' }] as const) s = reduce(s, a);
      return s;
    };
    const a = run(base('indy'));
    const b = run(base('indy'));
    expect(JSON.stringify({ ...a, lastCombat: null })).toBe(JSON.stringify({ ...b, lastCombat: null }));
    expect(a.ancients).toBeUndefined();
  });
});

describe('Ancients — the offer', () => {
  it('is 3 DISTINCT Ancients, seeded (same seed + wave → same offer), without touching the run cursor', () => {
    const open = (seed: number): RunState => reduce(enableAncients({ ...base(), seed } as RunState), { type: 'ancientSetMeter', points: 16 });
    const a = open(11), b = open(11);
    expect(a.ancients!.offer).toEqual(b.ancients!.offer);
    expect(new Set(a.ancients!.offer).size).toBe(3);
    for (const id of a.ancients!.offer!) expect(ANCIENT_IDS).toContain(id);
    const before = enableAncients({ ...base(), seed: 11 } as RunState);
    expect(a.rngCursor).toBe(before.rngCursor);
    // Different seeds reach different offers somewhere in a small sweep (it is not a constant).
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) seen.add(open(seed).ancients!.offer!.join(','));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('Ancients × Indy — the five pairings', () => {
  it('DEATH: the Masterwork target also gains Rise and Taunt, permanently', () => {
    let s = picked('death', { board: [card('a', 'gnash')] });
    s = reduce(s, { type: 'heroPower', uid: 'a' });
    const a = s.board.find((c) => c.uid === 'a')!;
    expect(a.golden).toBe(true);
    expect(a.keywords).toEqual(expect.arrayContaining(['R', 'T']));
  });

  it('FORTUNE: selling ANY gilded minion gets a plain, non-golden copy with printed stats', () => {
    let s = picked('fortune', { board: [card('g', 'gnash', { golden: true, attack: 99, health: 99 }), card('p', 'gnash')] });
    s = reduce(s, { type: 'sell', uid: 'g' });
    const copies = s.hand.filter((c) => c.cardId === 'gnash');
    expect(copies).toHaveLength(1);
    expect(copies[0]!.golden).toBe(false);
    expect([copies[0]!.attack, copies[0]!.health]).toEqual([CARD_INDEX.gnash!.attack, CARD_INDEX.gnash!.health]);
    // A plain sale gets nothing.
    const handBefore = s.hand.length;
    s = reduce(s, { type: 'sell', uid: 'p' });
    expect(s.hand.length).toBe(handBefore);
  });

  it('GENESIS: Masterwork no longer gilds; it gives 2 plain copies, which complete a triple with the original', () => {
    let s = picked('genesis', { board: [card('a', 'gnash')] });
    s = reduce(s, { type: 'heroPower', uid: 'a' });
    const all = [...s.board, ...s.hand].filter((c) => c.cardId === 'gnash');
    expect(all, 'three copies combined into one golden (the normal triple)').toHaveLength(1);
    expect(all[0]!.golden).toBe(true);
    expect(s.heroPowerSpent).toBe(true);
  });

  it('WAR (Shop): whenever a friendly minion dies, every OTHER gilded minion gains +8/+8', () => {
    const s = picked('war', { board: [card('g', 'gnash', { golden: true }), card('v', 'sandbag'), card('p', 'gnash')] });
    const g0 = { ...s.board.find((c) => c.uid === 'g')! }; // a snapshot: the buff mutates the card in place
    // A shop death through the real destroy path: Deathfibrillator-style destroy via the shared chokepoint.
    const { destroyMinionInShop, makeContext } = recruitMod;
    const victim = s.board.find((c) => c.uid === 'v')!;
    destroyMinionInShop(makeContext(s), victim);
    const g1 = s.board.find((c) => c.uid === 'g')!;
    const p1 = s.board.find((c) => c.uid === 'p')!;
    expect([g1.attack - g0.attack, g1.health - g0.health]).toEqual([8, 8]);
    expect([p1.attack, p1.health]).toEqual([CARD_INDEX.gnash!.attack, CARD_INDEX.gnash!.health]); // not gilded → nothing
  });

  it('WAR (combat): friendly deaths grow gilded minions in the fight AND the gain carries back', () => {
    let s = picked('war', { board: [card('g', 'alley', { golden: true, attack: 0, health: 400, keywords: [] }), card('f1', 'alley', { attack: 1, health: 1 }), card('f2', 'alley', { attack: 1, health: 1 })] });
    s = { ...s, servedBoards: { [s.wave]: dummies(s.wave, 3, 200) } };
    const before = { ...s.board.find((c) => c.uid === 'g')! };
    s = reduce(s, { type: 'faceOmen' });
    const lc = s.lastCombat!;
    const gUid = lc.initial.player[0]!.uid;
    const warBuffs = (lc.events as CombatEvent[]).filter((e) => e.type === 'buff' && e.target === gUid && e.source === 'Ancient of War');
    const playerDeaths = (lc.events as CombatEvent[]).filter((e) => e.type === 'death' && e.side === 'player' && e.target !== gUid).length;
    expect(playerDeaths).toBeGreaterThan(0);
    expect(warBuffs.length).toBe(playerDeaths);
    s = reduce(s, { type: 'resolveCombat' });
    const after = s.board.find((c) => c.uid === 'g')!;
    expect(after.attack - before.attack).toBe(8 * playerDeaths);
  });

  it('TIME: Start of Combat gilds the right-most minion for that fight only, and it reverts after', () => {
    let s = picked('time', { board: [card('a', 'sandbag', { health: 50 }), card('r', 'gnash')] });
    s = { ...s, servedBoards: { [s.wave]: dummies(s.wave, 0, 5) } };
    s = reduce(s, { type: 'faceOmen' });
    const lc = s.lastCombat!;
    const rUid = lc.initial.player[1]!.uid;
    const ev = lc.events as CombatEvent[];
    expect(ev.some((e) => e.type === 'ascend' && e.target === rUid && e.gild)).toBe(true);
    expect(ev.some((e) => e.type === 'buff' && e.target === rUid && e.source === 'Ancient of Time' && e.attack === CARD_INDEX.gnash!.attack)).toBe(true);
    // Never on the left-most.
    expect(ev.some((e) => e.type === 'ascend' && e.target === lc.initial.player[0]!.uid)).toBe(false);
    s = reduce(s, { type: 'resolveCombat' });
    const r = s.board.find((c) => c.uid === 'r')!;
    expect(r.golden).toBe(false);
    expect([r.attack, r.health]).toEqual([CARD_INDEX.gnash!.attack, CARD_INDEX.gnash!.health]);
  });

  it('TIME is combat-only: no Shop action gilds anything', () => {
    let s = picked('time', { board: [card('r', 'gnash')] });
    s = reduce(s, { type: 'roll' });
    expect(s.board[0]!.golden).toBe(false);
  });

  it('the hero power prints the COMBINED power (Genesis replaces the text)', () => {
    const g = picked('genesis');
    expect(heroPowerText(g)).toContain('2** plain copies');
    expect(heroPowerText(g)).not.toContain('Gilded');
    const w = picked('war');
    expect(heroPowerText(w)).toMatch(/^Make a friendly minion \*\*Gilded\*\*.*\+8\/\+8/);
  });
});

describe('Ancients — a hero with no pairing', () => {
  it('shows "Not written yet." and has no effect', () => {
    expect(ancientOfferText('warden', 'war')).toBe(ANCIENT_NOT_WRITTEN);
    const s = picked('war', { board: [card('g', 'gnash', { golden: true }), card('v', 'sandbag')] }, 'warden');
    const g0 = { ...s.board[0]! };
    recruitMod.destroyMinionInShop(recruitMod.makeContext(s), s.board[1]!);
    expect(s.board[0]!.attack).toBe(g0.attack);
    expect(heroPowerText(s)).toBe(heroPowerText({ ...s, ancientsEnabled: false }));
  });
});

describe('Ancients — serialisable', () => {
  it('a run with Ancients survives a JSON round trip', () => {
    const s = picked('time');
    const back = JSON.parse(JSON.stringify(s)) as RunState;
    expect(back.ancients).toEqual(s.ancients);
    expect(reduce(back, { type: 'roll' }).phase).toBe('recruit');
  });

  it('survives the save format (serialize → deserialize)', () => {
    const s = picked('war');
    const back = deserialize(serialize(s));
    expect(back?.ancients?.picked).toBe('war');
  });
});
