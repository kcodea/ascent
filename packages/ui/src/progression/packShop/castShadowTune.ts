/**
 * THE COUNTER PACKS' CAST SHADOW, as shipped, and a DEV tuner over it (owner 2026-11-27: "can you add a tuner for me to
 * adjust the position of the x and y of the shadow, the blur amount, size, and opacity?"). The tuned values live in
 * localStorage and apply live (the scene reads them every frame; a blur change repaints the shadow's texture). A shipped
 * build never reads them.
 *
 * `x` / `y`: how far the shadow is pushed right / toward the viewer, as shares of the pack's height. `blur`: its soft
 * edge, px on its 128 px texture. `w` / `h`: its size against the pack's own outline. `alpha`: its strength at rest.
 */
export interface CastShadowTune { x: number; y: number; blur: number; w: number; h: number; alpha: number }

// owner 2026-11-27, tuned live: "these are perfect"
export const CAST_SHADOW_SHIPPED: Readonly<CastShadowTune> = { x: 0, y: -0.015, blur: 2, w: 0.96, h: 0.98, alpha: 0.69 };

const KEY = 'ascent.dev.packCastShadow';
const DEV = import.meta.env.DEV;
const FIELDS = Object.keys(CAST_SHADOW_SHIPPED) as (keyof CastShadowTune)[];

let current: CastShadowTune | null = null;
const listeners = new Set<(t: Readonly<CastShadowTune>) => void>();

function load(): CastShadowTune {
  const t: CastShadowTune = { ...CAST_SHADOW_SHIPPED };
  if (!DEV) return t;
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (raw && typeof raw === 'object') {
      for (const f of FIELDS) {
        const v = (raw as Record<string, unknown>)[f];
        if (typeof v === 'number' && Number.isFinite(v)) t[f] = v;
      }
    }
  } catch { /* nothing stored */ }
  return t;
}

/** The cast shadow's values now (the shipped ones, or the dev tuner's). The same object every call until a change. */
export function castShadowTune(): Readonly<CastShadowTune> {
  if (!current) current = load();
  return current;
}

/** Dev tuner: change some values (null: back to what ships). Tells every listener. */
export function setCastShadowTune(next: Partial<CastShadowTune> | null): void {
  if (!DEV) return;
  current = next === null ? { ...CAST_SHADOW_SHIPPED } : { ...castShadowTune(), ...next };
  try {
    if (next === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, JSON.stringify(current));
  } catch { /* storage is full or blocked */ }
  for (const fn of listeners) fn(current);
}

/** Hear every change (the scene repaints the shadow's blur). Returns the unsubscribe. */
export function onCastShadowTune(fn: (t: Readonly<CastShadowTune>) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
