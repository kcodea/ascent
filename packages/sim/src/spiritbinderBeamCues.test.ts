import { describe, it, expect } from 'vitest';
import { CARD_INDEX, EQUIPMENT_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { amplifyEquipment, armCalibration, calibrationPendingOf } from './equipment';

/**
 * SPIRITBINDER: ONE `use` CUE PER FIRE (owner ruling 2026-09-22: *"spiritbinder one beam per fire"*).
 *
 * The beam shipped one cue per ACTIVATION: a multi-trigger or Amplified press folded every board pick into a
 * single cue aimed at the LAST body, so an earlier recipient fell through to the generic self-buff burst and two
 * fires read as one beam plus one unrelated flash. Now every fire that found a board Spirit stamps its own cue,
 * carrying that fire's recipient and gain, in fire order — the way Rally and Shout count repeated triggers at
 * the signal. NOTHING about the picks changes: which bodies grow, by how much, and in what order are exactly as
 * before. Only the signal is per fire.
 *
 * The contract this file pins, case by case:
 *   · a SINGLE fire stamps EXACTLY the cue it stamped before (toEqual, no extra keys, seq +1) — byte-identical;
 *   · N fires stamp N cues, in fire order, each with its own recipient and its own +6/+6 (or +12/+12 gilded);
 *   · two fires on the SAME Spirit are two cues with the same uid — never one summed cue;
 *   · a fire with no board Spirit stamps nothing; an activation with none at all still stamps today's single
 *     target-less cue (the UI's "play nothing" signal);
 *   · per-fire cues are scoped to `useFxTargetsBuffed`: a three-trigger Bloodpot is still one travel.
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const runSeed = (seed: number, over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(seed), setId: 'set3', phase: 'recruit', embers: 20, tier: 6, tribes: ['spirit', 'undead', 'kobold'],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), ...over } as RunState);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const stats = (c: BoardCard): [number, number] => [c.attack, c.health];
const play = (s: RunState, uid: string, toIndex = s.board.length): RunState => reduce(s, { type: 'play', uid, toIndex } as Action);
const activate = (s: RunState): RunState => reduce(s, { type: 'activateEquipment' } as Action);
const cuesOf = (s: RunState) => (s.equipFx ?? []).filter((f) => f.kind === 'use' && f.equipmentId === 'spiritbringer');

/** Knot (`sp3_bondweaver`) played from hand onto the board, so Spiritbinder is granted and selected. */
const armed = (seed: number, over: Partial<RunState>): RunState => play(runSeed(seed, over), 'bw');

/** The picks are seeded-random, so a case that needs a PARTICULAR draw (two different bodies, the Shaman on one
 *  fire) walks the seeds until one produces it — and fails loudly if none does within the range. */
function firstSeed(build: (seed: number) => RunState, pred: (s: RunState) => boolean, max = 64): RunState {
  for (let seed = 1; seed <= max; seed += 1) {
    const s = build(seed);
    if (pred(s)) return s;
  }
  throw new Error(`no seed in 1..${max} produced the case`);
}

/** Every board body's gain since `before`, keyed by uid. */
const gains = (before: RunState, after: RunState): Record<string, [number, number]> =>
  Object.fromEntries(after.board.map((c) => {
    const b = before.board.find((x) => x.uid === c.uid) ?? c;
    return [c.uid, [c.attack - b.attack, c.health - b.health]];
  }));

/** What the cues say each body was owed, summed per uid, so it can be checked against what it actually gained. */
const owed = (s: RunState): Record<string, [number, number]> => {
  const out: Record<string, [number, number]> = {};
  for (const c of cuesOf(s)) {
    if (!c.targetUid) continue;
    const cur = out[c.targetUid] ?? [0, 0];
    out[c.targetUid] = [cur[0] + (c.buffAttack ?? 0), cur[1] + (c.buffHealth ?? 0)];
  }
  return out;
};

describe('Spiritbinder stamps one use cue per FIRE (owner 2026-09-22)', () => {
  it('a SINGLE fire stamps exactly the cue it stamped before this ruling — byte-identical, and equipFxSeq moves by one', () => {
    const s0 = armed(1, { board: [body('x', 'sp3_kindled')], hand: [body('bw', 'sp3_bondweaver'), body('h', 'sp3_nurturer')] });
    const seqBefore = s0.equipFxSeq ?? 0;
    const s = activate(s0);
    const target = cuesOf(s)[0]?.targetUid;
    expect(['x', 'bw'], 'the destination is a board Spirit').toContain(target);
    // toEqual over the WHOLE cue list: no extra keys, no `spellIds`, nothing but the seven fields it always carried.
    expect(s.equipFx).toEqual([
      { kind: 'use', uid: 'bw', cardId: 'sp3_bondweaver', equipmentId: 'spiritbringer', targetUid: target, buffAttack: 6, buffHealth: 6 },
    ]);
    expect(s.equipFxSeq, 'one stamp, one bump').toBe(seqBefore + 1);
    expect(s.equipmentFxBuffed, 'one fire, one recorded pick').toHaveLength(1);
  });

  it('an EXTRA trigger with two board Spirits stamps TWO cues in fire order, each carrying its own recipient and its own +6/+6', () => {
    const s0 = armed(1, { board: [body('x', 'sp3_kindled'), body('y', 'sp3_tidebud')], hand: [body('bw', 'sp3_bondweaver'), body('h', 'sp3_nurturer')] });
    s0.equipmentExtraTriggers = 1; // two fires
    const seqBefore = s0.equipFxSeq ?? 0;
    const s = activate(s0);
    const cues = cuesOf(s);
    expect(cues, 'one cue per fire').toHaveLength(2);
    for (const c of cues) {
      expect(c.uid, 'the source is still the granting body').toBe('bw');
      expect(['x', 'y', 'bw'], 'each names a board Spirit').toContain(c.targetUid);
      expect([c.buffAttack, c.buffHealth], 'each owes ITS fire, never a sum').toEqual([6, 6]);
    }
    // FIRE ORDER: the cues are the recorded picks, one to one, in the order the fires made them.
    expect(cues.map((c) => c.targetUid)).toEqual((s.equipmentFxBuffed ?? []).map((p) => p.uid));
    expect(s.equipFxSeq, 'two stamps, two bumps').toBe(seqBefore + 2);
    // THE PICKS ARE UNCHANGED: what each body gained is exactly what its cues add up to.
    const g = gains(s0, s);
    const o = owed(s);
    for (const uid of ['x', 'y', 'bw']) expect(g[uid], `${uid} grew by what its cues owe`).toEqual(o[uid] ?? [0, 0]);
    expect(Object.values(g).reduce((n, [a]) => n + a, 0), 'two fires, twelve Attack across the board').toBe(12);
  });

  it('two fires that land on DIFFERENT Spirits are two cues naming two bodies', () => {
    const s = firstSeed(
      (seed) => {
        const s0 = armed(seed, { board: [body('x', 'sp3_kindled'), body('y', 'sp3_tidebud')], hand: [body('bw', 'sp3_bondweaver')] });
        s0.equipmentExtraTriggers = 1;
        return activate(s0);
      },
      (s) => { const c = cuesOf(s); return c.length === 2 && c[0]!.targetUid !== c[1]!.targetUid; },
    );
    const [a, b] = cuesOf(s);
    expect(a!.targetUid).not.toBe(b!.targetUid);
    expect(stats(at(s, a!.targetUid!))).toEqual([CARD_INDEX[at(s, a!.targetUid!).cardId]!.attack + 6, CARD_INDEX[at(s, a!.targetUid!).cardId]!.health + 6]);
    expect(stats(at(s, b!.targetUid!))).toEqual([CARD_INDEX[at(s, b!.targetUid!).cardId]!.attack + 6, CARD_INDEX[at(s, b!.targetUid!).cardId]!.health + 6]);
  });

  it('two fires on the SAME Spirit are two cues with the same uid, +6/+6 each, and the body is +12/+12 — never one summed cue', () => {
    // The Shaman is sold after granting (the grant outlives it), so `x` is the ONLY board Spirit: both fires must hit it.
    let s = armed(1, { board: [body('x', 'sp3_kindled'), body('v', 'stray')], hand: [body('bw', 'sp3_bondweaver')] });
    s = reduce(s, { type: 'sell', uid: 'bw' } as Action);
    s.equipmentExtraTriggers = 1;
    s = activate(s);
    const cues = cuesOf(s);
    expect(cues.map((c) => [c.targetUid, c.buffAttack, c.buffHealth])).toEqual([['x', 6, 6], ['x', 6, 6]]);
    expect(stats(at(s, 'x'))).toEqual([CARD_INDEX['sp3_kindled']!.attack + 12, CARD_INDEX['sp3_kindled']!.health + 12]);
    expect(stats(at(s, 'v')), 'the non-Spirit is never a fallback').toEqual([1, 1]);
    expect(cues[0]!.uid, 'the source is the eq: stand-in once the granter is sold').toBe('eq:spiritbringer');
  });

  it('an AMPLIFIED activation (the stack) is two fires and two cues', () => {
    const s0 = armed(1, { board: [body('x', 'sp3_kindled'), body('y', 'sp3_tidebud')], hand: [body('bw', 'sp3_bondweaver')] });
    expect(amplifyEquipment(s0, 'spiritbringer')).toBe(true);
    const s = activate(s0);
    expect(cuesOf(s)).toHaveLength(2);
    for (const c of cuesOf(s)) expect([c.buffAttack, c.buffHealth]).toEqual([6, 6]);
    expect(gains(s0, s)['x']![0] + gains(s0, s)['y']![0] + gains(s0, s)['bw']![0], 'twelve Attack across the board').toBe(12);
  });

  it('GILDED + Amplified: two cues, +12/+12 each', () => {
    const s0 = armed(1, { board: [body('x', 'sp3_kindled'), body('y', 'sp3_tidebud')], hand: [body('bw', 'sp3_bondweaver', { golden: true })] });
    amplifyEquipment(s0, 'spiritbringer');
    const s = activate(s0);
    expect(cuesOf(s).map((c) => [c.buffAttack, c.buffHealth])).toEqual([[12, 12], [12, 12]]);
  });

  it('an extra trigger UNDER an Amplified stack is four fires and four cues, in fire order', () => {
    const s0 = armed(1, { board: [body('x', 'sp3_kindled'), body('y', 'sp3_tidebud'), body('z', 'sp3_nurturer')], hand: [body('bw', 'sp3_bondweaver')] });
    s0.equipmentExtraTriggers = 1;
    amplifyEquipment(s0, 'spiritbringer');
    const s = activate(s0);
    const cues = cuesOf(s);
    expect(cues, '(1 + 1) × 2').toHaveLength(4);
    expect(cues.map((c) => c.targetUid)).toEqual((s.equipmentFxBuffed ?? []).map((p) => p.uid));
    const g = gains(s0, s);
    const o = owed(s);
    for (const uid of ['x', 'y', 'z', 'bw']) expect(g[uid]).toEqual(o[uid] ?? [0, 0]);
  });

  it('a Calibration charge ON TOP of an own Amplified stack is still ×2 — two cues — and the charge is not spent', () => {
    const s0 = armed(1, { board: [body('x', 'sp3_kindled')], hand: [body('bw', 'sp3_bondweaver')] });
    amplifyEquipment(s0, 'spiritbringer');
    armCalibration(s0, 1);
    const s = activate(s0);
    expect(cuesOf(s), 'one Amplification, never two').toHaveLength(2);
    expect(calibrationPendingOf(s), 'the Wrench charge waits for a press the stack did not cover').toBe(1);
  });

  it('a Calibration charge ALONE Amplifies the press: two cues, and the charge is spent', () => {
    const s0 = armed(1, { board: [body('x', 'sp3_kindled')], hand: [body('bw', 'sp3_bondweaver')] });
    armCalibration(s0, 1);
    const s = activate(s0);
    expect(cuesOf(s)).toHaveLength(2);
    expect(calibrationPendingOf(s)).toBe(0);
  });

  it('the Shaman can be the recipient of ONE of the fires: its cue names it and the other cue names the other Spirit', () => {
    const s = firstSeed(
      (seed) => {
        const s0 = armed(seed, { board: [body('x', 'sp3_kindled')], hand: [body('bw', 'sp3_bondweaver')] });
        s0.equipmentExtraTriggers = 1;
        return activate(s0);
      },
      (s) => { const t = cuesOf(s).map((c) => c.targetUid); return t.length === 2 && t.includes('bw') && t.includes('x'); },
    );
    const cues = cuesOf(s);
    expect(cues.map((c) => c.uid), 'both cues leave the same source').toEqual(['bw', 'bw']);
    expect(new Set(cues.map((c) => c.targetUid))).toEqual(new Set(['bw', 'x']));
    const before = CARD_INDEX['sp3_bondweaver']!;
    // The self-hit is a real +6/+6 on the Shaman, exactly like any other recipient (its play may have moved its
    // stats already, so measure against the OTHER body's known base and the Shaman's own cue instead).
    expect(cues.find((c) => c.targetUid === 'bw')!.buffAttack).toBe(6);
    expect(stats(at(s, 'x'))).toEqual([CARD_INDEX['sp3_kindled']!.attack + 6, CARD_INDEX['sp3_kindled']!.health + 6]);
    expect(at(s, 'bw').attack).toBeGreaterThanOrEqual(before.attack + 6);
  });

  it('NO board Spirit: however many fires, exactly today\'s single target-less cue (and no beam)', () => {
    // A fire that finds no Spirit BETWEEN two that do is unreachable inside one activation: Spiritbinder only
    // buffs, so the set of board Spirits cannot change between its fires. Either every fire finds one or none does.
    let s = armed(1, { board: [body('v', 'stray')], hand: [body('bw', 'sp3_bondweaver'), body('h', 'sp3_nurturer')] });
    s = reduce(s, { type: 'sell', uid: 'bw' } as Action);
    s.equipmentExtraTriggers = 1;
    amplifyEquipment(s, 'spiritbringer'); // four fires, none with a board recipient
    const handBefore = stats(s.hand.find((c) => c.uid === 'h')!);
    s = activate(s);
    expect(s.equipFx).toEqual([{ kind: 'use', uid: 'eq:spiritbringer', cardId: 'spiritbringer', equipmentId: 'spiritbringer' }]);
    expect(s.equipmentFxBuffed, 'nothing recorded, so nothing to beam').toEqual([]);
    expect(stats(s.hand.find((c) => c.uid === 'h')!), 'the hand Spirit still took every fire').toEqual([handBefore[0] + 24, handBefore[1] + 24]);
    expect(stats(at(s, 'v')), 'the non-Spirit is never a fallback target').toEqual([1, 1]);
  });

  it('every per-fire cue is a beam the UI will suppress the generic pulse for: kind use, a targetUid, and a useFxTargetsBuffed Equipment', () => {
    const s0 = armed(1, { board: [body('x', 'sp3_kindled'), body('y', 'sp3_tidebud')], hand: [body('bw', 'sp3_bondweaver')] });
    s0.equipmentExtraTriggers = 2; // three fires
    const s = activate(s0);
    const cues = cuesOf(s);
    expect(cues).toHaveLength(3);
    // The exact predicate `Recruit.tsx`'s `beamedNow` filter applies (pinned by spiritbinderBeamGuard.test.ts).
    const beamed = (s.equipFx ?? [])
      .filter((f) => f.kind === 'use' && f.targetUid && EQUIPMENT_INDEX[f.equipmentId ?? '']?.useFxTargetsBuffed)
      .map((f) => f.targetUid!);
    expect(beamed, 'every recipient of every fire is covered').toEqual(cues.map((c) => c.targetUid));
  });

  it('per-fire cues are scoped to useFxTargetsBuffed: a three-trigger Bloodpot is still ONE travel', () => {
    let s = runSeed(1, { hand: [body('f', 'e3_frank')], board: [body('t', 'sandbag')] });
    s = play(s, 'f', 1);
    s = reduce(s, { type: 'selectEquipment', equipmentId: 'bloodpot' } as Action);
    s.equipmentExtraTriggers = 2;
    const before = stats(at(s, 't'));
    s = reduce(s, { type: 'activateEquipment', targetUid: 't' } as Action);
    const uses = (s.equipFx ?? []).filter((f) => f.kind === 'use');
    expect(uses).toHaveLength(1);
    expect(uses[0]).toEqual({ kind: 'use', uid: 'f', cardId: 'e3_frank', equipmentId: 'bloodpot', targetUid: 't' });
    expect(stats(at(s, 't')), 'all three triggers landed').toEqual([before[0] + 9, before[1] + 9]);
  });
});
