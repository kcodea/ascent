/**
 * LEARNED VALUE (balance bot) — public surface.
 *
 *   featuresOf / featuresOfSnapshot   the ONE feature function (training + inference)
 *   fit / predict                     the deterministic ridge model
 *   valueTermOf                       the evaluator hook
 *   loadDefaultValueModel(setId)      the committed model for a set (`models/<set>-v1.json`), or null
 */
import set2v1 from './models/set2-v1.json';
import { validateModel, type ValueModel } from './model';

export * from './features';
export * from './model';
export * from './term';

const COMMITTED: Record<string, unknown> = { set2: set2v1 };

/** The committed model for a set, validated against the live feature schema. `null` when none is shipped (or it drifted). */
export function loadDefaultValueModel(setId: string): ValueModel | null {
  const m = COMMITTED[setId];
  return m && validateModel(m) ? m : null;
}
