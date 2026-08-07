import { describe, it, expect } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/** The third 2026-08-07 owner batch: the Badger (Basic), the Groveweaver and the Conduit (Epic). */
const rune = (id: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.id === id)!;
const bm = (uid: string, cardId: string, a = 2, h = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: a, health: h, keywords: [], golden: false });

function withRune(id: string, extra: Partial<RunState> = {}): RunState {
  const s: RunState = { ...createRun(3, 'runesmith'), wave: 7, phase: 'recruit', embers: 20, runeforgeOffer: [id], ...extra };
  return reduce(s, { type: 'buyRune', index: 0 }) as RunState;
}

describe('the 3 defs ship as specced', () => {
  it('costs, forges and set scoping', () => {
    expect([rune('rune_badger').cost, !!rune('rune_badger').epic]).toEqual([5, false]);
    expect([rune('rune_groveweaver').cost, rune('rune_groveweaver').epic]).toEqual([6, true]);
    expect([rune('rune_conduit').cost, rune('rune_conduit').epic]).toEqual([5, true]);
    // Only the Conduit is Ruby-gated; the other two work in either set.
    expect(rune('rune_conduit').sets).toEqual(['set2']);
    expect(rune('rune_badger').sets).toBeUndefined();
    expect(rune('rune_groveweaver').sets).toBeUndefined();
  });
});

describe('Rune of the Badger', () => {
  it('hands over a Badgington carrying Flurry AND Ward', () => {
    const s = withRune('rune_badger');
    const badger = s.hand.find((c) => c.cardId === 'badgington');
    expect(badger, 'no Badgington granted').toBeDefined();
    expect(badger!.keywords).toContain('W');  // Flurry
    expect(badger!.keywords).toContain('DS'); // Ward
  });
});

describe('Rune of the Groveweaver', () => {
  /** Play a Beast beside a Groveweaver and report what the Groveweaver itself gained. */
  const summonBeside = (armed: boolean): number => {
    const base: Partial<RunState> = {
      board: [bm('gw', 'b2_groveweaver', 4, 8)],
      hand: [bm('b', 'stray', 1, 1)],
      embers: 20,
    };
    const s = armed
      ? withRune('rune_groveweaver', base)
      : ({ ...createRun(3), phase: 'recruit', ...base } as RunState);
    const before = s.board.find((c) => c.uid === 'gw')!;
    const start = before.attack + before.health;
    const next = reduce(s, { type: 'play', uid: 'b' }) as RunState;
    const after = next.board.find((c) => c.uid === 'gw')!;
    return (after.attack + after.health) - start;
  };

  it('without the rune the Groveweaver buffs only the arriver', () => {
    expect(summonBeside(false)).toBe(0);
  });

  it('with the rune it also buffs itself, by the same +3/+3', () => {
    expect(summonBeside(true)).toBe(6); // +3/+3
  });

  it('a NON-Beast arriver pays nobody — the self-buff obeys the same tribe gate', () => {
    const s = withRune('rune_groveweaver', {
      board: [bm('gw', 'b2_groveweaver', 4, 8)],
      hand: [bm('m', 'sandbag', 1, 1)], // neutral, not a Beast
      embers: 20,
    });
    const before = s.board.find((c) => c.uid === 'gw')!;
    const start = before.attack + before.health;
    const next = reduce(s, { type: 'play', uid: 'm' }) as RunState;
    const after = next.board.find((c) => c.uid === 'gw')!;
    expect((after.attack + after.health) - start, 'a non-Beast summon should grant nothing').toBe(0);
  });
});

describe('Rune of the Conduit', () => {
  /** Cast a Ruby onto `target` and report the TOTAL stats gained across the rest of the board. */
  const bounceGain = (armed: boolean): number => {
    const base: Partial<RunState> = {
      board: [bm('t', 'stray', 1, 1), bm('o1', 'pack', 1, 1), bm('o2', 'alley', 1, 1)],
      hand: [bm('r', 'ruby', 1, 1)], // a Ruby's stats ride on the INSTANCE (it can be buffed in hand) — 1/1 base
      embers: 20,
    };
    const s = armed ? withRune('rune_conduit', base) : ({ ...createRun(3), phase: 'recruit', ...base } as RunState);
    const others = () => s.board.filter((c) => c.uid !== 't');
    const start = others().reduce((n, c) => n + c.attack + c.health, 0);
    const next = reduce(s, { type: 'play', uid: 'r', targetUid: 't' }) as RunState;
    const end = next.board.filter((c) => c.uid !== 't').reduce((n, c) => n + c.attack + c.health, 0);
    return end - start;
  };

  it('without the rune a Ruby stays on its target', () => {
    expect(bounceGain(false)).toBe(0);
  });

  it('with the rune the Ruby bounces once more, onto someone else', () => {
    expect(bounceGain(true), 'a 1/1 Ruby bouncing once = +2 across the rest of the board').toBe(2);
  });
});
