import { describe, expect, it } from 'vitest';
import type { BindingTable } from '../../choreo/bindings';
import { forkId, MAX_SLUG, planCommit, referencesTo } from './commitPlan';

const tables: BindingTable = {
  kinds: {
    buffWave: { def: 'self-buff-gold', fanOut: 'selfBuffed' },
    attackExchange: { def: 'self-buff-gold', fanOut: 'selfBuffed' },
    scCast: { def: 'spell-cast' },
  },
  cards: {
    bloodbinder: { scCast: { def: 'ruby-lance', fanOut: 'damaged' } },
  },
};

const input = (over: Partial<Parameters<typeof planCommit>[0]> = {}): Parameters<typeof planCommit>[0] => ({
  scope: 'card',
  baseId: 'self-buff-gold',
  cardId: 'targetdummy',
  kind: 'buffWave',
  fanOut: 'selfBuffed',
  knownDefIds: ['self-buff-gold', 'spell-cast', 'ruby-lance'],
  tables,
  ...over,
});

describe('forkId', () => {
  it('joins the base and the card', () => {
    expect(forkId('self-buff-gold', 'targetdummy')).toBe('self-buff-gold-targetdummy');
  });

  // The write endpoint enforces ^[a-z0-9][a-z0-9-]{0,63}$. Truncating HERE means an over-long pair is a
  // predictable id shown in the panel before you press anything, instead of a 400 after you do.
  it('truncates to the slug limit', () => {
    const long = forkId('a'.repeat(50), 'b'.repeat(50));
    expect(long.length).toBe(MAX_SLUG);
    expect(long.startsWith('a'.repeat(50))).toBe(true);
  });
});

describe('referencesTo', () => {
  it('finds every kind and card entry pointing at a def', () => {
    expect(referencesTo(tables, 'self-buff-gold')).toEqual([
      { cardId: null, kind: 'buffWave' },
      { cardId: null, kind: 'attackExchange' },
    ]);
    expect(referencesTo(tables, 'ruby-lance')).toEqual([{ cardId: 'bloodbinder', kind: 'scCast' }]);
  });

  it('returns empty for a def nothing points at', () => {
    expect(referencesTo(tables, 'nobody-uses-me')).toEqual([]);
  });
});

describe('planCommit — card scope', () => {
  it('forks the def and targets the card row', () => {
    const p = planCommit(input());
    expect(p.defId).toBe('self-buff-gold-targetdummy');
    expect(p.forkedFrom).toBe('self-buff-gold');
    expect(p.bindingTarget).toEqual({ cardId: 'targetdummy', kind: 'buffWave' });
  });

  // THE point of forking. A fresh fork is referenced by nothing, so committing it cannot disturb any other
  // card — which is exactly what "card-only" has to guarantee.
  it('affects nothing else, because the forked def is new', () => {
    expect(planCommit(input()).alsoAffects).toEqual([]);
  });

  it('reports an existing fork as an overwrite, not a new def', () => {
    const p = planCommit(input({ knownDefIds: ['self-buff-gold-targetdummy'] }));
    expect(p.overwritesExisting).toBe(true);
    expect(planCommit(input()).overwritesExisting).toBe(false);
  });
});

describe('planCommit — global scope', () => {
  it('writes the base id and targets the kind row', () => {
    const p = planCommit(input({ scope: 'global' }));
    expect(p.defId).toBe('self-buff-gold');
    expect(p.forkedFrom).toBeNull();
    expect(p.bindingTarget).toEqual({ cardId: null, kind: 'buffWave' });
  });

  // The blast radius, and the reason it excludes the row being written: "also affects" must mean OTHER
  // places, or the panel would always report at least one and the number would be meaningless.
  it('reports the other places the overwritten def is bound, excluding the target row', () => {
    const p = planCommit(input({ scope: 'global' }));
    expect(p.alsoAffects).toEqual([{ cardId: null, kind: 'attackExchange' }]);
  });
});

describe('planCommit — fanOut', () => {
  it('carries a non-default fanOut into the binding', () => {
    expect(planCommit(input({ fanOut: 'damaged' })).binding).toEqual({
      def: 'self-buff-gold-targetdummy',
      fanOut: 'damaged',
    });
  });

  // `primary` is the default, so it is written as an ABSENT key — matching every entry in bindings.json
  // that doesn't fan out. Writing it explicitly would work but would make the committed file noisier than
  // the ones already there.
  it('omits fanOut entirely when it is primary or unset', () => {
    expect(planCommit(input({ fanOut: 'primary' })).binding).toEqual({ def: 'self-buff-gold-targetdummy' });
    expect(planCommit(input({ fanOut: undefined })).binding).toEqual({ def: 'self-buff-gold-targetdummy' });
  });
});
