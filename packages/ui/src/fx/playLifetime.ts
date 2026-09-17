import type { FxDef } from './def';
import { getPrimitive } from './registry';

/**
 * The HONEST END of one `playDef` play — the per-def wall-clock ceiling that replaces a flat 15 s cap.
 *
 * ── the defect this closes ───────────────────────────────────────────────────────────────────────────
 * A play retires when its player reports `!isPlaying()`, which for a one-shot fire means "every layer's
 * `isComplete()` said so" (`player.ts`'s `firing` branch). That is the right contract — a burst whose shards
 * are authored to live 700 ms in a 600 ms def must play its shards out, not be cut at the def's nominal
 * length — but it leaves the runtime with exactly ONE backstop when a layer never completes: `PLAY_TIMEOUT_MS`,
 * 15 s of wall clock. The 2026-09-17 perf handoff read `fx:def:dice-land` at ~3,500 ticks and
 * `fx:def:spell-sparks` at ~5,600 against 600 ms defs; those turned out to be the per-frame label's call
 * count summed over EVERY play in the capture (≈25–30 plays each, ~150–260 frames per play at 240 Hz), not
 * a single play living for 15 s — but the point stands that a stuck play had 15 s to leak an updater, a
 * container and a live particle layer before anything noticed. The ceiling should be what the def itself
 * says its end is.
 *
 * ── what "honest" means ──────────────────────────────────────────────────────────────────────────────
 * Every layer's natural span is derived from the same params its primitive's `isComplete()` reads, so the
 * ceiling sits AT the def's own true completion — never inside it. Nothing authored is cut:
 *
 *   • a layer with an explicit `life` is torn down at `at + life` by the player (`syncLayer`), whatever its
 *     primitive — so that is its span;
 *   • `burst` fires one wave whose shards live `life` ms → `life`;
 *   • `emitter` / `smoke` emit for one `life` window and then drain for another → `2 × life`
 *     (`withinEmitWindow` + `emitterFireComplete`). NB an emitter's window is its OWN `life`, not the def's
 *     `duration` — `cia-hp`, `spell-target` and `ruby-target` are authored to keep emitting past their
 *     900–1000 ms durations, which is why this module does not (and must not) stop emission at `duration`;
 *   • `shockwave`, `custom`, `screen`, `beam`, `lightning` each carry their own timing params, mirrored here
 *     from their `isComplete()` arithmetic;
 *   • a primitive this module does not model (`ribbon` drains on a head-motion grace, `react` schedules
 *     DOM animations off the live board, `targeting`, anything new) is given the rest of the def plus a
 *     generous fixed tail, so an unmodelled layer can never be the one that gets cut.
 *
 * The result is floored at `duration + maxParticleLife` (the handoff's formula — the bound for the common
 * "particles outlive the def" case) and padded by `LIFETIME_GRACE_MS` so float drift, the one-frame head
 * wait a burst pays before its first wave, and a `speed`-scaled clock never land a legitimate play on the
 * ceiling. Everything here is in SIMULATED ms (the def's own frame, post-`scaleDef`); `playDef` divides by
 * the play's `speed` to get wall clock, and keeps the old 15 s as the absolute maximum.
 *
 * Pure given the registry, so it is unit-tested without a renderer (`playLifetime.test.ts`).
 */

/** Padding on top of the honest end. Generous on purpose: this is a leak backstop, not a cut. */
export const LIFETIME_GRACE_MS = 500;

/** The tail granted to a layer whose primitive this module does not model, past the def's duration. */
export const UNMODELLED_TAIL_MS = 3000;

const num = (params: Record<string, unknown>, key: string, fallback: number): number => {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

/** A primitive's declared default for `key`, or `fallback` when the registry (or the param) is absent. */
function specDefault(primitiveId: string, key: string, fallback: number): number {
  const spec = getPrimitive(primitiveId)?.params[key] as { default?: unknown } | undefined;
  return typeof spec?.default === 'number' ? spec.default : fallback;
}

type LayerLike = Pick<FxDef['layers'][number], 'primitive' | 'params' | 'at' | 'life'>;

/** The per-particle life a layer's particles are authored to, or 0 for a layer with no particles. */
export function particleLifeOf(layer: Pick<LayerLike, 'primitive' | 'params'>): number {
  const p = layer.params as Record<string, unknown>;
  if (layer.primitive === 'burst') return num(p, 'life', specDefault('burst', 'life', 450));
  if (layer.primitive === 'emitter') return num(p, 'life', specDefault('emitter', 'life', 700));
  if (layer.primitive === 'smoke') return num(p, 'life', specDefault('smoke', 'life', 1500));
  return 0;
}

/**
 * How long one layer runs past its `at`, in the def's own ms, before its primitive reports complete —
 * or `null` when the primitive is not modelled here (the caller grants the unmodelled tail).
 */
export function layerNaturalSpanMs(layer: LayerLike): number | null {
  if (layer.life !== undefined) return Math.max(0, layer.life);
  const p = layer.params as Record<string, unknown>;
  const d = (key: string, fallback: number): number => num(p, key, specDefault(layer.primitive, key, fallback));
  switch (layer.primitive) {
    case 'burst': return particleLifeOf(layer);
    case 'emitter':
    case 'smoke': return 2 * particleLifeOf(layer);
    case 'shockwave': {
      // Mirrors `shockwaveOneShotDurationSec`.
      const n = Math.max(1, Math.round(d('rings', 2)));
      const s = Math.max(1e-4, d('speed', 0.9));
      const delay = Math.max(0, d('ringDelay', 0));
      return 1000 * ((2 * n - 1) / (n * s) + ((n - 1) * delay) / s);
    }
    case 'custom': {
      const stagger = p.role === 'draw' ? (Math.max(1, d('count', 1)) - 1) * Math.max(0, d('staggerMs', 0)) : 0;
      return Math.max(1, d('durationMs', 800)) + stagger;
    }
    case 'screen': return Math.max(d('shakeMs', 300), d('flashMs', 250), 1);
    case 'beam': return d('travelMs', 200) + d('dwellMs', 520) + d('releaseMs', 200);
    case 'lightning': return d('travelMs', 300) + d('dwellMs', 620) + d('releaseMs', 180);
    default: return null;
  }
}

/**
 * PURE (given the registry): the simulated-ms ceiling for one play of `def` — see the module header.
 * Muted layers are already gone from the def `playDef` hands in (it passes `playableDef`'s output).
 */
export function playLifetimeMs(def: Pick<FxDef, 'duration' | 'layers'>): number {
  const duration = Number.isFinite(def.duration) && def.duration > 0 ? def.duration : 0;
  let maxParticleLife = 0;
  let naturalEnd = duration;
  for (const layer of def.layers) {
    const at = Number.isFinite(layer.at) && layer.at > 0 ? layer.at : 0;
    maxParticleLife = Math.max(maxParticleLife, particleLifeOf(layer));
    const span = layerNaturalSpanMs(layer);
    const end = span === null ? Math.max(duration, at) + UNMODELLED_TAIL_MS : at + span;
    if (end > naturalEnd) naturalEnd = end;
  }
  return Math.max(duration + maxParticleLife, naturalEnd) + LIFETIME_GRACE_MS;
}
