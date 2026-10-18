// Side-effect imports: each `extensions.add`s its type's render pipes (Pixi's own opt-in entry points, the same
// shape as `fx/blendModes.ts`'s 'pixi.js/advanced-blend-modes'). See below for why they must run at entry.
import 'pixi.js/particle-container';
import 'pixi.js/sprite-nine-slice';
import type { Application } from 'pixi.js';
import { reportFxFault } from './pixiAppSafety';

/**
 * REGISTER PIXI'S SCENE RENDER PIPES BEFORE ANY RENDERER EXISTS (mobile perf pass, 2026-10-18).
 *
 * Pixi v8 registers a scene type's render pipe as a side effect of evaluating that type's module
 * (`ParticleContainer.mjs` imports `../init.mjs`, which `extensions.add`s the `particle` pipe; the same for
 * `NineSliceSprite`). A renderer builds its pipe table ONCE, at `init`, from whatever is registered at that
 * moment, and never picks up a pipe registered later.
 *
 * Our only users of those two classes live in the FX primitives chunk, which is fetched lazily so its GLSL
 * stays out of the entry bundle. Rollup tree-shakes the classes out of the entry chunk, so their pipes were
 * registered only when that lazy chunk evaluated. Whenever the overlay's `Application.init` won that race
 * (about one session in four in the headless mobile audit), the main renderer had no `particle` pipe for the
 * whole session: every particle effect on the main canvas was silently skipped, and every frame in which a
 * live ParticleContainer changed threw `Cannot read properties of undefined (reading 'updateRenderable')`
 * out of `updateRenderGroupTransforms`, which aborted that frame's FX render outright (hundreds of
 * `pixiFx:render` faults a session).
 *
 * The two side-effect imports above register both pipes when this module evaluates, with `pixiFx.ts`, in the
 * entry chunk, before any `Application` is created. (Referencing the classes is NOT enough: their modules are
 * marked side-effect-free, so Rollup tree-shakes an unused reference and the registration stays in the lazy
 * chunk.) Every renderer on the page is created after the entry chunk has run, so all of them get the pipes.
 */
/** The pipes the FX primitives' ParticleContainer and NineSliceSprite render through (Pixi's `renderPipeId`). */
export const REQUIRED_SCENE_PIPES = ['particle', 'nineSliceSprite'] as const;

/** Names of {@link REQUIRED_SCENE_PIPES} the renderer is missing. Empty when the renderer can draw them all. */
export function missingScenePipes(renderPipes: Record<string, unknown> | undefined): string[] {
  if (!renderPipes) return [...REQUIRED_SCENE_PIPES];
  return REQUIRED_SCENE_PIPES.filter((id) => !renderPipes[id]);
}

/** Report (never throw) when a freshly initialised app cannot draw a scene type the FX layer uses. A field
 *  tripwire for the race above: if a future refactor drops the import, the perf HUD's `fx:faults` says so. */
export function checkScenePipes(app: Application, site: string): boolean {
  const missing = missingScenePipes((app.renderer as unknown as { renderPipes?: Record<string, unknown> }).renderPipes);
  if (missing.length === 0) return true;
  reportFxFault(`${site}:missing-pipes`, new Error(`renderer was created without the ${missing.join(', ')} pipe(s)`));
  return false;
}
