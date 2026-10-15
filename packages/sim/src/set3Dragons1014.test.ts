import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, EQUIPMENT_INDEX, SETS, WHISPER_IDS, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type BoardSnapshot, type RunState } from './index';
import { spellDisplayText } from './recruit';

/**
 * SET 3 DRAGONS, the 2026-10-14 owner batch (the Whisper Dragons moved into Set 3 the same day):
 *
 *  - WHALOO (T6 9/10): "When a Dragon attacks, cast Runebind on it. (3 times per combat)" — R-WHISPER-03.
 *  - FALX (T5 6/5) + its Whisper RIPPLE: "Trigger a minion's Shout." — R-WHISPER-04.
 *  - QUEEN MORRO (T5 7/8): "Your spells cast an additional time in combat." — R-SPELL-MORRO-01.
 *  - SHUSH (T4 5/4): "Equip: Jar of Secrets (2): Get 3 random Whispers." — R-WHISPER-05.
 *  - A Gilded granter's Whisper is gilded: the effect (and Runebind's improve) doubles, on every surface — R-WHISPER-06.
 *  - Runebind's FX trigger (the buff tagged with the spell) on every cast source, both phases — R-WHISPER-07.
 */

const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, undefined, 'ascent', undefined, 'set3'), phase: 'recruit', embers: 40, tier: 6, hand: [], board: [], ...over } as RunState);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const stats = (c: BoardCard): [number, number] => [c.attack, c.health];
const whispersIn = (s: RunState, id?: string): BoardCard[] => s.hand.filter((c) => CARD_INDEX[c.cardId]?.whisper && (!id || c.cardId === id));
const cast = (s: RunState, whisperUid: string, targetUid: string): RunState => act(s, { type: 'play', uid: whisperUid, targetUid } as Action);
const nextTurn = (s: RunState): RunState => act(act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' }), { type: 'resolveCombat' });

const m = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack: CARD_INDEX[cardId]!.attack, health: CARD_INDEX[cardId]!.health, keywords: [...CARD_INDEX[cardId]!.keywords], ...over } as unknown as BoardMinion);
const wall = (): BoardMinion[] => [{ cardId: 'sandbag', attack: 1, health: 500, keywords: [] } as unknown as BoardMinion];
const fight = (p: BoardMinion[], improve?: Record<string, number>, seed = 5) =>
  simulate(p, wall(), makeRng(seed), CARD_INDEX, combatSide({ tier: 6, ...(improve ? { whisperImprove: improve } : {}) }), combatSide({ tier: 6 }));
const runebindCasts = (events: readonly CombatEvent[]) =>
  events.filter((e): e is Extract<CombatEvent, { type: 'sc' }> => e.type === 'sc' && e.spellId === 'w4_runebind');
const runebindBuffs = (events: readonly CombatEvent[]) =>
  events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.spellId === 'w4_runebind');

describe('the batch is Set 3 content', () => {
  it('Whaloo, Falx, Queen Morro and Shush are Set 3 Dragons at the owner stats; Jar of Secrets is an Equipment, not a spell', () => {
    const want: [string, number, number, number][] = [['d3_whaloo', 6, 9, 10], ['d3_falx', 5, 6, 5], ['d3_morro', 5, 7, 8], ['d3_shush', 4, 5, 4]];
    const ids = poolFor('set3').buyable.map((c) => c.id);
    for (const [id, tier, a, h] of want) {
      const d = CARD_INDEX[id]!;
      expect([d.tribe, d.tier, d.attack, d.health], id).toEqual(['dragon', tier, a, h]);
      expect(ids, id).toContain(id);
    }
    expect(CARD_INDEX['sp3_jarofsecrets'], 'the spell was replaced by the Equipment the same day (never shipped)').toBeUndefined();
    expect(SETS.set3.tribes).toContain('dragon');
    // Ripple is a Whisper (Gift class): granted, never drawable.
    expect(CARD_INDEX['w3_ripple']?.whisper).toBe(true);
    expect(poolFor('set3').all.some((c) => c.id === 'w3_ripple')).toBe(false);
    expect([...WHISPER_IDS].slice(0, 3)).toEqual(['w4_tome', 'w4_runebind', 'w3_ripple']); // + Well of Dragons and Seed (2026-10-15, set3Dragons1015.test.ts)
    for (const id of ['d3_whaloo', 'd3_falx', 'd3_morro', 'd3_shush', 'w3_ripple']) {
      for (const t of [CARD_INDEX[id]!.text, CARD_INDEX[id]!.goldenText ?? '']) expect(/—|--/.test(t), `${id}: ${t}`).toBe(false);
    }
  });
});

describe('R-WHISPER-03: Whaloo casts Runebind on an attacking Dragon (3 times per combat)', () => {
  it('each friendly Dragon swing casts Runebind on the attacker: combat-only stats, a real spell cast, the improve rises live', () => {
    const r = fight([m('d4_galas', { health: 60 }), m('d3_whaloo', { health: 100 })], { w4_runebind: 4 });
    const casts = runebindCasts(r.events).filter((e) => e.source === r.initial.player[1]!.uid);
    expect(casts).toHaveLength(3); // the cap
    // Runebind's live value: base 2 + the run's improvement 4 = 6, then +2 per cast (real time).
    expect(runebindBuffs(r.events).map((b) => b.attack)).toEqual([6, 8, 10]);
    expect(casts.map((c) => c.whisperImprove)).toEqual([6, 8, 10]);
    expect(r.playerShoutCarry?.whisperImprove).toEqual({ w4_runebind: 10 });
    expect(r.playerSpellsCast).toBe(3);
  });

  it('a non-Dragon attacker gets nothing', () => {
    const r = fight([m('venom', { health: 60 }), m('d3_whaloo', { attack: 0, health: 100 })]);
    // Only Whaloo's own swings (it is a Dragon) cast; venom's never do. A 0-Attack Whaloo still attacks.
    for (const c of runebindCasts(r.events)) expect(c.target).toBe(r.initial.player[1]!.uid);
  });

  it('Gilded Whaloo casts a GILDED Runebind: double the value and the improve; the cap stays 3', () => {
    const r = fight([m('d4_galas', { health: 60 }), m('d3_whaloo', { health: 100, golden: true, attack: 18 })]);
    // The Shop's gilded formula exactly: (base + the run's improve) x2, and each gilded cast improves by +4.
    expect(runebindBuffs(r.events).map((b) => b.attack)).toEqual([4, 12, 20]); // (2+0)x2, (2+4)x2, (2+8)x2
    expect(r.playerShoutCarry?.whisperImprove).toEqual({ w4_runebind: 12 });
    expect(runebindCasts(r.events)).toHaveLength(3);
  });

  it('Whisp hears it (a Whisper cast on a Dragon): a full cast on itself; Tamby copies it to hand, once per fight', () => {
    const r = fight([m('d4_galas', { health: 60 }), m('d3_whaloo', { attack: 0, health: 100 }), m('d4_whisp', { attack: 0, health: 100 }), m('d4_tamby', { attack: 0, health: 100 })]);
    const [, , whisp] = r.initial.player.map((x) => x.uid);
    expect(runebindBuffs(r.events).some((b) => b.target === whisp), 'Whisp took the echo').toBe(true);
    expect(r.playerSpellsCast).toBeGreaterThanOrEqual(2);
    const tambyFight = fight([m('d4_tamby', { health: 60 }), m('d3_whaloo', { attack: 0, health: 100 })]);
    expect(tambyFight.playerHandGrants?.filter((id) => id === 'w4_runebind')).toHaveLength(1); // once per fight
  });

  it('settle: the Runebind improve is PERMANENT on the run; the attacker\'s stats are not', () => {
    const foes: BoardSnapshot = { v: 1, wave: 1, heroId: 'indy', resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 1, minions: [{ cardId: 'sandbag', attack: 0, health: 300, keywords: [] }], seed: 1, origin: 'self' };
    let s = run({ wave: 1, board: [bc('g', 'd4_galas', { health: 60 }), bc('w', 'd3_whaloo', { health: 100 })] });
    s = { ...s, servedBoards: { [s.wave]: foes } } as RunState;
    const before = s.spellsCast;
    s = act(act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' }), { type: 'resolveCombat' });
    expect(s.whisperImprove?.['w4_runebind']).toBe(6); // three combat casts, +2 each
    expect(s.spellsCast).toBe(before + 3); // each counted (Galas's Tome reads this)
    expect(stats(at(s, 'g'))).toEqual([3, 60]); // the Runebind stats were combat-only
  });
});

describe('R-SPELL-MORRO-01: Queen Morro, "Your spells cast an additional time in combat"', () => {
  it('every combat cast repeats: Whaloo\'s Runebind lands twice per trigger (Runebind improves per cast; the cap counts triggers)', () => {
    const r = fight([m('d4_galas', { health: 60 }), m('d3_whaloo', { attack: 0, health: 100 }), m('d3_morro', { attack: 0, health: 100 })]);
    const whaloo = r.initial.player[1]!.uid;
    const own = runebindCasts(r.events).filter((e) => e.source === whaloo);
    expect(own.length).toBe(6); // 3 triggers x 2 casts
    expect(new Set(own.map((e) => (e as { step?: number }).step)).size).toBe(3);
    expect(r.playerSpellsCast).toBe(6);
    expect(runebindBuffs(r.events).filter((b) => b.source === whaloo).map((b) => b.attack)).toEqual([2, 4, 6, 8, 10, 12]);
  });

  it('Gilded Morro: 2 additional times (3 casts per trigger)', () => {
    const r = fight([m('d4_galas', { health: 60 }), m('d3_whaloo', { attack: 0, health: 100 }), m('d3_morro', { attack: 0, health: 100, golden: true })]);
    expect(runebindCasts(r.events).filter((e) => e.source === r.initial.player[1]!.uid)).toHaveLength(9);
  });

  it('a Ruby played in combat casts an additional time (Korn\'s Rally Ruby lands twice)', () => {
    const korn = (p: BoardMinion[]) => {
      const r = fight(p);
      const k = r.initial.player[0]!.uid;
      const first = r.events.findIndex((e) => e.type === 'attack' && e.attacker === k);
      const next = r.events.findIndex((e, i) => i > first && e.type === 'attack');
      return r.events.slice(first, next < 0 ? undefined : next).filter((e) => e.type === 'buff' && e.target === k && (e as { ruby?: true }).ruby).reduce((n, e) => n + (e as { attack: number }).attack, 0);
    };
    const plain = korn([m('k3_korn', { health: 60 })]);
    const withMorro = korn([m('k3_korn', { health: 60 }), m('d3_morro', { attack: 0, health: 100 })]);
    expect(plain).toBeGreaterThan(0);
    expect(withMorro).toBe(plain * 2);
  });

  it('Shop-phase casts are untouched (the text says "in combat")', () => {
    let s = run({ board: [bc('t', 'd4_tolan'), bc('q', 'd3_morro'), bc('x', 'venom')] });
    s = nextTurn(s);
    const before = s.spellsCast;
    s = cast(s, whispersIn(s, 'w4_runebind')[0]!.uid, 'x');
    expect(s.spellsCast).toBe(before + 1);
  });
});

describe('R-WHISPER-04: Falx grants Ripple, "Trigger a minion\'s Shout"', () => {
  it('playing Falx hands over a Ripple; Ripple re-fires a Shout; a Shout-less target refuses (kept in hand)', () => {
    let s = act(run({ board: [bc('h', 'b4_hawg', { health: 5 }), bc('x', 'venom')], hand: [bc('f', 'd3_falx')] }), { type: 'play', uid: 'f', toIndex: 0 } as Action);
    const ripple = whispersIn(s, 'w3_ripple')[0]!;
    expect(ripple).toBeTruthy();
    const refused = cast(s, ripple.uid, 'x'); // venom has no Shout
    expect(whispersIn(refused, 'w3_ripple')).toHaveLength(1);
    const before = s.spellsCast;
    s = cast(s, ripple.uid, 'h'); // Hawg's Shout: 1 damage to itself, Beasts +1 Health
    expect(whispersIn(s, 'w3_ripple')).toHaveLength(0);
    expect(at(s, 'h').health).toBe(5); // net neutral on itself, as when played
    expect(s.spellsCast).toBe(before + 1);
  });

  it('a Gilded Falx grants a gilded Ripple: the Shout fires twice; it prints "twice" live', () => {
    const s = act(run({ board: [bc('c', 'buddy')], hand: [bc('f', 'd3_falx', { golden: true })] }), { type: 'play', uid: 'f', toIndex: 0 } as Action);
    const ripple = whispersIn(s, 'w3_ripple')[0]!;
    expect(ripple.whisperMult).toBe(2);
    expect(spellDisplayText('w3_ripple', 0, 0, 0, 0, 0, 0, { whisperMult: 2 })).toContain('{{twice}}');
    expect(spellDisplayText('w3_ripple', 0, 0, 0, 0, 0, 0, {})).not.toContain('twice');
  });

  it('a gilded Ripple triggers the Shout twice (Hawg: your other Beasts +1 Health per trigger)', () => {
    const mended = (golden: boolean): number => {
      let s = act(run({ board: [bc('h', 'b4_hawg', { health: 5 }), bc('e', 'b4_eatah')], hand: [bc('f', 'd3_falx', { golden })] }), { type: 'play', uid: 'f', toIndex: 0 } as Action);
      const before = at(s, 'e').health;
      s = cast(s, whispersIn(s, 'w3_ripple')[0]!.uid, 'h');
      return at(s, 'e').health - before;
    };
    expect(mended(false)).toBe(1);
    expect(mended(true)).toBe(2);
  });
});

describe('R-WHISPER-05: Shush equips Jar of Secrets, 3 random Whispers', () => {
  it('"(2)" is its Gold cost; a use gets 3 random Whispers from the pool; Gilded gets 3 GILDED Whispers; they fade at End of Turn', () => {
    const jar = EQUIPMENT_INDEX['jar_of_secrets']!;
    expect([jar.name, jar.baseCost, jar.targetMode, jar.params, jar.gildedParams]).toEqual(['Jar of Secrets', 2, 'none', { count: 3, mult: 1 }, { count: 3, mult: 2 }]);
    expect(CARD_INDEX['d3_shush']!.effects[0]).toMatchObject({ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'jar_of_secrets' } });
    for (const golden of [false, true]) {
      let s = act(run({ hand: [bc('s', 'd3_shush', { golden })] }), { type: 'play', uid: 's', toIndex: 0 } as Action);
      const gold = s.embers;
      s = act(s, { type: 'activateEquipment' } as Action);
      expect(s.embers, 'paid its 2 Gold').toBe(gold - 2);
      const got = whispersIn(s);
      expect(got, `golden ${golden}`).toHaveLength(3);
      for (const w of got) { expect(WHISPER_IDS).toContain(w.cardId); expect(w.whisperMult ?? 1).toBe(golden ? 2 : 1); }
      s = act(s, { type: 'faceOmen' });
      expect(whispersIn(s)).toHaveLength(0);
    }
  });
});

describe('R-WHISPER-06: a Gilded granter\'s Whisper is gilded, on every surface', () => {
  it('Gilded Tolan: the Runebind in hand prints double, casts double and improves double', () => {
    let s = nextTurn(run({ board: [bc('t', 'd4_tolan', { golden: true }), bc('x', 'venom')] }));
    const rb = whispersIn(s, 'w4_runebind')[0]!;
    expect(rb.whisperMult).toBe(2);
    expect(spellDisplayText('w4_runebind', 0, 0, 0, 0, 0, 0, { whisperMult: 2, whisperImprove: s.whisperImprove })).toContain('{{+4/+4}}');
    expect(spellDisplayText('w4_runebind', 0, 0, 0, 0, 0, 0, { whisperMult: 2 })).toContain('Improve this by **+4/+4**');
    s = cast(s, rb.uid, 'x');
    expect(stats(at(s, 'x'))).toEqual([1 + 4, 1 + 4]);
    expect(s.whisperImprove?.['w4_runebind']).toBe(4);
  });

  it('Tamby\'s copy of a gilded Whisper is gilded too', () => {
    let s = nextTurn(run({ board: [bc('t', 'd4_tolan', { golden: true }), bc('y', 'd4_tamby')] }));
    s = cast(s, whispersIn(s, 'w4_runebind')[0]!.uid, 'y');
    expect(whispersIn(s, 'w4_runebind')[0]?.whisperMult).toBe(2);
  });
});

describe('R-WHISPER-07: every Runebind cast is tagged for its FX, from every source, in both phases', () => {
  // The player's cast's own capture: SPELL-kind records, one per landed buff (the UI's `buffedOn` row plays once per
  // record on its target, `runBuffedOnFire`), never a rune's or a minion's cast.
  const own = (s: RunState, uid: string) => s.recruitBuffFx.filter((e) => e.kind === 'spell' && e.targetUid === uid && !e.sourceRuneId && !e.castByUid);
  it('Shop: from hand, a Yazzus repeat, a Whisp echo, a gilded copy, a Tamby copy: one spell buff per cast, on its target', () => {
    let s = nextTurn(run({ board: [bc('t', 'd4_tolan', { golden: true }), bc('z', 'yazzus'), bc('w', 'd4_whisp'), bc('y', 'd4_tamby')] }));
    s = cast(s, whispersIn(s, 'w4_runebind')[0]!.uid, 't'); // a Dragon: Yazzus repeats, Whisp echoes each cast
    expect(own(s, 't')).toHaveLength(2); // the cast + Yazzus's repeat
    expect(own(s, 'w')).toHaveLength(2); // Whisp's echo of each
    s = nextTurn(s);
    s = cast(s, whispersIn(s, 'w4_runebind')[0]!.uid, 'y'); // Tamby hands back a copy…
    s = cast(s, whispersIn(s, 'w4_runebind')[0]!.uid, 'y'); // …and casting the copy is its own cast (Yazzus doubles it)
    expect(own(s, 'y')).toHaveLength(2);
  });

  it('Combat: Whaloo\'s casts and Whisp\'s echo each carry the spell on the target\'s buff', () => {
    const r = fight([m('d4_galas', { health: 60 }), m('d3_whaloo', { attack: 0, health: 100 }), m('d4_whisp', { attack: 0, health: 100 })]);
    const buffs = runebindBuffs(r.events);
    expect(buffs.length).toBe(runebindCasts(r.events).length); // one tagged buff per cast
    for (const c of runebindCasts(r.events)) expect(buffs.some((b) => b.target === c.target)).toBe(true);
  });
});
