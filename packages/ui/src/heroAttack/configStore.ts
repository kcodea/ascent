/**
 * A HERO ATTACK'S TUNED VALUES, as a small store (added 2026-09-29 with the three Rare attacks, which share it instead
 * of each repeating the same clamp / sanitize / localStorage block the Legendary styles carry inline).
 *
 * The convention is the Blast's: localStorage in DEV only, every value clamped on write AND on load (numbers into their
 * [min, max], colours `#rrggbb`, clips a short string), junk and unknown keys dropped; production always plays the
 * DEFAULTS. The preview-only keys (the tuner's Play buttons) are left out of Copy JSON.
 */
export type RangeTable<K extends string> = Record<K, readonly [number, number, number]>;

export interface ConfigStoreSpec<C extends object> {
  /** The localStorage key (DEV only). */
  key: string;
  defaults: C;
  /** [min, max, step] per NUMERIC key. */
  ranges: RangeTable<Extract<keyof C, string>> | Record<string, readonly [number, number, number]>;
  colorKeys: readonly string[];
  clipKeys: readonly string[];
  /** Keys the tuner's Play buttons read that never ship (left out of Copy JSON). */
  previewKeys?: readonly string[];
}

export interface ConfigStore<C extends object> {
  get(): C;
  /** One value made safe (undefined = not a key of this config). */
  clamp<K extends keyof C>(key: K, value: unknown): C[K] | undefined;
  sanitize(saved: unknown): C;
  set(key: keyof C, value: number | string): void;
  reset(): void;
  json(c?: C): string;
}

const HEX = /^#[0-9a-f]{6}$/i;

export function configStore<C extends object>(spec: ConfigStoreSpec<C>): ConfigStore<C> {
  const defs = spec.defaults as unknown as Record<string, unknown>;
  const ranges = spec.ranges as Record<string, readonly [number, number, number]>;
  const clamp = <K extends keyof C>(key: K, value: unknown): C[K] | undefined => {
    const k = key as string;
    if (!Object.prototype.hasOwnProperty.call(defs, k)) return undefined;
    const def = defs[k] as C[K];
    if (spec.colorKeys.includes(k)) {
      if (typeof value !== 'string') return def;
      const v = value.trim();
      return (HEX.test(v) ? v.toLowerCase() : def) as C[K];
    }
    if (spec.clipKeys.includes(k)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as C[K];
    const n = typeof value === 'number' ? value : Number(value);
    if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
    const r = ranges[k];
    if (!r) return def;
    return Math.min(r[1], Math.max(r[0], n)) as C[K];
  };
  const sanitize = (saved: unknown): C => {
    const out = { ...spec.defaults };
    if (!saved || typeof saved !== 'object') return out;
    for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
      const safe = clamp(k as keyof C, v);
      if (safe !== undefined) (out as Record<string, unknown>)[k] = safe;
    }
    return out;
  };
  let cfg: C = (() => {
    if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...spec.defaults };
    try { return sanitize(JSON.parse(localStorage.getItem(spec.key) ?? '{}')); } catch { return { ...spec.defaults }; }
  })();
  return {
    get: () => cfg,
    clamp,
    sanitize,
    set: (key, value) => {
      const safe = clamp(key, value);
      if (safe === undefined) return;
      cfg = { ...cfg, [key]: safe };
      if (!import.meta.env.DEV) return;
      try { localStorage.setItem(spec.key, JSON.stringify(cfg)); } catch { /* ignore */ }
    },
    reset: () => {
      cfg = { ...spec.defaults };
      try { localStorage.removeItem(spec.key); } catch { /* ignore */ }
    },
    json: (c: C = cfg) => {
      const ship = { ...c } as Record<string, unknown>;
      for (const k of spec.previewKeys ?? []) delete ship[k];
      return JSON.stringify(ship, null, 2);
    },
  };
}
