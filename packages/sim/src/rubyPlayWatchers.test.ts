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
  it("Alchemist Brisbane's End of Turn", () => {
    const s: RunState = { ...createRun(1), board: [broker('b')], hand: [] };
    s.board.push({ uid: 'ab', cardId: 'k_alchemist', tribe: 'kobold', attack: 9, health: 6, keywords: [], golden: false });
    const gold = s.embers;
    applyEndOfTurn(s);
    const hit = s.board.find((c) => c.uid === 'b')!;
    // Brisbane picks a random Kobold — when it picks the Broker, the Broker must pay out.
    if ((hit.rubiesOnThisTurn ?? 0) > 0) expect(s.embers).toBeGreaterThan(gold);
    // Brisbane hits EVERY friendly Kobold (owner ruling 2026-08-03), so both bodies must hear about it.
    const total = s.board.reduce((n, c) => n + (c.rubiesOnThisTurn ?? 0), 0);
    expect(total, 'the played Ruby was invisible to a target').toBe(s.board.length);
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
