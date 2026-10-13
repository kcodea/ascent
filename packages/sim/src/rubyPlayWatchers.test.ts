import { describe, it, expect } from 'vitest';
import { createRun, type RunState, type BoardCard } from './state';
import { addBuff, applyEndOfTurn, fireOnRubyPlayed } from './recruit';
import { reduce } from './reducer';

/**
 * A Ruby PLAYED by a card must notify its target, exactly as a hand-cast Ruby does — the target's own
 * `onRubyPlayed` effects fire and `rubiesOnThisTurn` moves. Three card paths landed the stats and nothing
 * else (owner report 2026-08-02, via Alchemist Brisbane "not working"): the Rubies were invisible to every
 * downstream Ruby engine. Ruby Broker is the probe — it turns a received Ruby into Gold, so the Gold is a
 * direct read of "did the target hear about it".
 */
const broker = (uid: string): BoardCard =>
  ({ uid, cardId: 'k_rubybroker', tribe: 'kobold', attack: 4, health: 5, keywords: [], golden: false });

describe('a Ruby played by a card notifies its target', () => {
  // The End of Turn Ruby cast was Alchemist Brisbane's (the 2026-08-02 report) until the owner removed it from her on
  // 2026-10-13; Assembler carries the same factory now (2 Rubies on every OTHER Kobold).
  it("the End of Turn Ruby cast (Assembler)", () => {
    const s: RunState = { ...createRun(1), board: [broker('b')], hand: [] };
    s.board.push({ uid: 'as', cardId: 'k_assembler', tribe: 'kobold', attack: 4, health: 3, keywords: [], golden: false });
    const gold = s.embers;
    applyEndOfTurn(s);
    const hit = s.board.find((c) => c.uid === 'b')!;
    // Both Rubies land on the Broker (the only OTHER Kobold), and it must hear each one and pay out.
    expect(hit.rubiesOnThisTurn ?? 0, 'the played Rubies were invisible to the target').toBe(2);
    expect(s.embers, 'Ruby Broker never heard the Rubies').toBeGreaterThan(gold);
    expect(s.board.find((c) => c.uid === 'as')!.rubiesOnThisTurn ?? 0, 'never the caster').toBe(0);
  });

  it('Frenzied Excavator (Shout: a Ruby on every friendly)', () => {
    let s: RunState = { ...createRun(1), board: [broker('b')], hand: [{ uid: 'fe', cardId: 'k_frenzied', tribe: 'kobold', attack: 5, health: 5, keywords: [], golden: false }] };
    const gold = s.embers;
    s = reduce(s, { type: 'play', uid: 'fe' });
    expect(s.board.find((c) => c.uid === 'b')!.rubiesOnThisTurn ?? 0).toBeGreaterThan(0);
    expect(s.embers, 'Ruby Broker never heard the Ruby').toBeGreaterThan(gold);
  });

  it("Candle Conduit's bounce notifies NOBODY — the no-rebounce guard (rework 2026-08-07)", () => {
    // The bounce is stats-only by design: if it went back through fireOnRubyPlayed, two Conduits (or a
    // Conduit + Resonance Idol) would ping Rubies forever. So after one real Ruby play, exactly ONE minion
    // heard a Ruby land — the original target — even though a second minion gained the stats.
    const cc = { uid: 'cc', cardId: 'k_candleconduit', tribe: 'kobold' as const, attack: 3, health: 4, keywords: [], golden: false };
    const s: RunState = { ...createRun(1), board: [broker('b'), cc], hand: [] };
    const target = s.board[0]!;
    addBuff(target, 'Ruby', 1, 1);
    fireOnRubyPlayed(s, target, 1, 1);
    const notified = s.board.reduce((n, c) => n + (c.rubiesOnThisTurn ?? 0), 0);
    expect(notified, 'only the original target was notified').toBe(1);
  });
});
