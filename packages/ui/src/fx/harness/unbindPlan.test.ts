import { describe, expect, it } from 'vitest';
import { planUnbind } from './unbindPlan';
import type { BindingEntry } from '../../choreo/bindings';

const file = (def: string): BindingEntry => ({ bindings: [{ def }], source: 'file' });

describe('planUnbind', () => {
  it('renders nothing when there is no binding at this row', () => {
    expect(planUnbind({ cardId: 'bloodbinder', kind: 'scCast', entry: undefined, fallback: [{ def: 'spell-cast' }] }))
      .toBeNull();
  });

  // The whole reason the panel exists: on a card row the two removals do OPPOSITE things, so both are
  // offered and each says which.
  it('offers both removals on a card row with a kind default beneath it, and names the fall-through', () => {
    const plan = planUnbind({
      cardId: 'bloodbinder',
      kind: 'scCast',
      entry: { bindings: [{ def: 'ruby-lance', fanOut: 'damaged' }], source: 'file' },
      fallback: [{ def: 'spell-cast' }],
    });
    expect(plan?.current).toEqual({ def: 'ruby-lance', fanOut: 'damaged' });
    expect(plan?.source).toBe('file');
    expect(plan?.options.map((o) => o.op)).toEqual(['clear', 'tombstone']);
    expect(plan?.options[0].consequence).toBe('scCast falls back to spell-cast');
    expect(plan?.options[1].consequence).toBe('nothing plays at scCast for this card');
  });

  // A kind row has no layer beneath it, so `clear` and `tombstone` are the same silence. Two buttons here
  // would be a choice between identical outcomes.
  it('offers one removal on a kind row, because nothing can fall through', () => {
    const plan = planUnbind({ cardId: null, kind: 'scCast', entry: file('spell-cast'), fallback: [] });
    expect(plan?.options.map((o) => o.op)).toEqual(['clear']);
    expect(plan?.options[0].consequence).toBe('nothing plays at scCast — for any card without its own binding');
    expect(plan?.target).toEqual({ cardId: null, kind: 'scCast' });
  });

  // The collapse is driven by the FALLBACK, not by the scope — a card row at a kind nobody bound has
  // nothing to fall back to either, and must not be offered a choice that does not exist.
  it('collapses on a card row too when its kind has no default', () => {
    const plan = planUnbind({ cardId: 'bloodbinder', kind: 'rally', entry: file('ruby-lance'), fallback: [] });
    expect(plan?.options.map((o) => o.op)).toEqual(['clear']);
    expect(plan?.options[0].consequence).toBe('nothing plays at rally for this card');
  });

  it('describes an uncommitted session override as such', () => {
    const plan = planUnbind({
      cardId: 'bloodbinder',
      kind: 'scCast',
      entry: { bindings: [{ def: 'ember-lance' }], source: 'session' },
      fallback: [{ def: 'spell-cast' }],
    });
    expect(plan?.source).toBe('session');
  });

  describe('a row that is already an explicit silence', () => {
    it('offers only to remove it, and says what comes back', () => {
      const plan = planUnbind({
        cardId: 'bloodbinder',
        kind: 'scCast',
        entry: { bindings: null, source: 'file' },
        fallback: [{ def: 'spell-cast' }],
      });
      expect(plan?.current).toBeNull();
      expect(plan?.options.map((o) => o.op)).toEqual(['clear']);
      expect(plan?.options[0].consequence).toBe('scCast plays spell-cast again');
    });

    it('says so honestly when removing it changes nothing visible', () => {
      const plan = planUnbind({ cardId: null, kind: 'scCast', entry: { bindings: null, source: 'file' }, fallback: [] });
      expect(plan?.options[0].consequence).toBe('nothing plays at scCast — for any card without its own binding');
    });
  });
});
