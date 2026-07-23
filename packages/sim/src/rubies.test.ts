import { describe, it, expect } from 'vitest';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { mintRubies, RUBY_ID } from './recruit';

/**
 * The Ruby engine (set 2 Kobolds). Rubies are a spell-LIKE token that is NOT a Shop Spell: minted into hand,
 * played onto a friendly minion to grant it the Ruby's stats as a permanent shop buff, tracked on its OWN cast
 * counter so Shop-Spell triggers never see them. These pin the recruit-phase spine before the Kobold cards +
 * UI layer on top of it.
 */
const mkMinion = (uid: string): BoardCard => ({ uid, cardId: 'sandbag', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false });

describe('Ruby engine (set 2)', () => {
  it('mints Rubies into hand at base 1/1', () => {
    const s = createRun(1);
    mintRubies(s, 2);
    const rubies = s.hand.filter((c) => c.cardId === RUBY_ID);
    expect(rubies.length).toBe(2);
    expect(rubies.every((r) => r.attack === 1 && r.health === 1)).toBe(true);
  });

  it('a Ruby played from hand grants a friendly minion its stats as a "Ruby" buff, then is consumed', () => {
    let s: RunState = { ...createRun(1), board: [mkMinion('m1')], hand: [] };
    mintRubies(s, 1);
    const ruby = s.hand.find((c) => c.cardId === RUBY_ID)!;
    const spellsBefore = s.spellsCast;
    s = reduce(s, { type: 'play', uid: ruby.uid, targetUid: 'm1' });
    const target = s.board.find((c) => c.uid === 'm1')!;
    expect([target.attack, target.health]).toEqual([3, 3]); // 2/2 + 1/1
    expect(target.buffs?.find((b) => b.source === 'Ruby')).toMatchObject({ attack: 1, health: 1 });
    expect(s.hand.find((c) => c.uid === ruby.uid)).toBeUndefined(); // consumed
    expect(s.rubyCasts).toBe(1);
    expect(s.spellsCast).toBe(spellsBefore); // NOT a Shop Spell — the spell-cast counter is untouched
  });

  it('rubyBonus grows only FUTURE Rubies (never retroactive)', () => {
    const s = createRun(1);
    s.hand = [];
    mintRubies(s, 1); // minted at base 1/1
    s.rubyBonus = { attack: 1, health: 1 };
    mintRubies(s, 1); // minted AFTER the bonus → 2/2
    const rubies = s.hand.filter((c) => c.cardId === RUBY_ID);
    expect(rubies.map((r) => `${r.attack}/${r.health}`).sort()).toEqual(['1/1', '2/2']);
  });

  it('a Ruby with no valid target fizzles and stays in hand', () => {
    let s: RunState = { ...createRun(1), board: [], hand: [] };
    mintRubies(s, 1);
    const ruby = s.hand.find((c) => c.cardId === RUBY_ID)!;
    s = reduce(s, { type: 'play', uid: ruby.uid, targetUid: 'nope' });
    expect(s.hand.some((c) => c.uid === ruby.uid)).toBe(true); // kept
    expect(s.rubyCasts ?? 0).toBe(0);
  });
});
