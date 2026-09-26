import type { AncientId } from '@game/sim';
import { canPlayDefs, playDef } from '../fx/playDef';
import { getDef, registerSavedDef } from '../fx/fxDefs';
import { ancientColor, getAncientsConfig } from './ancientsConfig';

/**
 * THE ANCIENTS' SMOKE (owner 2026-09-25: "use colored smoke and pixi to enhance this entire animation"). Pixi defs,
 * pooled particles, capped rates — never DOM paint:
 *  · `ancient-smoke`       an arrival / slam puff billowing up, in the Ancient's OWN colour;
 *  · `ancient-haze`        the settled state's faint slow haze behind each card (a LOOPED play, retired on unmount);
 *  · `ancient-slam`        the landing: a flat gold shockwave + dust;
 *  · `ancient-gate-smoke`  the eruption's violet/gold burst from the hero power.
 * The two coloured ones are recoloured per Ancient: a variant def (`<base>--<ancient>`) is registered at runtime from
 * the committed base with the Ancient's palette (the tuner's colour), so each Ancient's smoke is its own colour even
 * when two play at once. Size / amount / lifetime come from the ✦ Ancients "Smoke" dials (`scale` / `intensity` /
 * `time` on the play).
 */
type Pt = { x: number; y: number };

function shade(hex: string, k: number): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const mix = (c: number): number => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

const registered = new Map<string, string>(); // variant id → the colour it was built with
function variantId(base: 'ancient-smoke' | 'ancient-haze', id: AncientId): string {
  const vid = `${base}--${id}`;
  const col = ancientColor(id);
  if (registered.get(vid) === col) return vid;
  const def = getDef(base);
  if (!def) return base;
  const palette = [shade(col, -0.35), shade(col, 0), shade(col, 0.3), shade(col, 0.65)]; // additive: lit, not muddy
  registerSavedDef({ ...def, id: vid, layers: def.layers.map((l) => ({ ...l, params: { ...l.params, palette } })) });
  registered.set(vid, col);
  return vid;
}

function smokeOpts(): { scale: number; intensity: number; time: number } {
  const c = getAncientsConfig();
  return { scale: c.smokeSize, intensity: c.smokeAmount, time: c.smokeLife };
}

/** A coloured puff (arrival / slam) — or, with `loop`, the settled haze; returns its retire for a looped play. */
export function ancientSmoke(kind: 'puff' | 'haze', id: AncientId, at: Pt): (() => void) | null {
  if (!canPlayDefs() || getAncientsConfig().smokeAmount <= 0) return null;
  const defId = variantId(kind === 'haze' ? 'ancient-haze' : 'ancient-smoke', id);
  return playDef(defId, { target: at }, { ...smokeOpts(), loop: kind === 'haze' }) ?? null;
}

/** The slam's landing: a flat gold shockwave + dust at `at`, scaled by the slam strength. */
export function ancientSlam(at: Pt): void {
  if (!canPlayDefs()) return;
  playDef('ancient-slam', { target: at }, { scale: Math.max(0.3, getAncientsConfig().slamStrength) });
}

/** The eruption's violet/gold smoke burst from the hero power. */
export function ancientGateSmoke(at: Pt): void {
  if (!canPlayDefs() || getAncientsConfig().smokeAmount <= 0) return;
  playDef('ancient-gate-smoke', { target: at }, smokeOpts());
}
