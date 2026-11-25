/**
 * ANCIENTS × CASSEN (owner pairings 2026-10-09), plus the owner's Commission rework (2026-11-16): Shed (Discover a Shop
 * spell, 1 turn), House (gain 4 Gold, 2 turns), Bridge (Discover a minion from your Tier, 3 turns), Castle (upgrading
 * costs 3 less, 3 turns), Zeppelin at Tier 6 in place of the Castle (Discover a Tier 7 minion, 2 turns); 3 offered, never
 * the same one twice in a row; no commission gives max Gold (R-CASSEN-03). Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import {
  ANCIENT_COMMISSION_FLAG, ANCIENT_IDS, ancientAvengeCountdown, ancientCombatMods, ancientOfferText, commissionOffer, commissionRewardOf, createRun, enableAncients,
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
  ({ ...createRun(7, 'cassen'), phase: 'recruit', embers: 60, hand: [], lastCommission: 'citadel', ...over } as RunState);
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
/** Take every open (and queued) Discover's first option; returns the run and the ids offered in each. */
const takeAll = (s: RunState): { s: RunState; offers: string[][] } => {
  const offers: string[][] = [];
  for (let k = 0; k < 6 && s.discover?.length; k++) { offers.push([...s.discover]); s = reduce(s, { type: 'discover', index: 0 }); }
  return { s, offers };
};
const isShopSpell = (id: string) => !!CARD_INDEX[id]?.spell;

describe('Cassen Commission rework (owner 2026-11-16)', () => {
  const ALL = ['spell', 'gold', 'discover', 'citadel', 'fortress'] as const;
  const slot = (k: CommissionKind) => (k === 'fortress' ? 'citadel' : k);

  it('3 offered every turn, never the one started last: with a last pick, exactly the other three', () => {
    for (let wave = 1; wave <= 30; wave++) {
      for (const tier of [1, 3, 5, 6]) {
        for (const last of ALL) {
          const o = commissionOffer(base({ wave, tier, lastCommission: last }));
          expect(o.length, `wave ${wave} tier ${tier} last ${last}`).toBe(3);
          expect(o.map(slot), `no repeat of ${last}`).not.toContain(slot(last));
          expect(o, 'Castle below Tier 6, Zeppelin from Tier 6').not.toContain(tier >= 6 ? 'citadel' : 'fortress');
        }
      }
    }
    expect(commissionOffer(base({ tier: 2, lastCommission: 'gold' }))).toEqual(['spell', 'discover', 'citadel']);
    expect(commissionOffer(base({ tier: 6, lastCommission: 'gold' }))).toEqual(['spell', 'discover', 'fortress']);
    // A Castle then a Zeppelin is a repeat (the Zeppelin is the Castle's Tier 6 form).
    expect(commissionOffer(base({ tier: 6, lastCommission: 'citadel' }))).toEqual(['spell', 'gold', 'discover']);
  });

  it('before the first commission: 3 of the 4, seeded, stable through the turn and across a replay', () => {
    const seen = new Set<string>();
    for (let wave = 1; wave <= 20; wave++) {
      const s = base({ wave, tier: 2, lastCommission: undefined });
      const o = commissionOffer(s);
      expect(o.length).toBe(3);
      expect(commissionOffer({ ...s })).toEqual(o);
      expect(commissionOffer(JSON.parse(JSON.stringify(s)) as RunState)).toEqual(o);
      seen.add(o.join(','));
    }
    expect(seen.size, 'the dropped one varies turn to turn').toBeGreaterThan(1);
  });

  it('the reducer refuses a repeat in a row and anything not on offer', () => {
    const s = base({ lastCommission: 'gold' });
    expect(reduce(s, { type: 'heroPower', commission: 'gold' })).toBe(s);
    expect(reduce(s, { type: 'heroPower', commission: 'fortress' }), 'no Zeppelin below Tier 6').toBe(s);
    const t = commission(s, 'spell');
    expect(t.lastCommission).toBe('spell');
    const u = takeAll(nextTurn(t)).s;
    expect(u.commission).toBeUndefined();
    expect(reduce(u, { type: 'heroPower', commission: 'spell' }), 'Shed twice in a row').toBe(u);
    expect(commission(u, 'gold').commission!.kind).toBe('gold');
  });

  it('each job keeps its delay', () => {
    const delays: [CommissionKind, number, number][] = [['spell', 1, 2], ['gold', 2, 2], ['discover', 3, 2], ['citadel', 3, 2], ['fortress', 2, 6]];
    for (const [kind, d, tier] of delays) {
      const s = commission(base({ tier, lastCommission: kind === 'gold' ? 'spell' : 'gold' }), kind);
      expect(s.commission, kind).toEqual({ kind, dueWave: s.wave + d });
    }
  });

  /** Run `kind` to its payout next to a control run that commissioned nothing. */
  const payout = (kind: CommissionKind, over: Partial<RunState> = {}) => {
    const start = base({ lastCommission: kind === 'gold' ? 'spell' : 'gold', ...over });
    let s = commission(start, kind);
    let c: RunState = { ...start, heroReady: false };
    const due = s.commission!.dueWave;
    while (s.wave < due) {
      expect(s.commission, `${kind} still working on turn ${s.wave}`).toBeDefined();
      s = nextTurn(s); c = nextTurn(c);
    }
    expect(s.commission, `${kind} paid`).toBeUndefined();
    return { s, c };
  };

  it('Shed: Discover a Shop spell', () => {
    const { s, c } = payout('spell');
    expect(s.discover?.length).toBeGreaterThan(0);
    expect(s.discover!.every(isShopSpell)).toBe(true);
    expect((s.maxGoldBonus ?? 0) - (c.maxGoldBonus ?? 0)).toBe(0);
    const t = takeAll(s).s;
    expect(spells(t).length).toBe(1);
  });

  it('House: gain 4 Gold, and no more', () => {
    const { s, c } = payout('gold');
    expect((s.maxGoldBonus ?? 0) - (c.maxGoldBonus ?? 0)).toBe(0);
    expect(s.embers - c.embers).toBe(4);
  });

  it('Bridge: Discover a minion from your Shop Tier', () => {
    const { s, c } = payout('discover', { tier: 3 });
    expect(s.discover?.length).toBeGreaterThan(0);
    for (const id of s.discover!) expect(CARD_INDEX[id]!.tier, id).toBe(s.tier);
    expect((s.maxGoldBonus ?? 0) - (c.maxGoldBonus ?? 0)).toBe(0);
  });

  it('Castle: upgrading your Shop costs 3 less', () => {
    const { s, c } = payout('citadel', { tier: 2, upgradeCost: 11 });
    expect(c.upgradeCost).toBeGreaterThanOrEqual(3);
    expect(s.upgradeCost).toBe(c.upgradeCost - 3);
    expect((s.maxGoldBonus ?? 0) - (c.maxGoldBonus ?? 0)).toBe(0);
  });

  it('Zeppelin (Tier 6): Discover a Tier 7 minion', () => {
    const { s, c } = payout('fortress', { tier: 6 });
    expect(s.discover?.length).toBeGreaterThan(0);
    for (const id of s.discover!) expect(CARD_INDEX[id]!.tier, id).toBe(7);
    expect((s.maxGoldBonus ?? 0) - (c.maxGoldBonus ?? 0)).toBe(0);
  });

  it('a Castle already working when you reach Tier 6 stays a Castle', () => {
    let s = commission(base({ tier: 5, lastCommission: 'gold' }), 'citadel');
    const max0 = s.maxGoldBonus ?? 0;
    s = { ...s, tier: 6 };
    expect(heroPowerText(s)).toContain('**Castle** pays out in 3 turns.');
    while (s.commission) s = nextTurn(s);
    expect(s.discover ?? [], 'no Zeppelin Discover').toEqual([]);
    expect((s.maxGoldBonus ?? 0) - max0).toBe(0);
  });

  it('the printed rule: names, delays, live rewards, no max Gold, no em dash', () => {
    const t = heroPowerText(base({ tier: 2 }));
    expect(t).toBe('Choose one: **Shed** (1 turn): Discover a Shop spell. · **House** (2 turns): Gain 4 Gold. · **Bridge** (3 turns): Discover a minion from Tier 2.');
    expect(t).not.toMatch(/—|--/);
    expect(heroPowerText(base({ tier: 6, lastCommission: 'spell' }))).toContain('**Zeppelin** (2 turns): Discover a minion from Tier 7.');
    expect(heroPowerText({ ...base(), commission: { kind: 'gold', dueWave: base().wave + 2 } } as RunState)).toBe('Working: **House** pays out in 2 turns. Gain 4 Gold.');
    expect(heroPowerText({ ...base(), commission: { kind: 'spell', dueWave: base().wave + 1 } } as RunState)).toBe('Working: **Shed** pays out next turn. Discover a Shop spell.');
    expect(commissionRewardOf(base({ tier: 4 }), 'discover')).toBe('Discover a minion from Tier 4.');
    expect(commissionRewardOf(base(), 'citadel')).toBe('Reduce the cost of upgrading your Shop by 3.');
  });

  it('OLD SAVES: a Citadel / Fortress already working pays the new Castle / Zeppelin; an old last pick is still honoured', () => {
    let c = base({ tier: 2, upgradeCost: 11 });
    c = JSON.parse(JSON.stringify({ ...c, commission: { kind: 'citadel', dueWave: c.wave + 1 } })) as RunState;
    const cost = nextTurn({ ...c, commission: undefined }).upgradeCost;
    c = nextTurn(c);
    expect(c.commission).toBeUndefined();
    expect(c.tier, 'no free upgrade any more').toBe(2);
    expect(c.upgradeCost).toBe(cost - 3);
    let f = base({ tier: 6 });
    f = nextTurn({ ...f, commission: { kind: 'fortress', dueWave: f.wave + 1 } });
    expect(f.commission).toBeUndefined();
    for (const id of f.discover ?? []) expect(CARD_INDEX[id]!.tier).toBe(7);
    expect(f.discover?.length).toBeGreaterThan(0);
    expect(commissionOffer(base({ lastCommission: 'discover' }))).not.toContain('discover');
  });
});

describe('Cassen: a finished commission gives no max Gold (R-CASSEN-03), with each Ancient', () => {
  it.each(ANCIENT_IDS.map((id) => [id]))('%s', (id) => {
    let s = commission(picked(id as AncientId), 'gold');
    const before = s.maxGoldBonus ?? 0;
    for (let k = 0; k < 4 && s.commission; k++) s = takeAll(nextTurn(s)).s;
    expect(s.commission).toBeUndefined();
    expect((s.maxGoldBonus ?? 0) - before, 'a payout never moves max Gold').toBe(0);
  });
});

describe('Cassen × DEATH: "Avenge (5): advance your commission 1 turn." (owner 2026-11-19: 5, was 7; still per combat)', () => {
  it('Shop: the 5th friendly death moves the commission a turn sooner; one now due pays at once', () => {
    let s = commission(picked('death', { board: [...['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'].map((u, i) => card(u, N(i))), card('k', N(8))] }), 'gold');
    const due = s.commission!.dueWave;
    expect(due).toBe(s.wave + 2);
    expect(heroPowerText(s)).toBe('Working: **House** pays out in 2 turns. Gain 4 Gold. **Avenge (5):** your commission pays out **1** turn sooner (**5** more to go).');
    expect(ancientOfferText('cassen', 'death')).toBe('**Avenge (5):** your commission pays out **1** turn sooner.');
    s = structuredClone(s);
    for (const u of ['d1', 'd2', 'd3', 'd4']) destroyMinionInShop(makeContext(s), at(s, u));
    expect(s.commission!.dueWave).toBe(due);
    expect(heroPowerText(s)).toContain('(**1** more to go)');
    destroyMinionInShop(makeContext(s), at(s, 'd5'));
    expect(s.commission!.dueWave).toBe(due - 1);
    // A second full Avenge brings it due THIS turn: the next action's boundary pays it.
    s = { ...s, ancients: { ...s.ancients!, cassenDeaths: 4 }, board: [...s.board, card('d8', N(9))] };
    destroyMinionInShop(makeContext(s), at(s, 'd8'));
    expect(s.commission!.dueWave).toBe(s.wave);
    const gold = s.embers;
    s = reduce(s, { type: 'sell', uid: 'k' });
    expect(s.commission).toBeUndefined();
    expect(s.embers).toBeGreaterThanOrEqual(gold + 4 + 1);
  });
  it('combat: the 5th death in the fight fires mid-fight (a flagged pulse); 7 deaths still once; settle moves the commission (per combat, R-AVENGE-PER-COMBAT-01: the Shop count never comes in)', () => {
    let s = commission(picked('death', { board: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((u, i) => card(u, N(i), { attack: 1, health: 1 })) }), 'discover');
    s = { ...s, ancients: { ...s.ancients!, cassenDeaths: 4 } };
    const due = s.commission!.dueWave;
    expect(ancientCombatMods(s).ancientAvengePulse).toEqual({ every: 5, tick: 4, flag: ANCIENT_COMMISSION_FLAG, label: 'Ancient of Death' });
    expect(ancientAvengeCountdown(s)).toBe(1);
    expect(heroPowerText(s)).toContain('**Bridge** pays out in 3 turns.');
    expect(heroPowerText(s, 0, { friendlyDeaths: 1 })).toContain('**Bridge** pays out in 2 turns.');
    s = fightNow(s, 100, 1000);
    const pulses = (s.lastCombat!.events as { type: string; flag?: string }[]).filter((e) => e.type === 'questTrigger' && e.flag === ANCIENT_COMMISSION_FLAG).length;
    expect(pulses).toBe(1);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.commission!.dueWave).toBe(due - 1);
  });
  it('no commission running: an Avenge does nothing', () => {
    let s = picked('death', { board: ['d1', 'd2', 'd3', 'd4', 'd5'].map((u, i) => card(u, N(i))) });
    s = structuredClone(s);
    for (const u of ['d1', 'd2', 'd3', 'd4', 'd5']) destroyMinionInShop(makeContext(s), at(s, u));
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

describe('Cassen × TIME (ancient pass 1, owner 2026-11-16): "Choose two commissions to be live at once."', () => {
  it('two commissions can run at once (both can start the same turn); a third is refused; the rule prints both', () => {
    let s = picked('time');
    expect(heroPowerText(s)).toContain('You can have **2** working at once.');
    expect(heroPowerText(s)).toContain('**Bridge** (3 turns)'); // the delays are the normal ones again
    s = commission(s, 'discover');
    expect(heroPowerText(s)).toContain('Choose another:');
    s = commission(s, 'spell');
    expect(s.commission).toEqual({ kind: 'discover', dueWave: s.wave + 3 });
    expect(s.ancients!.cassenSecond).toEqual({ kind: 'spell', dueWave: s.wave + 1 });
    expect(heroPowerText(s)).toBe(`Working: **Bridge** pays out in 3 turns. Discover a minion from Tier ${s.tier}. Also working: **Shed** pays out next turn. Discover a Shop spell. You can have **2** working at once.`);
    expect(s.lastCommission, 'the one started last').toBe('spell');
    expect(reduce({ ...s, heroReady: true }, { type: 'heroPower', commission: 'gold' }).ancients!.cassenSecond!.kind, 'a third is refused').toBe('spell');
    // Next turn the second (Spell) pays on its own beat; the first keeps running; the second slot is open again.
    let u = nextTurn(s);
    expect(u.discover!.every(isShopSpell), 'the Shed Discover').toBe(true);
    u = takeAll(u).s;
    expect(spells(u).length).toBe(1);
    expect(u.ancients!.cassenSecond).toBeUndefined();
    expect(u.commission!.kind).toBe('discover');
    u = commission(u, 'gold');
    expect(u.ancients!.cassenSecond!.kind).toBe('gold');
  });
  it('when the first pays out and the second is still working, the second moves up into the first slot', () => {
    let s = commission(commission(picked('time'), 'spell'), 'discover');
    const due = s.ancients!.cassenSecond!.dueWave;
    s = takeAll(nextTurn(s)).s;
    expect(spells(s).length).toBe(1);
    expect(s.commission).toEqual({ kind: 'discover', dueWave: due });
    expect(s.ancients!.cassenSecond).toBeUndefined();
  });
  it('both due the same turn: both pay (a Bridge and a Castle, never the same job twice in a row)', () => {
    let s = commission(picked('time', { tier: 2, upgradeCost: 11 }), 'discover');
    expect(reduce({ ...s, heroReady: true }, { type: 'heroPower', commission: 'discover' }).ancients!.cassenSecond, 'no repeat in a row').toBeUndefined();
    s = commission(s, 'citadel');
    const max0 = s.maxGoldBonus ?? 0;
    while (s.commission) s = nextTurn(s);
    expect(s.ancients!.cassenSecond).toBeUndefined();
    expect(s.discover?.length, 'the Bridge Discover').toBeGreaterThan(0);
    expect((s.maxGoldBonus ?? 0) - max0).toBe(0);
  });
  it('without the pairing a second commission is refused (one at a time)', () => {
    const s = commission(picked('fortune'), 'spell');
    expect(reduce({ ...s, heroReady: true }, { type: 'heroPower', commission: 'gold' }).commission!.kind).toBe('spell');
  });
});

describe('Cassen × BONDS: "Commission pays out twice."', () => {
  it('a Shed opens two spell Discovers; a House pays 8 Gold; no max Gold; the text counts both', () => {
    let s = commission(picked('bonds'), 'spell');
    expect(heroPowerText(s)).toBe('Working: **Shed** pays out next turn. Discover a Shop spell 2 times. It pays out **twice** (the numbers above count both).');
    const max0 = s.maxGoldBonus ?? 0;
    s = nextTurn(s);
    const { s: t, offers } = takeAll(s);
    expect(offers.length).toBe(2);
    expect(offers.every((o) => o.every(isShopSpell))).toBe(true);
    expect(spells(t).length).toBe(2);
    expect((t.maxGoldBonus ?? 0) - max0).toBe(0);
    expect(commissionRewardOf(t, 'gold')).toBe('Gain 8 Gold.');
  });
});

describe('Cassen × save / restore and determinism', () => {
  it('the running count survives a JSON round trip', () => {
    let s = picked('death');
    s = JSON.parse(JSON.stringify({ ...s, ancients: { ...s.ancients!, cassenDeaths: 3 } })) as RunState;
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
