/**
 * ANCIENTS × LORD OF THE RISEN (hero id `risen`; owner pairings 2026-09-26). Undying: "Give a friendly minion Rise for
 * the next combat." Each pairing in the phase(s) it fires in, with real-time ordering where it matters.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, ancientCombatMods, ancientOfferText, ancientRiseTint, createRun, enableAncients, heroPowerText, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import * as recruitMod from './recruit';

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
/** Effect-less bodies, one card per uid letter so no two ever form a triple. */
const VANILLA: Record<string, string> = { a: 'hm_test_squire', b: 'shaper', c: 'beetle', v: 'n2_spellsword', r: 'k3_forkvein', w: 'k3_splitpick' };
const pup = (uid: string, attack: number, health: number, keywords: BoardCard['keywords'] = []): BoardCard =>
  card(uid, VANILLA[uid]!, { attack, health, keywords });
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'risen'), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
/** A served board of `n` sandbags (`kw` on the first one, e.g. Flurry). */
const foes = (wave: number, attack: number, health: number, n = 1, kw: BoardCard['keywords'] = []): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health * n,
  minions: Array.from({ length: n }, (_, i) => ({ cardId: 'sandbag', attack, health, keywords: i === 0 ? [...kw] : [] })), seed: 1, origin: 'self',
});
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const fightNow = (s: RunState, attack = 0, health = 400, n = 1, kw: BoardCard['keywords'] = []): RunState =>
  reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, attack, health, n, kw) } }, { type: 'faceOmen' });
const events = (s: RunState): CombatEvent[] => s.lastCombat!.events as CombatEvent[];
/** The combat uid of the player's i-th starting minion. */
const cuid = (s: RunState, i: number): string => s.lastCombat!.initial.player[i]!.uid;
type Reborn = Extract<CombatEvent, { type: 'reborn' }>;
const reborns = (s: RunState, uid: string): Reborn[] => events(s).filter((e): e is Reborn => e.type === 'reborn' && e.target === uid);
const undying = (s: RunState, uid: string): RunState => {
  const t = reduce(s, { type: 'heroPower', uid });
  expect(at(t, uid).keywords).toContain('R');
  return t;
};

describe('Risen × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), none uses an em dash', () => {
    expect(ancientOfferText('risen', 'genesis'), 'owner text trim 2026-09-26').toBe('In combat, each minion you summon summons an extra copy.');
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('risen', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('risen', id)).not.toMatch(/—|--/);
      expect(heroPowerText(picked(id))).not.toMatch(/—|--|\{/);
    }
  });
});

describe('Risen × DEATH — Undying\'s target gains Rise again after it Rises (once per combat), a BLUE Rise', () => {
  it('the target Rises twice in one fight: the first return is plain, then it regains a BLUE Rise, then Rises again', () => {
    let s = undying(picked('death', { board: [pup('a', 2, 2)] }), 'a');
    s = fightNow(s, 50, 400);
    const a = cuid(s, 0);
    const back = reborns(s, a);
    expect(back, 'two Rises in one fight').toHaveLength(2);
    expect(back[0]!.tint, 'the Undying Rise is blue from the start (owner 2026-09-26)').toBe('blue');
    expect(back[1]!.tint, 'the regained Rise is blue').toBe('blue');
    const ev = events(s);
    const i0 = ev.indexOf(back[0]!);
    const regain = ev.findIndex((e, j) => j > i0 && e.type === 'keyword' && e.target === a && e.keyword === 'R');
    expect(regain, 'the Rise comes back right after the return').toBe(i0 + 1);
    expect((ev[regain] as Extract<CombatEvent, { type: 'keyword' }>).tint).toBe('blue');
  });

  it('only once per combat: a third death stays dead', () => {
    let s = undying(picked('death', { board: [pup('a', 2, 2)] }), 'a');
    s = fightNow(s, 50, 400);
    expect(reborns(s, cuid(s, 0))).toHaveLength(2);
    expect(events(s).some((e) => e.type === 'death' && e.target === cuid(s, 0) && !e.rise), 'the third death is final').toBe(true);
  });

  it('without the pairing the Undying target Rises once', () => {
    let s = undying(picked('fortune', { board: [pup('a', 2, 2)] }), 'a');
    s = fightNow(s, 50, 400);
    expect(reborns(s, cuid(s, 0))).toHaveLength(1);
  });

  it('only the Undying target regains: a minion with its own Rise Rises once', () => {
    let s = undying(picked('death', { board: [pup('a', 2, 2), pup('b', 2, 2, ['R'])] }), 'a');
    s = fightNow(s, 50, 400);
    expect(reborns(s, cuid(s, 1))).toHaveLength(1);
  });

  it('a Rise that is regained still reads as a death for kill credit (the regain does not hide it)', () => {
    let s = undying(picked('death', { board: [pup('a', 2, 2)] }), 'a');
    s = fightNow(s, 50, 400);
    const a = cuid(s, 0);
    const ev = events(s);
    const firstReborn = ev.findIndex((e) => e.type === 'reborn' && e.target === a);
    // The player's body was knocked down and came back: the fight goes on (the body is on the board, alive).
    expect(firstReborn).toBeGreaterThan(0);
    expect(ev.slice(0, firstReborn).some((e) => e.type === 'death' && e.target === a && e.rise)).toBe(true);
  });
});

describe('Risen × FORTUNE — every friendly Rise in combat banks 1 Gold for next turn', () => {
  it('counts each Rise in the fight, and the Gold arrives next turn', () => {
    // The Undying target and a minion with its own Rise: two Rises.
    let s = undying(picked('fortune', { board: [pup('a', 2, 2), pup('b', 2, 2, ['R'])] }), 'a');
    s = fightNow(s, 50, 400);
    expect(s.lastCombat!.playerRises).toBe(2);
    const withF = reduce(s, { type: 'resolveCombat' });
    let t = undying(picked('bonds', { board: [pup('a', 2, 2), pup('b', 2, 2, ['R'])] }), 'a'); // same board, no Fortune
    t = reduce(fightNow(t, 50, 400), { type: 'resolveCombat' });
    expect(withF.embers - t.embers).toBe(2);
    expect(heroPowerText(withF)).toContain('Last combat: **2 Gold**');
  });

  it('a fight with no Rise banks nothing', () => {
    let s = picked('fortune', { board: [pup('a', 0, 300)] });
    s = fightNow(s, 1, 400);
    expect(s.lastCombat!.playerRises).toBe(0);
  });
});

describe('Risen × DEATH — the Undying target wears a BLUE Rise from the moment Undying lands', () => {
  it('blue in the Shop and in the first combat frame; a printed Rise stays green', () => {
    let s = undying(picked('death', { board: [pup('a', 2, 2), pup('b', 2, 2, ['R'])] }), 'a');
    expect(ancientRiseTint(s, at(s, 'a'))).toBe('blue');
    expect(ancientRiseTint(s, at(s, 'b'))).toBeUndefined();
    s = fightNow(s, 50, 400);
    expect(s.lastCombat!.initial.player[0]!.riseTint).toBe('blue');
    expect(s.lastCombat!.initial.player[1]!.riseTint).toBeUndefined();
  });
});

describe('Risen × WAR — the Undying target Rises with double Attack and attacks immediately, a RED Rise', () => {
  it('its Rise is red from the first frame (combat snapshot) and in the Shop', () => {
    let s = undying(picked('war', { board: [pup('a', 2, 2), pup('b', 2, 2, ['R'])] }), 'a');
    expect(ancientRiseTint(s, at(s, 'a'))).toBe('red');
    expect(ancientRiseTint(s, at(s, 'b')), 'a printed Rise stays green').toBeUndefined();
    s = fightNow(s, 50, 400);
    expect(s.lastCombat!.initial.player[0]!.riseTint).toBe('red');
    expect(s.lastCombat!.initial.player[1]!.riseTint).toBeUndefined();
    expect(reborns(s, cuid(s, 0))[0]!.tint).toBe('red');
  });

  it('returns with DOUBLE its return Attack and strikes right after it returns, before the next normal attacker', () => {
    const def = CARD_INDEX[VANILLA.a!]!;
    // Two foes (they strike first: more minions), the second weak so the player's other minion survives the round.
    let s = undying(picked('war', { board: [pup('a', 2, 2), pup('b', 0, 500)] }), 'a');
    s = fightNow(s, 50, 400, 3);
    const a = cuid(s, 0);
    const back = reborns(s, a)[0]!;
    expect(back.attack).toBe(def.attack * 2);
    const ev = events(s);
    const i = ev.indexOf(back);
    const nextAttack = ev.findIndex((e, j) => j > i && e.type === 'attack');
    expect((ev[nextAttack] as Extract<CombatEvent, { type: 'attack' }>).attacker, 'the risen body cuts the line').toBe(a);
  });

  it('interrupts a Flurry: it strikes BETWEEN the two swings of the Flurry minion that killed it (R-ORD-05)', () => {
    // Taunt pulls the Flurry's first swing onto the Undying target; a wall beside it takes the second swing.
    let s = undying(picked('war', { board: [pup('a', 2, 2, ['T']), pup('b', 0, 900)] }), 'a');
    s = fightNow(s, 50, 400, 3, ['W']);
    const a = cuid(s, 0);
    const ev = events(s);
    const flurry = s.lastCombat!.initial.enemy[0]!.uid;
    type Attack = Extract<CombatEvent, { type: 'attack' }>;
    const back = ev.findIndex((e) => e.type === 'reborn' && e.target === a);
    const swing1 = ev.findIndex((e) => e.type === 'attack' && e.attacker === flurry);
    const strike = ev.findIndex((e, j) => j > back && e.type === 'attack' && e.attacker === a);
    const swing2 = ev.findIndex((e, j) => j > swing1 && e.type === 'attack' && e.attacker === flurry);
    expect((ev[swing1] as Attack).defender, 'swing 1 kills the Undying target').toBe(a);
    expect(back).toBeGreaterThan(swing1);
    expect(strike, 'it strikes after it returns').toBeGreaterThan(back);
    expect((ev[swing2] as Attack).swing, "the Flurry minion's second swing").toBe(1);
    expect(swing2, 'the second swing comes after the risen strike').toBeGreaterThan(strike);
  });

  it('without the pairing the Rise returns at its printed Attack and waits its turn', () => {
    const def = CARD_INDEX[VANILLA.a!]!;
    let s = undying(picked('fortune', { board: [pup('a', 2, 2)] }), 'a');
    s = fightNow(s, 50, 400);
    expect(reborns(s, cuid(s, 0))[0]!.attack).toBe(def.attack);
    expect(reborns(s, cuid(s, 0))[0]!.tint).toBeUndefined();
  });
});

describe('Risen × GENESIS — every summon in combat summons an extra copy (a Rise included); extras on a full board overflow', () => {
  const summonsOf = (s: RunState, cardId: string): Extract<CombatEvent, { type: 'summon' }>[] =>
    events(s).filter((e): e is Extract<CombatEvent, { type: 'summon' }> => e.type === 'summon' && e.side === 'player' && e.minion.cardId === cardId);

  it('an Echo that summons two Pups summons four', () => {
    let s = picked('genesis', { board: [card('p', 'pack')] });
    s = fightNow(s, 50, 400);
    expect(summonsOf(s, 'pup')).toHaveLength(4);
    let t = picked('fortune', { board: [card('p', 'pack')] });
    t = fightNow(t, 50, 400);
    expect(summonsOf(t, 'pup')).toHaveLength(2);
  });

  it('a Rise summons an extra copy of the risen body beside it, at its return stats, WITHOUT Rise', () => {
    let s = undying(picked('genesis', { board: [pup('a', 2, 2)] }), 'a');
    s = fightNow(s, 50, 400);
    const a = cuid(s, 0);
    const ev = events(s);
    const back = ev.findIndex((e) => e.type === 'reborn' && e.target === a);
    const copy = ev.findIndex((e, j) => j > back && e.type === 'summon' && e.side === 'player' && e.minion.cardId === VANILLA.a);
    expect(copy).toBeGreaterThan(back);
    const c = (ev[copy] as Extract<CombatEvent, { type: 'summon' }>);
    expect(c.minion.keywords).not.toContain('R');
    expect([c.minion.attack, c.minion.health]).toEqual([(ev[back] as Reborn).attack, (ev[back] as Reborn).hp]);
    expect(c.source, 'beside the risen body').toBe(a);
  });

  it('extras count as OVERFLOWS on a full board: every extra fires the overflow watchers (Flowing Monk)', () => {
    // 7 bodies: Mama Pup dies first (the only one that can: the rest are walls), its Echo lands one Pup in the
    // freed slot; the Pup's extra and the second Pup (+ its extra) overflow.
    const wall = (u: string): BoardCard => pup(u, 0, 900);
    const board = [card('p', 'pack', { attack: 0, health: 1 }), card('m', 'monk', { attack: 0, health: 900 }), wall('a'), wall('b'), wall('c'), wall('v'), wall('r')];
    const overflowsOf = (s: RunState): number => s.lastCombat!.events.filter((e) => e.type === 'buff' && e.key === 'factory:overflowBuffRandom:summonOverflow').length;
    let s = picked('genesis', { board });
    s = fightNow(s, 1, 900);
    let t = picked('fortune', { board });
    t = fightNow(t, 1, 900);
    expect(summonsOf(s, 'pup'), 'one Pup still lands').toHaveLength(1);
    // Flowing Monk engraves 2 friends per overflow: 3 overflows with Genesis (Pup extra, Pup 2, its extra) vs 1.
    expect(overflowsOf(t)).toBe(2);
    expect(overflowsOf(s)).toBe(6);
  });

  it('a copy never makes copies (no runaway): one Echo, one extra each', () => {
    let s = picked('genesis', { board: [card('i', 'burialimp')] });
    s = fightNow(s, 50, 400);
    expect(summonsOf(s, 'impscrap')).toHaveLength(2);
  });

  it('threads its mod only while Genesis is picked', () => {
    expect(ancientCombatMods(picked('genesis')).ancientSummonExtra).toBe(1);
    expect(ancientCombatMods(picked('war')).ancientSummonExtra).toBeUndefined();
  });
});

describe('Risen × TIME — Start of Turn: your minions gain +3/+2 for each minion summoned last combat', () => {
  it('counts every friendly summon (Echo summons and Rises) and pays it at the next Start of Turn, permanently', () => {
    let s = undying(picked('time', { board: [card('p', 'pack'), pup('b', 0, 500), pup('a', 2, 2)] }), 'a');
    s = fightNow(s, 3, 400);
    const n = s.lastCombat!.playerSummonsMade!;
    // Mama Pup's two Pups + the Undying Rise (at least; the Pups' deaths summon nothing).
    expect(n).toBeGreaterThanOrEqual(3);
    const b0 = { ...at(s, 'b') };
    s = reduce(s, { type: 'resolveCombat' });
    expect([at(s, 'b').attack - b0.attack, at(s, 'b').health - b0.health]).toEqual([3 * n, 2 * n]);
    expect(heroPowerText(s)).toContain(`Last combat: **${n}** summoned (**+${3 * n}/+${2 * n}**)`);
  });

  it('a fight with no summons pays nothing', () => {
    let s = picked('time', { board: [pup('b', 0, 500)] });
    s = reduce(fightNow(s, 1, 400), { type: 'resolveCombat' });
    expect(at(s, 'b').attack).toBe(0);
  });
});

describe('Risen × BONDS — when a minion Rises, trigger the Echo of a minion next to it', () => {
  it('COMBAT: the Rise fires the neighbour\'s Echo right after the return (a rally cue, then its summon)', () => {
    let s = undying(picked('bonds', { board: [card('i', 'burialimp', { attack: 0, health: 500 }), pup('a', 2, 2), pup('b', 0, 500)] }), 'a');
    s = fightNow(s, 50, 400, 1);
    const a = cuid(s, 1), imp = cuid(s, 0);
    const ev = events(s);
    const back = ev.findIndex((e) => e.type === 'reborn' && e.target === a);
    expect(back).toBeGreaterThanOrEqual(0);
    const rally = ev.findIndex((e, j) => j > back && e.type === 'rally' && e.source === a && e.target === imp);
    expect(rally, 'the Echo proc is attributed to the risen body').toBeGreaterThan(back);
    const nextAttack = ev.findIndex((e, j) => j > back && e.type === 'attack');
    expect(rally < nextAttack || nextAttack < 0, 'real time: before the next attack').toBe(true);
    expect(ev.some((e, j) => j > rally && e.type === 'summon' && e.side === 'player' && e.minion.cardId === 'impscrap')).toBe(true);
  });

  it('COMBAT: nothing when neither neighbour has an Echo', () => {
    let s = undying(picked('bonds', { board: [pup('b', 0, 500), pup('a', 2, 2), pup('c', 0, 500)] }), 'a');
    s = fightNow(s, 50, 400, 1);
    expect(events(s).some((e) => e.type === 'rally')).toBe(false);
  });

  it('COMBAT: a random one of the two when both neighbours have an Echo (both reachable across seeds)', () => {
    const hit = new Set<number>();
    for (let seed = 1; seed <= 24 && hit.size < 2; seed++) {
      let s = undying(picked('bonds', { board: [card('i', 'burialimp', { attack: 0, health: 500 }), pup('a', 2, 2), card('p', 'pack', { attack: 0, health: 500 })] }), 'a');
      s = { ...s, seed: seed * 7919 };
      s = fightNow(s, 50, 400, 1);
      const a = cuid(s, 1);
      const r = events(s).find((e) => e.type === 'rally' && e.source === a) as Extract<CombatEvent, { type: 'rally' }> | undefined;
      expect(r).toBeDefined();
      hit.add([cuid(s, 0), cuid(s, 2)].indexOf(r!.target!));
    }
    expect([...hit].sort()).toEqual([0, 1]);
  });

  it('SHOP: a shop destroy\'s Rise fires the neighbour\'s Echo', () => {
    const s = picked('bonds', { board: [card('i', 'burialimp'), pup('a', 2, 2, ['R'])] });
    const before = s.board.length;
    recruitMod.destroyMinionInShop(recruitMod.makeContext(s), at(s, 'a'));
    expect(s.board.some((c) => c.cardId === VANILLA.a), 'it rose').toBe(true);
    expect(s.board.filter((c) => c.cardId === 'impscrap')).toHaveLength(1);
    expect(s.board.length).toBe(before + 1);
  });

  it('threads its mod into the fight', () => {
    expect(ancientCombatMods(picked('bonds')).ancientRiseEcho).toEqual({ label: 'Ancient of Bonds' });
  });
});
