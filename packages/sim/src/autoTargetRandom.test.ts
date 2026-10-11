/**
 * R-TARGET-07 — A TARGETED EFFECT THE PLAYER DID NOT AIM PICKS A RANDOM LEGAL TARGET (owner bug 2026-10-10).
 *
 * Owner: *"in this setup, the humphry end of turn triggers should target a random dragon. they are targeting the same
 * one every time for some reason. this should be the case for all targeted minions when they get triggered in a way
 * that doesnt allow the player to target. it picks a random minion from the available options, not the same one every
 * time."*
 *
 * Root cause: the arena's un-aimed fallback for `battlecryBuffTarget` (Humphry, Twilight Emissary, Brood Whelp) and
 * `battlecryGrantKeyword` took the HIGHEST-ATTACK legal friend, so every Shrieker re-fire of Humphry fed the same
 * already-biggest Dragon. Roomworks took the LEFT-most legal minion; a stranded aim at End Turn took the highest-
 * Attack "carry"; Cage Breaker's re-fire did nothing. Every un-aimed pick now goes through core's `pickAutoTarget`
 * (one seeded draw per trigger): the run cursor in the Shop, the fight's rng in combat.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef } from '@game/core';
import { CONFIG, createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, castSpellFromMinion, replayBattlecry } from './recruit';

const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const set2 = (extra: Partial<RunState> = {}): RunState => ({
  ...createRun(3, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
  tribes: ['kobold', 'dragon', 'beast', 'demon', 'dwarf'], wave: 7, tier: 6, phase: 'recruit', embers: 40, hand: [], board: [],
  ...extra,
} as RunState);
const on = (s: RunState, uid: string): BoardCard | undefined => s.board.find((c) => c.uid === uid);
const gainFrom = (c: BoardCard | undefined, source: string): number =>
  (c?.buffs ?? []).filter((b) => b.source === source).reduce((t, b) => t + b.attack, 0);

// ── The owner's setup: two Humphrys, two Shriekers, Dragons of very different sizes, a non-Dragon ─────────────

/** The screenshot board: Humphry ×2, Shrieker ×2 (one HUGE), a Dragonflame-ish whelp, plus a non-Dragon. */
const ownerBoard = (): BoardCard[] => [
  bc('h1', 'd2_humphry'), bc('h2', 'd2_humphry'),
  bc('s1', 'd2_shrieker', { attack: 11, health: 10 }), bc('s2', 'd2_shrieker', { attack: 125, health: 124 }),
  bc('w', 'd2_cinderchef', { attack: 18, health: 34 }), bc('x', 'stray'),
];
const DRAGONS = new Set(['h1', 'h2', 's1', 's2', 'w']);

/** End the turn's End of Turn once (Shrieker ×2 → each re-fires both Humphrys) and report who got Humphry's buff. */
const humphryRecipients = (cursor: number): string[] => {
  const s = set2({ board: ownerBoard(), rngCursor: cursor, playedThisTurn: ['d2_humphry'] });
  applyEndOfTurn(s);
  return s.board.filter((c) => gainFrom(c, 'Humphry') > 0).map((c) => c.uid);
};

describe('R-TARGET-07 Shop — Shrieker re-firing Humphry lands on a RANDOM Dragon', () => {
  it('across seeds, the buff reaches several different Dragons (it used to be the 125/124 Shrieker every time)', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) for (const u of humphryRecipients(seed * 7919)) seen.add(u);
    expect(seen.size, `recipients seen: ${[...seen].join(',')}`).toBeGreaterThanOrEqual(3);
    expect(seen.has('s1') || seen.has('w') || seen.has('h1') || seen.has('h2'), 'not just the biggest Dragon').toBe(true);
  });

  it('never an invalid target: no non-Dragon, and a Humphry never buffs itself', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = set2({ board: ownerBoard(), rngCursor: seed * 104729, playedThisTurn: ['d2_humphry'] });
      // Re-fire each Humphry by hand-rolled replay, the path Shrieker uses, and read the self rule per fire.
      for (const uid of ['h1', 'h2']) {
        const before = gainFrom(on(s, uid), 'Humphry');
        replayBattlecry(s, on(s, uid)!);
        expect(gainFrom(on(s, uid), 'Humphry'), `${uid} never buffs itself`).toBe(before);
      }
      expect(gainFrom(on(s, 'x'), 'Humphry'), 'the non-Dragon is never picked').toBe(0);
      for (const c of s.board) if (gainFrom(c, 'Humphry') > 0) expect(DRAGONS.has(c.uid)).toBe(true);
    }
  });

  it('each separate trigger re-rolls: one End of Turn (4 Humphry fires) can split across Dragons', () => {
    let split = false;
    for (let seed = 1; seed <= 40 && !split; seed++) split = humphryRecipients(seed * 31337).length > 1;
    expect(split).toBe(true);
  });

  it('deterministic: the same cursor lands the same buffs', () => {
    const run = () => {
      const s = set2({ board: ownerBoard(), rngCursor: 424242, playedThisTurn: ['d2_humphry'] });
      applyEndOfTurn(s);
      return s.board.map((c) => [c.uid, gainFrom(c, 'Humphry')]);
    };
    expect(run()).toEqual(run());
  });
});

describe('R-TARGET-07 Shop — a PLAYER-aimed Humphry still lands on the chosen Dragon', () => {
  it('the aim wins over any random pick, every seed', () => {
    for (let seed = 1; seed <= 10; seed++) {
      let s = set2({ rngCursor: seed * 7919, board: [bc('small', 'd2_cinderchef', { attack: 1, health: 1 }), bc('big', 'd2_embermouth', { attack: 90, health: 90 })] });
      s = act({ ...s, hand: [bc('h', 'd2_humphry')] }, { type: 'play', uid: 'h' });
      expect(s.pendingTarget?.uid).toBe('h');
      s = act(s, { type: 'battlecryTarget', targetUid: 'small' });
      expect(gainFrom(on(s, 'small'), 'Humphry')).toBeGreaterThan(0);
      expect(gainFrom(on(s, 'big'), 'Humphry')).toBe(0);
    }
  });
});

describe('R-TARGET-07 Shop — Roomworks fired without an aim picks a RANDOM End of Turn minion', () => {
  // Two End of Turn minions (Steward copies the last spell; Kringle-free so the read is clean): which one's End of Turn
  // replays is visible as the Steward's copy landing or not.
  const board = (): BoardCard[] => [bc('st', 'stewardofspells'), bc('sh', 'd2_shrieker'), bc('x', 'stray'), bc('r', 'd2_roomworks')];
  const copies = (s: RunState) => s.hand.filter((c) => c.cardId === 'growth').length;
  it('across seeds both End of Turn minions are picked (it used to be the left-most every time), never the off-filter body', () => {
    const outcomes = new Set<number>();
    for (let seed = 1; seed <= 40 && outcomes.size < 2; seed++) {
      const s = set2({ board: board(), lastSpellCastId: 'growth', rngCursor: seed * 7919 });
      replayBattlecry(s, on(s, 'r')!);
      outcomes.add(copies(s)); // 1 = the Steward (left-most) was picked; 0 = the Shrieker was
    }
    expect([...outcomes].sort()).toEqual([0, 1]);
  });
  it('deterministic per cursor', () => {
    const run = () => { const s = set2({ board: board(), lastSpellCastId: 'growth', rngCursor: 99 }); replayBattlecry(s, on(s, 'r')!); return [copies(s), s.rngCursor]; };
    expect(run()).toEqual(run());
  });
  it('an AIMED Roomworks still replays the chosen minion', () => {
    for (let seed = 1; seed <= 10; seed++) {
      let s = set2({ board: [bc('sh', 'd2_shrieker'), bc('st', 'stewardofspells')], lastSpellCastId: 'growth', rngCursor: seed * 7919, hand: [bc('r', 'd2_roomworks')] });
      s = act(s, { type: 'play', uid: 'r' });
      s = act(s, { type: 'battlecryTarget', targetUid: 'st' });
      expect(copies(s)).toBe(1);
    }
  });
});

describe('R-TARGET-07 Shop — a stranded aim at End Turn resolves on a RANDOM legal target', () => {
  it('Humphry left un-aimed at End Turn buffs a random other Dragon (not always the biggest), never itself', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40 && seen.size < 2; seed++) {
      let s = set2({ rngCursor: seed * 7919, board: [bc('a', 'd2_cinderchef', { attack: 1, health: 300 }), bc('b', 'd2_embermouth', { attack: 90, health: 300 }), bc('x', 'stray', { health: 300 })] });
      s = act({ ...s, hand: [bc('h', 'd2_humphry', { health: 300 })] }, { type: 'play', uid: 'h' });
      expect(s.pendingTarget?.uid).toBe('h');
      s = act(s, { type: 'faceOmen' });
      const hit = ['a', 'b', 'x', 'h'].filter((u) => (s.board.find((c) => c.uid === u)?.buffs ?? []).some((bf) => bf.source === 'Humphry'));
      expect(hit.length).toBeLessThanOrEqual(1);
      for (const u of hit) { expect(u).not.toBe('x'); expect(u).not.toBe('h'); seen.add(u); }
    }
    expect([...seen].sort()).toEqual(['a', 'b']);
  });
});

describe('R-TARGET-07 Shop — Cage Breaker fired without an aim destroys a RANDOM other friendly Undead', () => {
  const board = (): BoardCard[] => [bc('cb', 'u3_cagebreaker'), bc('x', 'stray'), bc('a1', 'u3_adeptus'), bc('a2', 'u3_adeptus')];
  it('one of the two Undead dies (both reachable across seeds), never the non-Undead or itself; it used to do nothing', () => {
    const died = new Set<string>();
    for (let seed = 1; seed <= 40 && died.size < 2; seed++) {
      const s = set2({ board: board(), rngCursor: seed * 7919 });
      replayBattlecry(s, on(s, 'cb')!);
      const gone = ['cb', 'x', 'a1', 'a2'].filter((u) => !on(s, u));
      expect(gone).toHaveLength(1);
      expect(['a1', 'a2']).toContain(gone[0]);
      died.add(gone[0]!);
    }
    expect([...died].sort()).toEqual(['a1', 'a2']);
  });
});

// ── COMBAT ───────────────────────────────────────────────────────────────────────────────────────────────────

const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, ...extra } as BoardMinion);
/** Dawnclaw (1/1) dies to the first swing and its Echo re-fires its living neighbours' Shouts, live, un-aimed. */
const dawnclawRefire = (seed: number) => simulate(
  [bm('emissary', 1, 9999), bm('b2_dawnclaw', 1, 1), bm('d2_cinderchef', 1, 9999), bm('d2_embermouth', 90, 9999), bm('stray', 1, 9999)],
  [bm('sandbag', 50, 9999)], makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));

describe('R-TARGET-07 combat — a targeted Shout re-fired mid-fight picks a RANDOM legal target', () => {
  const emissaryTargets = (seed: number): string[] => {
    const r = dawnclawRefire(seed);
    const src = r.initial.player[0]!.uid;
    const byUid = new Map(r.initial.player.map((m) => [m.uid, m.cardId]));
    return r.events.filter((e) => e.type === 'buff' && (e as { source?: string }).source === src)
      .map((e) => byUid.get((e as { target: string }).target) ?? '?');
  };
  it('Twilight Emissary re-fired by Dawnclaw reaches different Dragons across seeds, never a non-Dragon or itself', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) for (const id of emissaryTargets(seed)) seen.add(id);
    expect(seen.has('stray'), 'never the non-Dragon').toBe(false);
    expect(seen.has('emissary'), 'never itself').toBe(false);
    expect([...seen].sort(), 'both Dragons reachable (was the 90-Attack one every time)').toEqual(['d2_cinderchef', 'd2_embermouth']);
  });
  it('deterministic: the same seed replays the same fight', () => {
    expect(dawnclawRefire(17).events).toEqual(dawnclawRefire(17).events);
  });
});

// ── NAMED SPELLS a minion casts (owner 2026-10-10: "Yes, random too") ──────────────────────────────────────────

describe('R-TARGET-07 Shop — a TARGETED named spell a minion casts lands on a RANDOM legal other friend', () => {
  const spell = CARD_INDEX['tower_shield']!; // a plain targeted stat spell
  const hit = (s: RunState) => s.board.filter((c) => (c.buffs ?? []).some((b) => b.source === spell.name)).map((c) => c.uid);
  it('across seeds it reaches every other friend (was the highest-Attack one every time), never the caster', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = set2({ rngCursor: seed * 7919, board: [bc('c', 'stray'), bc('a', 'stray', { attack: 1 }), bc('b', 'stray', { attack: 99 })] });
      expect(castSpellFromMinion(s, on(s, 'c'), spell)).toBe(true);
      const h = hit(s);
      expect(h).toHaveLength(1);
      expect(h[0]).not.toBe('c');
      seen.add(h[0]!);
    }
    expect([...seen].sort()).toEqual(['a', 'b']);
  });
  it('a lone caster has no legal target: the cast fizzles and is not counted (it used to land on the caster)', () => {
    const s = set2({ board: [bc('c', 'stray')] });
    const before = s.spellsCast;
    expect(castSpellFromMinion(s, on(s, 'c'), spell)).toBe(false);
    expect(hit(s)).toEqual([]);
    expect(s.spellsCast).toBe(before);
  });
  it('deterministic per cursor', () => {
    const run = () => { const s = set2({ rngCursor: 5, board: [bc('c', 'stray'), bc('a', 'stray'), bc('b', 'stray')] }); castSpellFromMinion(s, on(s, 'c'), spell); return hit(s); };
    expect(run()).toEqual(run());
  });
});

describe('R-TARGET-07 combat — a TARGETED named spell cast mid-fight lands on a RANDOM legal other friend', () => {
  // Flamebeat Drake's Rally casts a named spell (`rallyCastNamedSpell` → `castNamedSpellInCombat`). Point it at a
  // targeted spell through a test-only card index; the shipped cards never change.
  const cards: Record<string, CardDef> = {
    ...CARD_INDEX,
    d2_flamebeat: { ...CARD_INDEX.d2_flamebeat!, effects: [{ on: 'onAttack', do: 'rallyCastNamedSpell', params: { spellId: 'tower_shield' } }] },
  };
  const fight = (seed: number) => simulate(
    [bm('d2_flamebeat', 1, 9999), bm('stray', 1, 9999), bm('stray', 99, 9999)],
    [bm('sandbag', 0, 99999)], makeRng(seed), cards as never, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
  const firstCastTarget = (seed: number): string | undefined => {
    const r = fight(seed);
    const caster = r.initial.player[0]!.uid;
    const i = r.events.findIndex((e) => e.type === 'sc' && (e as { source?: string }).source === caster && /casts/.test((e as { text: string }).text));
    if (i < 0) return undefined;
    const buff = r.events.slice(0, i).reverse().find((e) => e.type === 'buff') as { target: string } | undefined;
    return buff?.target;
  };
  it('the cast reaches both other friends across seeds, never the caster', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const t = firstCastTarget(seed);
      if (!t) continue;
      const r = fight(seed);
      const idx = r.initial.player.findIndex((m) => m.uid === t);
      expect(idx, 'never the caster').not.toBe(0);
      seen.add(idx);
    }
    expect([...seen].sort()).toEqual([1, 2]);
  });
  it('deterministic: the same seed replays the same fight', () => {
    expect(fight(9).events).toEqual(fight(9).events);
  });
});
