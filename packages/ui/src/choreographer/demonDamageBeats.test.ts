import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, presentationPolicyFor, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CONFIG, createRun, reduce, reduceWithPresentation, type Action, type BoardCard, type RunState } from '@game/sim';
import { replayBeats, replayOrder } from '../choreo/replayOrder';
import { compileMoments, type Moment } from '../choreo/compile';
import { attackerOfImpact, buildBeats, meleePairOfImpact } from '../combatBeats';
import { groupBuffCasts } from '../choreo/channels/buffCast';
import { wavesAheadOf } from '../choreo/channels/windupWaves';
import { holdMs } from '../choreo/clock';
import { HIT_REACTION_LEAD_MS, HIT_REACTION_READ_MS } from '../choreo/hitReactions';
import { compileTimeline } from './compileTimeline';
import { normalizePresentationBatch } from './adapters/presentationBatchAdapter';

/**
 * R-DEMON-DMG-BEATS-01 (owner 2026-10-11): "when a minion is buffed from dmg dealt by demons, it should have its beat
 * happen in real time. for example, with gasket, when gasket winds up and ralliy procs, damaging the units it does,
 * rad rachel's tendrils should go out THEN, before the gasket's attack goes off."
 *
 *   attack (wind-up, parked) → pass 1 → pass 1's reactions → [pass 2 → pass 2's reactions] → the strike
 *
 * Graded on SIMULATED fights through the replay's own moment list (`replayBeats`), so the shape is the engine's.
 */
const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, keywords: [], ...extra });
const REACTION_KEY = 'factory:onFriendlyDemonDamageBuffTribe:friendlyDemonDealtDamage';

/** Player: m0 Gasket, m1 Rad Rachel, m2 a neutral, m3 Ruinous Lord. Enemy: a Demon + a neutral wall. */
const gasketFight = (golden = false, seed = 7) => simulate(
  [bm('dm_gasket', 7, 3, { keywords: ['RL'], golden }), bm('dm_radrachel', 8, 10), bm('trainingdummy', 0, 40), bm('dm_ruinouslord', 0, 40)],
  [bm('dm_clerk', 0, 40), bm('trainingdummy', 0, 40)],
  makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));

const evOf = (events: CombatEvent[], m: Moment) => events.slice(m.start, m.end);

function firstSwing(events: CombatEvent[]) {
  const moments = replayBeats(events);
  const ai = moments.findIndex((m) => m.primary.type === 'attack' && m.primary.attacker === 'm0');
  expect(ai).toBeGreaterThanOrEqual(0);
  return { moments, ai, order: replayOrder(events) };
}

describe('Gasket + Rad Rachel + Ruinous Lord: the reactions play AT each pass, before the swing', () => {
  it('the engine order is damage → reaction (each landed Gasket hit is followed by its Rachel + Lord buffs)', () => {
    const { events } = gasketFight();
    const firstDmg = events.findIndex((e) => e.type === 'dmg' && e.wave !== undefined);
    const firstBuff = events.findIndex((e) => e.type === 'buff' && e.key === REACTION_KEY);
    expect(firstDmg).toBeGreaterThanOrEqual(0);
    expect(firstBuff).toBeGreaterThan(firstDmg);
    expect(events[firstBuff]!.wave, 'the reaction is stamped with the pass that caused it').toBe(events[firstDmg]!.wave);
  });

  it('plain: wind-up → pass (damage only) → its reaction beat → the strike', () => {
    const { events } = gasketFight();
    const { moments, ai, order } = firstSwing(events);
    const pass = moments[ai + 1]!;
    const react = moments[ai + 2]!;
    expect(pass.primary.wave).toBeDefined();
    expect(evOf(order, pass).some((e) => e.type === 'buff'), 'the pass carries no reaction any more').toBe(false);
    expect(react.hitReaction).toBe(true);
    expect(react.kind).toBe('buffWave');
    expect(evOf(order, react).every((e) => e.type === 'buff')).toBe(true);
    expect(react.primary.wave, 'the reaction belongs to its pass').toBe(pass.primary.wave);
    const strike = moments[ai + 3]!;
    expect(strike.primary.wave).toBeUndefined();
    expect(evOf(order, strike).some((e) => e.type === 'dmg' && e.source === 'm0')).toBe(true);
    // The swing still parks through the pass AND its reaction, and the strike is still the melee exchange.
    expect(wavesAheadOf(moments[ai]!, order, 'm0')).toBe(true);
    expect(meleePairOfImpact(moments, ai + 3)?.attacker).toBe('m0');
    expect(attackerOfImpact(moments, ai + 3)).toBe('m0');
    expect(meleePairOfImpact(moments, ai + 2)).toBeNull();
  });

  it('Gilded: pass 1 → its reactions → pass 2 → its reactions → the strike (interleaved per pass)', () => {
    const { events } = gasketFight(true);
    const { moments, ai } = firstSwing(events);
    const shape = moments.slice(ai + 1, ai + 6).map((m) => (m.hitReaction ? 'react' : m.primary.wave !== undefined ? 'pass' : 'strike'));
    expect(shape).toEqual(['pass', 'react', 'pass', 'react', 'strike']);
    expect(moments[ai + 2]!.primary.wave).toBe(moments[ai + 1]!.primary.wave);
    expect(moments[ai + 4]!.primary.wave).toBe(moments[ai + 3]!.primary.wave);
    expect(moments[ai + 3]!.primary.wave).not.toBe(moments[ai + 1]!.primary.wave);
  });

  it('one tendril per buffed minion per source: Rachel → every friend, Lord → every Demon, from the right body', () => {
    const { events } = gasketFight();
    const { moments, ai, order } = firstSwing(events);
    const casts = groupBuffCasts(moments[ai + 2]!, order);
    const pairs = casts.map((c) => `${c.source}>${c.target}`);
    expect(new Set(pairs).size, 'merged: never two tendrils for one (source, target)').toBe(pairs.length);
    // m1 Rachel buffs every OTHER friend (her own gain is a self pulse, not a tendril).
    expect(casts.filter((c) => c.source === 'm1').map((c) => c.target).sort()).toEqual(['m0', 'm2', 'm3']);
    // m3 Ruinous Lord buffs the OTHER Demons only (Gasket, Rachel) — never the neutral.
    expect(casts.filter((c) => c.source === 'm3').map((c) => c.target).sort()).toEqual(['m0', 'm1']);
    // Three landed hits this pass (m2, m4, m5): the casts sum them, Rachel +2/+1 x3.
    expect(casts.find((c) => c.source === 'm1' && c.target === 'm2')).toMatchObject({ attack: 6, health: 3 });
    expect(CARD_INDEX['dm_radrachel']!.tribe).toBe('demon'); // → tendril-trail-demon
    expect(CARD_INDEX['dm_ruinouslord']!.tribe).toBe('demon');
  });

  it('a full 7v7 pass: the reaction beat holds at most one tendril per (source, buffed minion)', () => {
    const r = simulate(
      [bm('dm_gasket', 7, 3, { keywords: ['RL'], golden: true }), bm('dm_radrachel', 8, 10), bm('dm_ruinouslord', 4, 40),
        bm('trainingdummy', 0, 40), bm('trainingdummy', 0, 40), bm('trainingdummy', 0, 40), bm('trainingdummy', 0, 40)],
      Array.from({ length: 7 }, () => bm('trainingdummy', 0, 40)),
      makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const { moments, ai, order } = firstSwing(r.events);
    const react = moments[ai + 2]!;
    expect(react.hitReaction).toBe(true);
    // 11 landed hits fired Rachel 11 times and the Lord 11 times (22 x their targets of buff events) …
    expect(evOf(order, react).length).toBeGreaterThan(50);
    // … presented as 6 Rachel tendrils + 2 Lord tendrils.
    expect(groupBuffCasts(react, order).length).toBe(8);
  });

  it('a NORMAL Demon attack: the reaction plays right at contact, before the next attack', () => {
    const r = simulate([bm('dm_radrachel', 8, 10), bm('trainingdummy', 0, 40)], [bm('dm_clerk', 3, 40), bm('trainingdummy', 0, 40)],
      makeRng(7), CARD_INDEX, combatSide({ tier: 4 }), combatSide({ tier: 4 }));
    const moments = replayBeats(r.events);
    const order = replayOrder(r.events);
    const ai = moments.findIndex((m) => m.primary.type === 'attack' && m.primary.attacker === 'm0');
    expect(moments[ai + 1]!.kind, 'the clash').toBe('damage');
    const react = moments[ai + 2]!;
    expect(react.kind).toBe('buffWave');
    expect(evOf(order, react).every((e) => e.type === 'buff' && e.key === REACTION_KEY)).toBe(true);
    expect(moments[ai + 3]!.primary.type, 'the next swing only after the reaction').toBe('attack');
    expect(groupBuffCasts(react, order).map((c) => `${c.source}>${c.target}`)).toEqual(['m0>m1']);
  });

  it('the clock: the reaction starts right after its pass, and the next beat waits for its tendrils', () => {
    const { events } = gasketFight(true);
    const { moments, ai } = firstSwing(events);
    expect(holdMs(moments[ai + 2]!, moments[ai + 1]!, 1)).toBe(HIT_REACTION_LEAD_MS);
    expect(holdMs(moments[ai + 3]!, moments[ai + 2]!, 1)).toBeGreaterThanOrEqual(HIT_REACTION_READ_MS);
    expect(holdMs(moments[ai + 5]!, moments[ai + 4]!, 1)).toBeGreaterThanOrEqual(HIT_REACTION_READ_MS);
    // Speed-scaled like every other hold.
    expect(holdMs(moments[ai + 2]!, moments[ai + 1]!, 2)).toBe(HIT_REACTION_LEAD_MS / 2);
  });

  it('a foldedCue reaction does not split (the registry decides)', () => {
    expect(presentationPolicyFor(REACTION_KEY)?.policy).toBe('ownBeat');
    expect(presentationPolicyFor('factory:onFriendlyDemonDamageBuffSelf:friendlyDemonDealtDamage')?.policy).toBe('ownBeat');
    // A pass with no reaction (no Rachel / Lord / Todd) keeps the old single-moment shape.
    const r = simulate([bm('dm_gasket', 7, 3, { keywords: ['RL'] }), bm('trainingdummy', 0, 40)], [bm('trainingdummy', 0, 40)],
      makeRng(7), CARD_INDEX, combatSide({ tier: 4 }), combatSide({ tier: 4 }));
    expect(replayBeats(r.events).some((m) => m.hitReaction)).toBe(false);
  });

  it('the split moments still tile the log exactly, and the oracle agrees', () => {
    for (const golden of [false, true]) {
      const { events } = gasketFight(golden);
      const order = replayOrder(events);
      const moments = compileMoments(order);
      let at = 0;
      for (const m of moments) { expect(m.start).toBe(at); at = m.end; }
      expect(at).toBe(order.length);
      expect(moments.map(({ start, end, primary }) => ({ start, end, primary })))
        .toEqual(buildBeats(order).map(({ start, end, primary }) => ({ start, end, primary })));
    }
  });

  it('presentation only: the same seed gives the same outcome and log; deterministic', () => {
    const a = gasketFight(true, 11);
    const b = gasketFight(true, 11);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.result).toEqual(b.result);
    expect(a.playerDamage).toBe(b.playerDamage);
    // The replay's moment list is a pure function of the log, and never edits it.
    const before = JSON.stringify(a.events);
    replayBeats(a.events);
    expect(JSON.stringify(a.events)).toBe(before);
  });
});

// ── THE SHOP: a Fel Spikes Echo fired by Ossuary Rite (the shop spray's Demon-damage path) ─────────────────────────
const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const set2 = (x: Partial<RunState>): RunState => ({
  ...createRun(3, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
  tribes: ['kobold', 'dragon', 'beast', 'demon', 'dwarf'], wave: 7, tier: 6, phase: 'recruit', embers: 40, hand: [], board: [], ...x,
} as RunState);
const shop = () => set2({
  board: [bc('fs', 'dm_felspikes'), bc('rr', 'dm_radrachel'), bc('n1', 'trainingdummy', { health: 20 }), bc('rl', 'dm_ruinouslord'), bc('n2', 'trainingdummy', { health: 20 })],
  hand: [bc('o', 'ossuaryrite')],
});
const castRite: Action = { type: 'play', uid: 'o', targetUid: 'fs' } as Action;

describe('the Shop: the same reactions, each its own beat at the hit, one tendril per (source, minion)', () => {
  it('each reaction is a nested beat with the registry identity, sourced on Rachel / the Lord', () => {
    const t = compileTimeline(normalizePresentationBatch(reduceWithPresentation(shop(), castRite, true).batch!));
    const reactions = t.beats.filter((b) => b.policyKey === REACTION_KEY);
    expect(reactions.length, 'two landed hits x two reactors').toBe(4);
    expect(new Set(reactions.map((b) => b.source.uid))).toEqual(new Set(['rr', 'rl']));
    expect(reactions.every((b) => b.lane === 'reaction' && b.parentBeatId !== undefined)).toBe(true);
  });

  it('the mid-turn replay records: one tendril wave per (pass, source), so the Lord is never swallowed by Rachel', () => {
    const s = reduce(shop(), castRite);
    const fx = s.recruitBuffFx.filter((e) => e.sourceUid === 'rr' || e.sourceUid === 'rl');
    const waveOf = (src: string) => new Set(fx.filter((e) => e.sourceUid === src).map((e) => e.fxWave));
    expect(waveOf('rr').size).toBe(1);
    expect(waveOf('rl').size).toBe(1);
    expect([...waveOf('rr')][0]).not.toBe([...waveOf('rl')][0]);
    // Rachel → every other minion; the Lord → the other Demons (Fel Spikes, Rachel).
    expect(new Set(fx.filter((e) => e.sourceUid === 'rr').map((e) => e.targetUid))).toEqual(new Set(['fs', 'n1', 'rl', 'n2']));
    expect(new Set(fx.filter((e) => e.sourceUid === 'rl').map((e) => e.targetUid))).toEqual(new Set(['fs', 'rr']));
  });

  it('same outcome with and without the presentation collector', () => {
    const plain = reduce(shop(), castRite);
    const presented = reduceWithPresentation(shop(), castRite, true).state;
    const stats = (s: RunState) => s.board.map((c) => [c.uid, c.attack, c.health]);
    expect(stats(presented)).toEqual(stats(plain));
  });
});
