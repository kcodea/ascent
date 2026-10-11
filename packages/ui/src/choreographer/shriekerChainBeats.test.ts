import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { CONFIG, createRun, reduce, reduceWithPresentation, type BoardCard, type RunState } from '@game/sim';
import { CHAIN_LINK_PACING, compileTimeline } from './compileTimeline';
import { normalizePresentationBatch } from './adapters/presentationBatchAdapter';
import type { CompiledBeat, CompiledTimeline } from './timelineTypes';

/**
 * R-SHRIEKER-BEATS-01 (owner 2026-10-10): "shrieker's end of turn beat is somewhat unqiue - every shout minion that
 * triggers an effect gets their own beat from left to right. they do not all happen at the same time ... this also
 * means the tendrils will fire 1 at a time as each shout triggers".
 *
 * Driven through the REAL End-of-Turn batch (`reduceWithPresentation(faceOmen)`) and the shared compiler, so the
 * order asserted is the order gameplay emitted, not a fixture's.
 */
const faceOmen = { type: 'faceOmen' } as never;

const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const set2 = (board: BoardCard[]): RunState => ({
  ...createRun(3, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
  tribes: ['kobold', 'dragon', 'beast', 'demon', 'dwarf'], wave: 7, tier: 6, phase: 'recruit', embers: 40, hand: [], board,
} as RunState);

/** Three Broodfires (Shout: your Dragons +3/+2) around a Roomworks (excluded) and Shrieker on the right. */
const board = (shrieker: Partial<BoardCard> = {}): BoardCard[] => [
  bc('bf1', 'd2_broodfire'), bc('rw', 'd2_roomworks'), bc('bf2', 'd2_broodfire'), bc('bf3', 'd2_broodfire'), bc('sh', 'd2_shrieker', shrieker),
];

const compile = (s: RunState): CompiledTimeline => {
  const { batch } = reduceWithPresentation(s, faceOmen, true);
  return compileTimeline(normalizePresentationBatch(batch!));
};
const links = (t: CompiledTimeline): CompiledBeat[] => t.beats.filter((b) => b.chainLink).sort((a, b) => a.startMs - b.startMs);
const shriekerBeat = (t: CompiledTimeline): CompiledBeat => t.beats.find((b) => b.source.uid === 'sh' && b.trigger === 'endOfTurn')!;

describe('R-SHRIEKER-BEATS-01: Shrieker triggers each Shout as its own beat, left to right, one tendril each', () => {
  it('N Shout minions = N separate beats, strictly left to right, never overlapping', () => {
    const t = compile(set2(board()));
    const l = links(t);
    expect(l.map((b) => b.source.uid)).toEqual(['bf1', 'bf2', 'bf3']); // Roomworks excluded, Shrieker never itself
    for (let i = 1; i < l.length; i++) {
      // The next Shout starts only once the previous one has finished AND recovered: no two at the same time.
      expect(l[i]!.startMs).toBeGreaterThanOrEqual(l[i - 1]!.recoveryEndMs);
      expect(l[i]!.startMs).toBeGreaterThan(l[i - 1]!.completionMs);
    }
    expect(l.map((b) => b.chainLink!.index)).toEqual([0, 1, 2]);
    expect(l.every((b) => b.chainLink!.count === 3)).toBe(true);
  });

  it('each beat carries exactly ONE link, from Shrieker to the Shout it triggers', () => {
    const t = compile(set2(board()));
    for (const b of links(t)) {
      expect(b.chainLink!.from.uid).toBe('sh');
      expect(b.chainLink!.from.id).toBe('d2_shrieker');
      expect(CARD_INDEX[b.chainLink!.from.id]!.tribe).toBe('dragon'); // → `tendril-trail-dragon` in the player
      expect(b.parentBeatId).toBe(shriekerBeat(t).id);
    }
  });

  it("each Shout's consequences land on ITS beat, after its tendril has arrived", () => {
    const t = compile(set2(board()));
    const l = links(t);
    for (const b of l) {
      const mine = t.consequenceDeliveries.filter((d) => d.beatId === b.id);
      expect(mine.length, `${b.source.uid} produced buffs on its beat`).toBeGreaterThan(0);
      for (const d of mine) {
        expect(d.atMs).toBeGreaterThanOrEqual(b.startMs + CHAIN_LINK_PACING.linkLeadMs);
        expect(d.atMs).toBeLessThanOrEqual(b.completionMs);
      }
    }
    // …and no Shout's buff lands inside a LATER Shout's slot or before its own.
    for (let i = 0; i < l.length - 1; i++) {
      const mine = t.consequenceDeliveries.filter((d) => d.beatId === l[i]!.id);
      for (const d of mine) expect(d.atMs).toBeLessThan(l[i + 1]!.startMs);
    }
  });

  it('the Shrieker beat stretches over the whole chain, so the next End-of-Turn source waits for it', () => {
    const t = compile(set2(board()));
    const l = links(t);
    const sh = shriekerBeat(t);
    expect(sh.completionMs).toBeGreaterThanOrEqual(l[l.length - 1]!.completionMs);
    expect(sh.recoveryEndMs).toBeGreaterThanOrEqual(l[l.length - 1]!.recoveryEndMs);
    // The chain reserves real time: each link ~one slot. Counting beats is not giving them room.
    const slot = CHAIN_LINK_PACING.completionMs + CHAIN_LINK_PACING.recoveryMs;
    expect(l[l.length - 1]!.recoveryEndMs - l[0]!.startMs).toBeGreaterThanOrEqual(slot * 3 - 1);
  });

  it('stays snappy: 6 Shouts finish well inside 3.5 s', () => {
    const six = [1, 2, 3, 4, 5, 6].map((n) => bc(`bf${n}`, 'd2_broodfire'));
    const t = compile(set2([...six, bc('sh', 'd2_shrieker')]));
    const l = links(t);
    expect(l).toHaveLength(6);
    expect(l[5]!.recoveryEndMs - l[0]!.startMs).toBeLessThan(3500);
  });

  it('gilded runs the whole left-to-right pass TWICE (A, B, C, A, B, C), each with its own tendril', () => {
    const t = compile(set2(board({ golden: true })));
    const l = links(t);
    expect(l.map((b) => b.source.uid)).toEqual(['bf1', 'bf2', 'bf3', 'bf1', 'bf2', 'bf3']);
    expect(l.map((b) => b.chainLink!.index)).toEqual([0, 1, 2, 3, 4, 5]);
    for (let i = 1; i < l.length; i++) expect(l[i]!.startMs).toBeGreaterThanOrEqual(l[i - 1]!.recoveryEndMs);
  });

  it('a Shout repeat (Orivax) stays inside that minion\'s beat: still one beat per Shout minion', () => {
    const t = compile(set2([bc('or', 'd2_orivax'), ...board()]));
    const l = links(t);
    expect(l.map((b) => b.source.uid)).toEqual(['bf1', 'bf2', 'bf3']);
  });

  it('is deterministic and presentation-only: same compile twice, and the committed state equals a plain reduce', () => {
    const s = set2(board({ golden: true }));
    expect(JSON.stringify(compile(s))).toBe(JSON.stringify(compile(s)));
    const withBatch = reduceWithPresentation(s, faceOmen, true).state;
    const plain = reduce(s, faceOmen);
    expect(JSON.stringify(withBatch.board)).toBe(JSON.stringify((plain as RunState).board));
  });

  it('only a registry-sequential parent chains: any other parent still places its nested triggers together', () => {
    const ev = (id: string, policyKey: string, parentId?: string, seq = 0) => ({
      type: 'sourceTrigger' as const, id, sequence: seq, step: seq + 1, phase: 'endOfTurn' as const,
      source: { kind: 'minion' as const, id: `card_${id}`, uid: id }, trigger: 'endOfTurn', policy: 'ownBeat' as const,
      policyKey, family: 'endOfTurn', ...(parentId ? { parentId } : {}),
    });
    const run = (parentKey: string) => compileTimeline(normalizePresentationBatch({
      id: 'b', actionId: 'a', phase: 'endOfTurn',
      events: [ev('p', parentKey, undefined, 0), ev('c1', 'factory:battlecryBuffTribe:onPlay', 'p', 1), ev('c2', 'factory:battlecryBuffTribe:onPlay', 'p', 2)],
    }));
    const plain = run('factory:addTavernFodder:endOfTurn').beats.filter((b) => b.lane === 'reaction');
    expect(plain[0]!.startMs).toBe(plain[1]!.startMs); // together, unchanged
    expect(plain.every((b) => !b.chainLink)).toBe(true);
    const chain = run('factory:endOfTurnTriggerShouts:endOfTurn').beats.filter((b) => b.lane === 'reaction');
    expect(chain[1]!.startMs).toBeGreaterThanOrEqual(chain[0]!.recoveryEndMs);
  });
});
