/**
 * ANCIENTS × GORUN (owner pairings 2026-11-10). Blade Mastery (passive): "When your minions attack, give them +3 Attack.
 * Improves every 8 attacks." Every pairing through the real reducer / simulator, in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent, Keyword } from '@game/core';
import {
  ANCIENT_IDS, ancientCombatMods, ancientOfferText, createRun, enableAncients, heroPowerText, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import * as recruitMod from './recruit';

const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && !c.henchman && c.id !== 'sandbag').map((c) => c.id);
const N = (i: number) => NEUTRALS[i % NEUTRALS.length]!;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'gorun'), phase: 'recruit', embers: 0, hand: [], board: [], ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
type Foe = { cardId: string; attack: number; health: number; keywords?: Keyword[] };
const foes = (wave: number, minions: Foe[]): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: 1,
  minions: minions.map((m) => ({ keywords: [], ...m })), seed: 1, origin: 'self',
});
const WALL: Foe = { cardId: 'sandbag', attack: 0, health: 4000 };
const fightNow = (s: RunState, enemy: Foe[] = [WALL]): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, enemy) } }, { type: 'faceOmen' });
const settle = (s: RunState): RunState => reduce(s, { type: 'resolveCombat' });
const events = (s: RunState): CombatEvent[] => s.lastCombat!.events as CombatEvent[];
const cuid = (s: RunState, i: number): string => s.lastCombat!.initial.player[i]!.uid;
const buffsFrom = (ev: CombatEvent[], source: string) =>
  ev.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === source);
const triggers = (ev: CombatEvent[], flag: string) => ev.filter((e) => e.type === 'questTrigger' && e.side === 'player' && e.flag === flag).length;
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const trio = (): BoardCard[] => [card('a', N(0), { attack: 1, health: 900 }), card('b', N(1), { attack: 1, health: 900 }), card('c', N(2), { attack: 1, health: 900 })];

describe('Gorun × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash, "Oath" or "climb"', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('gorun', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('gorun', id)).not.toMatch(/—|--|Oath|climb/);
      expect(heroPowerText(picked(id))).not.toMatch(/—|--|\{|Oath|climb/);
    }
  });
  it('without Ancients, Blade Mastery gives Attack only and nothing else fires', () => {
    const s = fightNow(base({ board: trio() }));
    const blade = buffsFrom(events(s), 'Blade Mastery');
    expect(blade.length).toBeGreaterThan(3);
    expect(blade[0]).toMatchObject({ attack: 3, health: 0 });
    for (const src of ['Ancient of Death', 'Ancient of Bonds']) expect(buffsFrom(events(s), src).length).toBe(0);
    expect(triggers(events(s), 'ancientAttackGold')).toBe(0);
    expect(events(s).some((e) => e.type === 'shieldUp')).toBe(false);
  });
});

describe('Gorun × DEATH: "When a friendly minion dies, give its Attack to a random friendly minion."', () => {
  const board = () => [card('a', N(0), { attack: 10, health: 1 }), card('b', N(1), { attack: 1, health: 900 })];
  it('COMBAT: the dead minion\'s Attack goes to a living friendly minion, for that combat', () => {
    let s = fightNow(picked('death', { board: board() }), [{ cardId: 'sandbag', attack: 5, health: 4000 }]);
    const gifts = buffsFrom(events(s), 'Ancient of Death');
    expect(gifts.length).toBe(1);
    expect(gifts[0]!.target).toBe(cuid(s, 1));
    expect(gifts[0]!.attack).toBeGreaterThanOrEqual(10); // 10, or 13 when it attacked first (its own Blade Mastery)
    expect(gifts[0]!.health).toBe(0);
    s = settle(s);
    expect(at(s, 'b').attack, 'a combat buff: the Shop board is unchanged').toBe(1);
  });
  it('SHOP: a minion destroyed in the Shop gives its Attack to another board minion, permanently', () => {
    const s = structuredClone(picked('death', { board: board() }));
    recruitMod.destroyMinionInShop(recruitMod.makeContext(s), s.board[0]!);
    expect(at(s, 'b').attack).toBe(11);
    expect(at(s, 'b').buffs?.some((b) => b.source === 'Ancient of Death')).toBe(true);
  });
  it('another Ancient: neither phase gives anything', () => {
    const s = fightNow(picked('time', { board: board() }), [{ cardId: 'sandbag', attack: 5, health: 4000 }]);
    expect(buffsFrom(events(s), 'Ancient of Death').length).toBe(0);
    const t = structuredClone(picked('time', { board: board() }));
    recruitMod.destroyMinionInShop(recruitMod.makeContext(t), t.board[0]!);
    expect(at(t, 'b').attack).toBe(1);
  });
});

describe('Gorun × FORTUNE: "Every 5 attacks, gain 1 Gold next turn."', () => {
  it('every 5th friendly attack banks 1 Gold for next turn, on one running count across fights; printed live', () => {
    const start = picked('fortune', { board: trio() });
    expect(heroPowerText(start)).toContain('Every **5** attacks, gain **1 Gold** next turn (**5** more to go).');
    const fought = fightNow(start);
    const attacks = triggers(events(fought), 'bladeMastery');
    expect(attacks).toBeGreaterThanOrEqual(5);
    expect(triggers(events(fought), 'ancientAttackGold')).toBe(Math.floor(attacks / 5));
    expect(fought.lastCombat!.playerBonusGold).toBe(Math.floor(attacks / 5));
    const s = settle(fought);
    expect(s.ancients!.gorunAttacks).toBe(attacks % 5);
    const control = settle(fightNow(picked('war', { board: trio() })));
    expect(s.embers - control.embers).toBe(Math.floor(attacks / 5));
    expect(heroPowerText(s)).toContain(`(**${5 - (attacks % 5)}** more to go)`);
    // The carried count continues: with 4 banked, the very first attack of the next fight pays.
    const next = fightNow({ ...s, ancients: { ...s.ancients!, gorunAttacks: 4 } });
    const n2 = triggers(events(next), 'bladeMastery');
    expect(triggers(events(next), 'ancientAttackGold')).toBe(Math.floor((4 + n2) / 5));
  });
  it('the live text follows the fight on screen', () => {
    const s = picked('fortune', { board: trio() });
    expect(heroPowerText({ ...s, fxBladeAttacksPreview: 3 } as RunState)).toContain('(**2** more to go)');
  });
});

describe('Gorun × WAR: "Blade Mastery also gives the same Health."', () => {
  it('every Blade Mastery grant gives the same Health; another Ancient gives Attack only', () => {
    const s = fightNow(picked('war', { board: trio() }));
    expect(ancientCombatMods(s).ancientBladeHealth).toBe(true);
    const blade = buffsFrom(events(s), 'Blade Mastery');
    expect(blade.length).toBeGreaterThan(8);
    for (const b of blade) expect(b.health).toBe(b.attack);
    expect(blade[0]!.attack).toBe(3);
    expect(blade[8]!.attack, 'the 9th attack is the first bigger one').toBe(6);
    const t = fightNow(picked('death', { board: trio() }));
    for (const b of buffsFrom(events(t), 'Blade Mastery')) expect(b.health).toBe(0);
    expect(at(settle(s), 'a')).toMatchObject({ attack: 1, health: 900 });
  });
});

describe('Gorun × GENESIS: "Start of Combat: Your two left-most minions gains Ward and Flurry."', () => {
  it('the two left-most gain Ward and Flurry before any attack, for that combat only', () => {
    let s = fightNow(picked('genesis', { board: trio() }));
    const ev = events(s);
    const firstAttack = ev.findIndex((e) => e.type === 'attack');
    const early = ev.slice(0, firstAttack);
    const wards = early.filter((e) => e.type === 'shieldUp').map((e) => (e as { target: string }).target);
    const flurry = early.filter((e) => e.type === 'keyword' && e.keyword === 'W').map((e) => (e as { target: string }).target);
    expect(wards).toEqual([cuid(s, 0), cuid(s, 1)]);
    expect(flurry).toEqual([cuid(s, 0), cuid(s, 1)]);
    s = settle(s);
    expect(at(s, 'a').keywords).toEqual([]);
  });
  it('another Ancient: no Ward, no Flurry', () => {
    const ev = events(fightNow(picked('time', { board: trio() })));
    expect(ev.some((e) => e.type === 'shieldUp' || (e.type === 'keyword' && e.keyword === 'W'))).toBe(false);
  });
});

describe('Gorun × TIME: "Start of Combat: each of your minions gains Blade Mastery once."', () => {
  it('every minion gains the current grant before the first attack, and no attack is counted for it', () => {
    const s = fightNow(picked('time', { board: trio(), bladeAttacks: 8 }));
    const ev = events(s);
    const firstAttack = ev.findIndex((e) => e.type === 'attack');
    const early = buffsFrom(ev.slice(0, firstAttack), 'Blade Mastery');
    expect(early.map((b) => b.target)).toEqual([cuid(s, 0), cuid(s, 1), cuid(s, 2)]);
    for (const b of early) expect(b).toMatchObject({ attack: 6, health: 0 });
    expect(triggers(ev.slice(0, firstAttack), 'bladeMastery')).toBe(0);
    const all = buffsFrom(ev, 'Blade Mastery');
    expect(all[3]!.attack, 'the first real attack still reads 8 attacks made').toBe(6);
  });
  it('another Ancient: nothing before the first attack', () => {
    const ev = events(fightNow(picked('death', { board: trio() })));
    expect(buffsFrom(ev.slice(0, ev.findIndex((e) => e.type === 'attack')), 'Blade Mastery').length).toBe(0);
  });
});

describe('Gorun × BONDS: "When a minion attacks, your next attacker also gets its bonus."', () => {
  it('each attacker after the first also gains the previous attacker\'s Blade Mastery grant, never a carried one', () => {
    const s = fightNow(picked('bonds', { board: trio() }));
    const ev = events(s);
    const blade = buffsFrom(ev, 'Blade Mastery');
    const bonds = buffsFrom(ev, 'Ancient of Bonds');
    expect(bonds.length).toBe(blade.length - 1);
    // The k-th Bonds grant equals the (k-1)-th Blade Mastery grant (its own grant only: it never compounds).
    bonds.forEach((b, k) => expect(b).toMatchObject({ attack: blade[k]!.attack, health: 0 }));
    expect(ev.indexOf(bonds[0]!)).toBeGreaterThan(ev.indexOf(blade[1]!));
    expect(Math.max(...bonds.map((b) => b.attack))).toBeLessThanOrEqual(Math.max(...blade.map((b) => b.attack)));
  });
  it('another Ancient: no Bonds grant', () => {
    expect(buffsFrom(events(fightNow(picked('war', { board: trio() }))), 'Ancient of Bonds').length).toBe(0);
  });
});

describe('Gorun × save / restore and determinism', () => {
  it('the running attack count survives a JSON round trip', () => {
    let s = settle(fightNow(picked('fortune', { board: trio() })));
    const tick = s.ancients!.gorunAttacks;
    s = JSON.parse(JSON.stringify(s)) as RunState;
    expect(ancientCombatMods(s).ancientAttackGold!.tick).toBe(tick);
  });
  it('every pairing replays identically from the same state', () => {
    for (const id of ANCIENT_IDS) {
      const run = () => settle(fightNow(picked(id, { board: [card('a', N(0), { attack: 10, health: 3 }), card('b', N(1), { attack: 4, health: 30 }), card('c', N(2), { attack: 2, health: 60 })] }),
        [{ cardId: N(3), attack: 6, health: 40 }, { cardId: N(4), attack: 3, health: 60 }]));
      const a = run();
      const b = run();
      expect(JSON.stringify(a.lastCombat?.events), id).toBe(JSON.stringify(b.lastCombat?.events));
      expect(JSON.stringify(a.board), id).toBe(JSON.stringify(b.board));
      expect(a.embers, id).toBe(b.embers);
      expect(JSON.stringify(a.ancients), id).toBe(JSON.stringify(b.ancients));
    }
  });
});
