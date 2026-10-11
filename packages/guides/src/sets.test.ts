import { describe, expect, it } from 'vitest';
import { guideSetsFor, type SetFacts } from './sets';

const SETS: SetFacts[] = [
  { id: 'set2', cardIds: new Set(['a', 'b', 'c', 'spell']), tribes: ['beast', 'dwarf'] },
  { id: 'set3', cardIds: new Set(['a', 'b', 'spell']), tribes: ['beast', 'spirit'] },
];
const g = { core: ['a'], enablers: ['b'], mentions: ['spell'], tribes: ['beast'], pairsWith: [] };

describe('guideSetsFor (owner 2026-10-11: "any guides that still have all referenced cards can carry over")', () => {
  it('a guide whose every card and tribe exists in a set belongs to it', () => {
    expect(guideSetsFor(g, SETS)).toEqual(['set2', 'set3']);
  });
  it('one missing Core, Enabler or named card keeps it out of that set', () => {
    expect(guideSetsFor({ ...g, core: ['a', 'c'] }, SETS)).toEqual(['set2']);
    expect(guideSetsFor({ ...g, enablers: ['c'] }, SETS)).toEqual(['set2']);
    expect(guideSetsFor({ ...g, mentions: ['c'] }, SETS)).toEqual(['set2']);
  });
  it('a tribe or a pairs-with tribe missing from the roster keeps it out', () => {
    expect(guideSetsFor({ ...g, tribes: ['dwarf'] }, SETS)).toEqual(['set2']);
    expect(guideSetsFor({ ...g, pairsWith: ['spirit'] }, SETS)).toEqual(['set3']);
  });
  it('a Neutral guide (no tribes) only needs its cards', () => {
    expect(guideSetsFor({ ...g, tribes: [] }, SETS)).toEqual(['set2', 'set3']);
  });
  it('a card in no set belongs nowhere', () => {
    expect(guideSetsFor({ ...g, core: ['ghost'] }, SETS)).toEqual([]);
  });
});
