/**
 * ANCIENTS IN A DUOS GAME: THE DEV SEAM (R-ANCDUOS-01; owner 2026-11-10: "we arent turning ancients on just yet, but
 * build it out").
 *
 * Ancients are NOT on in any Versus or Ranked Duos game a player can reach. The Duos heroes' pairings (Priestess,
 * Magician) are built and tested, and this is the one way to play them end to end: on a DEV server or a bench bundle
 * (`VITE_PERF_BENCH=1`), a tab that sets `localStorage['ascent.dev.duosAncients']` gets `ancients` on the Duos runs it
 * builds, exactly as the Scene Builder turns them on for a solo run (`enableAncients`, through `createVersusRun`'s `dev`
 * argument).
 *
 * The gate is the BUILD, not a setting: both checks are static, so a player bundle folds this whole function to
 * `undefined` and no local storage key, URL or console call can turn it on there. Nothing about it is on the wire: the
 * room, the Worker and the teammate never hear of it (each tab that wants Ancients sets its own key).
 *
 * The value: `1` (or anything truthy) = the default meter; `cost:<n>` = a meter that awakens after `n` points (a quick
 * local check awakens on the first Refresh with `cost:1`).
 */
import type { AncientMeterTuning } from '@game/sim';

export const VERSUS_DEV_ANCIENTS_KEY = 'ascent.dev.duosAncients';

export function versusDevAncients(): Partial<AncientMeterTuning> | true | undefined {
  if (!(import.meta.env.DEV || import.meta.env.VITE_PERF_BENCH === '1') || typeof window === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(VERSUS_DEV_ANCIENTS_KEY);
    if (!raw || raw === '0') return undefined;
    const m = /^cost:(\d+)$/.exec(raw);
    const cost = m ? Number(m[1]) : 0;
    return cost >= 1 ? { cost } : true;
  } catch {
    return undefined;
  }
}
