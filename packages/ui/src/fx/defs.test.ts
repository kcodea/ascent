/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { FX_ANCHOR_IDS } from './anchors';
import { coerceDef, FX_DEF_VERSION } from './defStore';
// Side-effect import: every built-in primitive self-registers at load (see `primitives/index.ts`), which is
// what lets `getPrimitive(layer.primitive)` — and therefore the params-key check below — see them at all.
import './primitives';
import { getPrimitive } from './registry';

/**
 * The guard that makes HAND-AUTHORED def JSON safe.
 *
 * `coerceDef` is deliberately TOTAL: it repairs everything it can rather than throwing, because a def
 * arriving from disk or a clipboard is untrusted input. That tolerance is exactly what makes a hand-written
 * file dangerous — every one of these mistakes loads "successfully" and renders something WRONG:
 *
 *   • a typo'd param name (`raidus`, `plateu`) is silently DROPPED by `coerceParams` and the param keeps its
 *     default, so the layer looks authored and does nothing it was tuned to do;
 *   • an unknown primitive drops the WHOLE layer (`coerceLayer` returns null);
 *   • an unknown anchor silently falls back to `target`, so a `travel` ribbon quietly stops travelling;
 *   • an `id` that doesn't match the filename is overridden by the filename (see `fxDefs.ts`), so the def
 *     plays under a name its own JSON disagrees with.
 *
 * None of that is visible to the type system (the files are JSON) or to a reader (they all look fine), so it
 * is checked here instead — against the primitives' own `SPECS`, which are the only source of truth for what
 * a param is called.
 *
 * Every test walks the WHOLE set and reports EVERY offender at once, so fixing one file doesn't just reveal
 * the next. The glob is directory-wide, so a def added later is covered the moment its file lands.
 */

// Same mechanism (and the same Vitest caveat) as `fxDefs.ts`: `import.meta.glob` is a Vite TRANSFORM whose
// options must be an inline literal, not a runtime call — it holds under Vitest because Vitest runs source
// through Vite. Unlike `fxDefs.ts` this is deliberately NOT DEV-gated: the files must be validated whatever
// the env the suite runs in.
const MODULES = import.meta.glob('./defs/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

interface DefEntry {
  /** `./defs/rally-link.json` */
  path: string;
  /** `rally-link` — the filename stem, which `fxDefs.ts` treats as the authority on a def's id. */
  stem: string;
  /** The file's parsed JSON, UNCOERCED. Checking the raw object is the point: `coerceDef` would repair most
   *  of what these tests exist to catch. */
  raw: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const ENTRIES: DefEntry[] = Object.entries(MODULES)
  .map(([path, raw]) => ({ path, stem: path.split('/').pop()?.replace(/\.json$/, '') ?? '', raw }))
  .sort((a, b) => a.stem.localeCompare(b.stem));

/** The layer objects of a raw def, paired with their index so a failure can name the offender. */
function layersOf(raw: unknown): { index: number; layer: Record<string, unknown> }[] {
  if (!isRecord(raw) || !Array.isArray(raw.layers)) return [];
  const out: { index: number; layer: Record<string, unknown> }[] = [];
  raw.layers.forEach((layer: unknown, index: number) => {
    if (isRecord(layer)) out.push({ index, layer });
  });
  return out;
}

describe('committed fx defs', () => {
  // Guards the whole file against passing VACUOUSLY: if the glob ever stops resolving (a moved directory, a
  // loader that doesn't transform `import.meta.glob`), every loop below iterates nothing and reports green.
  it('finds the committed def files', () => {
    expect(ENTRIES.length).toBeGreaterThan(0);
  });

  it('every file parses through coerceDef', () => {
    const problems: string[] = [];
    for (const { path, raw } of ENTRIES) {
      if (!isRecord(raw)) {
        problems.push(`${path}: not a JSON object`);
        continue;
      }
      if (coerceDef(raw) === null) problems.push(`${path}: coerceDef returned null (not a def at all)`);
    }
    expect(problems).toEqual([]);
  });

  // `fxDefs.ts` makes the FILENAME the authority on a def's id, so a mismatch isn't an error there — it's a
  // silent rename. That is precisely why it has to be an error here.
  it('every def\'s id equals its filename stem', () => {
    const problems: string[] = [];
    for (const { path, stem, raw } of ENTRIES) {
      const id = isRecord(raw) ? raw.id : undefined;
      if (id !== stem) problems.push(`${path}: id is ${JSON.stringify(id)}, expected '${stem}'`);
    }
    expect(problems).toEqual([]);
  });

  it('every def declares version 1, a positive duration, and at least one layer', () => {
    const problems: string[] = [];
    for (const { path, raw } of ENTRIES) {
      if (!isRecord(raw)) continue; // already reported by the parse test
      if (raw.version !== FX_DEF_VERSION) {
        problems.push(`${path}: version is ${JSON.stringify(raw.version)}, expected ${FX_DEF_VERSION}`);
      }
      if (typeof raw.duration !== 'number' || !Number.isFinite(raw.duration) || raw.duration <= 0) {
        problems.push(`${path}: duration is ${JSON.stringify(raw.duration)}, expected a finite number > 0`);
      }
      if (!Array.isArray(raw.layers)) {
        problems.push(`${path}: layers is not an array`);
      } else {
        if (raw.layers.length === 0) problems.push(`${path}: layers is empty`);
        raw.layers.forEach((layer: unknown, i: number) => {
          if (!isRecord(layer)) problems.push(`${path} / layer ${i}: not an object`);
        });
      }
    }
    expect(problems).toEqual([]);
  });

  // An unknown primitive doesn't degrade — `coerceLayer` drops the ENTIRE layer, so the def loads with a
  // piece of the composition simply missing.
  it('every layer names a registered primitive', () => {
    const problems: string[] = [];
    for (const { path, raw } of ENTRIES) {
      for (const { index, layer } of layersOf(raw)) {
        const id = layer.primitive;
        if (typeof id !== 'string' || getPrimitive(id) === undefined) {
          problems.push(`${path} / layer ${index}: unknown primitive ${JSON.stringify(id)}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  // The counterpart to the check above, from the other direction: whatever the reason, a layer that doesn't
  // survive coercion is a layer that will never render.
  it('coercion drops no layer', () => {
    const problems: string[] = [];
    for (const { path, raw } of ENTRIES) {
      if (!isRecord(raw) || !Array.isArray(raw.layers)) continue;
      const coerced = coerceDef(raw);
      if (coerced && coerced.layers.length !== raw.layers.length) {
        problems.push(`${path}: ${raw.layers.length} layers authored, ${coerced.layers.length} survived coerceDef`);
      }
    }
    expect(problems).toEqual([]);
  });

  // A bad anchor is the quietest failure of the lot: `coerceLayer` falls back to `target`, so a mistyped
  // `travel` still renders — just pinned to the wrong point, with nothing anywhere saying so.
  it('every layer names a valid anchor', () => {
    const problems: string[] = [];
    for (const { path, raw } of ENTRIES) {
      for (const { index, layer } of layersOf(raw)) {
        const anchor = layer.anchor;
        if (typeof anchor !== 'string' || !(FX_ANCHOR_IDS as readonly string[]).includes(anchor)) {
          problems.push(
            `${path} / layer ${index}: invalid anchor ${JSON.stringify(anchor)} ` +
              `(expected one of ${FX_ANCHOR_IDS.join(', ')})`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  /**
   * THE important one.
   *
   * `coerceParams` only ever reads keys that exist in the primitive's `SPECS` — anything else in the JSON is
   * ignored without a word. So a def can be fully "valid", load cleanly, render, and quietly use the DEFAULT
   * for every param whose name was mistyped. Nothing else in the system can catch this: JSON has no types,
   * and the value was never wrong, only its key.
   */
  it('every param key exists in its primitive\'s SPECS', () => {
    const problems: string[] = [];
    for (const { path, raw } of ENTRIES) {
      for (const { index, layer } of layersOf(raw)) {
        const id = typeof layer.primitive === 'string' ? layer.primitive : '';
        const prim = getPrimitive(id);
        if (!prim) continue; // already reported by the primitive test
        const params = layer.params;
        if (params === undefined) continue; // omitting params entirely is legal — everything defaults
        if (!isRecord(params)) {
          problems.push(`${path} / layer ${index} (${id}): params is not an object`);
          continue;
        }
        for (const key of Object.keys(params)) {
          if (!(key in prim.params)) {
            problems.push(`${path} / layer ${index} (${id}): unknown param '${key}'`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('every layer schedules a non-negative `at`, and a positive `life` when it declares one', () => {
    const problems: string[] = [];
    for (const { path, raw } of ENTRIES) {
      for (const { index, layer } of layersOf(raw)) {
        const at = layer.at;
        if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) {
          problems.push(`${path} / layer ${index}: at is ${JSON.stringify(at)}, expected a finite number >= 0`);
        }
        if ('life' in layer) {
          const life = layer.life;
          if (typeof life !== 'number' || !Number.isFinite(life) || life <= 0) {
            problems.push(`${path} / layer ${index}: life is ${JSON.stringify(life)}, expected a finite number > 0`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  // The OTHER half of the silent-failure hazard. The key check above catches a param that does not exist;
  // this catches one that exists but whose VALUE `coerceParams` silently repairs. They fail identically to a
  // reader — the file looks authored and renders something else.
  //
  // Not hypothetical: `ward-gained.json` shipped with `"radius": 0.42` on a shockwave layer whose `radius`
  // spec is PIXELS (min 40), so it was clamped to the smallest ring the primitive can draw. The def looked
  // deliberate and had been wrong since the day it was committed.
  it('every param VALUE survives coercion unchanged (nothing is silently clamped or dropped)', () => {
    const problems: string[] = [];
    for (const { path, raw } of ENTRIES) {
      for (const { index, layer } of layersOf(raw)) {
        const id = typeof layer.primitive === 'string' ? layer.primitive : '';
        const prim = getPrimitive(id);
        if (!prim) continue;
        const params = layer.params;
        if (!isRecord(params)) continue;
        for (const [key, value] of Object.entries(params)) {
          const spec = prim.params[key];
          if (!spec) continue; // unknown key — already reported by the params-key test
          const where = `${path} / layer ${index} (${id}) '${key}'`;
          if (spec.kind === 'slider') {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
              problems.push(`${where}: expected a number, got ${JSON.stringify(value)}`);
            } else if (value < spec.min || value > spec.max) {
              problems.push(`${where}: ${value} is outside [${spec.min}, ${spec.max}] and will be CLAMPED`);
            }
          } else if (spec.kind === 'enum') {
            if (typeof value !== 'string' || !spec.options.includes(value)) {
              problems.push(`${where}: ${JSON.stringify(value)} is not one of ${spec.options.join(' | ')}`);
            }
          } else if (spec.kind === 'toggle') {
            if (typeof value !== 'boolean') problems.push(`${where}: expected a boolean`);
          } else if (spec.kind === 'palette') {
            const ok = Array.isArray(value) && value.length === 4
              && value.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 0xffffff);
            if (!ok) problems.push(`${where}: expected 4 ints in [0, 0xFFFFFF]`);
          } else if (spec.kind === 'curve') {
            const vMax = spec.vMax ?? 1;
            if (!Array.isArray(value) || value.length < 2) {
              problems.push(`${where}: a curve needs at least 2 points`);
            } else {
              let prevT = -Infinity;
              for (const pt of value) {
                if (!Array.isArray(pt) || pt.length !== 2 || pt.some((n) => typeof n !== 'number')) {
                  problems.push(`${where}: every point must be [t, v]`);
                  break;
                }
                const [t, v] = pt as [number, number];
                if (t < 0 || t > 1) problems.push(`${where}: t ${t} is outside [0, 1] and will be CLAMPED`);
                if (v < 0 || v > vMax) problems.push(`${where}: v ${v} is outside [0, ${vMax}] and will be CLAMPED`);
                if (t < prevT) problems.push(`${where}: points must be sorted ascending by t (coerce re-sorts)`);
                prevT = t;
              }
            }
          } else if (spec.kind === 'shape') {
            if (typeof value !== 'string' || value === '') problems.push(`${where}: expected a shape id`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

/**
 * The CANVAS SLOT field (`slot: 'over' | 'under' | 'above'`).
 *
 * Two things are worth locking down, and only one of them is about correctness:
 *
 *  1. an unreadable slot silently falls back to `'over'` in `coerceDef`, exactly like a bad anchor falls back
 *     to `target` — so `"slot": "Under"` or `"slot": "below"` loads clean and draws in the wrong place;
 *  2. `'over'` is the DEFAULT and must be written as an OMISSION. A def that spells it out plays identically,
 *     which is precisely why it would never be noticed — and it is how the field starts creeping into every
 *     file on disk. The omit-unless-set rule is enforced here or nowhere.
 */
describe('committed defs — canvas slot', () => {
  it('declares no slot at all, or exactly "under" / "above"', () => {
    const problems: string[] = [];
    for (const { stem, raw } of ENTRIES) {
      if (!isRecord(raw) || !('slot' in raw)) continue;
      if (raw.slot === 'over') {
        problems.push(`${stem}: writes the DEFAULT slot explicitly — omit the field instead`);
      } else if (raw.slot !== 'under' && raw.slot !== 'above') {
        problems.push(`${stem}: slot ${JSON.stringify(raw.slot)} is neither 'under' nor 'above', so it will silently draw OVER the cards`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('reserves the ABOVE-MODAL canvas for effects that are about a modal', () => {
    // `above` draws over the Discover / Choose One overlays, which are otherwise deliberately above every
    // board effect. A board moment drawn over the window that is asking the player a question is a bug, not
    // a flourish — so the slot carries an explicit inventory rather than being available by default.
    const ABOUT_A_MODAL = new Set(['prismatic-pick']);
    const claimed = ENTRIES.filter((e) => isRecord(e.raw) && e.raw.slot === 'above').map((e) => e.stem);
    expect(claimed.filter((s) => !ABOUT_A_MODAL.has(s)),
      'a def took the above-modal canvas without being about a modal — check it, then add it here')
      .toEqual([]);
    expect([...ABOUT_A_MODAL].filter((s) => !claimed.includes(s)),
      'this inventory names a def that no longer claims the slot — delete the entry').toEqual([]);
  });

  it('survives coercion with the slot it declared', () => {
    const problems: string[] = [];
    for (const { stem, raw } of ENTRIES) {
      const declared = isRecord(raw) && (raw.slot === 'under' || raw.slot === 'above') ? raw.slot : undefined;
      const coerced = coerceDef(raw)?.slot;
      if (coerced !== declared) problems.push(`${stem}: declared ${String(declared)}, coerced to ${String(coerced)}`);
    }
    expect(problems).toEqual([]);
  });
});
