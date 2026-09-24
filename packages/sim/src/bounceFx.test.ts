import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';

/**
 * THE BOUNCE SIGNAL (owner ask 2026-09-15): a spell or Ruby RE-CAST onto a DIFFERENT body as a consequence of
 * the original cast records ONE hop per cast on `bounceFx` — `fromUid` = the body the original cast landed on,
 * `toUid` = the bounce recipient — so the UI can play the owner's `ruby-bounce` (or the placeholder
 * `spell-bounce`) ribbon between exactly those two. CROSS-TARGET ONLY: a same-target recast (Mirrorwing,
 * Prismcaster's extra Ruby) records nothing — the owner is authoring a separate cue for those.
 *
 * Every assertion here is about the SIGNAL, never the stats: each family's gameplay is pinned by its own file
 * (set3Celestials, reflectorSharedAllowance, fourRunes, runeBatch6, doubleTrouble). This file exists so a hop
 * cannot silently stop being recorded — the defect that makes an effect "work but show nothing".
 */
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const spell = (uid: string, cardId: string): BoardCard => ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false } as BoardCard);
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(3), setId: 'set3', phase: 'recruit', embers: 30, tier: 6, tribes: ['celestial', 'undead', 'kobold'], shop: [],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), ...over } as RunState);
const play = (s: RunState, uid: string, extra: Partial<Action> = {}): RunState => reduce(s, { type: 'play', uid, ...extra } as Action);
const hops = (s: RunState) => (s.bounceFx ?? []).map((b) => `${b.kind}:${b.fromUid}>${b.toUid}`);

describe('bounceFx — the per-hop shop signal', () => {
  it('Star Crash: target → its random friendly is ONE spell hop; never a same-body hop', () => {
    // Two bodies: the random half lands on the target (no hop) or on the other body (one hop). Whichever the
    // seed rolls, the signal says exactly what happened and never names the target as both ends.
    let s = run({ hand: [spell('s', 'starcrash')], board: [body('t', 'ce3_courier'), body('o', 'sandbag')] });
    s = play(s, 's', { targetUid: 't' });
    const got = hops(s);
    expect(got.length).toBeLessThanOrEqual(1);
    if (got.length === 1) expect(got).toEqual(['spell:t>o']);
    const landedOnOther = (s.board.find((c) => c.uid === 'o')!.buffs ?? []).some((b) => b.source === 'Star Crash');
    expect(got.length, 'a hop is recorded iff the random half landed elsewhere').toBe(landedOnOther ? 1 : 0);
    expect(s.bounceFxSeq ?? 0).toBe(got.length);
  });

  it('Star Crash on the Starform token: the hop travels from the token (a Shop uid) to the board', () => {
    let s = run({ hand: [spell('s', 'starcrash')], board: [body('o', 'sandbag')], shop: [{ uid: 'sf', cardId: 'ce3_starform', starform: true, cost: 6 }] });
    s = play(s, 's', { targetUid: 'sf' });
    expect(hops(s), 'the only friendly is the sandbag, so the secondary MUST land there').toEqual(['spell:sf>o']);
  });

  it('Crash Course (2026-09-18: a same-target re-cast, Mirrorwing\'s shape) records NO a>a hop — only Star Crash\'s own random half hops, cross-target', () => {
    let s = run({ hand: [spell('s', 'starcrash')], board: [body('a', 'ce3_adept'), body('x', 'ce3_courier'), body('y', 'ce3_vendor')] });
    s = play(s, 's', { targetUid: 'a' });
    expect(s.board.find((c) => c.uid === 'a')!.namedSpreadUsedThisTurn, 'the re-cast happened').toBe(true);
    // Two full casts landed on `a` (its primary twice); each cast's secondary half is a random friendly — a
    // cross-target hop from `a` when it lands elsewhere, NO hop when it lands back on `a`. Never an a>a entry.
    const fromA = hops(s).filter((h) => h.startsWith('spell:a>'));
    expect(fromA.length).toBeLessThanOrEqual(2);
    expect(hops(s).every((h) => h.startsWith('spell:a>')), 'every hop this action leaves the Course').toBe(true);
    for (const h of hops(s)) { const [, pair] = h.split(':'); const [f, t] = pair!.split('>'); expect(f).not.toBe(t); }
    const onA = (s.board.find((c) => c.uid === 'a')!.buffs ?? []).filter((b) => b.source === 'Star Crash').reduce((n, b) => n + b.attack, 0);
    expect(onA, 'the primary +5 landed on the Course twice (2 casts)').toBeGreaterThanOrEqual(10);
  });

  it('Crash Course under a cast doubler: the re-cast is a FULL doubled cast, so four secondary hops leave the Course', () => {
    let s = run({ hand: [spell('s', 'starcrash')], board: [body('a', 'ce3_adept'), body('x', 'ce3_courier'), body('y', 'ce3_vendor'), body('z', 'yazzus')] });
    s = play(s, 's', { targetUid: 'a' });
    // original ×2 (Yazzus) + re-cast ×2 = 4 casts on `a`, each with at most one secondary hop from `a`.
    expect(hops(s).filter((h) => h.startsWith('spell:a>')).length).toBeLessThanOrEqual(4);
    for (const h of hops(s)) { const [, pair] = h.split(':'); const [f, t] = pair!.split('>'); expect(f).not.toBe(t); }
    const onA = (s.board.find((c) => c.uid === 'a')!.buffs ?? []).filter((b) => b.source === 'Star Crash').reduce((n, b) => n + b.attack, 0);
    expect(onA, 'four primaries landed on the Course').toBeGreaterThanOrEqual(20);
  });

  it('Reflector: a spell on it hops once (spell), a Ruby on it hops once (ruby) — each to its random friend', () => {
    const base = (): RunState => ({
      ...createRun(2114408705, 'quillen'), setId: 'set2', embers: 20, phase: 'recruit',
      board: [body('b4', 'k_chipwick'), body('b27', 'n2_reflector')],
      hand: [body('r1', 'ruby'), spell('cc', 'crestclimb')],
    } as RunState);
    // Spell first (a fresh Reflector each time — the allowance is shared, one per turn).
    let s = reduce(reduce(reduce(base(), { type: 'play', uid: 'cc' }), { type: 'chooseOne', index: 1 }), { type: 'battlecryTarget', targetUid: 'b27' });
    expect(hops(s)).toEqual(['spell:b27>b4']);
    // Ruby first.
    s = reduce(base(), { type: 'play', uid: 'r1', targetUid: 'b27' });
    expect(hops(s)).toEqual(['ruby:b27>b4']);
  });

  // Since 2026-09-24 a SPELL's Distillation echo is the RUNE's cast (owner: "the runes that repeat casts should use the
  // rune-cast visual"): it records against the rune and travels from the rune's node, so it records NO hop. The Ruby
  // echo below keeps its hop (Rubies speak the Ruby language). See runeRepeatCastActor.test.ts.
  it('Rune of Distillation: a spell on a SHOP offer echoes onto your left-most AND right-most AS THE RUNE — no spell hop', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      board: [body('lead', 'drummer'), body('other', 'joker')],
      hand: [spell('sp', 'spiritfire')],
      shop: [{ uid: 'o1', cardId: 'sandbag' }],
      runeDistillation: true,
    };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'o1' });
    expect(hops(s)).toEqual([]);
    expect((s.castFx ?? []).map((c) => (c.source.kind === 'rune' ? c.source.id : c.source.kind))).toEqual(['rune_distillation', 'rune_distillation']);
  });

  it('Rune of Distillation: a Ruby on a SHOP offer hops offer → your left-most AND right-most (as a Ruby)', () => {
    let s: RunState = {
      ...createRun(1), setId: 'set2', phase: 'recruit', embers: 20,
      board: [body('lead', 'drummer'), body('other', 'joker')],
      hand: [body('r', 'ruby')],
      shop: [{ uid: 'o1', cardId: 'sandbag' }],
      runeDistillation: true,
    } as RunState;
    s = reduce(s, { type: 'play', uid: 'r', targetUid: 'o1' });
    expect(hops(s)).toEqual(['ruby:o1>lead', 'ruby:o1>other']);
  });

  it('Rune of Redirection: a Ruby on the left-most hops left-most → right-most; a one-body board hops nothing', () => {
    const mk = (board: BoardCard[]): RunState => ({ ...createRun(1), setId: 'set2', phase: 'recruit', embers: 20, board, hand: [body('r', 'ruby')], runeRedirection: true } as RunState);
    let s = reduce(mk([body('l', 'drummer'), body('m', 'joker'), body('t', 'sandbag')]), { type: 'play', uid: 'r', targetUid: 'l' });
    expect(hops(s)).toEqual(['ruby:l>t']);
    s = reduce(mk([body('l', 'drummer')]), { type: 'play', uid: 'r', targetUid: 'l' });
    expect(hops(s), 'left-most IS right-most — no cross-target hop').toEqual([]);
  });

  it('Rune of the Conduit: the extra landing hops from the body the Ruby landed on to the random extra recipient', () => {
    const s0: RunState = { ...createRun(3), setId: 'set2', phase: 'recruit', embers: 20, board: [body('a', 'drummer'), body('b', 'joker')], hand: [body('r', 'ruby')], runeConduit: true, runeIdByKind: { runeConduit: 'rune_conduit' }, runes: ['rune_conduit'] } as RunState;
    const s = reduce(s0, { type: 'play', uid: 'r', targetUid: 'a' });
    expect(hops(s)).toEqual(['ruby:a>b']);
  });

  it('a same-target recast (Mirrorwing "casts again") records NO hop — cross-target only', () => {
    let s = run({ setId: 'set2', tribes: ['dragon'], hand: [spell('s', 'crestclimb')], board: [body('m', 'd2_mirrorwing'), body('o', 'sandbag')] });
    s = reduce(reduce(reduce(s, { type: 'play', uid: 's' }), { type: 'chooseOne', index: 1 }), { type: 'battlecryTarget', targetUid: 'm' });
    expect(s.board.find((c) => c.uid === 'm')!.spellsOnThisTurn, 'the recast happened').toBe(2);
    expect(hops(s)).toEqual([]);
  });

  it('the channel is per-action: a plain play clears the previous action\'s hops', () => {
    let s = run({ hand: [spell('s', 'starcrash'), body('n', 'sandbag')], board: [body('a', 'ce3_adept'), body('x', 'ce3_courier'), body('y', 'ce3_vendor')] });
    s = play(s, 's', { targetUid: 'a' });
    expect(hops(s).length).toBeGreaterThan(0);
    s = play(s, 'n', { toIndex: 3 });
    expect(s.bounceFx).toEqual([]);
  });
});

describe('bounce provenance — the combat `buff` event', () => {
  const bm = (cardId: string, uid: string, attack: number, health: number): BoardMinion => ({ cardId, attack, health, sourceUid: uid, keywords: [] });
  /** The same adjacent-Ruby rattler `doubleTrouble.test.ts` drives Trouble with. */
  const adjRattler = (rubies: number): CardDef => ({
    id: 'dt_rattler', name: 'DtRattler', tribe: 'kobold', tier: 2, attack: 1, health: 1, keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattlePlayRubiesAdjacent', params: { rubies } }], text: '',
  });
  const bounced = (events: readonly CombatEvent[]) =>
    events.flatMap((e) => (e.type === 'buff' && e.bounce ? [{ from: e.bounce.from, to: e.target, kind: e.bounce.kind }] : []));

  it('Trouble: its self-Ruby is stamped as a Ruby bounce FROM the body the triggering Ruby landed on', () => {
    // Board: [Trouble, victim, rattler]. The rattler dies, Rubies the victim (m1); Trouble (m0) casts one on itself.
    const r = simulate(
      [bm('k3_doubletrouble', 'DT', 8, 60), bm('sandbag', 'VIC', 1, 60), bm('dt_rattler', 'RAT', 1, 1)],
      [{ cardId: 'sandbag', attack: 10, health: 400 }], makeRng(7), { ...CARD_INDEX, dt_rattler: adjRattler(1) },
      combatSide({ tier: 6, tribes: ['kobold'] }), combatSide({ tier: 1 }),
    );
    expect(bounced(r.events)).toEqual([{ from: 'm1', to: 'm0', kind: 'ruby' }]);
    // The original landing on the victim carries no provenance — it is the cast, not a bounce.
    const onVictim = r.events.filter((e) => e.type === 'buff' && e.target === 'm1');
    expect(onVictim.length).toBeGreaterThan(0);
    for (const e of onVictim) expect((e as { bounce?: unknown }).bounce).toBeUndefined();
  });

  it('Trouble: three Rubies on another minion are THREE bounce-stamped buffs (per Ruby, countable)', () => {
    const r = simulate(
      [bm('k3_doubletrouble', 'DT', 8, 60), bm('sandbag', 'VIC', 1, 60), bm('dt_rattler', 'RAT', 1, 1)],
      [{ cardId: 'sandbag', attack: 10, health: 400 }], makeRng(7), { ...CARD_INDEX, dt_rattler: adjRattler(3) },
      combatSide({ tier: 6, tribes: ['kobold'] }), combatSide({ tier: 1 }),
    );
    // `playRubyOn` carries 3 in ONE call → one stamped buff whose magnitude is 3 Rubies' worth. The signal is
    // one event per `applyRubyStats` call, which is one per trigger — the count rides in the stats, as the
    // rubyLanded cue already reads it. What matters here: it IS stamped, and from the right body.
    const b = bounced(r.events);
    expect(b.length).toBeGreaterThanOrEqual(1);
    for (const h of b) expect(h).toEqual({ from: 'm1', to: 'm0', kind: 'ruby' });
  });

  it('a Ruby cast on Trouble ITSELF stamps no bounce (no self-trigger)', () => {
    const r = simulate(
      [bm('sandbag', 'OUT', 1, 60), bm('k3_doubletrouble', 'DT', 8, 60), bm('dt_rattler', 'RAT', 1, 1)],
      [{ cardId: 'sandbag', attack: 10, health: 400 }], makeRng(7), { ...CARD_INDEX, dt_rattler: adjRattler(1) },
      combatSide({ tier: 6, tribes: ['kobold'] }), combatSide({ tier: 1 }),
    );
    expect(bounced(r.events)).toEqual([]);
  });

  it('an ordinary buff event keeps its exact shape — no `bounce` key is ever spread in', () => {
    const r = simulate(
      [bm('sandbag', 'A', 1, 60), bm('dt_rattler', 'RAT', 1, 1)],
      [{ cardId: 'sandbag', attack: 10, health: 400 }], makeRng(7), { ...CARD_INDEX, dt_rattler: adjRattler(1) },
      combatSide({ tier: 6, tribes: ['kobold'] }), combatSide({ tier: 1 }),
    );
    const buffs = r.events.filter((e) => e.type === 'buff');
    expect(buffs.length).toBeGreaterThan(0);
    for (const e of buffs) expect(Object.keys(e)).not.toContain('bounce');
  });
});
