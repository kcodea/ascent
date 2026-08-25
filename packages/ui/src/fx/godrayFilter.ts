/**
 * A GodrayFilter with ONE fix baked in: its output alpha tracks the ray brightness instead of being forced
 * fully opaque.
 *
 * pixi-filters' stock GodrayFilter ends its shader with `mist.a = 1.0;` — every pixel in the filter region is
 * written fully opaque, dark where there's no ray. That's fine for a full-screen pass over an opaque scene,
 * but our FX overlay is a TRANSPARENT canvas over the game DOM (`backgroundAlpha: 0`), so an opaque region
 * paints a solid black BOX over the cards wherever the primitive's bounds are mostly empty. No blend mode can
 * cure it — the problem is the written alpha, not how it composites (measured: `add` was byte-identical).
 *
 * The fix ties alpha to the ray value (`mist.a = clamp(noise,0,1) * fade`): empty gaps → alpha ~0 (the DOM
 * shows through), rays → lit. We PATCH the program the installed lib builds (read its source, swap the one
 * line) rather than vendoring the shader, so a pixi-filters bump is picked up automatically. If the marker
 * line ever disappears (lib rewrite), the replace no-ops and we fall back to stock — guarded by a test.
 */
import { GlProgram, GpuProgram } from 'pixi.js';
import { GodrayFilter } from 'pixi-filters/godray';

/** The stock line, identical in the GLSL (`god-ray2`) and WGSL (`god-ray`) fragments. */
export const GODRAY_OPAQUE_LINE = 'mist.a = 1.0;';
/** Alpha = ray brightness × vertical fade, so gaps stay transparent over the DOM overlay. */
export const GODRAY_ALPHA_FIX = 'mist.a = clamp(noise, 0.0, 1.0) * (1.0 - coord.y);';

/** Swap the opaque-alpha line for the ray-tracking one. No-ops (returns `src`) if the marker is absent, so a
 *  pixi-filters shader rewrite fails safe to stock rather than corrupting the shader — a test guards the marker. */
export function patchGodrayFragment(src: string): string {
  return src.replace(GODRAY_OPAQUE_LINE, GODRAY_ALPHA_FIX);
}

export function createGodrayFilter(): GodrayFilter {
  const gr = new GodrayFilter();

  // WebGL (the renderer the FX overlay actually uses — see pixiFx.ts `preference: 'webgl'`).
  const gl = gr.glProgram;
  const glFrag = gl?.fragment;
  const glVert = gl?.vertex;
  if (gl && glFrag && glVert && glFrag.includes(GODRAY_OPAQUE_LINE)) {
    gr.glProgram = GlProgram.from({ vertex: glVert, fragment: patchGodrayFragment(glFrag), name: 'god-ray-alpha-fixed' });
  }

  // WebGPU (fallback path; patched for correctness even though the overlay prefers WebGL).
  const gpu = gr.gpuProgram;
  const gpuFrag = gpu?.fragment;
  const gpuVert = gpu?.vertex;
  if (gpu && gpuFrag && gpuVert && gpuFrag.source.includes(GODRAY_OPAQUE_LINE)) {
    gr.gpuProgram = GpuProgram.from({
      vertex: { source: gpuVert.source, entryPoint: gpuVert.entryPoint },
      fragment: { source: patchGodrayFragment(gpuFrag.source), entryPoint: gpuFrag.entryPoint },
    });
  }

  return gr;
}
