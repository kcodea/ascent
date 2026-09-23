import { describe, it, expect } from 'vitest';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { mintRubies, RUBY_ID } from './recruit';

/**
 * A BOUNCED Ruby resolves on its destination exactly as if it had been cast there — stats AND the Ruby's
 * keyword rider (owner report 2026-09-23: "warding ruby cast on a resonance idol that then hits a kobold
 * should grant it ward"). The Warding Ruby's Ward used to be granted only by the reducer's hand-play branch,
 * AFTER the landing primitive had already bounced the stats on, so a hop carried +1/+1 and nothing else.
 * The keyword now rides the one landing primitive (`fireOnRubyPlayed` → the `onRubyPlayed` payload → the
 * arena's `rubyPlayedBounce` → `gainRubyStats`), so every hop off a Ruby carries the Ruby's whole payload.
 * Ward stays a KOBOLD payoff on every landing (owner spec 2026-07-31: "give it Ward if it is a Kobold").
 */
const mk = (uid: string, cardId: string, tribe: BoardCard['tribe'] = 'kobold', golden = false): BoardCard =>
  ({ uid, cardId, tribe, attack: 2, health: 2, keywords: cardId === 'k_resonance' ? ['DS'] : [], golden });
const castOn = (s: RunState, rubyId: string, targetUid: string): RunState => {
  mintRubies(s, 1, rubyId);
  const ruby = s.hand.find((c) => c.cardId === rubyId)!;
  return reduce(s, { type: 'play', uid: ruby.uid, targetUid });
};
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const rubyBuff = (c: BoardCard) => c.buffs?.find((b) => b.source === 'Ruby');

describe('a Ruby bounced by Resonance Idol carries its whole payload (owner report 2026-09-23)', () => {
  it('a Warding Ruby cast on the Idol grants Ward to the KOBOLD it bounces onto — and only stats to a non-Kobold', () => {
    let s: RunState = { ...createRun(1), board: [mk('idol', 'k_resonance'), mk('kob', 'sandbag'), mk('neu', 'sandbag', 'neutral')], hand: [] };
    s = castOn(s, 'warding-ruby', 'idol');
    // The Idol's own landing is unchanged: its stats, its printed Ward.
    expect(rubyBuff(at(s, 'idol'))).toMatchObject({ attack: 1, health: 1 });
    expect(at(s, 'idol').keywords).toContain('DS');
    // Both random friends were hit (a pool of exactly two): the Kobold gets the stats AND the Ward …
    expect(rubyBuff(at(s, 'kob'))).toMatchObject({ attack: 1, health: 1 });
    expect(at(s, 'kob').keywords, 'the bounced Warding Ruby left the Kobold without Ward').toContain('DS');
    // … while the neutral gets the stats only — Ward is the Kobold payoff on every landing, direct or bounced.
    expect(rubyBuff(at(s, 'neu'))).toMatchObject({ attack: 1, health: 1 });
    expect(at(s, 'neu').keywords).not.toContain('DS');
  });

  it('a PLAIN Ruby bounced onto a Kobold still grants no keyword', () => {
    let s: RunState = { ...createRun(1), board: [mk('idol', 'k_resonance'), mk('kob', 'sandbag')], hand: [] };
    s = castOn(s, RUBY_ID, 'idol');
    expect(rubyBuff(at(s, 'kob'))).toMatchObject({ attack: 1, health: 1 });
    expect(at(s, 'kob').keywords).not.toContain('DS');
  });

  it('the no-rebounce guard holds: a second Idol receiving the hop bounces nothing further', () => {
    let s: RunState = { ...createRun(1), board: [mk('i1', 'k_resonance'), mk('i2', 'k_resonance'), mk('kob', 'sandbag')], hand: [] };
    s = castOn(s, 'warding-ruby', 'i1');
    // i1's bounce reaches BOTH friends (pool of two). i2's hop is stats only — it never re-bounces, so the
    // Kobold receives exactly ONE hop and i1 gets nothing reflected back.
    expect(rubyBuff(at(s, 'i1'))).toMatchObject({ attack: 1, health: 1 });
    expect(rubyBuff(at(s, 'i2'))).toMatchObject({ attack: 1, health: 1 });
    expect(rubyBuff(at(s, 'kob'))).toMatchObject({ attack: 1, health: 1 });
    expect(at(s, 'kob').keywords).toContain('DS');
    expect(s.bounceFx?.length ?? 0, 'exactly two hops: i1 → i2 and i1 → kob').toBe(2);
  });

  it('a Ruby improvement rides the bounce: a 1/2 Warding Ruby lands 1/2 + Ward on the Kobold', () => {
    let s: RunState = { ...createRun(1), rubyBonus: { attack: 0, health: 1 }, board: [mk('idol', 'k_resonance'), mk('kob', 'sandbag')], hand: [] };
    s = castOn(s, 'warding-ruby', 'idol');
    expect(rubyBuff(at(s, 'kob'))).toMatchObject({ attack: 1, health: 2 });
    expect(at(s, 'kob').keywords).toContain('DS');
  });

  it('a Gilded Idol bounces twice per target — the stats stack, the Ward lands once', () => {
    let s: RunState = { ...createRun(1), board: [mk('idol', 'k_resonance', 'kobold', true), mk('kob', 'sandbag')], hand: [] };
    s = castOn(s, 'warding-ruby', 'idol');
    expect(rubyBuff(at(s, 'kob'))).toMatchObject({ attack: 2, health: 2 });
    expect(at(s, 'kob').keywords.filter((k) => k === 'DS')).toEqual(['DS']);
  });

  it('Rune of Redirection: the right-most Kobold takes the Warding Ruby whole (stats + Ward), like the left-most', () => {
    let s: RunState = { ...createRun(1), runeRedirection: true, board: [mk('left', 'sandbag'), mk('mid', 'sandbag'), mk('right', 'sandbag')], hand: [] };
    s = castOn(s, 'warding-ruby', 'left');
    expect(at(s, 'left').keywords).toContain('DS');
    expect(rubyBuff(at(s, 'right'))).toMatchObject({ attack: 1, health: 1 });
    expect(at(s, 'right').keywords, 'the redirected landing is a real Ruby cast — it carries the Ward too').toContain('DS');
    expect(at(s, 'mid').keywords).not.toContain('DS');
  });
});
