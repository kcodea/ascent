/**
 * The Grand Finale's textures, painted ONCE per session on 2D canvases and kept. Since the third pass there is no
 * launcher and no painted object at all: everything on screen is particles drawn with the shared Blast and Arcana basics
 * (glow, spark, streak, ring, the four-point star) plus ONE soft texture of its own:
 *  - the PUFF: a soft, lumpy smoke puff (a few overlapping soft blobs, white, so it takes any tint), for the smoke that
 *    hangs and drifts after every burst and the wisps that rise off a singed portrait. About 36 KB of GPU memory.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroFireworksTextures } from './heroFireworksScene';

/** The puff's size in texture px (the scene's PUFF_PX). */
export const PUFF_TEX_PX = 96;

function paintPuff(D: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = D; c.height = D;
  const g = c.getContext('2d');
  if (!g) return null;
  // Fixed blobs (no randomness: the same puff every session), soft edged, denser in the middle.
  const blobs: [number, number, number, number][] = [
    [0.5, 0.52, 0.3, 0.55], [0.36, 0.46, 0.2, 0.45], [0.63, 0.42, 0.22, 0.45], [0.46, 0.66, 0.2, 0.4], [0.66, 0.62, 0.17, 0.35], [0.3, 0.6, 0.15, 0.3],
  ];
  for (const [x, y, r, a] of blobs) {
    const gr = g.createRadialGradient(x * D, y * D, 0, x * D, y * D, r * D);
    gr.addColorStop(0, `rgba(255,255,255,${a})`);
    gr.addColorStop(0.55, `rgba(255,255,255,${a * 0.45})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, D, D);
  }
  return c;
}

let cached: HeroFireworksTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroFireworksTextures(): HeroFireworksTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const puff = paintPuff(PUFF_TEX_PX);
  if (!base || !puff) return null;
  cached = { ...base, puff: new Texture({ source: new CanvasSource({ resource: puff }) }) };
  return cached;
}
