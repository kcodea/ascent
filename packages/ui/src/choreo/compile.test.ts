import { describe, expect, it } from 'vitest';
import { makeRng, simulate, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { buildBeats } from '../combatBeats';
import { compileMoments, DEFAULT_RULES } from './compile';
import { replayBeats, replayOrder } from './replayOrder';

/** Real fights across the shapes that exercise every grouping rule: plain exchange, Deathrattle cascade,
 *  mutual chip, and a wider board. Rosters mirror the existing suites so the logs are known-interesting. */
const FIGHTS: [string, () => ReturnType<typeof simulate>][] = [
  ['exchange + rattle', () => simulate(
    [{ cardId: 'stray', attack: 3, health: 10 }, { cardId: 'sandbag', attack: 0, health: 5 }],
    [{ cardId: 'pack', attack: 2, health: 2 }], makeRng(3), CARD_INDEX)],
  ['mutual chip', () => simulate(
    [{ cardId: 'stray', attack: 3, health: 10 }],
    [{ cardId: 'sandbag', attack: 2, health: 8 }], makeRng(3), CARD_INDEX)],
  ['bigger board', () => simulate(
    [{ cardId: 'stray', attack: 3, health: 4 }, { cardId: 'pack', attack: 2, health: 2 }, { cardId: 'sandbag', attack: 0, health: 9 }],
    [{ cardId: 'pack', attack: 2, health: 2 }, { cardId: 'stray', attack: 3, health: 4 }], makeRng(11), CARD_INDEX)],
  ['rise pull-back', () => simulate(
    [{ cardId: 'footman', attack: 2, health: 1 }],
    [{ cardId: 'stray', attack: 4, health: 6 }], makeRng(7), CARD_INDEX)],
  ['windfury double-attack', () => simulate(
    [{ cardId: 'speedy', attack: 4, health: 4 }],
    [{ cardId: 'sandbag', attack: 1, health: 12 }], makeRng(13), CARD_INDEX)],
  ['venom-heavy trade', () => simulate(
    [{ cardId: 'venom', attack: 1, health: 1 }, { cardId: 'venom', attack: 1, health: 1 }],
    [{ cardId: 'stray', attack: 3, health: 8 }, { cardId: 'pack', attack: 2, health: 2 }], makeRng(21), CARD_INDEX)],
];

describe('compileMoments — default rules reproduce buildBeats exactly', () => {
  for (const [name, run] of FIGHTS) {
    it(`equivalence: ${name}`, () => {
      const r = run();
      const beats = buildBeats(r.events);
      const moments = compileMoments(r.events, DEFAULT_RULES);
      expect(moments.map(({ start, end, primary }) => ({ start, end, primary })))
        .toEqual(beats.map(({ start, end, primary }) => ({ start, end, primary })));
    });
  }

  it('carries stepGroups: contiguous same-step runs covering exactly the moment, in order', () => {
    const r = FIGHTS[0]![1]();
    const moments = compileMoments(r.events, DEFAULT_RULES);
    for (const m of moments) {
      const flat = m.stepGroups.flat();
      expect(flat).toEqual(Array.from({ length: m.end - m.start }, (_, k) => m.start + k));
      for (const g of m.stepGroups) {
        const steps = new Set(g.map((i) => r.events[i]!.step));
        expect(steps.size).toBe(1); // every group is step-homogeneous (real sim output is fully tagged)
      }
    }
  });

  it('untagged events (legacy replays / fixtures) are each their OWN group — never merged', () => {
    const moments = compileMoments(
      [
        { type: 'dmg', target: 'b', amount: 1, remainingHp: 4 },
        { type: 'dmg', target: 'c', amount: 1, remainingHp: 3 },
      ],
      DEFAULT_RULES,
    );
    expect(moments).toHaveLength(1); // two dmg events collapse into one impact moment (grouping unchanged)…
    expect(moments[0]!.stepGroups).toEqual([[0], [1]]); // …but with NO step info, each event stands alone
  });

  it('single-action fallthrough: sc / toHand each become their own single-event moment', () => {
    const moments = compileMoments(
      [
        { type: 'sc', source: 'a', text: 'x', step: 0 },
        { type: 'toHand', cardId: 'y', side: 'player', step: 1 },
      ],
      DEFAULT_RULES,
    );
    expect(moments).toHaveLength(2);
    expect(moments[0]).toMatchObject({ start: 0, end: 1, primary: { type: 'sc', source: 'a' }, stepGroups: [[0]] });
    expect(moments[1]).toMatchObject({ start: 1, end: 2, primary: { type: 'toHand', cardId: 'y' }, stepGroups: [[1]] });
  });

  it('a mid-combat sc after an attack is absorbed into the attack wind-up; a Start-of-Combat cast is not', () => {
    // Shop-buff flash: `attack` then `+1/+2 Shop` fold into ONE attack moment so the number fires in the lunge.
    const shop = compileMoments(
      [
        { type: 'attack', source: 'a', target: 'b', step: 0 },
        { type: 'sc', source: 'a', text: '+1/+2 Shop', step: 1 },
        { type: 'dmg', target: 'b', amount: 3, step: 2 },
      ] as unknown as Parameters<typeof compileMoments>[0],
      DEFAULT_RULES,
    );
    expect(shop[0]).toMatchObject({ start: 0, end: 2, primary: { type: 'attack' } }); // attack + sc together
    expect(shop[1]).toMatchObject({ primary: { type: 'dmg' } });
    // Any other mid-combat narration folds in the same way, and — the point of widening it on 2026-09-01 —
    // so does everything BEHIND it. A Rally that casts a spell runs `attack, rally, sc, buff…`; stopping at the
    // `sc` orphaned the cast AND its buffs into post-lunge beats, which is what the owner saw as "the lunge
    // completes, then all the animations trigger, then damage is dealt".
    const cast = compileMoments(
      [
        { type: 'attack', source: 'a', target: 'b', step: 0 },
        { type: 'rally', source: 'a', target: 'a', step: 1 },
        { type: 'sc', source: 'a', text: 'Flamebeat Drake casts Dragonflame', spellId: 'sp_dragonflame', step: 2 },
        { type: 'buff', target: 'a', attack: 4, health: 4, source: 'a', step: 3 },
        { type: 'dmg', target: 'b', amount: 3, step: 4 },
      ] as unknown as Parameters<typeof compileMoments>[0],
      DEFAULT_RULES,
    );
    expect(cast[0], 'the whole cast belongs to the wind-up it came from').toMatchObject({ start: 0, end: 4, primary: { type: 'attack' } });
    expect(cast[1]).toMatchObject({ primary: { type: 'dmg' } });
    // A genuine START-OF-COMBAT cast is NOT a consequence of a swing and keeps its own beat. (The absorb loop
    // only runs after an `attack` anyway; this pins the predicate itself.)
    const soc = compileMoments(
      [
        { type: 'attack', source: 'a', target: 'b', step: 0 },
        { type: 'sc', source: 'a', text: 'X casts Y', cast: true, step: 1 },
      ] as unknown as Parameters<typeof compileMoments>[0],
      DEFAULT_RULES,
    );
    expect(soc[0]).toMatchObject({ start: 0, end: 1, primary: { type: 'attack' } });
    expect(soc[1]).toMatchObject({ start: 1, end: 2, primary: { type: 'sc' } });
  });

  it('empty log compiles to no moments', () => {
    expect(compileMoments([], DEFAULT_RULES)).toEqual([]);
  });
});

describe('compileMoments — wave tags pace a multi-pass AoE echo (Fel Spikes)', () => {
  // A GILDED Fel Spikes echo, WITH demon-damage reactors present: each pass is one wave, its volley of damage
  // interleaved with the reactor buffs those hits fire (Leech/Axeman/Todd), and a mid-pass kill bumps the step.
  // The wave tag must fold each whole pass into ONE moment (a simultaneous volley) — never per-target — while
  // the two passes stay SEPARATE moments (the pause between waves comes from the per-moment clock hold).
  const log: CombatEvent[] = [
    // ── wave 1 ──
    { type: 'dmg', target: 'e1', amount: 4, remainingHp: 2, step: 10, wave: 1 },
    { type: 'buff', target: 'fs', attack: 1, health: 0, source: 'fs', step: 10, wave: 1 }, // reactor rides the wave
    { type: 'dmg', target: 'e2', amount: 4, remainingHp: 0, step: 10, wave: 1 },
    { type: 'buff', target: 'fs', attack: 1, health: 0, source: 'fs', step: 10, wave: 1 },
    { type: 'death', target: 'e2', side: 'enemy', step: 11, wave: 1 }, // a kill bumps step — wave id holds
    { type: 'dmg', target: 'p1', amount: 4, remainingHp: 1, step: 11, wave: 1 }, // own non-Demon, post-kill step
    { type: 'buff', target: 'fs', attack: 1, health: 0, source: 'fs', step: 11, wave: 1 },
    // ── wave 2 ──
    { type: 'dmg', target: 'e1', amount: 4, remainingHp: -2, step: 12, wave: 2 },
    { type: 'buff', target: 'fs', attack: 1, health: 0, source: 'fs', step: 12, wave: 2 },
    { type: 'dmg', target: 'p1', amount: 4, remainingHp: -3, step: 12, wave: 2 },
  ];

  it('folds each pass into ONE moment and keeps the two passes separate', () => {
    const moments = compileMoments(log, DEFAULT_RULES);
    expect(moments.map((m) => [m.start, m.end])).toEqual([[0, 7], [7, 10]]); // exactly two waves, no fragments
    expect(moments[0]!.primary).toBe(log[0]); // each wave's primary is its first hit
    expect(moments[1]!.primary).toBe(log[7]);
  });

  it('reproduces buildBeats exactly on a wave-tagged log (equivalence oracle)', () => {
    const beats = buildBeats(log);
    const moments = compileMoments(log, DEFAULT_RULES);
    expect(moments.map(({ start, end, primary }) => ({ start, end, primary })))
      .toEqual(beats.map(({ start, end, primary }) => ({ start, end, primary })));
  });

  it('stepGroups still split a wave by resolution step (deaths bump the step within one wave)', () => {
    const moments = compileMoments(log, DEFAULT_RULES);
    // Wave 1 spans steps 10 and 11 (the kill bumped it) → two step-groups; the whole moment is still covered.
    expect(moments[0]!.stepGroups).toEqual([[0, 1, 2, 3], [4, 5, 6]]);
    expect(moments[1]!.stepGroups).toEqual([[7, 8, 9]]);
  });

  it('end-to-end: a REAL gilded Fel Spikes echo emits two waves → two distinct volley moments', () => {
    // Gilded Fel Spikes (health 1) dies to the enemy front line; its Echo sprays the board TWICE. Each pass is
    // wrapped in `ctx.wave`, so the engine stamps two distinct wave ids and the compiler yields two moments.
    const r = simulate(
      [{ cardId: 'dm_felspikes', attack: 4, health: 1, golden: true }],
      [{ cardId: 'sandbag', attack: 6, health: 40 }, { cardId: 'sandbag', attack: 0, health: 40 }],
      makeRng(3), CARD_INDEX,
    );
    const waveIds = [...new Set(r.events.map((e) => e.wave).filter((w): w is number => w !== undefined))];
    expect(waveIds).toHaveLength(2); // two passes → two distinct wave ids

    // Walk the REAL runtime path: replayOrder (deferClashBuffs slides the sandbags' onDamaged reactor buffs to
    // each wave's tail) → compileMoments. The reorder must keep every wave's events contiguous, so each wave
    // still yields exactly ONE volley moment covering all of it (no stray split-off buff moment).
    const ordered = replayOrder(r.events);
    const moments = replayBeats(r.events);
    for (const w of waveIds) {
      const idxs = ordered.map((e, i) => (e.wave === w ? i : -1)).filter((i) => i >= 0);
      // contiguous after reordering
      expect(idxs).toEqual(Array.from({ length: idxs.length }, (_, k) => idxs[0]! + k));
      const covering = moments.filter((m) => m.start < idxs[idxs.length - 1]! + 1 && m.end > idxs[0]!);
      expect(covering).toHaveLength(1);
      expect([covering[0]!.start, covering[0]!.end]).toEqual([idxs[0], idxs[idxs.length - 1]! + 1]);
    }
  });
});
