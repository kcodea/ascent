/**
 * The pack holo's place in the tear strip. Headless: `Shader.from` is string preprocessing + reflection (the compile
 * happens at draw time, which no test reaches), and meshes / geometry are GL-free until drawn.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMAdapter, Texture } from 'pixi.js';
import { holoHueFor } from './packHolo';
import { makeHoloMaterial } from './packHoloMesh';
import { StripMesh } from './stripMesh';

beforeAll(() => {
  const base = DOMAdapter.get();
  DOMAdapter.set({ ...base, createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement });
});

describe('the strip holo', () => {
  it('sits over the printed front and UNDER the lining back, the shade and the spec (a curl\'s back covers it)', () => {
    const tex = { front: new Texture(), back: new Texture(), shade: new Texture(), spec: new Texture() };
    const strip = new StripMesh(tex);
    const holo = strip.attachHolo(makeHoloMaterial(new Texture(), holoHueFor('ancient')));
    const kids = strip.view.children as unknown as { texture?: Texture }[];
    const at = (t: Texture) => kids.findIndex((c) => c.texture === t);
    const h = kids.indexOf(holo as unknown as { texture?: Texture });
    expect(h).toBe(at(tex.front) + 1);
    expect(h).toBeLessThan(at(tex.back));
    expect(h).toBeLessThan(at(tex.shade));
    expect(h).toBeLessThan(at(tex.spec));
    expect(holo.blendMode).toBe('add');
    expect(holo.visible).toBe(false); // until the scene shows it (after the mask loads)
  });

  it('shares the front\'s positions, so a back-facing triangle collapses on both', () => {
    const tex = { front: new Texture(), back: new Texture(), shade: new Texture(), spec: new Texture() };
    const strip = new StripMesh(tex);
    const holo = strip.attachHolo(makeHoloMaterial(new Texture(), holoHueFor('epic')));
    const front = (strip.view.children as unknown as { texture?: Texture; geometry: { positions: Float32Array } }[])
      .find((c) => c.texture === tex.front)!;
    expect(holo.geometry.positions).toBe(front.geometry.positions);
  });
});
