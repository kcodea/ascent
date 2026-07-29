import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ART_DATA_URL_PREFIX,
  FX_DEF_VERSION,
  clearCommitNote,
  clearSession,
  coerceDef,
  isValidSlug,
  loadCommitNote,
  loadSession,
  parseDef,
  saveArt,
  saveBindings,
  saveCommitNote,
  saveDef,
  saveSession,
  slugify,
  toStoredDef,
  type StoredFxDef,
} from './defStore';
import { clearPrimitives, registerPrimitive } from './registry';
import type { FxPrimitive } from './primitive';

/**
 * `defStore` is the untrusted-input boundary for defs: clipboard pastes, files on disk, defs authored on
 * another machine against a different build. So the contract these tests hold is TOTALITY — `parseDef` and
 * `coerceDef` never throw, never return a half-valid layer, and never let a foreign param through
 * unchecked. The write path is tested against a stubbed `fetch` (there is no dev server in vitest) and the
 * session path against the real `localStorage` when present, plus explicit throw-on-access stubs.
 */

const stub: FxPrimitive = {
  id: 'test-prim',
  params: {
    size: { kind: 'slider', label: 'Size', min: 0, max: 10, step: 1, default: 4 },
    on: { kind: 'toggle', label: 'On', default: true },
    mode: { kind: 'enum', label: 'Mode', options: ['a', 'b'], default: 'a' },
  },
  spawn: () => ({ update: () => {}, setParams: () => {}, destroy: () => {} }),
};

beforeEach(() => {
  clearPrimitives();
  registerPrimitive(stub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearSession();
});

const defJson = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    version: 1,
    id: 'crit-impact',
    duration: 1000,
    layers: [{ primitive: 'test-prim', anchor: 'target', at: 0, life: 400, params: { size: 7 } }],
    ...over,
  });

describe('slugify / isValidSlug', () => {
  it('lowercases and dashes spaces + underscores', () => {
    expect(slugify('Crit Impact')).toBe('crit-impact');
    expect(slugify('crit_impact')).toBe('crit-impact');
  });

  it('strips everything outside [a-z0-9-] and collapses dash runs', () => {
    expect(slugify('Crit!! Impact??')).toBe('crit-impact');
    expect(slugify('a///b')).toBe('ab');
    expect(slugify('a -- b')).toBe('a-b');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugify('  --hit--  ')).toBe('hit');
    expect(slugify('../evil')).toBe('evil');
  });

  it('caps at 64 characters without leaving a trailing dash', () => {
    const long = slugify(`${'a'.repeat(64)} tail`);
    expect(long.length).toBe(64);
    expect(long.endsWith('-')).toBe(false);
    expect(isValidSlug(long)).toBe(true);
  });

  it('returns an empty string when nothing usable is left, rather than inventing a name', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('')).toBe('');
    expect(isValidSlug('')).toBe(false);
  });

  it('accepts exactly the slug grammar', () => {
    expect(isValidSlug('crit-impact')).toBe(true);
    expect(isValidSlug('a')).toBe(true);
    expect(isValidSlug('9lives')).toBe(true);
    expect(isValidSlug('-lead')).toBe(false);
    expect(isValidSlug('Trail')).toBe(false);
    expect(isValidSlug('a/b')).toBe(false);
    expect(isValidSlug('..')).toBe(false);
    expect(isValidSlug('a'.repeat(65))).toBe(false);
  });
});

describe('parseDef', () => {
  it('round-trips a well-formed def', () => {
    const def = parseDef(defJson());
    expect(def).not.toBeNull();
    expect(def?.id).toBe('crit-impact');
    expect(def?.version).toBe(FX_DEF_VERSION);
    expect(def?.duration).toBe(1000);
    expect(def?.layers).toHaveLength(1);
    expect(def?.layers[0].params.size).toBe(7);
    expect(def?.layers[0].life).toBe(400);
  });

  it('never throws — malformed JSON is null, not an exception', () => {
    expect(() => parseDef('{ not json')).not.toThrow();
    expect(parseDef('{ not json')).toBeNull();
    expect(parseDef('')).toBeNull();
  });

  it('returns null only when the input is not a def at all', () => {
    expect(parseDef('null')).toBeNull();
    expect(parseDef('42')).toBeNull();
    expect(parseDef('"a string"')).toBeNull();
    expect(parseDef('[]')).toBeNull();
    expect(parseDef('{}')).toBeNull(); // no duration, no layers
    expect(parseDef('{"duration":100}')).toBeNull(); // no layers array
    expect(parseDef('{"layers":[]}')).toBeNull(); // no numeric duration
    expect(parseDef('{"duration":"1000","layers":[]}')).toBeNull();
    expect(parseDef('{"duration":100,"layers":{}}')).toBeNull();
  });

  it('drops layers whose primitive this build does not have', () => {
    const def = parseDef(
      defJson({
        layers: [
          { primitive: 'from-the-future', anchor: 'target', at: 0, params: {} },
          { primitive: 'test-prim', anchor: 'source', at: 10, params: {} },
        ],
      }),
    );
    expect(def?.layers.map((l) => l.primitive)).toEqual(['test-prim']);
  });

  it('coerces foreign and out-of-range params to the primitive\'s own defaults', () => {
    const def = parseDef(
      defJson({
        layers: [
          {
            primitive: 'test-prim',
            anchor: 'target',
            at: 0,
            params: { size: 999, on: 'yes', mode: 'z', bogus: { deep: true } },
          },
        ],
      }),
    );
    const params = def?.layers[0].params;
    expect(params?.size).toBe(10); // clamped to the slider's max
    expect(params?.on).toBe(true); // wrong type → default
    expect(params?.mode).toBe('a'); // not an option → default
    expect(params?.bogus).toBeUndefined(); // foreign key dropped entirely
  });

  it('defaults a missing/invalid anchor, `at`, and version', () => {
    const def = parseDef('{"duration":500,"layers":[{"primitive":"test-prim"}]}');
    expect(def?.version).toBe(1);
    expect(def?.id).toBe('untitled');
    expect(def?.layers[0].anchor).toBe('target');
    expect(def?.layers[0].at).toBe(0);
    expect(def?.layers[0].params.size).toBe(4);
  });

  it('keeps `life` only when it is a finite number', () => {
    const keep = parseDef(defJson({ layers: [{ primitive: 'test-prim', at: 0, life: 250 }] }));
    expect(keep?.layers[0].life).toBe(250);
    for (const life of ['400', null, Number.NaN, -5]) {
      const def = parseDef(defJson({ layers: [{ primitive: 'test-prim', at: 0, life }] }));
      expect(def?.layers[0], `life: ${String(life)}`).not.toHaveProperty('life');
    }
  });

  it('clamps a negative duration and `at` rather than rejecting the def', () => {
    const def = parseDef(defJson({ duration: -20, layers: [{ primitive: 'test-prim', at: -5 }] }));
    expect(def?.duration).toBe(0);
    expect(def?.layers[0].at).toBe(0);
  });

  it('repairs an unusable id into a slug (a def can never name a path)', () => {
    expect(parseDef(defJson({ id: '../../etc/passwd' }))?.id).toBe('etcpasswd');
    expect(parseDef(defJson({ id: 'Crit Impact' }))?.id).toBe('crit-impact');
    expect(parseDef(defJson({ id: 42 }))?.id).toBe('untitled');
    expect(parseDef(defJson({ id: '!!!' }))?.id).toBe('untitled');
  });

  it('loads a def declaring a future version rather than refusing it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const def = parseDef(defJson({ version: 99 }));
    expect(def?.version).toBe(FX_DEF_VERSION);
    warn.mockRestore();
  });

  it('survives every shape of junk thrown at it', () => {
    const junk = [
      '{"duration":1,"layers":[null]}',
      '{"duration":1,"layers":[[]]}',
      '{"duration":1,"layers":[{"primitive":1}]}',
      '{"duration":1,"layers":[{"primitive":"test-prim","params":[1,2]}]}',
      '{"duration":1,"layers":[{"primitive":"test-prim","params":null}]}',
      '{"duration":1e400,"layers":[]}',
    ];
    for (const j of junk) {
      expect(() => parseDef(j), j).not.toThrow();
    }
    expect(parseDef('{"duration":1,"layers":[null]}')?.layers).toEqual([]);
    expect(parseDef('{"duration":1e400,"layers":[]}')).toBeNull(); // Infinity is not a duration
  });
});

describe('coerceDef / toStoredDef', () => {
  it('coerceDef takes an already-parsed value (the registry\'s path)', () => {
    expect(coerceDef({ duration: 100, layers: [] })?.duration).toBe(100);
    expect(coerceDef(undefined)).toBeNull();
  });

  it('toStoredDef stamps the current schema version', () => {
    const def = toStoredDef('x', 500, []);
    expect(def).toEqual({ version: FX_DEF_VERSION, id: 'x', duration: 500, layers: [] });
  });

  // `seed` is OPTIONAL on purpose — that optionality is why the schema version is NOT bumped: every def
  // written before the seed control still loads, and "no seed" keeps meaning "roll fresh every time",
  // exactly what an unlocked composition means in the workbench.

  it('toStoredDef writes a seed only when one is supplied', () => {
    expect(toStoredDef('x', 500, [], 4242).seed).toBe(4242);
    expect('seed' in toStoredDef('x', 500, [])).toBe(false);
    expect('seed' in toStoredDef('x', 500, [], Number.NaN)).toBe(false);
  });

  it('coerceDef keeps a finite seed', () => {
    expect(coerceDef({ duration: 100, layers: [], seed: 12345 })?.seed).toBe(12345);
    expect(coerceDef({ duration: 100, layers: [], seed: 0 })?.seed).toBe(0);
    expect(coerceDef({ duration: 100, layers: [], seed: -7 })?.seed).toBe(-7);
  });

  it('coerceDef DROPS an unusable seed rather than repairing it into a wrong one', () => {
    for (const seed of [Number.NaN, '5', null, Infinity, {}, [1]]) {
      const def = coerceDef({ duration: 100, layers: [], seed });
      expect('seed' in def!, `seed: ${JSON.stringify(seed)}`).toBe(false);
    }
  });

  it('a def with NO seed still loads (every pre-seed def stays valid)', () => {
    const def = parseDef(defJson());
    expect(def).not.toBeNull();
    expect('seed' in def!).toBe(false);
    expect(def?.version).toBe(FX_DEF_VERSION); // NOT bumped — optionality is the whole migration
  });

  it('round-trips a layer\'s authoring-only `muted` flag, keeping it only when literally true', () => {
    const def = parseDef(
      defJson({
        layers: [
          { primitive: 'test-prim', at: 0, muted: true },
          { primitive: 'test-prim', at: 0, muted: 'yes' },
          { primitive: 'test-prim', at: 0 },
        ],
      }),
    );
    expect(def?.layers[0].muted).toBe(true);
    expect('muted' in def!.layers[1]).toBe(false);
    expect('muted' in def!.layers[2]).toBe(false);
  });
});

describe('coerceDef — label and tags', () => {
  const base = { version: 1, id: 'x', duration: 500, layers: [] };

  it('carries a string label and string tags through', () => {
    const def = coerceDef({ ...base, label: 'Ember Lance', tags: ['impact', 'spell'] });
    expect(def?.label).toBe('Ember Lance');
    expect(def?.tags).toEqual(['impact', 'spell']);
  });

  // Absent is the norm — 20 committed defs have neither — so an untouched def must serialise exactly as it
  // did before these fields existed.
  it('OMITS both when absent, rather than storing empty values', () => {
    const def = coerceDef(base);
    expect('label' in (def ?? {})).toBe(false);
    expect('tags' in (def ?? {})).toBe(false);
  });

  // The trim is real, not cosmetic: a surviving value is STORED trimmed, so a label typed with a stray
  // trailing space can't produce a second, visually identical entry in the browser's search results.
  it('trims a surviving label and surviving tags', () => {
    const def = coerceDef({ ...base, label: '  Ember Lance  ', tags: ['  impact  '] });
    expect(def?.label).toBe('Ember Lance');
    expect(def?.tags).toEqual(['impact']);
  });

  it('drops a non-string label and trims a blank one to an omission', () => {
    expect('label' in (coerceDef({ ...base, label: 42 }) ?? {})).toBe(false);
    expect('label' in (coerceDef({ ...base, label: '   ' }) ?? {})).toBe(false);
  });

  it('drops non-string tags individually, keeping the usable ones', () => {
    expect(coerceDef({ ...base, tags: ['ok', 7, null, 'fine'] })?.tags).toEqual(['ok', 'fine']);
  });

  it('drops a tags field that is not an array, and an array that empties out', () => {
    expect('tags' in (coerceDef({ ...base, tags: 'impact' }) ?? {})).toBe(false);
    expect('tags' in (coerceDef({ ...base, tags: [1, 2] }) ?? {})).toBe(false);
  });
});

describe('saveDef / saveArt', () => {
  const def: StoredFxDef = { version: 1, id: 'crit-impact', duration: 100, layers: [] };
  const png = `${ART_DATA_URL_PREFIX}iVBORw0KGgo=`;

  it('POSTs the def as JSON text and reports the written path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ ok: true, path: 'packages/ui/src/fx/defs/crit-impact.json' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await saveDef(def);
    expect(res).toEqual({ ok: true, path: 'packages/ui/src/fx/defs/crit-impact.json' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/__fx/def');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { id: string; json: string };
    expect(body.id).toBe('crit-impact');
    expect(JSON.parse(body.json)).toEqual(def);
  });

  it('rejects a bad name before any request goes out', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await saveDef({ ...def, id: '../evil' })).ok).toBe(false);
    expect((await saveArt('../evil', png)).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects art that is not a PNG data URL before any request goes out', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await saveArt('ember', 'data:image/jpeg;base64,zzz');
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a 4xx reason instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 413, json: () => Promise.resolve({ ok: false, error: 'Too big.' }) }),
    );
    expect(await saveDef(def)).toEqual({ ok: false, error: 'Too big.' });
  });

  it('degrades when the dev server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));
    const res = await saveDef(def);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain('Failed to fetch');
  });

  it('degrades when the response is not JSON at all (no endpoint registered)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 404, json: () => Promise.reject(new Error('not json')) }),
    );
    const res = await saveDef(def);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain('404');
  });

  it('never throws, whatever fetch does', async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('synchronous explosion');
    });
    await expect(saveDef(def)).resolves.toMatchObject({ ok: false });
    await expect(saveArt('ember', png)).resolves.toMatchObject({ ok: false });
  });
});

describe('saveBindings', () => {
  it('POSTs the serialised table to /__fx/bindings and reports ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ ok: true, path: 'packages/ui/src/choreo/bindings.json' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await saveBindings('{"version":1,"kinds":{},"cards":{}}');
    expect(res).toEqual({ ok: true, path: 'packages/ui/src/choreo/bindings.json' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/__fx/bindings');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { json: string };
    expect(body).toEqual({ json: '{"version":1,"kinds":{},"cards":{}}' });
  });

  it('degrades when the dev server is unreachable, same as saveDef', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));
    const res = await saveBindings('{"version":1,"kinds":{},"cards":{}}');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain('Failed to fetch');
  });
});

describe('session autosave', () => {
  // The node test environment has no `localStorage`, so the round-trip cases run against a minimal
  // in-memory stand-in — the same seam the hostile/absent-storage cases exercise from the other side.
  function memoryStorage(): Storage {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: (i: number) => [...map.keys()][i] ?? null,
      get length() {
        return map.size;
      },
    } as Storage;
  }

  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));

  it('round-trips arbitrary state', () => {
    saveSession({ duration: 900, layers: [{ primitive: 'test-prim' }] });
    expect(loadSession<{ duration: number }>()?.duration).toBe(900);
    clearSession();
    expect(loadSession()).toBeNull();
  });

  it('is null when nothing has been saved', () => {
    clearSession();
    expect(loadSession()).toBeNull();
  });

  it('returns null (never throws) on a corrupted snapshot', () => {
    localStorage.setItem('ascent.fx.session.v1', '{ broken');
    expect(loadSession()).toBeNull();
  });

  it('silently no-ops when storage throws (private mode / quota)', () => {
    const hostile = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    vi.stubGlobal('localStorage', hostile);
    expect(() => saveSession({ a: 1 })).not.toThrow();
    expect(loadSession()).toBeNull();
    expect(() => clearSession()).not.toThrow();
  });

  it('silently no-ops when there is no storage at all (headless)', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => saveSession({ a: 1 })).not.toThrow();
    expect(loadSession()).toBeNull();
    expect(() => clearSession()).not.toThrow();
  });

  // The commit confirmation rides the same storage seam, for a different reason: committing writes
  // `bindings.json`, which forces a full page reload, so the note has to outlive the component that set it.
  describe('commit note', () => {
    it('round-trips, and clearing means the note shows exactly once', () => {
      saveCommitNote('Committed → bolt-heavy · src/fx/bindings.json');
      expect(loadCommitNote()).toBe('Committed → bolt-heavy · src/fx/bindings.json');
      clearCommitNote();
      expect(loadCommitNote()).toBeNull();
    });

    it('is null when nothing has been parked', () => {
      expect(loadCommitNote()).toBeNull();
    });

    it('treats an empty string as no note', () => {
      saveCommitNote('');
      expect(loadCommitNote()).toBeNull();
    });

    it('is independent of the session snapshot', () => {
      saveSession({ duration: 900 });
      saveCommitNote('Committed → x · y');
      clearSession();
      expect(loadCommitNote()).toBe('Committed → x · y');
    });

    it('silently no-ops when storage is hostile or absent', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('quota');
        },
        removeItem: () => {
          throw new Error('denied');
        },
      });
      expect(() => saveCommitNote('n')).not.toThrow();
      expect(loadCommitNote()).toBeNull();
      expect(() => clearCommitNote()).not.toThrow();

      vi.stubGlobal('localStorage', undefined);
      expect(() => saveCommitNote('n')).not.toThrow();
      expect(loadCommitNote()).toBeNull();
      expect(() => clearCommitNote()).not.toThrow();
    });
  });
});

/**
 * The travel arc's bow. This one gets its own block because `0` is a MEANINGFUL value here — it is the
 * straight-line laser the field exists to make expressible — so every "is it set?" check in this path has to
 * be `!== null` rather than truthy. A truthiness bug would look exactly like the control doing nothing.
 */
describe('coerceDef — layer bow', () => {
  const withBow = (bow: unknown): unknown =>
    coerceDef({
      duration: 100,
      layers: [{ primitive: 'test-prim', anchor: 'travel', at: 0, bow, params: {} }],
    })?.layers[0].bow;

  it('keeps an explicit 0 — the straight line must survive coercion', () => {
    expect(withBow(0)).toBe(0);
  });

  it('keeps ordinary and negative bows', () => {
    expect(withBow(0.5)).toBe(0.5);
    expect(withBow(-0.4)).toBe(-0.4);
  });

  it('clamps an out-of-range bow instead of rejecting it', () => {
    expect(withBow(50)).toBe(1);
    expect(withBow(-50)).toBe(-1);
  });

  // A junk value must become an OMISSION (→ the default arc), never a 0 — falling back to a laser nobody
  // asked for would silently restyle an effect on a hand-edit typo.
  it('drops a junk bow so the default arc applies', () => {
    expect(withBow('straight')).toBeUndefined();
    expect(withBow(Number.NaN)).toBeUndefined();
    expect(withBow(null)).toBeUndefined();
    expect(withBow(undefined)).toBeUndefined();
  });

  // Every def written before this field existed must keep the arc it was authored with.
  it('leaves bow absent when the layer never mentioned it', () => {
    const def = coerceDef({
      duration: 100,
      layers: [{ primitive: 'test-prim', anchor: 'travel', at: 0, params: {} }],
    });
    expect(def?.layers[0]).not.toHaveProperty('bow');
  });
});
