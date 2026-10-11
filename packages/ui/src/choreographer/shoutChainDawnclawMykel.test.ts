import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { CONFIG, createRun, reduce, reduceWithPresentation, type Action, type BoardCard, type RunState } from '@game/sim';
import { compileTimeline } from './compileTimeline';
import { normalizePresentationBatch } from './adapters/presentationBatchAdapter';
import type { CompiledBeat, CompiledTimeline } from './timelineTypes';
import { compileMoments } from '../choreo/compile';
import { SHOP_CHAIN_SLOT_MS, isShoutChainTrigger, planShoutChain } from '../choreo/shoutChain';

/**
 * R-SHRIEKER-BEATS-01, extended (owner 2026-10-10: "dawnclaw and mykel should also do one at a time"). Dawnclaw's
 * Echo (and Ryme's, the same factory) and High King Mykel present every Shout they trigger as its OWN beat, left
 * neighbour first, each with the trigger-er's tribe tendril: in the beat batch (End of Turn + Beat Lab), in the
 * Shop's mid-turn chain (`shoutLinkFx`), and in combat (one moment per `shout` fire). Presentation only.
 */
const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const set2 = (x: Partial<RunState>): RunState => ({
  ...createRun(3, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
  tribes: ['kobold', 'dragon', 'beast', 'demon', 'dwarf'], wave: 7, tier: 6, phase: 'recruit', embers: 40, hand: [], board: [], ...x,
} as RunState);

const compile = (s: RunState, a: Action): CompiledTimeline => compileTimeline(normalizePresentationBatch(reduceWithPresentation(s, a, true).batch!));
const links = (t: CompiledTimeline): CompiledBeat[] => t.beats.filter((b) => b.chainLink).sort((a, b) => a.startMs - b.startMs);

/** Broodfire (Shout: your Dragons +3/+2) on both sides of the trigger-er. */
const dawnclaw = (golden = false) => set2({
  board: [bc('bf1', 'd2_broodfire'), bc('dc', 'b2_dawnclaw', { golden }), bc('bf2', 'd2_broodfire')],
  hand: [bc('o', 'ossuaryrite')],
});
const castRite: Action = { type: 'play', uid: 'o', targetUid: 'dc' } as Action;
const mykel = (golden: boolean) => set2({
  board: [bc('bf1', 'd2_broodfire'), bc('my', 'dw_brisbane', { golden, spellProgress: 7 }), bc('bf2', 'd2_broodfire')],
  hand: [bc('g', 'growth')],
});
const castGrowth: Action = { type: 'play', uid: 'g', targetUid: 'bf1' } as Action;

describe('Dawnclaw (Shop Echo): each adjacent Shout is its own beat, left first, beast tendril', () => {
  it('two neighbours = two chain beats, left then right, never overlapping, from Dawnclaw', () => {
    const l = links(compile(dawnclaw(), castRite));
    expect(l.map((b) => b.source.uid)).toEqual(['bf1', 'bf2']);
    expect(l[1]!.startMs).toBeGreaterThanOrEqual(l[0]!.recoveryEndMs);
    expect(l.every((b) => b.chainLink!.from.uid === 'dc')).toBe(true);
    expect(CARD_INDEX['b2_dawnclaw']!.tribe).toBe('beast'); // → `tendril-trail-beast`
  });
  it('gilded triggers each neighbour twice: L, L, R, R (the engine order, both phases), each its own beat', () => {
    const l = links(compile(dawnclaw(true), castRite));
    expect(l.map((b) => b.source.uid)).toEqual(['bf1', 'bf1', 'bf2', 'bf2']);
    for (let i = 1; i < l.length; i++) expect(l[i]!.startMs).toBeGreaterThanOrEqual(l[i - 1]!.recoveryEndMs);
  });
  it('the Shop chain records one link per fire, each owning ITS buff records, one slot apart', () => {
    const s = reduce(dawnclaw(), castRite);
    expect(s.shoutLinkFx!.map((x) => [x.fromUid, x.toUid])).toEqual([['dc', 'bf1'], ['dc', 'bf2']]);
    const plan = planShoutChain(s.shoutLinkFx!, s.recruitBuffFx);
    for (const p of plan.links) {
      expect(p.buffs.length, 'each fire produced its own buff records').toBeGreaterThan(0);
      expect(p.buffs.every((b) => b.sourceUid === p.link.toUid)).toBe(true); // the Shout's owner buffs, not Dawnclaw
    }
    expect(plan.links.map((p) => p.linkAtMs)).toEqual([0, SHOP_CHAIN_SLOT_MS]);
    expect(plan.links[1]!.buffAtMs).toBeGreaterThan(plan.links[0]!.buffAtMs);
  });
});

describe('High King Mykel: each Shout it triggers is its own beat, left first, dwarf tendril', () => {
  it('gilded (both neighbours): two chain beats, left then right, from Mykel', () => {
    const l = links(compile(mykel(true), castGrowth));
    expect(l.map((b) => b.source.uid)).toEqual(['bf1', 'bf2']);
    expect(l[1]!.startMs).toBeGreaterThanOrEqual(l[0]!.recoveryEndMs);
    expect(l.every((b) => b.chainLink!.from.uid === 'my')).toBe(true);
    const s = reduce(mykel(true), castGrowth);
    expect(s.shoutLinkFx!.map((x) => [x.fromUid, x.toUid])).toEqual([['my', 'bf1'], ['my', 'bf2']]);
  });
  it('plain (one random neighbour): one link, still with its tendril', () => {
    const s = reduce(mykel(false), castGrowth);
    expect(s.shoutLinkFx).toHaveLength(1);
    expect(['bf1', 'bf2']).toContain(s.shoutLinkFx![0]!.toUid);
  });
});

describe('presentation only: outcomes and determinism unchanged', () => {
  it('the batch path and plain reduce land the same board, and a re-run is byte-identical', () => {
    for (const [s, a] of [[dawnclaw(true), castRite], [mykel(true), castGrowth]] as const) {
      const withBatch = reduceWithPresentation(s, a, true).state;
      const plain = reduce(s, a);
      expect(JSON.stringify(withBatch.board)).toBe(JSON.stringify(plain.board));
      expect(JSON.stringify(compile(s, a))).toBe(JSON.stringify(compile(s, a)));
    }
  });
  it('each fire still pays: both Broodfire Shouts fire once, each giving every Dragon +3', () => {
    const s = reduce(dawnclaw(), castRite);
    const from = (uid: string) => (s.board.find((c) => c.uid === uid)!.buffs ?? []).filter((b) => b.source === 'Broodfire').reduce((t, b) => t + b.attack, 0);
    expect(from('bf1')).toBe(6); // its own fire + bf2's
    expect(from('bf2')).toBe(6);
  });
});

describe('Dawnclaw in COMBAT: one moment per Shout fire, left neighbour first, the tendril trigger-er', () => {
  const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
    const d = CARD_INDEX[cardId]!;
    return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
  };
  it('its Echo fires the left Shout, then the right, each in its OWN moment', () => {
    const r = simulate(
      [bm('d2_broodfire', { health: 60 }), bm('b2_dawnclaw', { keywords: ['T'] }), bm('d2_broodfire', { health: 60 })],
      [{ cardId: 'sandbag', attack: 30, health: 200, keywords: [] } as unknown as BoardMinion],
      makeRng(3), CARD_INDEX, combatSide({ tier: 6, poolIds: Object.keys(CARD_INDEX) } as never), combatSide({ tier: 6 }),
    );
    const uids = r.initial.player.map((m) => m.uid);
    const dc = uids[1]!;
    const shouts = r.events.map((e, i) => [e, i] as const).filter(([e]) => e.type === 'shout' && (e as Extract<CombatEvent, { type: 'shout' }>).source === dc);
    expect(shouts.map(([e]) => (e as Extract<CombatEvent, { type: 'shout' }>).target)).toEqual([uids[0], uids[2]]);
    const moments = compileMoments(r.events);
    const momentOf = (i: number) => moments.findIndex((m) => i >= m.start && i < m.end);
    expect(momentOf(shouts[1]![1])).toBeGreaterThan(momentOf(shouts[0]![1]));
    expect(isShoutChainTrigger('b2_dawnclaw')).toBe(true);
    expect(isShoutChainTrigger('dw_brisbane')).toBe(true);
    expect(isShoutChainTrigger('d2_shrieker')).toBe(true);
    expect(isShoutChainTrigger('d2_broodfire')).toBe(false);
  });
});
