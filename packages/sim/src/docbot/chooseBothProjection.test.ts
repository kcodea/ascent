import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseBothActive, chooseBothStateOf } from '../recruit';

/**
 * DOC BOT LANE `chooseBothProjection` — the (Both) predicate and the state the UI hands it cannot drift.
 *
 * ── The bug (owner report 2026-08-31) ──────────────────────────────────────────────────────────────────────
 *
 *   *"when choosing prismatic pick's second option, the choose one cards are not showing the 'will trigger
 *    both' effect/animation."*
 *
 * `chooseBothActive` had grown a third input — `chooseBothCharges`, armed by Dealer and the Prismatic
 * Pick — while three UI surfaces still hand-rolled a projection written when there were only two:
 *
 *     { runeFacetwright: run.runeFacetwright, runeUnbrokenVein: run.runeUnbrokenVein }
 *
 * ── Why TypeScript could not catch it ──────────────────────────────────────────────────────────────────────
 *
 * The predicate takes a `Pick<RunState, …>`, and every field it picks is OPTIONAL on `RunState`. A projection
 * missing one is therefore a perfectly good argument. The card views read the charge as `undefined`, printed
 * no (Both), and stamped no `data-choose-both` — so the marker FX, whose key list IS built from the full run,
 * looked for elements that were never marked. Half the feature was live and half was blind.
 *
 * ── The gate ───────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The projection is now a single builder with REQUIRED fields (`chooseBothStateOf`), which turns a dropped
 * field into a compile error. This lane guards the other half of the drift: a NEW input read by the predicate
 * that nobody added to the builder. It reads both function bodies and compares the run fields they touch.
 */

const RECRUIT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../recruit.ts'), 'utf8');

/** The body of a top-level exported function, comments stripped — a comment naming a field it no longer
 *  reads would otherwise keep a stale entry alive (the trap the `rallyGuard` lane was caught by). */
function bodyOf(name: string): string {
  const start = RECRUIT.indexOf(`export function ${name}(`);
  expect(start, `${name} is exported from recruit.ts`).toBeGreaterThan(-1);
  const open = RECRUIT.indexOf('{', RECRUIT.indexOf(')', start));
  let depth = 0;
  let i = open;
  for (; i < RECRUIT.length; i++) {
    if (RECRUIT[i] === '{') depth++;
    else if (RECRUIT[i] === '}' && --depth === 0) break;
  }
  return RECRUIT.slice(open, i).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** Every `state.x` / `s.x` the body reads. */
const fieldsRead = (body: string): Set<string> =>
  new Set([...body.matchAll(/\b(?:state|s)\.(\w+)/g)].map((m) => m[1]!));

describe('Doc Bot — the (Both) predicate and its projection stay in step', () => {
  it('every run field the predicate reads is one the projection carries', () => {
    const predicate = fieldsRead(bodyOf('chooseBothActive'));
    const projection = fieldsRead(bodyOf('chooseBothStateOf'));
    expect(predicate.size, 'the predicate reads run state at all (a parse floor)').toBeGreaterThan(1);
    expect([...predicate].filter((f) => !projection.has(f)),
      'chooseBothActive reads run state that chooseBothStateOf does not copy. Every UI surface passes the '
      + 'PROJECTION, so a field missing here is read as undefined on every card view — no (Both) text and no '
      + '`data-choose-both` for the marker FX, exactly the Prismatic Pick bug. Add it to the builder AND to '
      + '`ChooseBothState`.').toEqual([]);
  });

  it('and the projection carries nothing the predicate has stopped reading', () => {
    // The other direction, so the builder cannot rot into a bag of fields nobody consults.
    const predicate = fieldsRead(bodyOf('chooseBothActive'));
    const projection = fieldsRead(bodyOf('chooseBothStateOf'));
    expect([...projection].filter((f) => !predicate.has(f)),
      'the projection copies run state the predicate no longer reads — delete it').toEqual([]);
  });

  it('BEHAVIOURALLY: a charge alone makes a Choose One resolve both, through the projection', () => {
    // The static halves above cannot prove the two agree at RUNTIME — only that they name the same fields. So
    // the charge is driven end to end: run → projection → predicate, which is the exact path a card view takes.
    const def = { id: 'anything', chooseOne: [{ text: 'a', effects: [] }, { text: 'b', effects: [] }] };
    const armed = chooseBothStateOf({ chooseBothCharges: 1 });
    const spent = chooseBothStateOf({ chooseBothCharges: 0 });
    expect(chooseBothActive(armed, undefined, def), 'an armed charge lights the card up').toBe(true);
    expect(chooseBothActive(spent, undefined, def), 'and no charge leaves it a real choice').toBe(false);
  });
});
