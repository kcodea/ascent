import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bindingFor,
  bindingsJson,
  effectiveTables,
  parseTable,
  resetBindings,
  setBinding,
  type FxBinding,
} from './bindings';
import { CARD_INDEX } from '@game/content';
import { CARD_FX } from './cardFx';
import { SCORE_DEFAULTS } from './score';

// The session patch is module-level shared state — a `setBinding` in one test would otherwise leak into
// every test that runs after it in this file, including the FILE-baseline assertions below that predate the
// override layer and know nothing about it.
beforeEach(() => resetBindings());

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

  // The two cases above cover the top-level `kinds` loop and the `cards` card-id loop; this covers the third
  // site — the per-card KIND loop — plus `constructor`/`prototype`, which are refused alongside `__proto__`
  // but never separately exercised.
  it('drops unsafe keys in the per-card kind loop too', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const raw = JSON.parse(
      '{"version":1,"kinds":{},"cards":{"bloodbinder":{"__proto__":{"def":"evil"},"constructor":{"def":"evil"},"prototype":{"def":"evil"},"rally":{"def":"rally-link"}}}}',
    );
    const t = parseTable(raw);
    expect(t.cards.bloodbinder).toEqual({ rally: { def: 'rally-link' } });
    expect(Object.getPrototypeOf(t.cards.bloodbinder)).toBe(Object.prototype);
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

// The suite runs in bare node (no jsdom), so `localStorage` is undefined and setBinding/resetBindings's
// try/catch swallows every access — same situation score.test.ts documents for `overrides`. Install a
// minimal stub only for the one test that needs to observe the real persistence path.
const withLocalStorage = (fn: () => void): void => {
  const store = new Map<string, string>();
  const g = globalThis as unknown as { localStorage?: unknown };
  const had = 'localStorage' in g;
  const prev = g.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    configurable: true,
    writable: true,
  });
  try {
    fn();
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', { value: prev, configurable: true, writable: true });
    else delete g.localStorage;
  }
};

describe('session overrides', () => {
  beforeEach(() => resetBindings());

  it('a kind-level override wins over the file', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    expect(bindingFor(null, 'scCast')).toEqual({ def: 'test-red-blast' });
  });

  it('a card-level override wins over both the file and a kind override', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    setBinding('bloodbinder', 'scCast', { def: 'ember-lance', fanOut: 'damaged' });
    expect(bindingFor('bloodbinder', 'scCast')).toEqual({ def: 'ember-lance', fanOut: 'damaged' });
    expect(bindingFor('somethingelse', 'scCast')).toEqual({ def: 'test-red-blast' });
  });

  // A tombstone, not an absent key. Against a file baseline "absent" means INHERIT, so without an explicit
  // null there is no way to say "this card should play nothing here" as a live change.
  it('binding to null unbinds, and does NOT fall through to the kind', () => {
    setBinding('bloodbinder', 'scCast', null);
    expect(bindingFor('bloodbinder', 'scCast')).toBeNull();
    expect(bindingFor('somethingelse', 'scCast')).toEqual({ def: 'spell-cast' });
  });

  it('a kind-level tombstone unbinds the kind', () => {
    setBinding(null, 'scCast', null);
    expect(bindingFor(null, 'scCast')).toBeNull();
  });

  // The tombstone must beat a LIVE kind override, not just the committed file's default. Today's early
  // return makes that true by construction; this pins it, because the obvious "simplification" to a single
  // nullish chain (`overridden ?? patch.kinds[kind] ?? …`) would silently reintroduce the fallthrough.
  it('a card tombstone beats a live kind-level override, not just the file default', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    setBinding('bloodbinder', 'scCast', null);
    expect(bindingFor('bloodbinder', 'scCast')).toBeNull();
    expect(bindingFor('somethingelse', 'scCast')).toEqual({ def: 'test-red-blast' });
  });

  it('resetBindings returns everything to the file baseline', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    setBinding('bloodbinder', 'scCast', null);
    resetBindings();
    expect(bindingFor(null, 'scCast')).toEqual({ def: 'spell-cast' });
    expect(bindingFor('bloodbinder', 'scCast')).toEqual({ def: 'ruby-lance', fanOut: 'damaged' });
  });

  it('effectiveTables reflects overrides and drops tombstoned entries', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    setBinding('bloodbinder', 'scCast', null);
    const t = effectiveTables();
    expect(t.kinds.scCast).toEqual({ def: 'test-red-blast' });
    expect(t.cards.bloodbinder).toBeUndefined();
  });

  it('persists to localStorage under its own key', () => {
    withLocalStorage(() => {
      setBinding(null, 'scCast', { def: 'test-red-blast' });
      expect(localStorage.getItem('ascent.fxBindings')).toContain('test-red-blast');
      resetBindings();
      expect(localStorage.getItem('ascent.fxBindings')).toBeNull();
    });
  });
});

describe('bindingsJson', () => {
  beforeEach(() => resetBindings());

  // What commit writes must be what the session was playing, or the button lies.
  it('round-trips: the committed text re-parses to the same resolution', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    setBinding('bloodbinder', 'scCast', null);
    const parsed = parseTable(JSON.parse(bindingsJson()));
    expect(parsed.kinds.scCast).toEqual({ def: 'test-red-blast' });
    expect(parsed.cards.bloodbinder).toBeUndefined();
    expect(parsed.kinds.rally).toEqual({ def: 'rally-link' });
  });

  it('emits version 1, sorted keys, and a trailing newline', () => {
    const text = bindingsJson();
    expect(JSON.parse(text).version).toBe(1);
    expect(text.endsWith('\n')).toBe(true);
    const kinds = Object.keys(JSON.parse(text).kinds);
    expect(kinds).toEqual([...kinds].sort());
  });
});
