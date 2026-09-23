import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, offerBuyStats, type Action, type BoardCard, type RunState, type ShopCard } from './index';
import { applyEndOfTurn, endOfTurnTicksOf, eotTickCount, projectEndOfTurnSteps, replayEndOfTurn } from './recruit';
import { createStarform, starformOf } from './starform';

/**
 * THE TWO TEXT PATTERNS — owner ruling 2026-09-22 (R-REPEAT-01):
 *
 *   *"mother moss's animation and mechanic doesnt trigger each individual tick. neither does kringle. both of
 *   these cards need to be 'give x' and 'repeat for every blah blah'. so mother moss and kringle give the
 *   individual stat buff and repeat it x times. there are different ways of building these buffs. for example, a
 *   lot of our stuff is... give a minion +x/+y, +a/+b for every c you played. that should give a lump sum amount
 *   in one instance. however, if something says 'give a minion +x/+y. repeat for ever c played this turn.' that
 *   should give the base buff and repeat it z times for every c played that turn. both kringle and mother moss
 *   should function with the repeat logic. their animation beats will also naturally be longer since they'll
 *   spew out all of the different buffs repeated times instead of 1 per target."*
 *
 *   LUMP   — "+x/+y, +a/+b for every C you played" / "+x/+y for each C": ONE instance, magnitude = count × rate.
 *   REPEAT — "give … +x/+y. Repeat for every C played this turn": the BASE once, then once per C — `1 + count`
 *            ticks, EACH its own state delta, its own buff-FX event (`fxWave` = the tick) and its own beat.
 *
 * This file pins the SIM half: totals, the per-tick FX signal, the deterministic per-tick target roll, gilding,
 * the shared tick count, and the audit of every other card whose text says "Repeat". The Choreographer half
 * (one ROOT trigger per tick, one beat per tick, in order) is `packages/ui/src/choreographer/repeatPerTickBeats.test.ts`.
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (setId: 'set1' | 'set2' | 'set3', over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId, phase: 'recruit', embers: 20, tier: 6, tribes: ['spirit', 'dwarf', 'beast', 'dragon', 'celestial'],
    pool: Object.fromEntries(poolFor(setId).buyable.map((c) => [c.id, 5])), recruitBuffFx: [], lastEotFires: 0, ...over } as RunState);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
/** What ONE named source has granted a body: the ledger entry `addBuff` keeps per source (`count` = calls). */
const from = (c: BoardCard, source: string): { attack: number; health: number; count: number } => {
  const b = c.buffs?.find((x) => x.source === source);
  return b ? { attack: b.attack, health: b.health, count: b.count } : { attack: 0, health: 0, count: 0 };
};
const fxOf = (s: RunState, sourceCardId: string) => s.recruitBuffFx.filter((e) => e.sourceCardId === sourceCardId);

// Spirits played this turn are read off the card ids in `playedThisTurn` (`playedThisTurnFor`), so a test can
// stamp the tally without staging the plays: Kindled Sprite is a plain Spirit body (no End-of-Turn effect).
const spiritsPlayed = (n: number): string[] => Array.from({ length: n }, () => 'sp3_kindled');
const cardsPlayed = (n: number): string[] => Array.from({ length: n }, (_, i) => `x${i}`);

describe('the shared tick count — one source for the commit, the projection and the beat list', () => {
  it('Mother Moss fires 1 + Spirits played; Kringle 1 + cards played; every other End-of-Turn effect once', () => {
    expect(eotTickCount({ playedThisTurn: [] }, { do: 'endOfTurnBuffRandomTribeRepeatPerPlayed' })).toBe(1);
    expect(eotTickCount({ playedThisTurn: spiritsPlayed(3) }, { do: 'endOfTurnBuffRandomTribeRepeatPerPlayed' })).toBe(4);
    expect(eotTickCount({ playedThisTurn: ['x', 'y'] }, { do: 'endOfTurnBuffRandomTribeRepeatPerPlayed' }), 'non-Spirits do not count for Moss').toBe(1);
    expect(eotTickCount({ playedThisTurn: [] }, { do: 'endOfTurnBuffEndsTribePerCard' })).toBe(1);
    expect(eotTickCount({ playedThisTurn: cardsPlayed(3) }, { do: 'endOfTurnBuffEndsTribePerCard' })).toBe(4);
    expect(eotTickCount({ playedThisTurn: cardsPlayed(3) }, { do: 'endOfTurnBuffAdjacentPerCard' }), 'Striker is the LUMP form: one tick').toBe(1);
    expect(eotTickCount({ playedThisTurn: cardsPlayed(3) }, { do: 'grantRandomAle' })).toBe(1);
    // Per card: the most ticks any of its End-of-Turn effects takes.
    const s = { playedThisTurn: [...spiritsPlayed(2), 'x'] };
    expect(endOfTurnTicksOf(s, { cardId: 'sp3_nurturer' })).toBe(3);
    expect(endOfTurnTicksOf(s, { cardId: 'dw_foreman' })).toBe(4);
    expect(endOfTurnTicksOf(s, { cardId: 'dw3_striker' })).toBe(1);
    expect(endOfTurnTicksOf(s, { cardId: 'dw_brakka' }), 'no End-of-Turn effect at all').toBe(1);
    expect(endOfTurnTicksOf(s, { cardId: 'no-such-card' })).toBe(1);
  });
});

describe('Mother Moss — "give a random Spirit +3/+4. Repeat for every Spirit played this turn"', () => {
  const moss = (n: number, over: Partial<RunState> = {}): RunState => run('set3', {
    board: [body('m', 'sp3_nurturer'), body('a', 'sp3_kindled'), body('b', 'sp3_kindled')],
    playedThisTurn: spiritsPlayed(n),
    ...over,
  });
  const mossTotal = (s: RunState) => s.board.reduce((acc, c) => {
    const b = from(c, 'Mother Moss');
    return { attack: acc.attack + b.attack, health: acc.health + b.health, count: acc.count + b.count };
  }, { attack: 0, health: 0, count: 0 });

  it.each([0, 1, 3])('with %i Spirits played the total is (n + 1) × (+3/+4), landed as n + 1 separate ticks', (n) => {
    const s = moss(n);
    applyEndOfTurn(s);
    expect(mossTotal(s)).toEqual({ attack: 3 * (n + 1), health: 4 * (n + 1), count: n + 1 });
  });

  it('every tick is its own buff-FX event, tagged with its tick, in order (never two picks summed into one ribbon)', () => {
    const s = moss(3);
    applyEndOfTurn(s);
    const fx = fxOf(s, 'sp3_nurturer');
    // A self pick draws no ribbon (self-buffs pulse), so the events are the non-self ticks — each alone in its wave.
    expect(fx.length).toBeGreaterThan(0);
    expect(fx.length).toBeLessThanOrEqual(4);
    expect(new Set(fx.map((e) => e.fxWave)).size, 'one event per wave').toBe(fx.length);
    for (const e of fx) {
      expect(e.fxWave).toBeGreaterThanOrEqual(0);
      expect(e.fxWave).toBeLessThanOrEqual(3);
      expect([e.attack, e.health], 'the per-tick grant, not a lump').toEqual([3, 4]);
      expect(e.sourceUid).toBe('m');
      expect(e.kind).toBe('minion');
    }
    expect(fx.map((e) => e.fxWave), 'ticks land in order').toEqual([...fx.map((e) => e.fxWave)].sort((a, b) => a! - b!));
  });

  it('re-rolls its target per tick, deterministically: the same state rolls the same targets, and the rolls spread', () => {
    const a = moss(5, { rngCursor: 0x5eed });
    const b = moss(5, { rngCursor: 0x5eed });
    applyEndOfTurn(a);
    applyEndOfTurn(b);
    expect(a.board.map((c) => [c.uid, from(c, 'Mother Moss')])).toEqual(b.board.map((c) => [c.uid, from(c, 'Mother Moss')]));
    expect(a.rngCursor, 'the same draws were consumed').toBe(b.rngCursor);
    // Six ticks over three Spirits: a fresh pick per tick puts them on more than one body.
    expect(a.board.filter((c) => from(c, 'Mother Moss').count > 0).length, 'every tick on one body would mean the target is not re-rolled').toBeGreaterThan(1);
    // …and the commit consumed exactly one draw per tick: the projection (a throwaway clone, same cursor) agrees.
    const proj = projectEndOfTurnSteps(moss(5, { rngCursor: 0x5eed }));
    const last = proj.steps[proj.steps.length - 1]!;
    for (const c of a.board) expect(last[c.uid], `projected ${c.uid}`).toEqual({ attack: c.attack, health: c.health });
  });

  it('gilded doubles the per-tick grant (+6/+8), never the tick count', () => {
    const s = moss(2, { board: [body('m', 'sp3_nurturer', { golden: true }), body('a', 'sp3_kindled'), body('b', 'sp3_kindled')] });
    applyEndOfTurn(s);
    expect(mossTotal(s)).toEqual({ attack: 6 * 3, health: 8 * 3, count: 3 });
    for (const e of fxOf(s, 'sp3_nurturer')) expect([e.attack, e.health]).toEqual([6, 8]);
  });

  it('the projection plays ONE step per tick and lands on the committed board', () => {
    const before = moss(2);
    const { steps } = projectEndOfTurnSteps(before);
    expect(steps.length, 'three ticks → three beats (nothing else on this board fires at End of Turn)').toBe(3);
    // Each step lifts the board by exactly one tick's worth.
    let prev = Object.fromEntries(before.board.map((c) => [c.uid, { attack: c.attack, health: c.health }]));
    for (const step of steps) {
      const gained = before.board.reduce((n, c) => n + (step[c.uid]!.attack - prev[c.uid]!.attack) + (step[c.uid]!.health - prev[c.uid]!.health), 0);
      expect(gained, 'one +3/+4 per beat').toBe(7);
      prev = step;
    }
    const after = moss(2);
    applyEndOfTurn(after);
    for (const c of after.board) expect(steps[steps.length - 1]![c.uid]).toEqual({ attack: c.attack, health: c.health });
  });

  it('a single-shot caller (Djinn replaying its End of Turn) still gets every tick, each tagged', () => {
    const s = moss(2);
    expect(replayEndOfTurn(s, at(s, 'm'))).toBe(true);
    expect(mossTotal(s)).toEqual({ attack: 9, health: 12, count: 3 });
    for (const e of fxOf(s, 'sp3_nurturer')) expect(e.fxWave).toBeLessThanOrEqual(2);
  });
});

describe('Kringle — "give your left and right-most Dwarves +1/+2. Repeat for every card you played this turn"', () => {
  // Two plain Dwarves (no End-of-Turn effect of their own) at the ends, Kringle in the middle.
  const kringle = (n: number, over: Partial<RunState> = {}): RunState => run('set2', {
    board: [body('l', 'dw_brakka'), body('k', 'dw_foreman'), body('r', 'dw_edward')],
    playedThisTurn: cardsPlayed(n),
    ...over,
  });

  it.each([0, 1, 3])('with %i cards played each end Dwarf gets (n + 1) × (+1/+2), as n + 1 ticks', (n) => {
    const s = kringle(n);
    applyEndOfTurn(s);
    for (const uid of ['l', 'r']) expect(from(at(s, uid), 'Kringle'), uid).toEqual({ attack: n + 1, health: 2 * (n + 1), count: n + 1 });
    expect(from(at(s, 'k'), 'Kringle'), 'Kringle is not an end here').toEqual({ attack: 0, health: 0, count: 0 });
  });

  it('a turn with NOTHING played still pays the base +1/+2 once (the balance change: n → n + 1, owner 2026-09-22)', () => {
    const s = kringle(0);
    applyEndOfTurn(s);
    expect([at(s, 'l').attack, at(s, 'l').health]).toEqual([CARD_INDEX['dw_brakka']!.attack + 1, CARD_INDEX['dw_brakka']!.health + 2]);
  });

  it('every tick hits BOTH ends inside one wave, tagged 0..n, each carrying the per-tick +1/+2', () => {
    const s = kringle(3);
    applyEndOfTurn(s);
    const fx = fxOf(s, 'dw_foreman');
    expect([...new Set(fx.map((e) => e.fxWave))]).toEqual([0, 1, 2, 3]);
    for (const w of [0, 1, 2, 3]) {
      const wave = fx.filter((e) => e.fxWave === w);
      expect(wave.map((e) => e.targetUid).sort(), `wave ${w} reaches both ends`).toEqual(['l', 'r']);
      for (const e of wave) expect([e.attack, e.health]).toEqual([1, 2]);
    }
  });

  it('gilded doubles the per-tick grant (+2/+4), never the tick count', () => {
    const s = kringle(2, { board: [body('l', 'dw_brakka'), body('k', 'dw_foreman', { golden: true }), body('r', 'dw_edward')] });
    applyEndOfTurn(s);
    expect(from(at(s, 'l'), 'Kringle')).toEqual({ attack: 2 * 3, health: 4 * 3, count: 3 });
    for (const e of fxOf(s, 'dw_foreman')) expect([e.attack, e.health]).toEqual([2, 4]);
  });

  it('a lone Dwarf is both ends and is paid ONCE per tick', () => {
    const s = run('set2', { board: [body('k', 'dw_foreman')], playedThisTurn: cardsPlayed(2) });
    applyEndOfTurn(s);
    expect(from(at(s, 'k'), 'Kringle')).toEqual({ attack: 3, health: 6, count: 3 });
  });

  it('"when a Dwarf gains Attack" watchers fire once per TICK (Tankerchief beside Kringle)', () => {
    // Tankerchief: when a Dwarf gains Attack, it gains +1/+4 — one fire per tick per gaining end.
    const s = run('set3', { board: [body('l', 'dw_brakka'), body('k', 'dw_foreman'), body('t', 'dw3_tankerchief')], playedThisTurn: cardsPlayed(2) });
    const t0 = { a: at(s, 't').attack, h: at(s, 't').health };
    applyEndOfTurn(s);
    // Tankerchief is the right end: it takes Kringle's +1/+2 per tick, and reacts to Brakka's gain per tick
    // (its OWN gain is excluded — the 2026-09-09 no-ping-pong ruling).
    expect(at(s, 't').attack - t0.a, '3 ticks of +1 from Kringle, +1 per Brakka gain × 3').toBe(3 + 3);
    expect(at(s, 't').health - t0.h, '3 ticks of +2 from Kringle, +4 per Brakka gain × 3').toBe(6 + 12);
  });

  it('Parliament of Flame counts End-of-Turn TRIGGERS, not ticks', () => {
    const s = kringle(3);
    applyEndOfTurn(s);
    expect(s.lastEotFires, 'four ticks are one trigger of one effect').toBe(1);
  });

  it('the projection plays ONE step per tick, matching the beat list, and lands on the committed board', () => {
    const before = kringle(2);
    const { steps, fx } = projectEndOfTurnSteps(before);
    expect(steps.length).toBe(endOfTurnTicksOf(before, at(before, 'k')));
    expect(steps.length).toBe(3);
    for (const beatFx of fx) expect(beatFx.buffFx.map((e) => e.targetUid).sort(), 'each beat carries one tick: both ends').toEqual(['l', 'r']);
    const after = kringle(2);
    applyEndOfTurn(after);
    for (const c of after.board) expect(steps[2]![c.uid]).toEqual({ attack: c.attack, health: c.health });
  });

  it('under Chronos the whole tick sequence repeats: 2 repeats × 3 ticks', () => {
    const s = kringle(2, { extraEotThisTurn: true });
    applyEndOfTurn(s);
    expect(from(at(s, 'l'), 'Kringle')).toEqual({ attack: 6, health: 12, count: 6 });
    expect(s.lastEotFires, 'two triggers').toBe(2);
  });
});

describe('the audit — every other card whose text says "Repeat"', () => {
  it('Squirl Scout (Battlecry, "Repeat for every Beast you own"): one buff-FX event per repeat, tagged, never summed', () => {
    let s = run('set1', {
      board: [body('a', 'alley'), body('b', 'alley')],
      hand: [body('sq', 'squirlscout')],
    });
    s = reduce(s, { type: 'play', uid: 'sq' } as Action);
    // 3 Beasts owned (the two Pennycats + the Scout itself) → 3 repeats of +1/+1, each on a random OTHER body.
    const fx = fxOf(s, 'squirlscout');
    expect(fx.length, 'one event per repeat — two repeats on the same body are two events').toBe(3);
    expect([...new Set(fx.map((e) => e.fxWave))].sort(), 'each repeat its own wave').toEqual([0, 1, 2]);
    for (const e of fx) { expect([e.attack, e.health]).toEqual([1, 1]); expect(e.targetUid).not.toBe('sq'); }
    expect(s.board.reduce((n, c) => n + from(c, 'Squirl Scout').count, 0)).toBe(3);
  });

  it('Dragonflame (shop cast, "Repeat for every Dragon you control"): one sourceless descend per repeat, tagged', () => {
    let s = run('set2', {
      board: [body('d1', 'd2_broodfire'), body('d2', 'd2_flutterdrake')],
      hand: [{ uid: 'sp', cardId: 'sp_dragonflame', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    });
    s = reduce(s, { type: 'play', uid: 'sp' } as Action);
    const fx = s.recruitBuffFx.filter((e) => e.kind === 'spell' && e.attack === 4 && e.health === 4);
    expect(fx.length, 'base + one per Dragon = 3 repeats, each its own event').toBe(3);
    expect([...new Set(fx.map((e) => e.fxWave))].sort()).toEqual([0, 1, 2]);
    for (const e of fx) expect(e.sourceUid, 'a spell is sourceless').toBeUndefined();
    expect(s.board.reduce((n, c) => n + from(c, 'Dragonflame').count, 0)).toBe(3);
  });

  it('Rocket Power (Shout, "this shop +3/+3. Repeat for every Shop spell"): 1 + n separate ticks at the per-tick rate, never one summed instance', () => {
    // The REPEAT form in the sim (review fix 2026-09-22): the base once, then once per Shop spell cast this turn,
    // each its own `buffThisShopOffers` call — so the offer ledger counts 1 + n instances at +3/+3, the way Mother
    // Moss's board ledger does, and the row's total is unchanged. (The shop row still has no per-offer buff-FX
    // channel; the per-tick CUE on the row is the open presentation half.)
    let s = run('set3', { board: [], hand: [body('w', 'ce3_shootingstar')], spellsThisTurn: 2 });
    const offer: ShopCard = { uid: 'o1', cardId: 'ce3_courier' };
    s = { ...s, shop: [offer] };
    s = reduce(s, { type: 'play', uid: 'w', toIndex: 0 } as Action);
    const o = s.shop.find((x) => x.uid === 'o1')!;
    const ledger = o.buffs?.find((b) => b.source === 'Rocket Power');
    expect(ledger, 'three instances of the per-tick rate, not one of the sum').toMatchObject({ attack: 9, health: 9, count: 3 });
    expect(offerBuyStats(s, o)).toMatchObject({ attack: CARD_INDEX['ce3_courier']!.attack + 9, health: CARD_INDEX['ce3_courier']!.health + 9 });
    // Gilded: the per-tick rate doubles, the tick count never does.
    let g = run('set3', { board: [], hand: [body('w', 'ce3_shootingstar', { golden: true })], spellsThisTurn: 2 });
    g = { ...g, shop: [{ uid: 'o1', cardId: 'ce3_courier' }] };
    g = reduce(g, { type: 'play', uid: 'w', toIndex: 0 } as Action);
    expect(g.shop.find((x) => x.uid === 'o1')!.buffs?.find((b) => b.source === 'Rocket Power')).toMatchObject({ attack: 18, health: 18, count: 3 });
    // A turn with nothing cast still pays the base once (owner 2026-09-14).
    let z = run('set3', { board: [], hand: [body('w', 'ce3_shootingstar')], spellsThisTurn: 0 });
    z = { ...z, shop: [{ uid: 'o1', cardId: 'ce3_courier' }] };
    z = reduce(z, { type: 'play', uid: 'w', toIndex: 0 } as Action);
    expect(z.shop.find((x) => x.uid === 'o1')!.buffs?.find((b) => b.source === 'Rocket Power')).toMatchObject({ attack: 3, health: 3, count: 1 });
  });

  it('Rocket Power: the Starform grows by the whole sequence and Twinning hears ONE gain, not one per tick', () => {
    // The token's growth is dispatched as a per-action boundary diff (`fireStarformGainRemainder` in `reduce`),
    // not per `addOfferBuff` call — so the per-tick loop cannot multiply a per-gain watcher. Pinned because that
    // was the stated reason the loop was deferred, and it does not hold.
    let s = run('set3', { board: [body('tw', 'ce3_twinstar')], hand: [body('w', 'ce3_shootingstar')], spellsThisTurn: 2 });
    createStarform(s, { cardId: 'test', name: 'test' });
    s = reduce(s, { type: 'play', uid: 'w', toIndex: 0 } as Action);
    const sf = starformOf(s)!;
    expect(sf.buffs?.find((b) => b.source === 'Rocket Power'), 'the token takes every tick').toMatchObject({ attack: 9, health: 9, count: 3 });
    expect(offerBuyStats(s, sf)).toMatchObject({ attack: 1 + 9, health: 1 + 9 });
    const tw = at(s, 'tw');
    expect(tw.attack - CARD_INDEX['ce3_twinstar']!.attack, 'Twinning mirrors the summed gain once').toBe(9);
    expect(tw.health - CARD_INDEX['ce3_twinstar']!.health).toBe(9);
    expect((tw.buffs ?? []).filter((b) => b.source === 'Twinning').reduce((n, b) => n + b.count, 0), 'one starformGained delta').toBe(1);
  });

  it('Striker ("+1 Attack for each card you played") is the LUMP form: n itemized waves, no base tick, one trigger', () => {
    const s = run('set3', { board: [body('l', 'dw_brakka'), body('st', 'dw3_striker'), body('r', 'dw_edward')], playedThisTurn: cardsPlayed(3) });
    applyEndOfTurn(s);
    expect(from(at(s, 'l'), 'Striker'), 'n × the rate, not n + 1').toEqual({ attack: 3, health: 0, count: 3 });
    expect([...new Set(fxOf(s, 'dw3_striker').map((e) => e.fxWave))], 'its n waves keep the 2026-09-09 itemization').toEqual([0, 1, 2]);
    expect(s.lastEotFires).toBe(1);
    // …and a turn with nothing played gives nothing (the lump has no base).
    const t = run('set3', { board: [body('l', 'dw_brakka'), body('st', 'dw3_striker'), body('r', 'dw_edward')], playedThisTurn: [] });
    applyEndOfTurn(t);
    expect(from(at(t, 'l'), 'Striker').count).toBe(0);
  });

  it('Baby Gastrid ("+2 Health per Gold spent this turn") is the LUMP form: one instance of gold × the rate', () => {
    let s = run('set2', { board: [body('d', 'dw_brakka')], hand: [body('g', 'dw_dorrin')], goldSpentThisTurn: 5 });
    s = reduce(s, { type: 'play', uid: 'g' } as Action);
    expect(s.pendingTarget?.uid, 'the aim picker opened').toBe('g');
    s = reduce(s, { type: 'battlecryTarget', targetUid: 'd' } as Action);
    expect(from(at(s, 'd'), 'Baby Gastrid')).toEqual({ attack: 0, health: 10, count: 1 });
  });
});
