import { describe, expect, it, vi } from 'vitest';
import { bindingFor, effectiveTables, parseTable, type FxBinding } from './bindings';
import { CARD_INDEX } from '@game/content';
import { CARD_FX } from './cardFx';
import { SCORE_DEFAULTS } from './score';

describe('parseTable', () => {
  it('accepts a well-formed table', () => {
    const t = parseTable({
      version: 1,
      kinds: { scCast: { def: 'spell-cast' } },
      cards: { bloodbinder: { scCast: { def: 'ruby-lance', fanOut: 'damaged' } } },
    });
    expect(t.kinds.scCast).toEqual({ def: 'spell-cast' });
    expect(t.cards.bloodbinder?.scCast).toEqual({ def: 'ruby-lance', fanOut: 'damaged' });
  });

  // Per-entry, not all-or-nothing: losing one binding must not cost the others.
  it('drops only the bad entry and keeps the rest, naming the key', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = parseTable({
      version: 1,
      kinds: { scCast: { def: 'spell-cast' }, buffWave: { def: 42 }, rally: { def: 'rally-link' } },
      cards: {},
    });
    expect(t.kinds.scCast).toEqual({ def: 'spell-cast' });
    expect(t.kinds.rally).toEqual({ def: 'rally-link' });
    expect(t.kinds.buffWave).toBeUndefined();
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]?.[0])).toContain('kinds.buffWave');
    err.mockRestore();
  });

  it('rejects an unknown fanOut', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = parseTable({ version: 1, kinds: { scCast: { def: 'x', fanOut: 'sideways' } }, cards: {} });
    expect(t.kinds.scCast).toBeUndefined();
    expect(String(err.mock.calls[0]?.[0])).toContain('fanOut');
    err.mockRestore();
  });

  it('returns empty tables for a wholly wrong shape', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseTable(null)).toEqual({ kinds: {}, cards: {} });
    expect(parseTable({ version: 1, kinds: [], cards: 'nope' })).toEqual({ kinds: {}, cards: {} });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  // Object.entries over JSON.parse output surfaces "__proto__" as a normal own key; assigning to it on a
  // plain object literal invokes the inherited Object.prototype.__proto__ setter instead of creating an own
  // property, which would silently rewrite the table's prototype rather than dropping the bad entry.
  it('drops a __proto__-keyed entry instead of polluting the table prototype', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const raw = JSON.parse('{"version":1,"kinds":{"__proto__":{"def":"evil"},"rally":{"def":"rally-link"}},"cards":{"__proto__":{"scCast":{"def":"evil"}}}}');
    const t = parseTable(raw);
    expect(t.kinds.rally).toEqual({ def: 'rally-link' });
    expect((t.kinds as Record<string, unknown>).__proto__).toBe(Object.prototype);
    expect(Object.getPrototypeOf(t.kinds)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(t.cards)).toBe(Object.prototype);
    expect(Object.keys(t.cards)).not.toContain('__proto__');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('bindingFor', () => {
  it('resolves a kind-level binding', () => {
    expect(bindingFor(null, 'scCast')).toEqual({ def: 'spell-cast' });
  });

  it('lets a card-level binding beat the kind default', () => {
    expect(bindingFor('bloodbinder', 'scCast')).toEqual({ def: 'ruby-lance', fanOut: 'damaged' });
  });

  it('falls back to the kind for a card with no entry at that kind', () => {
    expect(bindingFor('bloodbinder', 'shieldGain')).toEqual({ def: 'ward-gained' });
    expect(bindingFor('somethingelse', 'scCast')).toEqual({ def: 'spell-cast' });
  });

  it('returns null for a kind nothing is bound to', () => {
    expect(bindingFor(null, 'damage')).toBeNull();
    expect(bindingFor('bloodbinder', 'damage')).toBeNull();
  });
});

describe('effectiveTables', () => {
  it('exposes the file contents', () => {
    const t = effectiveTables();
    expect(t.kinds.scCast).toEqual({ def: 'spell-cast' });
    expect(Object.keys(t.cards)).toContain('bloodbinder');
  });

  it('hands out a copy — mutating the result cannot corrupt the module', () => {
    const t = effectiveTables();
    delete t.kinds.scCast;
    expect(effectiveTables().kinds.scCast).toEqual({ def: 'spell-cast' });
  });

  // The top-level delete above only proves the outer maps are copied. A leaf FxBinding is a plain object too
  // (an editor UI would reasonably write `binding.def = 'x'` in place after fetching one) — this proves the
  // leaves are copies as well, not shared references into the module's own table.
  it('hands out copies of the leaf bindings too — editing a field cannot corrupt the module', () => {
    const t = effectiveTables();
    t.kinds.scCast!.def = 'clobbered';
    expect(effectiveTables().kinds.scCast).toEqual({ def: 'spell-cast' });
  });
});

/**
 * TEMPORARY — delete together with `CARD_FX` and the `def:` literals in Task 4.
 *
 * bindings.json is introduced as an exact duplicate of the two literals it replaces, so that readers can be
 * repointed one at a time while both sources still agree. This test is what makes "exact" a fact rather than
 * a hope.
 */
describe('parity with the literals being replaced', () => {
  it('binds every kind → def pair SCORE_DEFAULTS does, and no others', () => {
    const fromScore: Record<string, FxBinding> = {};
    for (const [kind, cues] of Object.entries(SCORE_DEFAULTS)) {
      for (const c of cues) {
        if (c.ch !== 'fxDef' || !c.def) continue;
        fromScore[kind] = c.fanOut === undefined ? { def: c.def } : { def: c.def, fanOut: c.fanOut };
      }
    }
    expect(effectiveTables().kinds).toEqual(fromScore);
  });

  it('binds every card → kind → def entry CARD_FX does, and no others', () => {
    expect(effectiveTables().cards).toEqual(CARD_FX);
  });
});

/**
 * PERMANENT. A binding naming a def that does not exist is a silent no-op at runtime — `playDef` returns null
 * and nothing plays, which is indistinguishable from a binding nobody wired. That ambiguity cost a long
 * debugging session on Bloodbinder.
 */
describe('binding integrity', () => {
  it('every bound def id exists in the registry', async () => {
    await import('../fx/primitives');
    const { listDefs } = await import('../fx/fxDefs');
    const known = new Set(listDefs().map((d) => d.id));
    const t = effectiveTables();
    const missing: string[] = [];
    for (const [kind, b] of Object.entries(t.kinds)) if (!known.has(b.def)) missing.push(`${kind}:${b.def}`);
    for (const [cardId, byKind] of Object.entries(t.cards)) {
      for (const [kind, b] of Object.entries(byKind)) {
        if (b && !known.has(b.def)) missing.push(`${cardId}.${kind}:${b.def}`);
      }
    }
    expect(missing, `bindings naming defs that do not exist: ${missing.join(', ')}`).toEqual([]);
  });

  it('every key is a real moment kind and a real card id', () => {
    const kinds = new Set(Object.keys(SCORE_DEFAULTS));
    const t = effectiveTables();
    const bad: string[] = [];
    for (const kind of Object.keys(t.kinds)) if (!kinds.has(kind)) bad.push(`kinds.${kind}`);
    for (const [cardId, byKind] of Object.entries(t.cards)) {
      if (!(cardId in CARD_INDEX)) bad.push(`cards.${cardId}`);
      for (const kind of Object.keys(byKind)) if (!kinds.has(kind)) bad.push(`cards.${cardId}.${kind}`);
    }
    expect(bad, `keys that name nothing real: ${bad.join(', ')}`).toEqual([]);
  });
});
