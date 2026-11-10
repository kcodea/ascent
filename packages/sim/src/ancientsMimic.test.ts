/**
 * ANCIENTS × MIMIC (owner pairings 2026-11-10). Mimicry (passive): "At the start of every turn, Discover a hero power to
 * wield this turn." Mimic's pairings are ALWAYS ON, whatever power it wields that turn; Death / Fortune / War / Bonds are
 * Soren's, Robin's, Emissary's and Gorr's powers running as extra passives through those powers' own code, so they
 * stack with the wielded power, the same one included. Every pairing through the real reducer / simulator.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent, Keyword } from '@game/core';
import {
  ANCIENT_IDS, activePowers, ancientCombatMods, ancientOfferText, ancientPairingHeroId, createRun, enableAncients, heroPowerText, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState, type ShopCard,
} from './index';

const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && !c.henchman && c.id !== 'sandbag').map((c) => c.id);
const N = (i: number) => NEUTRALS[i % NEUTRALS.length]!;
/** An Echo that summons, not itself a token. */
const ECHO = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby && c.keywords.length === 0
  && c.effects.length === 1 && c.effects[0]!.on === 'onDeath' && c.effects[0]!.do === 'deathrattleSummon')!.id;
/** Two plain minions of two different real types. */
const TYPED = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe !== 'neutral' && !c.tribe2);
const TA = TYPED[0]!;
const TB = TYPED.find((c) => c.tribe !== TA.tribe)!;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
/** A Mimic in the Shop with its turn's power offer already resolved (`wield` = the disguise, undefined = none yet). */
const base = (over: Partial<RunState> = {}, wield?: string): RunState =>
  ({ ...createRun(7, 'mimic'), phase: 'recruit', embers: 60, hand: [], board: [], powerOffer: undefined, pendingPowerOffer: undefined, heroReady: true, ...(wield ? { adoptedPowerId: wield } : {}), ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}, wield?: string): RunState => {
  let s = enableAncients(base(over, wield));
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
const summonsOf = (ev: CombatEvent[], cardId: string) =>
  ev.filter((e): e is Extract<CombatEvent, { type: 'summon' }> => e.type === 'summon' && e.side === 'player' && e.minion.cardId === cardId);
const buffsFrom = (ev: CombatEvent[], source: string) =>
  ev.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === source);
const offer = (uid: string, cardId: string): ShopCard => ({ uid, cardId } as ShopCard);
const buy = (s: RunState, id: string, u = 'o'): RunState => {
  const next = reduce({ ...s, shop: [offer(u, id)] }, { type: 'buy', uid: u });
  expect(next, `bought ${id}`).not.toBe(s);
  return next;
};
const buyAll = (s: RunState, ids: string[]): RunState => ids.reduce((t, id, i) => buy(t, id, `o${i}`), s);
const sell = (s: RunState, uid: string): RunState => {
  const next = reduce(s, { type: 'sell', uid });
  expect(next, `sold ${uid}`).not.toBe(s);
  return next;
};

describe('Mimic × every Ancient has a written pairing, and it is always Mimic\'s own', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash, "Oath" or "climb"', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('mimic', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('mimic', id)).not.toMatch(/—|--|Oath|climb/);
      expect(heroPowerText(picked(id, {}, 'soren'))).not.toMatch(/—|--|\{|Oath|climb/);
    }
  });
  it('a Mimic wielding another power still reads Mimic\'s pairing, and the wielded power keeps its own shape', () => {
    const s = picked('death', {}, 'soren');
    expect(ancientPairingHeroId(s)).toBe('mimic');
    expect(s.ancients!.powerOverrideFor).toBe('mimic');
    expect(ancientCombatMods(s).ancientAutoReclaim).toBeDefined();
    expect(ancientCombatMods(s).ancientReclaim, 'not Soren × Death').toBeUndefined();
    expect(activePowers(s)[0]!.kind).toBe('resummon');
    expect(heroPowerText(s)).toBe(`${CARD_TEXT('soren')} **Start of Combat:** destroy your left-most **Echo** minion and resummon it when there is room.`);
  });
  it('a non-Mimic hero wielding a power still follows that power (R-HERO-POWER-REPLACED-02 is unchanged)', () => {
    expect(ancientPairingHeroId({ heroId: 'warden', adoptedPowerId: 'gildmaster' })).toBe('gildmaster');
  });
});
/** A hero's printed power text. */
function CARD_TEXT(heroId: string): string {
  return heroPowerText({ ...createRun(7, heroId), phase: 'recruit' } as RunState);
}

describe('Mimic × DEATH: "Start of Combat: Destroy your left-most echo minion, and re-summon it when you have space."', () => {
  const board = () => [card('a', N(0), { attack: 2, health: 900 }), card('b', ECHO, { attack: 5, health: 900 }), card('c', ECHO, { attack: 1, health: 900 })];
  it('the left-most Echo minion is Reclaimed: destroyed at Start of Combat, its Echo fires, an exact copy returns', () => {
    const s = fightNow(picked('death', { board: board() }, 'nadja'));
    const ev = events(s);
    const firstAttack = ev.findIndex((e) => e.type === 'attack');
    const died = ev.slice(0, firstAttack).filter((e) => e.type === 'death').map((e) => (e as { target: string }).target);
    expect(died).toEqual([s.lastCombat!.initial.player[1]!.uid]);
    const back = summonsOf(ev, ECHO);
    expect(back.length).toBe(1);
    expect(back[0]!.minion).toMatchObject({ attack: 5, health: 900 });
    expect(ev.filter((e) => e.type === 'questTrigger' && e.flag === 'ancientAutoReclaim').length).toBe(1);
  });
  it('it stacks with a wielded Reclaim on another minion, and a minion marked by both is Reclaimed once', () => {
    let s = picked('death', { board: board() }, 'soren');
    s = reduce(s, { type: 'heroPower', uid: 'a' });
    const both = events(fightNow(s));
    expect(summonsOf(both, N(0)).length).toBe(1);
    expect(summonsOf(both, ECHO).length).toBe(1);
    let t = picked('death', { board: board() }, 'soren');
    t = reduce(t, { type: 'heroPower', uid: 'b' });
    const same = events(fightNow(t));
    expect(summonsOf(same, ECHO).length).toBe(1);
  });
  it('no Echo minion, or another Ancient: nothing is destroyed', () => {
    const none = events(fightNow(picked('death', { board: [card('a', N(0), { attack: 2, health: 900 })] }, 'nadja')));
    expect(none.slice(0, none.findIndex((e) => e.type === 'attack')).some((e) => e.type === 'death')).toBe(false);
    expect(summonsOf(events(fightNow(picked('time', { board: board() }, 'nadja'))), ECHO).length).toBe(0);
  });
});

describe('Mimic × FORTUNE: "For each minion you sell, gain 1 Gold next turn."', () => {
  const board = () => [card('a', N(0)), card('b', N(1))];
  it('each sale banks 1 Gold for next turn; printed live', () => {
    let s = picked('fortune', { board: board() }, 'nadja');
    const before = s.bonusEmbersNextTurn ?? 0;
    s = sell(s, 'a');
    expect((s.bonusEmbersNextTurn ?? 0) - before).toBe(1);
    expect(heroPowerText(s)).toContain('gain **1 Gold** next turn (**1** so far)');
    s = sell(s, 'b');
    expect((s.bonusEmbersNextTurn ?? 0) - before).toBe(2);
  });
  it('it stacks with a wielded Spoils (2 Gold per sale); another Ancient banks nothing', () => {
    const robin = sell(picked('fortune', { board: board() }, 'robin'), 'a');
    expect(robin.bonusEmbersNextTurn ?? 0).toBe(2);
    const other = sell(picked('time', { board: board() }, 'nadja'), 'a');
    expect(other.bonusEmbersNextTurn ?? 0).toBe(0);
  });
});

describe('Mimic × WAR: "Start of Combat: Give a minion of each type +1/+1 for each spell cast this game."', () => {
  const board = () => [card('a', TA.id, { attack: 1, health: 900 }), card('b', TB.id, { attack: 1, health: 900 }), card('c', TA.id, { attack: 1, health: 900 }), card('n', N(0), { attack: 1, health: 900 })];
  it('one minion of each type gains +N/+N for the spells cast this GAME, casts made before the pick included', () => {
    const s = picked('war', { board: board(), spellsCast: 6 }, 'nadja');
    expect(ancientCombatMods(s).ancientUnitedFront).toBe(6);
    expect(heroPowerText(s)).toContain('give a friendly minion of each type **+6/+6** (1 per spell cast this game)');
    const f = fightNow(s);
    const got = buffsFrom(events(f), 'United Front');
    expect(got.map((b) => b.target)).toEqual([f.lastCombat!.initial.player[0]!.uid, f.lastCombat!.initial.player[1]!.uid]);
    for (const b of got) expect(b).toMatchObject({ attack: 6, health: 6 });
    expect(settle(f).board.find((c) => c.uid === 'a')!.attack, 'a combat buff').toBe(1);
  });
  it('no spell cast yet, or another Ancient: nothing', () => {
    expect(ancientCombatMods(picked('war', { board: board(), spellsCast: 0 }, 'nadja')).ancientUnitedFront).toBeUndefined();
    expect(buffsFrom(events(fightNow(picked('time', { board: board(), spellsCast: 6 }, 'nadja'))), 'United Front').length).toBe(0);
  });
});

describe('Mimic × GENESIS: "Mimic has 4 options and no longer happens automatically. Can be activated once per turn."', () => {
  const nextTurn = (s: RunState): RunState => settle(fightNow({ ...s, board: [card('a', N(0), { attack: 1, health: 900 })] }));
  it('the next turn opens with no offer; Mimicry is a pressable power that offers 4, once per turn', () => {
    let s = picked('genesis', {}, 'soren');
    expect(activePowers(s)[0]!.kind, 'the pick turn keeps its disguise').toBe('resummon');
    s = nextTurn(s);
    expect(s.powerOffer).toBeUndefined();
    expect(s.pendingPowerOffer).toBeUndefined();
    expect(s.adoptedPowerId).toBeUndefined();
    expect(activePowers(s)[0]).toMatchObject({ kind: 'mimic', passive: false, untargeted: true });
    expect(heroPowerText(s)).toBe('**Discover** a hero power to wield this turn, from **4** options. Once per turn.');
    expect(s.heroReady).toBe(true);
    s = reduce(s, { type: 'heroPower' });
    expect(s.powerOffer?.slot).toBe('mimic');
    expect(s.powerOffer!.heroIds.length).toBe(4);
    expect(new Set(s.powerOffer!.heroIds).size).toBe(4);
    const choice = s.powerOffer!.heroIds[2]!;
    s = reduce(s, { type: 'pickPower', index: 2 });
    expect(s.adoptedPowerId).toBe(choice);
    expect(s.heroReady, 'the chosen power arrives ready').toBe(true);
    expect(activePowers(s)[0]!.kind, 'Mimicry is gone for the turn').not.toBe('mimic');
    // The turn after: Mimicry is back, unpressed.
    s = nextTurn({ ...s, discover: undefined, discoverQueue: undefined, questOffer: undefined });
    expect(s.adoptedPowerId).toBeUndefined();
    expect(activePowers(s)[0]!.kind).toBe('mimic');
    expect(s.powerOffer).toBeUndefined();
  });
  it('without Genesis the next turn opens the usual 2-option offer by itself, and Mimicry cannot be pressed', () => {
    const s = nextTurn(picked('time', {}, 'soren'));
    expect(s.powerOffer?.heroIds.length).toBe(2);
    const idle = base();
    expect(reduce(idle, { type: 'heroPower' })).toBe(idle);
  });
});

describe('Mimic × TIME: "Start of Turn: Get a plain copy of a minion that died last combat."', () => {
  const fought = (id: AncientId, enemy: Foe[]) =>
    settle(fightNow(picked(id, { board: [card('a', N(0), { attack: 90, health: 900 })] }, 'nadja'), enemy));
  it('the next Shop opens with a plain copy of a minion that died (either side, seeded), on its own beat', () => {
    const s = fought('time', [{ cardId: N(1), attack: 0, health: 1 }]);
    const got = s.hand.filter((c) => c.cardId === N(1));
    expect(got.length).toBe(1);
    expect(got[0]).toMatchObject({ attack: CARD_INDEX[N(1)]!.attack, health: CARD_INDEX[N(1)]!.health, golden: false });
    expect(s.sotBeatFx?.some((b) => b.source.label === 'Ancient of Time')).toBe(true);
    expect(fought('time', [{ cardId: N(1), attack: 0, health: 1 }]).hand.map((c) => c.cardId)).toEqual(s.hand.map((c) => c.cardId));
  });
  it('a token that died is a legal copy (Soulkeeper\'s pool); another Ancient gets nothing', () => {
    const s = fought('time', [{ cardId: N(1), attack: 0, health: 1 }, { cardId: N(2), attack: 0, health: 1 }]);
    expect(s.hand.length).toBe(1);
    expect([N(1), N(2)]).toContain(s.hand[0]!.cardId);
    expect(fought('fortune', [{ cardId: N(1), attack: 0, health: 1 }]).hand.length).toBe(0);
  });
});

describe('Mimic × BONDS: "When you buy 3 minions in a turn, get a plain copy of one of them at random."', () => {
  const three = [N(0), N(1), N(2)];
  const copies = (s: RunState) => s.hand.length - 3;
  it('the 3rd minion bought in a turn gives a plain copy of one of the three; printed live', () => {
    let s = buyAll(picked('bonds', {}, 'nadja'), three.slice(0, 2));
    expect(s.hand.length).toBe(2);
    expect(heroPowerText(s)).toContain('(**2/3**)');
    s = buy(s, three[2]!, 'z');
    expect(copies(s)).toBe(1);
    const extra = s.hand[3]!;
    expect(three).toContain(extra.cardId);
    expect(extra).toMatchObject({ attack: CARD_INDEX[extra.cardId]!.attack, health: CARD_INDEX[extra.cardId]!.health, golden: false });
  });
  it('it stacks with a wielded Four Peat (2 copies); another Ancient gives none', () => {
    expect(copies(buyAll(picked('bonds', {}, 'gorr'), three))).toBe(2);
    expect(copies(buyAll(picked('time', {}, 'nadja'), three))).toBe(0);
  });
});

describe('Mimic × save / restore and determinism', () => {
  it('the pairing, the Spoils tally and the Genesis shape survive a JSON round trip', () => {
    let s = sell(picked('fortune', { board: [card('a', N(0))] }, 'nadja'), 'a');
    s = JSON.parse(JSON.stringify(s)) as RunState;
    expect(heroPowerText(s)).toContain('(**1** so far)');
    let g = settle(fightNow({ ...picked('genesis', {}, 'soren'), board: [card('a', N(0), { attack: 1, health: 900 })] }));
    g = JSON.parse(JSON.stringify(g)) as RunState;
    expect(reduce(g, { type: 'heroPower' }).powerOffer?.heroIds.length).toBe(4);
  });
  it('every pairing replays identically from the same state', () => {
    for (const id of ANCIENT_IDS) {
      const run = () => {
        let s = picked(id, { spellsCast: 4, board: [card('a', TA.id, { attack: 30, health: 9 }), card('b', ECHO, { attack: 20, health: 6 }), card('c', TB.id, { attack: 9, health: 30 })] }, 'nadja');
        s = buyAll(s, [N(0), N(1), N(2)]);
        return settle(fightNow(s, [{ cardId: N(3), attack: 8, health: 60 }, { cardId: N(4), attack: 5, health: 70 }]));
      };
      const a = run();
      const b = run();
      expect(JSON.stringify(a.lastCombat?.events), id).toBe(JSON.stringify(b.lastCombat?.events));
      expect(JSON.stringify(a.board), id).toBe(JSON.stringify(b.board));
      expect(JSON.stringify(a.hand), id).toBe(JSON.stringify(b.hand));
      expect(JSON.stringify(a.powerOffer), id).toBe(JSON.stringify(b.powerOffer));
      expect(JSON.stringify(a.ancients), id).toBe(JSON.stringify(b.ancients));
    }
  });
});
