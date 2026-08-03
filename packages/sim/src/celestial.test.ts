import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { alignmentAt, alignmentsOf } from './alignment';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { applyEndOfTurn } from './recruit';

/**
 * CELESTIAL mechanics (owner spec 2026-08-03) — Alignment + Orbit.
 *
 * Alignment: the board splits around its CENTRE — Dawn left, Dusk right, Eclipse the exact middle body
 * (which counts as both). Derived from board SIZE, so a lone minion is Eclipsed and an EVEN board has none.
 * It locks at combat setup and combat never re-centres.
 *
 * Orbit: fires when a card is PLAYED FROM HAND adjacent to the watcher, gated by the watcher's OWN alignment.
 */

const body = (uid: string, cardId = 'sandbag'): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false });
// DISTINCT card ids per pad: three bodies sharing an id TRIPLE the moment the third lands, which combines
// them into a golden and empties the board out from under the test (a trap this repo has hit before).
// Vanilla MINIONS with no effects — 'apples'/'bulwark' look like pads but are SPELLS, which never land
// on the board at all and so can never be adjacent to anything.
const PADS = ['venom', 'bronzewarden', 'tara'];
const pad = (uid: string, i: number): BoardCard => body(uid, PADS[i]!);

describe('alignment centring', () => {
  it("matches the owner's worked cases", () => {
    expect(alignmentsOf([body('a')])).toEqual(['eclipse']); // a lone minion is Eclipsed
    expect(alignmentsOf([body('a'), body('b')])).toEqual(['dawn', 'dusk']); // EVEN -> no Eclipse
    expect(alignmentsOf([body('a'), body('b'), body('c')])).toEqual(['dawn', 'eclipse', 'dusk']);
    expect(alignmentsOf(['a', 'b', 'c', 'd'].map((u) => body(u)))).toEqual(['dawn', 'dawn', 'dusk', 'dusk']);
    expect(alignmentsOf(['a', 'b', 'c', 'd', 'e'].map((u) => body(u))))
      .toEqual(['dawn', 'dawn', 'eclipse', 'dusk', 'dusk']);
  });

  it('a FULL board is the left-3 / middle / right-3 case', () => {
    expect(alignmentsOf(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((u) => body(u))))
      .toEqual(['dawn', 'dawn', 'dawn', 'eclipse', 'dusk', 'dusk', 'dusk']);
  });

  it('EVEN boards never have an Eclipse; ODD boards have exactly one', () => {
    for (let n = 1; n <= 7; n++) {
      const eclipses = Array.from({ length: n }, (_, i) => alignmentAt(n, i)).filter((a) => a === 'eclipse');
      expect(eclipses.length, `board of ${n}`).toBe(n % 2 === 1 ? 1 : 0);
    }
  });
});

describe('Orbit', () => {
  // Twinlight Orbiter: Dawn Orbit -> buff the ARRIVER; Dusk Orbit -> buff ITSELF; Eclipsed -> both.
  const orbiter = (uid: string): BoardCard =>
    ({ uid, cardId: 'c3_orbiter', tribe: 'neutral', attack: 2, health: 3, keywords: [], golden: false });

  it('a DUSK orbiter feeds itself when a card lands beside it', () => {
    // [pad, pad, orbiter] + a play appends -> 4 bodies, orbiter at index 2 = dusk, arriver adjacent.
    let s: RunState = { ...createRun(1), board: [pad('p1', 0), pad('p2', 1), orbiter('orb')], hand: [pad('new', 2)], embers: 0 };
    s = reduce(s, { type: 'play', uid: 'new' });
    const idx = s.board.findIndex((c) => c.uid === 'orb');
    expect(alignmentsOf(s.board)[idx]).toBe('dusk');
    const orb = s.board.find((c) => c.uid === 'orb')!;
    const arriver = s.board.find((c) => c.uid === 'new')!;
    expect([orb.attack, orb.health], 'Dusk Orbit feeds ITSELF').toEqual([4, 5]);
    expect([arriver.attack, arriver.health], 'and must NOT pay the arriver').toEqual([2, 2]);
  });

  it('a DAWN orbiter pays the arriver instead', () => {
    // A lone orbiter + a play -> 2 bodies [dawn, dusk]; the orbiter is Dawn and the arriver is adjacent.
    let s: RunState = { ...createRun(1), board: [orbiter('orb')], hand: [pad('new', 0)], embers: 0 };
    s = reduce(s, { type: 'play', uid: 'new' });
    const idx = s.board.findIndex((c) => c.uid === 'orb');
    expect(alignmentsOf(s.board)[idx]).toBe('dawn');
    const arriver = s.board.find((c) => c.uid === 'new')!;
    const orb = s.board.find((c) => c.uid === 'orb')!;
    expect([arriver.attack, arriver.health], 'Dawn Orbit pays the ARRIVER').toEqual([4, 4]);
    expect([orb.attack, orb.health], 'and must NOT feed itself').toEqual([2, 3]);
  });

  it('an ECLIPSED orbiter fires BOTH halves', () => {
    // [pad, orbiter] + a play -> 3 bodies, orbiter at index 1 = eclipse, arriver adjacent.
    let s: RunState = { ...createRun(1), board: [pad('p1', 0), orbiter('orb')], hand: [pad('new', 1)], embers: 0 };
    s = reduce(s, { type: 'play', uid: 'new' });
    const idx = s.board.findIndex((c) => c.uid === 'orb');
    expect(alignmentsOf(s.board)[idx]).toBe('eclipse');
    const arriver = s.board.find((c) => c.uid === 'new')!;
    const orb = s.board.find((c) => c.uid === 'orb')!;
    expect([arriver.attack, arriver.health], 'eclipse pays the arriver...').toEqual([4, 4]);
    expect([orb.attack, orb.health], '...AND feeds itself').toEqual([4, 5]);
  });

  it('only fires for ADJACENT minions', () => {
    let s: RunState = { ...createRun(1), board: [orbiter('orb'), pad('p1', 0), pad('p2', 1)], hand: [pad('new', 2)], embers: 0 };
    s = reduce(s, { type: 'play', uid: 'new' });
    const orb = s.board.find((c) => c.uid === 'orb')!;
    const arriver = s.board.find((c) => c.uid === 'new')!;
    expect([orb.attack, orb.health], 'a distant play must not orbit').toEqual([2, 3]);
    expect([arriver.attack, arriver.health]).toEqual([2, 2]);
  });
});

describe('alignment gates ordinary triggers', () => {
  const herald = (uid: string): BoardCard =>
    ({ uid, cardId: 'c3_herald', tribe: 'neutral', attack: 3, health: 2, keywords: [], golden: false });

  it('a DUSK Shout takes the self-buff half', () => {
    // Played onto [pad, pad] -> index 2 of 3 = dusk.
    let s: RunState = { ...createRun(1), board: [pad('p1', 0), pad('p2', 1)], hand: [herald('h')], embers: 0 };
    s = reduce(s, { type: 'play', uid: 'h' });
    const h = s.board.find((c) => c.uid === 'h')!;
    expect(alignmentsOf(s.board)[s.board.findIndex((c) => c.uid === 'h')]).toBe('dusk');
    expect([h.attack, h.health], 'the Dusk half fired').toEqual([5, 4]);
  });

  it('an ECLIPSE Shout takes BOTH halves (self-buff AND the Gold)', () => {
    // Played onto an EMPTY board -> the lone body is Eclipsed.
    let s: RunState = { ...createRun(1), board: [], hand: [herald('h')], embers: 0 };
    const goldNextBefore = s.bonusEmbersNextTurn ?? 0;
    s = reduce(s, { type: 'play', uid: 'h' });
    const h = s.board.find((c) => c.uid === 'h')!;
    expect(alignmentsOf(s.board)).toEqual(['eclipse']);
    expect([h.attack, h.health], 'the Dusk half fired').toEqual([5, 4]);
    expect(s.bonusEmbersNextTurn ?? 0, 'and the Dawn half too').toBeGreaterThan(goldNextBefore);
  });
});

describe('alignment LOCKS at combat', () => {
  // NOTE on why the ECLIPSE case is pinned against a HAND-BUILT combat rather than through `faceOmen`:
  // both of the Sentinel's halves are `scDamage`, and against wave-1's small procedural threat board the
  // Dawn half KILLS the only enemy — so the Dusk half correctly finds no targets and logs nothing. That is
  // right behaviour, not a missing gate, so the eclipse proof uses durable 20-HP dummies (below) and the
  // reducer path is pinned with the unambiguous DAWN case.
  it('a DAWN-aligned board stamps only the Dawn half through the real reducer path', () => {
    // Sentinel first of two bodies -> dawn. Only Dawnfire may appear.
    const s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [
        { uid: 'sen', cardId: 'c3_sentinel', tribe: 'neutral', attack: 3, health: 4, keywords: [], golden: false },
        pad('p1', 0),
      ],
      hand: [],
    };
    const after = reduce(s, { type: 'faceOmen' });
    const scs = after.lastCombat!.events.filter((e) => e.type === 'sc').map((e) => (e as { text?: string }).text);
    expect(scs).toContain('Dawnfire');
    expect(scs).not.toContain('Duskfall');
  });

  it('an ECLIPSE-locked Sentinel runs BOTH Start-of-Combat halves', () => {
    const sentinel: BoardMinion = { cardId: 'c3_sentinel', attack: 3, health: 4, align: 'eclipse' };
    const foes: BoardMinion[] = [
      { cardId: 'sandbag', attack: 0, health: 20 },
      { cardId: 'sandbag', attack: 0, health: 20 },
    ];
    const r = simulate([sentinel], foes, makeRng(5), CARD_INDEX, combatSide({ tier: 3 }), combatSide({ tier: 3 }));
    const scs = r.events.filter((e) => e.type === 'sc').map((e) => (e as { text?: string }).text);
    expect(scs).toEqual(expect.arrayContaining(['Dawnfire', 'Duskfall']));
  });

  it('a DAWN-locked Sentinel runs ONLY its Dawn half', () => {
    const sentinel: BoardMinion = { cardId: 'c3_sentinel', attack: 3, health: 4, align: 'dawn' };
    const foes: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 20 }];
    const r = simulate([sentinel], foes, makeRng(5), CARD_INDEX, combatSide({ tier: 3 }), combatSide({ tier: 3 }));
    const scs = r.events.filter((e) => e.type === 'sc').map((e) => (e as { text?: string }).text);
    expect(scs).toContain('Dawnfire');
    expect(scs, 'the Dusk half must be inert for a Dawn body').not.toContain('Duskfall');
  });

  it('a body with NO alignment runs neither gated half (a non-Celestial board is untouched)', () => {
    const sentinel: BoardMinion = { cardId: 'c3_sentinel', attack: 3, health: 4 }; // no align stamped
    const foes: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 20 }];
    const r = simulate([sentinel], foes, makeRng(5), CARD_INDEX, combatSide({ tier: 3 }), combatSide({ tier: 3 }));
    const scs = r.events.filter((e) => e.type === 'sc').map((e) => (e as { text?: string }).text);
    expect(scs).not.toContain('Dawnfire');
    expect(scs).not.toContain('Duskfall');
  });
});

describe('the Celestial test units are self-consistent', () => {
  it('every Celestial is flagged and every aligned half names a real side', () => {
    for (const id of ['c3_orbiter', 'c3_herald', 'c3_sentinel']) {
      const def = CARD_INDEX[id]!;
      expect(def, id).toBeDefined();
      expect(def.celestial, `${id} must carry the celestial flag`).toBe(true);
      const aligned = def.effects.filter((e) => e.align);
      expect(aligned.length, `${id} should have aligned halves`).toBeGreaterThan(0);
      for (const e of aligned) expect(['dawn', 'dusk']).toContain(e.align);
    }
  });
});

describe('the second Celestial batch (owner 2026-08-03)', () => {
  const mk = (uid: string, cardId: string, attack: number, health: number, keywords: BoardCard['keywords'] = []): BoardCard =>
    ({ uid, cardId, tribe: 'neutral', attack, health, keywords, golden: false });

  it('Daybreak Acolyte: Dawn +2 Attack, Dusk +2 Health, Eclipse both (Start of Combat)', () => {
    const foes: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 50 }];
    const run1 = (align: 'dawn' | 'dusk' | 'eclipse') =>
      simulate([{ cardId: 'c3_acolyte', attack: 1, health: 2, align }], foes, makeRng(2), CARD_INDEX, combatSide({ tier: 1 }), combatSide({ tier: 1 }));
    const stats = (r: ReturnType<typeof run1>): [number, number] => {
      const buffs = r.events.filter((e) => e.type === 'buff' && (e as { target: string }).target === 'm0') as { attack: number; health: number }[];
      return [buffs.reduce((n, b) => n + b.attack, 0), buffs.reduce((n, b) => n + b.health, 0)];
    };
    expect(stats(run1('dawn'))).toEqual([2, 0]);
    expect(stats(run1('dusk'))).toEqual([0, 2]);
    expect(stats(run1('eclipse'))).toEqual([2, 2]);
  });

  it('Starweft Familiar: an UNGATED Orbit fires whatever its alignment', () => {
    let s: RunState = { ...createRun(1), board: [pad('p1', 0), pad('p2', 1), mk('sw', 'c3_starweft', 2, 2)], hand: [pad('new', 2)], embers: 0 };
    // The Familiar sits at index 2 of 3 = DUSK — an ungated Orbit must still pay the arriver.
    s = reduce(s, { type: 'play', uid: 'new' });
    const arriver = s.board.find((c) => c.uid === 'new')!;
    expect([arriver.attack, arriver.health], 'ungated Orbit pays regardless of side').toEqual([3, 3]);
  });

  it('Equinox Duelist: a DAWN-locked Rally pays Attack; a DUSK-locked Echo pays Health', () => {
    const foes: BoardMinion[] = [{ cardId: 'sandbag', attack: 20, health: 200 }];
    // Dawn: the Duelist rallies (RL) on its swing — its fellow Celestial gains +2 Attack.
    const dawn = simulate(
      [{ cardId: 'c3_equinox', attack: 3, health: 3, keywords: ['RL'], align: 'dawn' },
       { cardId: 'c3_acolyte', attack: 1, health: 30 }],
      foes, makeRng(3), CARD_INDEX, combatSide({ tier: 2 }), combatSide({ tier: 2 }));
    const atkTo = (r: typeof dawn, uid: string): number =>
      (r.events.filter((e) => e.type === 'buff' && (e as { target: string }).target === uid && (e as { source?: string }).source === 'm0') as { attack: number }[])
        .reduce((n, b) => n + b.attack, 0);
    expect(atkTo(dawn, 'm1'), 'the Dawn Rally buffed the other Celestial').toBeGreaterThan(0);
    // Dusk: the Duelist DIES into the 20-attack wall — its Echo gives the survivor +2 Health.
    const dusk = simulate(
      [{ cardId: 'c3_equinox', attack: 3, health: 3, keywords: ['RL'], align: 'dusk' },
       { cardId: 'c3_acolyte', attack: 1, health: 30 }],
      foes, makeRng(3), CARD_INDEX, combatSide({ tier: 2 }), combatSide({ tier: 2 }));
    const hpTo = (r: typeof dusk, uid: string): number =>
      (r.events.filter((e) => e.type === 'buff' && (e as { target: string }).target === uid && (e as { source?: string }).source === 'm0') as { health: number }[])
        .reduce((n, b) => n + b.health, 0);
    expect(hpTo(dusk, 'm1'), 'the Dusk Echo buffed the survivor').toBeGreaterThan(0);
  });

  it('Starbroker Nym: Dawn banks Gold, Dusk draws a spell, Eclipse does both — and the halves stay exclusive', () => {
    // DAWN: Nym first of two bodies.
    const dawn: RunState = { ...createRun(1), board: [mk('nym', 'c3_nym', 3, 5), pad('p1', 0)], hand: [] };
    applyEndOfTurn(dawn);
    expect(dawn.bonusEmbersNextTurn ?? 0, 'Dawn banks 2 Gold').toBe(2);
    expect(dawn.hand.length, 'and must NOT draw the Dusk spell').toBe(0);
    // DUSK: Nym second of two.
    const dusk: RunState = { ...createRun(1), board: [pad('p1', 0), mk('nym', 'c3_nym', 3, 5)], hand: [] };
    applyEndOfTurn(dusk);
    expect(dusk.bonusEmbersNextTurn ?? 0, 'Dusk banks nothing').toBe(0);
    expect(dusk.hand.length, 'Dusk draws a spell').toBe(1);
    expect(CARD_INDEX[dusk.hand[0]!.cardId]?.spell).toBe(true);
    // ECLIPSE: Nym alone.
    const ecl: RunState = { ...createRun(1), board: [mk('nym', 'c3_nym', 3, 5)], hand: [] };
    applyEndOfTurn(ecl);
    expect(ecl.bonusEmbersNextTurn ?? 0).toBe(2);
    expect(ecl.hand.length).toBe(1);
  });
});
