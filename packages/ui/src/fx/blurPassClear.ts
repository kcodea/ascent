import { BlurFilterPass, RendererType, TexturePool, type FilterSystem, type RenderSurface, type Texture } from 'pixi.js';

/**
 * PIXI'S BLUR PASS LEAVES ITS SCRATCH TEXTURE UNCLEARED ON WEBGL (R-PERF-FX-FILTER-AREA-01, perf pass 2026-11-18).
 *
 * `BlurFilterPass._applyOptimized` (pixi.js 8.19) ping-pongs between the input and a scratch texture taken from the
 * shared `TexturePool`, and on WebGL it never clears that scratch texture: each pass only overwrites the filter's own
 * frame. A pooled texture is a power-of-two sheet, so whatever an EARLIER, larger filter left outside the current
 * frame is still there, and the next pass's taps reach past the frame's right and bottom edges and pull it in.
 *
 * Nobody saw it while every particle filter covered the whole viewport: the frame was always the same 1920 x 1080
 * corner of the same sheet. With tight filter areas (`TIGHT_FILTERS`, filterStack.ts) frames of every size share the
 * sheets, and the leftovers showed as a faint L of stale glow along the right and bottom edge of a Bloom or Blur
 * (caught by the same-frame pixel diff, 2026-11-18). The legacy path cleared on its first pass; this restores exactly
 * that one clear and changes nothing else. Core `BlurFilter` and pixi-filters' `BloomFilter` both run this pass;
 * Kawase and Advanced Bloom clear their own targets.
 *
 * Returns false when the installed Pixi no longer has the method this was written against, in which case nothing is
 * patched and tight areas stay off (`tightAreasReady`), which is the old, safe behaviour.
 */
type PassInternals = {
  _uniforms: { uStrength: number };
  _calculateInitialStrength(): number;
  passes: number;
  _state: { blend: boolean };
  groups: Record<number, { setResource(resource: unknown, index: number): void }>;
  _blurUniforms: unknown;
  _applyOptimized(filterManager: FilterSystem, input: Texture, output: RenderSurface, clearMode: boolean): void;
};

let patched: boolean | null = null;

export function patchBlurPassClear(): boolean {
  if (patched !== null) return patched;
  const proto = BlurFilterPass.prototype as unknown as PassInternals;
  const original = proto._applyOptimized;
  const src = typeof original === 'function' ? Function.prototype.toString.call(original) : '';
  // The exact shape this replaces: a scratch texture from the pool, a halving strength, a WebGPU-only clear.
  if (typeof proto._calculateInitialStrength !== 'function' || !/getSameSizeTexture/.test(src) || !/uStrength\s*\*=\s*0?\.5/.test(src)) {
    patched = false;
    return false;
  }
  proto._applyOptimized = function applyOptimizedCleared(this: PassInternals, filterManager, input, output, clearMode): void {
    const self = this as unknown as BlurFilterPass;
    this._uniforms.uStrength = this._calculateInitialStrength();
    if (this.passes === 1) {
      filterManager.applyFilter(self, input, output, clearMode);
      return;
    }
    const tempTexture = TexturePool.getSameSizeTexture(input);
    let flip = input;
    let flop = tempTexture;
    this._state.blend = false;
    const renderer = filterManager.renderer;
    const isWebGPU = (renderer.type as RendererType) === RendererType.WEBGPU;
    const uboBatcher = isWebGPU ? (renderer.renderPipes as unknown as { uniformBatch: { getUboResource(u: unknown): unknown } }).uniformBatch : null;
    for (let i = 0; i < this.passes - 1; i++) {
      if (uboBatcher) this.groups[1]!.setResource(uboBatcher.getUboResource(this._blurUniforms), 0);
      // THE ONE CHANGE: the first write into the pooled scratch texture clears it (as the legacy path did).
      filterManager.applyFilter(self, flip, flop, i === 0 ? true : isWebGPU);
      const temp = flop;
      flop = flip;
      flip = temp;
      this._uniforms.uStrength *= 0.5;
    }
    if (uboBatcher) this.groups[1]!.setResource(uboBatcher.getUboResource(this._blurUniforms), 0);
    this._state.blend = true;
    filterManager.applyFilter(self, flip, output, clearMode);
    TexturePool.returnTexture(tempTexture);
  };
  patched = true;
  return true;
}

/** Tight filter areas are only safe once the blur pass clears its scratch texture. */
export function tightAreasReady(): boolean {
  return patched === true;
}
