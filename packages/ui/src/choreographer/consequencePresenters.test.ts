import { describe, it, expect, vi } from 'vitest';
import { createRun, prepareActionWithPresentation, type RunState } from '@game/sim';
import { compileTimeline } from './compileTimeline';
import { normalizePresentationBatch } from './adapters/presentationBatchAdapter';
import { createTimelinePlayer } from './livePlayer';
import { CONSEQUENCE_PRESENTERS, presentConsequence, type PresenterContext } from './consequencePresenters';
import type { CompiledBeat } from './timelineTypes';
import type { ConsequenceEvent } from '@game/core';

/**
 * BEAT CHOREOGRAPHER PR 5 — presenter coverage (blueprint §15, §22.4).
 *
 * The failure this guards against is the one that has bitten this codebase repeatedly: an effect resolves
 * correctly, passes the policy audit, and plays NO cue — because the animation decided what to draw by
 * matching factory ids instead of reading what actually happened.
 *
 * So the load-bearing test is not "does the ruby presenter call rubyLanded". It is: **every consequence type
 * real gameplay emits has a presenter**, and every presenter reads the EVENT rather than re-deriving.
 */

/** Every consequence type in the union. If gameplay gains one, adding it here is the point of failure. */
const ALL_CONSEQUENCE_TYPES = [
  'statsChanged', 'keywordChanged', 'cardSummoned', 'cardDestroyed', 'cardTransformed', 'cardGranted',
  'spellResolved', 'resourceChanged', 'shopChanged', 'auraChanged', 'counterChanged', 'rubyPlayed',
] as const;

const spyContext = () => ({
  statGain: vi.fn(), rubyLanded: vi.fn(), spellPower: vi.fn(), impAura: vi.fn(),
  cardGranted: vi.fn(), cardSummoned: vi.fn(), cardDestroyed: vi.fn(), shopBuffed: vi.fn(),
  resourceChanged: vi.fn(), counterChanged: vi.fn(), cardTransformed: vi.fn(), keywordChanged: vi.fn(),
}) satisfies PresenterContext;

const beat = { id: 'beat:1', source: { kind: 'minion', id: 'c', uid: 'src' } } as CompiledBeat;
const run = (consequence: ConsequenceEvent, ctx = spyContext()) => {
  presentConsequence({ consequence, beat, ctx });
  return ctx;
};

describe('every consequence type has a presenter', () => {
  it.each(ALL_CONSEQUENCE_TYPES)('%s is covered', (type) => {
    expect(CONSEQUENCE_PRESENTERS[type], `no presenter for '${type}' — it would resolve with nothing on screen`).toBeTypeOf('function');
  });

  it('the registry has no entries beyond the consequence union (no ghosts)', () => {
    expect(Object.keys(CONSEQUENCE_PRESENTERS).sort()).toEqual([...ALL_CONSEQUENCE_TYPES].sort());
  });
});

describe('presenters read the EVENT, not the card definition', () => {
  it('spell power fires from the emitted aura name — the Void Curator gap', () => {
    // Legacy matched `battlecryBuffSpellPower`, which is Aeon Guard's factory and nobody else's, so a second
    // card raising the same channel played nothing. Reading `aura` means any such card animates.
    const ctx = run({ type: 'auraChanged', id: 'a', sequence: 0, step: 1, aura: 'spellPower', amount: 3, attack: 2, health: 1 } as ConsequenceEvent);
    expect(ctx.spellPower).toHaveBeenCalledWith('src', 2, 1);
    expect(ctx.impAura).not.toHaveBeenCalled();
  });

  it('the imp aura wash is its own aura name', () => {
    const ctx = run({ type: 'auraChanged', id: 'a', sequence: 0, step: 1, aura: 'impAura', amount: 2, attack: 1, health: 1 } as ConsequenceEvent);
    expect(ctx.impAura).toHaveBeenCalled();
    expect(ctx.spellPower).not.toHaveBeenCalled();
  });

  it('rubies use the gem cascade with the emitted count, not a generic stat burst', () => {
    const ctx = run({ type: 'rubyPlayed', id: 'r', sequence: 0, step: 1, target: { zone: 'board', uid: 'u1' }, count: 3 } as ConsequenceEvent);
    expect(ctx.rubyLanded).toHaveBeenCalledWith('u1', 3);
    expect(ctx.statGain).not.toHaveBeenCalled();
  });

  it('a non-ordinary stat channel does NOT double-draw the generic burst', () => {
    // The ruby/aura channels already have their own consequence + cue; drawing the burst too is the
    // "overlapping mess" the owner reported.
    const ctx = run({ type: 'statsChanged', id: 's', sequence: 0, step: 1, target: { zone: 'board', uid: 'u1' }, attack: 2, health: 2, permanent: true, channel: 'ruby' } as ConsequenceEvent);
    expect(ctx.statGain).not.toHaveBeenCalled();
  });

  it('an ordinary stat change DOES draw the burst', () => {
    const ctx = run({ type: 'statsChanged', id: 's', sequence: 0, step: 1, target: { zone: 'board', uid: 'u1' }, attack: 2, health: 2, permanent: true, channel: 'ordinary' } as ConsequenceEvent);
    expect(ctx.statGain).toHaveBeenCalledWith('u1', 'board', 2, 2);
  });

  it('a consumed shop offer departs rather than being drawn as a buff', () => {
    const ctx = run({ type: 'shopChanged', id: 'sh', sequence: 0, step: 1, change: 'consumed', target: { zone: 'shop', uid: 'o1' } } as ConsequenceEvent);
    expect(ctx.cardDestroyed).toHaveBeenCalledWith('o1', 'shop');
    expect(ctx.shopBuffed).not.toHaveBeenCalled();
  });

  it('a welded attachment counter attributes to its source when the event names no target', () => {
    const ctx = run({ type: 'counterChanged', id: 'ct', sequence: 0, step: 1, counter: 'attachments', amount: 2 } as ConsequenceEvent);
    expect(ctx.counterChanged).toHaveBeenCalledWith('attachments', 2, 'src');
  });

  it('a presenter never throws on a malformed target', () => {
    expect(() => run({ type: 'statsChanged', id: 's', sequence: 0, step: 1, target: { zone: 'board' }, attack: 1, health: 1, permanent: true } as ConsequenceEvent)).not.toThrow();
  });
});

describe('against a real End-of-Turn batch', () => {
  const eotRun = (): RunState => ({
    ...createRun(3, 'warden'),
    phase: 'recruit',
    board: [{ uid: 'b1', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
    runeCoffers: true, runeShopkeep: true, runeLapidary: true, upgradeCost: 9, playedThisTurn: ['a', 'b', 'c'],
  }) as RunState;

  it('every consequence a real turn emits finds a presenter', () => {
    const prepared = prepareActionWithPresentation(eotRun(), { type: 'faceOmen' } as never);
    const timeline = compileTimeline(normalizePresentationBatch(prepared.batch!));
    const uncovered = timeline.consequenceDeliveries
      .map((d) => d.consequence.kind)
      .filter((kind) => !(kind in CONSEQUENCE_PRESENTERS));
    expect(uncovered, `emitted with no presenter: ${[...new Set(uncovered)].join(', ')}`).toHaveLength(0);
  });

  it('playing a real turn drives presenters and never throws', () => {
    const ctx = spyContext();
    const prepared = prepareActionWithPresentation(eotRun(), { type: 'faceOmen' } as never);
    const timeline = compileTimeline(normalizePresentationBatch(prepared.batch!));
    const beats = new Map(timeline.beats.map((b) => [b.id, b]));
    const player = createTimelinePlayer(timeline, {
      onConsequence: (d) => presentConsequence({ consequence: d.consequence.payload as ConsequenceEvent, beat: beats.get(d.beatId)!, ctx }),
    });
    expect(() => player.finish()).not.toThrow();
    // The Lapidary's rubies and the economy runes' HUD moves are the two we know this fixture produces.
    const calls = Object.values(ctx).reduce((n, fn) => n + fn.mock.calls.length, 0);
    expect(calls, 'a real turn drew something').toBeGreaterThan(0);
  });
});
