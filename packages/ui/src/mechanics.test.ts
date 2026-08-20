import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { MECHANICS, toMechInput } from './mechanics';

const has = (cardId: string, mechId: string): boolean => {
  const def = CARD_INDEX[cardId];
  if (!def) throw new Error(`no such card ${cardId}`);
  const m = MECHANICS.find((x) => x.id === mechId);
  if (!m) throw new Error(`no such mechanic ${mechId}`);
  return m.detect(toMechInput(def));
};

describe('MECHANICS detection', () => {
  it('detects Shout on an onPlay card, not on an onSummon watcher', () => {
    expect(has('havendrake', 'shout')).toBe(true);   // effects: onPlay
    expect(has('mamabear', 'shout')).toBe(false);    // effects: onSummon (a watcher, not a Shout)
  });
  it('detects Echo (onDeath), Avenge, End of Turn', () => {
    expect(has('impking', 'echo')).toBe(true);
    expect(has('dm_grobbus', 'avenge')).toBe(true);
    expect(has('aeonguard', 'endTurn')).toBe(true);
  });
  it('detects keyword mechanics via kwMatch', () => {
    expect(has('gryphon', 'taunt')).toBe(true);      // T
    expect(has('bronzewarden', 'ward')).toBe(true);  // DS
  });
  it('detects Choose One', () => {
    expect(has('shaper', 'chooseOne')).toBe(true);   // Wildwood Shaper
  });
  it('detects Engraved (glyph is the new runic one, not anvil)', () => {
    expect(has('thundeer', 'engraved')).toBe(true);
    expect(MECHANICS.find((m) => m.id === 'engraved')!.glyph).toBe('engrave');
  });
  it('Stealth uses its own glyph, not the eye', () => {
    expect(MECHANICS.find((m) => m.id === 'stealth')!.glyph).toBe('stealth');
  });
  it('every mechanic has a unique id and a non-empty glyph/term/def', () => {
    const ids = MECHANICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MECHANICS) { expect(m.glyph).toBeTruthy(); expect(m.term).toBeTruthy(); expect(m.def).toBeTruthy(); }
  });
});
