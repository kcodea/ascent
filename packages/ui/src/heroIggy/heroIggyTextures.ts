/**
 * The Iggy Blast's textures. It paints NOTHING of its own: every texture is one the hero attacks already paint once per
 * session (the shared live fire's puffs and glow, the Blast's glow / spark / ring, the Fire attack's thin shock ring and
 * scorch).
 *
 * THE WARD IS A PLACEHOLDER (owner rule 2026-10-07: no code-drawn props). Until the owner's painted hex-cell ward dome
 * lands, the ward is assembled from existing FX textures: the soft glow as its body, the thin shock ring as its rim, the
 * Blast's ring as its cell glow. When the painted dome arrives, load it here as `wardBody` (and, if it ships as layers,
 * `wardRim` / `wardCells`); the scene reads only these three slots.
 */
import { heroFireTextures } from '../heroFire/heroFireTextures';
import type { HeroIggyTextures } from './heroIggyScene';

let cached: HeroIggyTextures | null = null;

/** The session's textures, built on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroIggyTextures(): HeroIggyTextures | null {
  if (cached) return cached;
  const f = heroFireTextures();
  if (!f) return null;
  cached = {
    fire: f.fire, glow: f.glow, spark: f.spark, shock: f.shock, scorch: f.scorch,
    wardBody: f.glow, wardRim: f.shock, wardCells: f.ring,
  };
  return cached;
}
