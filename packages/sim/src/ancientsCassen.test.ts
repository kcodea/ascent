/**
 * ANCIENTS × CASSEN (owner pairings 2026-10-09), plus the owner's hero change of the same day: "let's change cassen and
 * remove citadel and fortress so he just has the 3 options instead." Commission = "Choose a commission. It pays out in a
 * few turns." Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import {
  ANCIENT_COMMISSION_FLAG, ANCIENT_IDS, ancientAvengeCountdown, ancientCombatMods, ancientOfferText, commissionOffer, createRun, enableAncients,
  heroPowerText, reduce, type AncientId, type BoardCard, type BoardSnapshot, type CommissionKind, type RunState,
} from './index';
import { destroyMinionInShop, makeContext } from './recruit';

const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && !c.henchman).map((c) => c.id);
const N = (i: number) => NEUTRALS[i % NEUTRALS.length]!;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'cassen'), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const foes = (wave: number, attack: number, health: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health,
  minions: [{ cardId: 'sandbag', attack, health, keywords: [] }], seed: 1, origin: 'self',
});
const fightNow = (s: RunState, attack = 0, health = 400): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, attack, health) } }, { type: 'faceOmen' });
/** Fight and open the next Shop (where a due commission pays). */
const nextTurn = (s: RunState, attack = 0, health = 400): RunState => reduce(fightNow(s, attack, health), { type: 'resolveCombat' });
const commission = (s: RunState, kind: CommissionKind): RunState => {
  const t = reduce(s, { type: 'heroPower', commission: kind });
  expect(t, `commissioned ${kind}`).not.toBe(s);
  return t;
};
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const spells = (s: RunState) => s.hand.filter((c) => CARD_INDEX[c.cardId]?.spell);

describe('Cassen hero change (owner 2026-10-09): the offer is always Discover / Gold / Spell', () => {
  it('every turn, every tier, after any pick: exactly the three jobs, never a Citadel or a Fortress', () => {
    for (let wave = 1; wave <= 40; wave++) {
      for (const tier of [1, 3, 5, 6]) {
        for (const last of [undefined, 'discover', 'gold', 'spell'] as const) {
          const o = commissionOffer(base({ wave, tier, lastCommission: last }));
          expect(o, `wave ${wave} tier ${tier} last ${last}`).toEqual(['discover', 'gold', 'spell']);
        }
      }
    }
  });
  it('a Citadel / Fortress pick is refused (no longer offered)', () => {
    const s = base();
    expect(reduce(s, { type: 'heroPower', commission: 'citadel' })).toBe(s);
    expect(reduce(s, { type: 'heroPower', commission: 'fortress' })).toBe(s);
  });
  it('the printed rule lists the three jobs, with no em dash', () => {
    const t = heroPowerText(base());
    expect(t).toBe('Choose one: In **3 turns**, Discover a minion of your Tavern Tier. · In **2 turns**, gain **2 Gold**. · In **1 turn**, get a random Shop spell.');
  });
  it('OLD SAVES: a Citadel already working still pays its free upgrade, a Fortress its Triple Reward', () => {
    let c = base({ tier: 2 });
    c = { ...c, commission: { kind: 'citadel', dueWave: c.wave + 1 } };
    c = JSON.parse(JSON.stringify(c)) as RunState;
    c = nextTurn(c);
    expect(c.commission).toBeUndefined();
    expect(c.tier).toBe(3);
    let f = base();
    f = { ...f, commission: { kind: 'fortress', dueWave: f.wave + 1 } };
    f = nextTurn(f);
    expect(f.commission).toBeUndefined();
    expect(f.hand.map((h) => h.cardId)).toContain('discoverspell');
    expect(heroPowerText({ ...base(), commission: { kind: 'fortress', dueWave: 9 } } as RunState)).toBe('Working: A triple reward (due turn 9).');
  });
});

describe('Cassen × DEATH: "Avenge (7): advance your commission 1 turn."', () => {
  it('Shop: the 7th friendly death moves the commission a turn sooner; one now due pays at once', () => {
    let s = commission(picked('death', { board: [...['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'].map((u, i) => card(u, N(i))), card('k', N(8))] }), 'gold');
    const due = s.commission!.dueWave;
    expect(due).toBe(s.wave + 2);
    expect(heroPowerText(s)).toBe(`Working: Gain 2 Gold (due turn ${due}). **Avenge (7):** your commission pays out **1** turn sooner (**7** more to go).`);
    s = structuredClone(s);
    for (const u of ['d1', 'd2', 'd3', 'd4', 'd5', 'd6']) destroyMinionInShop(makeContext(s), at(s, u));
    expect(s.commission!.dueWave).toBe(due);
    destroyMinionInShop(makeContext(s), at(s, 'd7'));
    expect(s.commission!.dueWave).toBe(due - 1);
    // A second full Avenge brings it due THIS turn: the next action's boundary pays it.
    s = { ...s, ancients: { ...s.ancients!, cassenDeaths: 6 }, board: [...s.board, card('d8', N(9))] };
    destroyMinionInShop(makeContext(s), at(s, 'd8'));
    expect(s.commission!.dueWave).toBe(s.wave);
    const gold = s.embers;
    s = reduce(s, { type: 'sell', uid: 'k' });
    expect(s.commission).toBeUndefined();
    expect(s.embers).toBeGreaterThanOrEqual(gold + 2);
  });
  it('combat: the carried count fires mid-fight (a flagged pulse); settle moves the commission', () => {
    let s = commission(picked('death', { board: ['a', 'b'].map((u, i) => card(u, N(i), { attack: 1, health: 1 })) }), 'discover');
    s = { ...s, ancients: { ...s.ancients!, cassenDeaths: 6 } };
    const due = s.commission!.dueWave;
    expect(ancientCombatMods(s).ancientAvengePulse).toEqual({ every: 7, tick: 6, flag: ANCIENT_COMMISSION_FLAG, label: 'Ancient of Death' });
    expect(ancientAvengeCountdown(s)).toBe(1);
    expect(heroPowerText(s, 0, { friendlyDeaths: 1 })).toContain(`(due turn ${due - 1})`);
    s = fightNow(s, 100, 1000);
    const pulses = (s.lastCombat!.events as { type: string; flag?: string }[]).filter((e) => e.type === 'questTrigger' && e.flag === ANCIENT_COMMISSION_FLAG).length;
    expect(pulses).toBe(1);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.commission!.dueWave).toBe(due - 1);
  });
  it('no commission running: an Avenge does nothing', () => {
    let s = picked('death', { board: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'].map((u, i) => card(u, N(i))) });
    s = structuredClone(s);
    for (const u of ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']) destroyMinionInShop(makeContext(s), at(s, u));
    expect(s.commission).toBeUndefined();
    expect(s.ancients!.cassenDeaths).toBe(0);
  });
});

describe('Cassen × FORTUNE: "Commission also grants 5 free refreshes."', () => {
  it('the payout banks 5 free Refreshes', () => {
    let s = commission(picked('fortune'), 'spell');
    expect(heroPowerText(s)).toContain('When it pays out, also get **5** free Refreshes.');
    const rolls = s.freeRolls;
    s = nextTurn(s);
    expect(s.commission).toBeUndefined();
    expect(s.freeRolls).toBe(rolls + 5);
  });
});

describe('Cassen × WAR: "Your minions gain +8/+8 when a commission triggers."', () => {
  it('the payout gives every board minion +8/+8, permanently', () => {
    let s = commission(picked('war', { board: [card('a', N(0)), card('b', N(1))] }), 'spell');
    s = nextTurn(s);
    expect(at(s, 'a')).toMatchObject({ attack: CARD_INDEX[N(0)]!.attack + 8, health: CARD_INDEX[N(0)]!.health + 8 });
    expect(at(s, 'b')).toMatchObject({ attack: CARD_INDEX[N(1)]!.attack + 8, health: CARD_INDEX[N(1)]!.health + 8 });
    s = nextTurn(s);
    expect(at(s, 'a').attack, 'once per payout').toBe(CARD_INDEX[N(0)]!.attack + 8);
  });
});

describe('Cassen × GENESIS: "Commission also grants a minion of your tier."', () => {
  it('the payout also gives a random minion of exactly your Shop tier', () => {
    let s = commission(picked('genesis', { tier: 3 }), 'spell');
    expect(heroPowerText(s)).toContain('(Tier **3**)');
    s = nextTurn(s);
    const minions = s.hand.filter((c) => !CARD_INDEX[c.cardId]?.spell);
    expect(minions.length).toBe(1);
    expect(CARD_INDEX[minions[0]!.cardId]!.tier).toBe(s.tier);
  });
});

describe('Cassen × TIME: "Commissions all trigger next turn."', () => {
  it('every commission is due next turn; the picker and the rule print 1 turn', () => {
    const s = picked('time');
    expect(heroPowerText(s)).toBe('Choose one: In **1 turn**, Discover a minion of your Tavern Tier. · In **1 turn**, gain **2 Gold**. · In **1 turn**, get a random Shop spell. Every commission pays out next turn.');
    const t = commission(s, 'discover');
    expect(t.commission!.dueWave).toBe(s.wave + 1);
    const u = nextTurn(t);
    expect(u.commission).toBeUndefined();
    expect(u.discover, 'the Discover opened').toBeTruthy();
  });
  it('a commission already running at the pick is due next turn', () => {
    let s = commission(base(), 'discover');
    expect(s.commission!.dueWave).toBe(s.wave + 3);
    s = enableAncients(s);
    s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: ['time', 'death', 'war'] } };
    s = reduce(s, { type: 'pickAncient', id: 'time' });
    expect(s.commission!.dueWave).toBe(s.wave + 1);
  });
});

describe('Cassen × BONDS: "Commission pays out twice."', () => {
  it('a Spell commission gives two spells', () => {
    let s = commission(picked('bonds'), 'spell');
    expect(heroPowerText(s)).toContain('It pays out **twice**.');
    s = nextTurn(s);
    expect(spells(s).length).toBe(2);
  });
});

describe('Cassen × save / restore and determinism', () => {
  it('the running count survives a JSON round trip', () => {
    let s = picked('death');
    s = JSON.parse(JSON.stringify({ ...s, ancients: { ...s.ancients!, cassenDeaths: 5 } })) as RunState;
    expect(ancientAvengeCountdown(s)).toBe(2);
  });
  it('every pairing replays identically from the same state', () => {
    for (const id of ANCIENT_IDS) {
      const run = () => {
        let s = commission(picked(id, { wave: 4, board: [card('a', N(0), { attack: 3, health: 1 }), card('b', N(1), { attack: 2, health: 1 })] }), 'spell');
        s = { ...s, ancients: { ...s.ancients!, cassenDeaths: 6 } };
        return nextTurn(s, 60, 1000);
      };
      const a = run();
      const b = run();
      expect(JSON.stringify(a.lastCombat?.events), id).toBe(JSON.stringify(b.lastCombat?.events));
      expect(JSON.stringify(a.board), id).toBe(JSON.stringify(b.board));
      expect(JSON.stringify(a.hand), id).toBe(JSON.stringify(b.hand));
      expect(JSON.stringify(a.ancients), id).toBe(JSON.stringify(b.ancients));
    }
  });
});
