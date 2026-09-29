/**
 * A RIBBON TRAIL: one textured strip drawn along a projectile's own motion sampled BACK IN TIME (the Arcana technique),
 * so it follows any curve for free and collapses into the projectile when it stops. Added 2026-09-29 for the Rare
 * attacks (the Boomerang's teal trail).
 *
 * Perf: `TRAIL_PTS` x 2 vertices (under Pixi's 100-vertex batch limit, so it batches), the vertex array rewritten in
 * place every frame, the UVs and indices shared by every trail, scratch arrays reused. No allocation per frame.
 */
import { MeshSimple, type Container, type Texture } from 'pixi.js';
import type { Pt } from './easing';

export const TRAIL_PTS = 16;

let sharedUvs: Float32Array | null = null;
let sharedIdx: Uint32Array | null = null;

function uvs(): Float32Array {
  if (sharedUvs) return sharedUvs;
  const u = new Float32Array(TRAIL_PTS * 4);
  for (let j = 0; j < TRAIL_PTS; j++) {
    const x = 1 - j / (TRAIL_PTS - 1); // the head is u = 1 (full), the tail u = 0 (the texture fades it in)
    u[j * 4] = x; u[j * 4 + 1] = 0; u[j * 4 + 2] = x; u[j * 4 + 3] = 1;
  }
  sharedUvs = u;
  return u;
}

function indices(): Uint32Array {
  if (sharedIdx) return sharedIdx;
  const idx = new Uint32Array((TRAIL_PTS - 1) * 6);
  for (let j = 0; j < TRAIL_PTS - 1; j++) { const a = j * 2; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], j * 6); }
  sharedIdx = idx;
  return idx;
}

const px = new Float32Array(TRAIL_PTS);
const py = new Float32Array(TRAIL_PTS);

export class RibbonTrail {
  readonly mesh: MeshSimple;
  private readonly v: Float32Array;

  constructor(parent: Container, texture: Texture, tint: number, blend: 'normal' | 'add') {
    this.mesh = new MeshSimple({ texture, vertices: new Float32Array(TRAIL_PTS * 4), uvs: uvs(), indices: indices() });
    this.mesh.blendMode = blend;
    this.mesh.tint = tint;
    this.mesh.alpha = 0;
    parent.addChild(this.mesh);
    this.v = this.mesh.vertices as Float32Array;
  }

  /**
   * Draw the strip: `sample(ms)` gives the projectile's position `ms` into its motion; the trail spans `spanMs` behind
   * `now`, `width` px wide at the head tapering to nothing, at opacity `alpha`.
   */
  draw(sample: (ms: number) => Pt, now: number, spanMs: number, width: number, alpha: number): void {
    const step = spanMs / (TRAIL_PTS - 1);
    for (let j = 0; j < TRAIL_PTS; j++) {
      const p = sample(Math.max(0, now - j * step));
      px[j] = p.x; py[j] = p.y;
    }
    let lx = 0, ly = 1;
    const v = this.v;
    for (let j = 0; j < TRAIL_PTS; j++) {
      const a = Math.max(0, j - 1), b = Math.min(TRAIL_PTS - 1, j + 1);
      const tx = px[a]! - px[b]!, ty = py[a]! - py[b]!;
      const l = Math.hypot(tx, ty);
      if (l > 0.01) { lx = -ty / l; ly = tx / l; }
      const f = j / (TRAIL_PTS - 1);
      const h = width * 0.5 * (1 - f) * (0.55 + 0.45 * (1 - f));
      v[j * 4] = px[j]! + lx * h; v[j * 4 + 1] = py[j]! + ly * h;
      v[j * 4 + 2] = px[j]! - lx * h; v[j * 4 + 3] = py[j]! - ly * h;
    }
    this.mesh.alpha = Math.max(0, alpha);
    this.mesh.visible = alpha > 0.001;
  }

  hide(): void { this.mesh.alpha = 0; this.mesh.visible = false; }
}
