/**
 * EVERY START OF TURN EFFECT GETS ITS OWN BEAT (R-SOT-BEAT-01; owner 2026-09-27, verbatim: "yes they all need their own
 * beat, and the timer/turn shouldnt start until after they complete. also, they need to wait until the transition back
 * from combat finishes.").
 *
 * The sim half: `advanceCombat` runs each Start of Turn source through `recordSotBeat`, which records ONE beat per
 * source, in the order the sim applied them, with what that source changed (gains, new cards, Discovers, rune
 * pulses). The recorder is READ-ONLY: the run state is the same with or without it, apart from the presentation-only
 * channel fields. The UI half (the wipe gate, the plan, the timer gate) lives in packages/ui/src/sotBeats.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { applyStartOfTurn } from './recruit';
import { recordSotBeat } from './sotBeat';
import { createRun, reduce, type BoardSnapshot, type RunState } from './index';

const card = (id: string, uid: string): RunState['board'][number] => {
  const c = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: c.tribe, attack: c.attack, health: c.health, keywords: [...c.keywords], golden: false } as RunState['board'][number];
};

/** A recruit-phase run holding `runes` (granted through the real reward engine) and `board`, fought and resolved. */
function resolveWith(runes: string[], board: RunState['board']): { before: RunState; after: RunState } {
  let s: RunState = { ...createRun(11, 'warden'), phase: 'recruit', embers: 0, hand: [], board };
  for (const id of runes) s = reduce(s, { type: 'devGrant', kind: 'rune', id });
  // The grants' own immediate payouts (a Discover, a copy) are not what this test is about: clear the decks.
  s = { ...s, discover: undefined, discoverQueue: undefined, hand: [] };
  const foes: BoardSnapshot = { v: 1, wave: s.wave, heroId: 'indy', resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 1, minions: [{ cardId: 'sandbag', attack: 0, health: 1, keywords: [] }], seed: 1, origin: 'self' };
  s = reduce({ ...s, servedBoards: { [s.wave]: foes } }, { type: 'faceOmen' });
  const before = s;
  return { before, after: reduce(s, { type: 'resolveCombat' }) };
}

describe('every Start of Turn source is its own beat, in sim order', () => {
  it('runes and board minions each record one beat with their own consequences, in the order the sim applied them', () => {
    const { before, after: s } = resolveWith(
      ['rune_resonance', 'rune_copies', 'rune_strange_caravan', 'rune_fresh_pages'],
      [card('d2_felconjurer', 'fc'), card('n3_charger', 'jj')],
    );
    expect(s.phase).toBe('recruit');
    const beats = s.sotBeatFx ?? [];
    const label = (b: (typeof beats)[number]): string => (b.source.kind === 'minion' ? `minion:${b.source.cardId}` : `${b.source.kind}:${'id' in b.source ? b.source.id : ''}`);
    // Sim order (advanceCombat): Resonance, then Copies, then the warband's Start of Turn left to right, then the
    // Strange Caravan, then Fresh Pages.
    expect(beats.map(label)).toEqual([
      'rune:rune_resonance',
      'rune:rune_copies',
      'minion:d2_felconjurer',
      'minion:n3_charger',
      'rune:rune_strange_caravan',
      'rune:rune_fresh_pages',
    ]);
    const by = (l: string) => beats.find((b) => label(b) === l)!;
    // Each beat carries exactly what ITS source produced: no merged wave.
    expect(by('rune:rune_resonance').handGrants).toHaveLength(1);
    expect(by('rune:rune_copies').handGrants).toHaveLength(1);
    expect(by('minion:d2_felconjurer').handGrants?.map((u) => s.hand.find((c) => c.uid === u)?.cardId)).toEqual(['quickstudy']);
    expect(by('minion:n3_charger').handGrants ?? [], 'a charge is invisible: the pulse IS the beat').toEqual([]);
    expect(by('rune:rune_strange_caravan').handGrants).toHaveLength(1);
    expect(by('rune:rune_fresh_pages').discovers).toBe(1);
    // No hand card is claimed by two beats, and every Start-of-Turn hand arrival belongs to one.
    const claimed = beats.flatMap((b) => b.handGrants ?? []);
    expect(new Set(claimed).size).toBe(claimed.length);
    expect([...claimed].sort()).toEqual(s.hand.map((c) => c.uid).sort());
    // The rune beats carry their pulse, and the badges hold it until the beat plays.
    expect(by('rune:rune_resonance').procs).toEqual({ rune_resonance: 1 });
    expect(s.sotRuneProcs?.['rune_resonance']).toBe(1);
    // One seq bump per beat (the UI queues a batch when the seq moves).
    expect((s.sotBeatFxSeq ?? 0) - (before.sotBeatFxSeq ?? 0)).toBe(beats.length);
  });

  it('a turn with no Start of Turn effect records no beat at all', () => {
    const { after: s } = resolveWith([], [card('sandbag', 'sb')]);
    expect(s.phase).toBe('recruit');
    expect(s.sotBeatFx ?? []).toEqual([]);
  });

  it('a board gain is held on its OWN beat with the real delta (Rune of the Pendant gilds, the gain is its doubling)', () => {
    const { after: s } = resolveWith(['rune_pendant'], [card('n3_charger', 'sb')]);
    const beat = (s.sotBeatFx ?? []).find((b) => b.source.kind === 'rune' && b.source.id === 'rune_pendant');
    expect(beat, 'the Pendant fired on its own beat').toBeDefined();
    if (!beat) return;
    const sb = s.board.find((c) => c.uid === 'sb')!;
    expect(beat.gilds).toEqual(['sb']);
    expect(beat.gains.find((g) => g.uid === 'sb')!.attack).toBeGreaterThan(0);
    expect(sb.golden).toBe(true);
  });
});

describe('the recorder is read-only (the recorded run and determinism do not change)', () => {
  const strip = (s: RunState): unknown => {
    const rest: Partial<RunState> = { ...s };
    delete rest.sotBeatFx;
    delete rest.sotBeatFxSeq;
    delete rest.sotRuneProcs;
    return JSON.parse(JSON.stringify(rest));
  };

  it('the warband Start of Turn lands identically wrapped or bare', () => {
    const base: RunState = { ...createRun(5, 'warden'), phase: 'recruit', hand: [], board: [card('d2_felconjurer', 'fc'), card('n3_charger', 'jj')] };
    const bare = structuredClone(base);
    applyStartOfTurn(bare);
    const wrapped = structuredClone(base);
    applyStartOfTurn(wrapped, (c, fire) => recordSotBeat(wrapped, { kind: 'minion', uid: c.uid, cardId: c.cardId, label: c.cardId }, fire, { always: true }));
    expect(strip(wrapped)).toEqual(strip(bare));
    expect(wrapped.sotBeatFx).toHaveLength(2);
  });

  it('a random Start of Turn payout draws the same cards from the same RNG cursor when recorded', () => {
    const { after: a } = resolveWith(['rune_strange_caravan', 'rune_copies'], [card('d2_felconjurer', 'fc')]);
    const { after: b } = resolveWith(['rune_strange_caravan', 'rune_copies'], [card('d2_felconjurer', 'fc')]);
    expect(strip(a)).toEqual(strip(b));
    expect(a.rngCursor).toBe(b.rngCursor);
  });
});
