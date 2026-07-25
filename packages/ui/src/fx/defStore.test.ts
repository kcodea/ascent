import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ART_DATA_URL_PREFIX,
  FX_DEF_VERSION,
  clearSession,
  coerceDef,
  isValidSlug,
  loadSession,
  parseDef,
  saveArt,
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
});
