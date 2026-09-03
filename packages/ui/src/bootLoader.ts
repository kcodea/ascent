/**
 * THE BOOT PIPELINE — everything the game will ever show or play, loaded and warmed before the menu opens.
 *
 * Owner ruling 2026-09-03: "I'd rather wait two minutes for the game to preload everything than experience
 * pop-in hitches." This reverses the 2026-08-25 fixed-3.5s splash, whose bar was a pure CSS animation with
 * nothing behind it; the real loading kept running under the menu, and every asset the old warm-up did not
 * cover (spell/quest/rune art, all 87 frame images, the audio clips, the FX shaders + textures, the fonts)
 * paid its cost the first time a player reached it.
 *
 * Four stages, each with its own progress and its own timeouts (a stuck item can never hang the boot):
 *   images — every bundled art file + every public/ image, fetched AND decoded          (art.ts)
 *   fonts  — every self-hosted face the stylesheet uses                                  (fontsPreload.ts)
 *   audio  — every clip fetched + decoded on a SUSPENDED context (a page may create one before any gesture,
 *            and decodeAudioData works while suspended; the click later just resumes it)   (sfx.ts)
 *   fx     — the Pixi canvas' program links + every shape/art texture uploaded            (fx/playDef.ts)
 * Every stage starts the moment this runs (owner ask 2026-09-03: "auto load everything and THEN the click to
 * begin text should show up only after it's fully loaded"). The bar shows the weighted mean.
 *
 * Pure where it can be: the weights + `bootProgress` are unit-tested; the stage runners are injectable so
 * the pipeline itself is tested without a browser.
 */
import { preloadAllArt } from './art';
import { preloadFonts } from './fontsPreload';
import { preloadAllSamples } from './sfx';
import { warmFx, warmFxTimings } from './fx/playDef';
import { warmEverything, type WarmAllReport } from './fx/warmAll';

export type StageName = 'images' | 'fonts' | 'audio' | 'fx';

/** Rough share of wall-clock each stage takes on a cold load — what the bar's mix is weighted by. */
export const STAGE_WEIGHTS: Readonly<Record<StageName, number>> = { images: 0.55, audio: 0.25, fx: 0.15, fonts: 0.05 };

/** Weighted mean of per-stage fractions (missing = 0), clamped to [0, 1]. */
export function bootProgress(
  fractions: Partial<Record<StageName, number>>,
  weights: Readonly<Record<StageName, number>> = STAGE_WEIGHTS,
): number {
  let sum = 0;
  let wsum = 0;
  for (const k of Object.keys(weights) as StageName[]) {
    const w = weights[k];
    const f = Math.min(1, Math.max(0, fractions[k] ?? 0));
    sum += w * f;
    wsum += w;
  }
  return wsum > 0 ? Math.min(1, Math.max(0, sum / wsum)) : 1;
}

export interface StageResult { ms: number; ok: boolean; note?: string }
/** The fire-everything report (see fx/warmAll.ts), surfaced on the boot report as `fx`. */
export type { WarmAllReport };
export interface BootReport { ms: number; stages: Record<StageName, StageResult> }

/** A stage runner: reports `(loaded, total)` as it goes and resolves when settled. Never rejects by contract,
 *  but the pipeline guards a rejection anyway (a stage failure marks `ok: false`, it never blocks the boot). */
export type StageRunner = (onProgress: (loaded: number, total: number) => void) => Promise<void>;

export interface BootLoaderOptions {
  onProgress: (p: number) => void;
  /** Test seam / a build without a stage (e.g. no WebGL) — defaults to the real runners. */
  runners?: Partial<Record<StageName, StageRunner>>;
  now?: () => number;
}

const DEFAULT_RUNNERS: Record<StageName, StageRunner> = {
  images: (p) => preloadAllArt(p),
  fonts: (p) => preloadFonts(p),
  audio: (p) => preloadAllSamples(p),
  fx: async (p) => {
    await warmFx();
    p(1, 2);
    // Then FIRE EVERYTHING under the splash — every committed def + every hand-written effect, twice: once to
    // warm whatever a program link cannot (filters, geometry, text, the Discover canvas), once under a
    // long-task observer to MEASURE what is still cold. See fx/warmAll.ts.
    lastWarmAll = await warmEverything();
    p(2, 2);
  },
};
let lastWarmAll: WarmAllReport | null = null;
/** The most recent fire-everything report, for the boot report + `window.__boot`. */
export const warmAllReport = (): WarmAllReport | null => lastWarmAll;

export async function runBootLoader(opts: BootLoaderOptions): Promise<BootReport> {
  const now = opts.now ?? ((): number => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const runners = { ...DEFAULT_RUNNERS, ...opts.runners };
  const fractions: Partial<Record<StageName, number>> = {};
  const stages = {} as Record<StageName, StageResult>;
  const t0 = now();
  const emit = (): void => opts.onProgress(bootProgress(fractions));

  const run = async (name: StageName): Promise<void> => {
    const s0 = now();
    let ok = true;
    try {
      await runners[name]((loaded, total) => {
        fractions[name] = total > 0 ? loaded / total : 1;
        emit();
      });
    } catch {
      ok = false;
    }
    fractions[name] = 1;
    stages[name] = { ms: Math.round(now() - s0), ok };
    if (name === 'fx' && lastWarmAll) {
      const r = lastWarmAll;
      stages.fx.note = `warmFx ${Object.entries(warmFxTimings).map(([k, v]) => `${k} ${v}ms`).join(', ')}; fired ${r.first.defs} defs + ${r.first.handWritten} effects; re-fire long tasks: ${r.secondPassLongTasks.length}`
        + (r.secondPassLongTasks.length ? ` (${r.secondPassLongTasks.join(', ')} ms)` : '')
        + (r.first.failed.length ? `; could not fire: ${r.first.failed.join(', ')}` : '');
    }
    emit();
  };

  await Promise.all([run('images'), run('fonts'), run('fx'), run('audio')]);
  return { ms: Math.round(now() - t0), stages };
}
