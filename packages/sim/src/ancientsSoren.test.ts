/**
 * ANCIENTS × SOREN (owner pairings 2026-10-02). Reclaim: "Choose a friendly minion. At the start of combat, destroy it and
 * resummon a copy when there is room." (free, once per turn). The Shop marks the minion (`resummon`); combat's Start of
 * Combat destroys it as a true death (its Echo fires) and an exact copy returns the moment there is room.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, ancientCombatMods, ancientOfferText, createRun, enableAncients, heroPowerText, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';

const BASE = 'Choose a friendly minion. At the start of combat, destroy it and resummon a copy when there is room.';
/** An effect-less Tier 1 body (3/3), so a death or a summon never muddies the numbers. */
const T1 = 'hm_test_squire';
const OTHER = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.ruby && !c.token && c.id !== T1 && c.effects.length === 0 && c.keywords.length === 0)!.id;
/** Distinct effect-less bodies (never three of one card, so a Shop action never completes a triple). */
const FILL = Object.values(CARD_INDEX).filter((c) => c && !c.spell && !c.ruby && !c.token && c.id !== T1 && c.effects.length === 0 && c.keywords.length === 0).map((c) => c.id);
/** An Echo that summons (a fixed count of bodies, never board-size dependent), not itself a token. */
const ECHO = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby && c.keywords.length === 0
  && c.effects.length === 1 && c.effects[0]!.on === 'onDeath' && c.effects[0]!.do === 'deathrattleSummon'
  && !(c.effects[0]!.params as { fixed?: boolean }).fixed)!;
const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'soren'), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const reclaim = (s: RunState, uid: string): RunState => reduce(s, { type: 'heroPower', uid });
const foes = (wave: number, attack: number, health: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health,
  minions: [{ cardId: 'sandbag', attack, health, keywords: [] }], seed: 1, origin: 'self',
});
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const fightNow = (s: RunState, attack = 0, health = 400): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, attack, health) } }, { type: 'faceOmen' });
const events = (s: RunState): CombatEvent[] => s.lastCombat!.events as CombatEvent[];
const summonsOf = (ev: CombatEvent[], cardId: string) =>
  ev.filter((e): e is Extract<CombatEvent, { type: 'summon' }> => e.type === 'summon' && e.side === 'player' && e.minion.cardId === cardId);
const buffsFrom = (ev: CombatEvent[], source: string) =>
  ev.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === source);
/** Reclaim `uid`, then fight a harmless wall (nothing dies but the Reclaimed body). */
const reclaimFight = (s: RunState, uid: string): RunState => fightNow(reclaim(s, uid));

describe('Soren × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('soren', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('soren', id)).not.toMatch(/—|--/);
    }
  });
  it('the fixtures are what the tests assume', () => {
    expect(CARD_INDEX[T1]!.effects.length).toBe(0);
    expect(ECHO).toBeDefined();
  });
  it('without Ancients, Reclaim marks in the Shop and resummons ONE copy at Start of Combat, no Gold', () => {
    let s = base({ board: [card('a', T1, { attack: 5, health: 40 })] });
    const gold = s.embers;
    s = reclaim(s, 'a');
    expect(at(s, 'a').resummon).toBe(true);
    expect(s.embers).toBe(gold);
    expect(s.hand.length).toBe(0);
    s = fightNow(s);
    expect(summonsOf(events(s), T1).length).toBe(1);
    expect(buffsFrom(events(s), 'Ancient of War').length).toBe(0);
    expect(s.ancients).toBeUndefined();
  });
});

describe('Soren × DEATH: "Echoes triggered by Reclaim trigger an additional time."', () => {
  const board = (): BoardCard[] => [card('e', ECHO.id, { health: 50 }), card('x', T1, { health: 50 })];
  it("the Reclaim destroy's Echo fires once more (its summons double, and the Echo tally counts both)", () => {
    const plain = reclaimFight(base({ board: board() }), 'e');
    const death = reclaimFight(picked('death', { board: board() }), 'e');
    // Only the Reclaim destroy's summons: the ones sourced from the Reclaimed body (the copy's own later Echo, if the
    // copy dies, is not Reclaim's and is not doubled).
    const tokens = (s: RunState) => {
      const anchor = summonsOf(events(s), ECHO.id)[0]!.source;
      return events(s).filter((e) => e.type === 'summon' && e.side === 'player' && e.source === anchor && e.minion.cardId !== ECHO.id).length;
    };
    expect(tokens(plain)).toBeGreaterThan(0);
    expect(tokens(death)).toBe(tokens(plain) * 2);
    expect(death.lastCombat!.playerDeathrattles, 'one more Echo trigger counted').toBe((plain.lastCombat!.playerDeathrattles ?? 0) + 1);
    expect(summonsOf(events(death), ECHO.id).length, 'the copy still returns once').toBe(1);
  });
  it('only the Reclaimed body: an Echo that dies otherwise in the same fight fires as normal', () => {
    const mk = (s: RunState) => fightNow(reclaim(s, 'x'), 100, 1000);
    const b = (): BoardCard[] => [card('e', ECHO.id, { health: 1 }), card('x', T1, { health: 50 })];
    const plain = mk(base({ board: b() }));
    const death = mk(picked('death', { board: b() }));
    expect(death.lastCombat!.playerDeathrattles).toBe(plain.lastCombat!.playerDeathrattles);
  });
  it('the combat mod carries echoExtra 1, and the power text says so', () => {
    const s = picked('death');
    expect(ancientCombatMods(s).ancientReclaim).toMatchObject({ echoExtra: 1, label: 'Ancient of Death' });
    expect(heroPowerText(s)).toBe(`${BASE} Its **Echo** triggers an extra time.`);
  });
});

describe('Soren × FORTUNE: "Reclaim works in Recruit phase instead. Gain 5g when it is used."', () => {
  it('destroys and resummons an exact copy in its slot right away, +5 Gold, no mark, nothing at Start of Combat', () => {
    let s = picked('fortune', { board: [card('l', OTHER, { health: 40 }), card('a', T1, { attack: 9, health: 40, keywords: ['T'], buffs: [{ source: 'X', attack: 6, health: 37, count: 1 }] }), card('r', OTHER, { health: 40 })] });
    const gold = s.embers;
    s = reclaim(s, 'a');
    expect(s.embers).toBe(gold + 5);
    expect(s.heroReady).toBe(false);
    expect(s.board.some((c) => c.uid === 'a'), 'the original is gone').toBe(false);
    const copy = s.board[1]!;
    expect(copy).toMatchObject({ cardId: T1, attack: 9, health: 40, keywords: ['T'] });
    expect(copy.buffs).toEqual([{ source: 'X', attack: 6, health: 37, count: 1 }]);
    expect(s.board.some((c) => c.resummon)).toBe(false);
    expect(reclaim(s, copy.uid), 'once per turn').toBe(s);
    s = fightNow(s);
    expect(summonsOf(events(s), T1).length, 'no Start-of-Combat Reclaim').toBe(0);
  });
  it('the Echo fires in the Shop, where the minion stood; the copy returns to the right of its summons', () => {
    let s = picked('fortune', { board: [card('l', T1), card('e', ECHO.id), card('r', T1)] });
    s = reclaim(s, 'e');
    const ids = s.board.map((c) => c.cardId);
    expect(ids[0]).toBe(T1);
    expect(ids[ids.length - 1]).toBe(T1);
    expect(ids.length).toBeGreaterThan(3); // the Echo summoned
    expect(ids[ids.length - 2], 'the copy sits right after the Echo summons').toBe(ECHO.id);
  });
  it('a full board after the Echo: an overflow, and the copy is lost (owner 2026-10-02)', () => {
    let s = picked('fortune', { board: [card('e', ECHO.id), ...['b', 'c', 'd', 'f', 'g', 'h'].map((u, i) => card(u, FILL[i]!))] });
    s = reclaim(s, 'e');
    expect(s.board.length).toBe(7);
    expect(s.board.some((c) => c.cardId === ECHO.id && c.uid !== 'e'), 'no copy').toBe(ECHO.effects[0]!.params?.cardId === ECHO.id);
    expect(s.hand.length, 'never sent to hand').toBe(0);
    expect(s.embers).toBe(65);
  });
  it('a Rise is ignored (a true death, like combat Reclaim)', () => {
    let s = picked('fortune', { board: [card('a', T1, { keywords: ['R'] })] });
    s = reclaim(s, 'a');
    expect(s.board.length).toBe(1);
    expect(s.board[0]!.keywords).toEqual(['R']); // the exact copy keeps its Rise; nothing Rose
  });
});

describe('Soren × WAR: "Reclaimed minions gain +10/+10 on re-summon. Start of Turn: Improve this."', () => {
  it('the copy gains +X/+X on its return, for that combat only (owner: "fight only")', () => {
    let s = reclaimFight(picked('war', { board: [card('a', T1, { health: 40 })] }), 'a');
    const war = buffsFrom(events(s), 'Ancient of War');
    expect(war.length).toBe(1);
    expect(war[0]).toMatchObject({ attack: 10, health: 10 });
    expect(war[0]!.target).toBe(summonsOf(events(s), T1)[0]!.minion.uid);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.board.map((c) => [c.attack, c.health])).toEqual([[3, 40]]);
  });
  it('an Engraved minion keeps it ("engraving etc would carry it back")', () => {
    let s = reclaimFight(picked('war', { board: [card('a', T1, { health: 40, keywords: ['EG'] })] }), 'a');
    s = reduce(s, { type: 'resolveCombat' });
    expect(at(s, 'a')).toMatchObject({ attack: 13, health: 50 });
  });
  it('Start of Turn improves it by +10/+10, printed live on the power', () => {
    let s = picked('war', { board: [card('a', T1, { health: 40 })] });
    expect(s.ancients!.sorenWarGain).toBe(10);
    expect(heroPowerText(s)).toBe(`${BASE} The copy gains **+10/+10** for that combat. **Start of Turn:** improve this by **+10/+10**.`);
    s = reduce(fightNow(s), { type: 'resolveCombat' });
    expect(s.ancients!.sorenWarGain).toBe(20);
    expect(heroPowerText(s)).toContain('**+20/+20**');
    expect(ancientCombatMods(s).ancientReclaim).toMatchObject({ gain: 20 });
    s = reclaimFight(s, 'a');
    expect(buffsFrom(events(s), 'Ancient of War')[0]).toMatchObject({ attack: 20, health: 20 });
  });
});

describe('Soren × GENESIS: "Reclaim grants a plain copy of the minion you target, but it is locked for 3 turns."', () => {
  it('Reclaim still marks, and a plain copy goes to hand, locked until three turns from now', () => {
    let s = picked('genesis', { board: [card('a', T1, { attack: 12, health: 40, keywords: ['T'], golden: true })] });
    s = reclaim(s, 'a');
    expect(at(s, 'a').resummon).toBe(true);
    expect(s.hand.length).toBe(1);
    const copy = s.hand[0]!;
    expect(copy).toMatchObject({ cardId: T1, attack: CARD_INDEX[T1]!.attack, health: CARD_INDEX[T1]!.health, golden: false, keywords: [] });
    expect(copy.lockedUntilWave).toBe(s.wave + 3);
    expect(reduce(s, { type: 'play', uid: copy.uid }), 'locked: it cannot be played').toBe(s);
  });
  it('unlocks on the third turn after', () => {
    let s = reclaim(picked('genesis', { board: [card('a', T1, { health: 40 }), card('b', OTHER, { health: 40 })] }), 'b');
    const uid = s.hand[0]!.uid;
    for (let i = 0; i < 3; i++) s = reduce(fightNow(s), { type: 'resolveCombat' });
    s = { ...s, embers: 60 };
    const played = reduce(s, { type: 'play', uid });
    expect(played).not.toBe(s);
    expect(played.hand.some((c) => c.uid === uid)).toBe(false);
  });
  it('a full hand gets no copy (never onto the board)', () => {
    const hand = Array.from({ length: 10 }, (_, i) => card(`h${i}`, FILL[i + 1]!));
    let s = picked('genesis', { board: [card('a', T1)], hand });
    s = reclaim(s, 'a');
    expect(s.hand.length).toBe(hand.length);
    expect(s.board.length).toBe(1);
  });
});

describe('Soren × TIME: "Reclaim summons twice."', () => {
  it('two copies return; only the first carries back to the run card', () => {
    let s = reclaimFight(picked('time', { board: [card('a', T1, { health: 40 })] }), 'a');
    const back = summonsOf(events(s), T1);
    expect(back.length).toBe(2);
    expect(back[1]!.minion).toMatchObject({ attack: 3, health: 40 });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.board.length, 'the run board is unchanged').toBe(1);
  });
  it('a full board limits it: the second copy waits until a friendly death frees a slot', () => {
    const s = reclaimFight(picked('time', { board: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((u, i) => card(u, i === 0 ? T1 : FILL[i]!, { health: 40 })) }), 'a');
    const ev = events(s);
    const back = ev.map((e, i) => (e.type === 'summon' && e.side === 'player' && e.minion.cardId === T1 ? i : -1)).filter((i) => i >= 0);
    expect(back.length).toBeGreaterThanOrEqual(1);
    const firstAttack = ev.findIndex((e) => e.type === 'attack');
    expect(back[0]!, 'the first copy takes the slot Reclaim freed, at Start of Combat').toBeLessThan(firstAttack);
    if (back.length > 1) {
      const freed = ev.findIndex((e, i) => i > back[0]! && e.type === 'death' && e.side === 'player');
      expect(freed, 'the second copy waited for a friendly death').toBeGreaterThan(firstAttack);
      expect(back[1]!).toBeGreaterThan(freed);
    }
  });
  it('the combat mod carries copies 2', () => {
    expect(ancientCombatMods(picked('time')).ancientReclaim).toMatchObject({ copies: 2, label: 'Ancient of Time' });
  });
});

describe('Soren × BONDS: "When the reclaimed minion summons, grant its attack to adjacent minions."', () => {
  it('on its return, the minions next to it gain its Attack for that combat (owner: "That fight only")', () => {
    let s = reclaimFight(picked('bonds', { board: [card('l', OTHER, { attack: 1, health: 40 }), card('a', T1, { attack: 7, health: 40 }), card('r', OTHER, { attack: 1, health: 40 })] }), 'a');
    const grants = buffsFrom(events(s), 'Ancient of Bonds');
    expect(grants.length).toBe(2);
    for (const g of grants) expect(g).toMatchObject({ attack: 7, health: 0 });
    s = reduce(s, { type: 'resolveCombat' });
    expect(at(s, 'l').attack).toBe(1);
    expect(at(s, 'r').attack).toBe(1);
  });
  it('an Engraved neighbour keeps it', () => {
    let s = reclaimFight(picked('bonds', { board: [card('l', OTHER, { attack: 1, health: 40, keywords: ['EG'] }), card('a', T1, { attack: 7, health: 40 })] }), 'a');
    s = reduce(s, { type: 'resolveCombat' });
    expect(at(s, 'l').attack).toBe(8);
  });
  it('no neighbours, no grant', () => {
    const s = reclaimFight(picked('bonds', { board: [card('a', T1, { attack: 7, health: 40 })] }), 'a');
    expect(buffsFrom(events(s), 'Ancient of Bonds').length).toBe(0);
  });
});

describe('Soren × save / restore and determinism', () => {
  it('War\'s grown amount and Genesis\' locked copy survive a JSON round trip', () => {
    let war = reduce(fightNow(picked('war', { board: [card('a', T1, { health: 40 })] })), { type: 'resolveCombat' });
    war = JSON.parse(JSON.stringify(war)) as RunState;
    expect(war.ancients!.sorenWarGain).toBe(20);
    expect(heroPowerText(war)).toContain('**+20/+20**');
    let gen = reclaim(picked('genesis', { board: [card('a', T1)] }), 'a');
    gen = JSON.parse(JSON.stringify(gen)) as RunState;
    const uid = gen.hand[0]!.uid;
    expect(reduce(gen, { type: 'play', uid })).toBe(gen);
  });
  it('every pairing replays identically from the same state', () => {
    const board = (): BoardCard[] => [card('l', OTHER, { health: 40 }), card('e', ECHO.id, { health: 40 }), card('r', T1, { health: 40 })];
    for (const id of ANCIENT_IDS) {
      const run = () => reduce(reclaimFight(picked(id, { board: board() }), 'e'), { type: 'resolveCombat' });
      const a = run();
      const b = run();
      expect(JSON.stringify(a.lastCombat?.events), id).toBe(JSON.stringify(b.lastCombat?.events));
      expect(JSON.stringify(a.board), id).toBe(JSON.stringify(b.board));
    }
  });
});
