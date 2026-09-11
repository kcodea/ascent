/**
 * DOC BOT LANE `firePaths` — every SYNTHETIC fire path reaches the watchers the NATURAL path reaches.
 *
 * Born from Bug Board 7e04222d (PR #1374): the Rune of Rallying's free Start-of-Combat Rally ran only the
 * rallier's own effects, so Hawkus / Paragon / Mineral Master lit on every real swing and stayed dark on
 * the rune's Rally. Doctrine, the site scan and the Rally derivation live in `firePaths.ts`.
 *
 * Gates:
 *   · SITE COMPLETENESS — every direct `FACTORIES[…]` dispatch in core is classified in
 *     `SYNTHETIC_FIRE_SITES` (unclassified → "classify me"; an entry no site matches → rot).
 *   · THE RALLY PAIR — for every `onAttack` factory in active content, the free-Rally reach equals the
 *     natural-Rally reach minus the (verified) ally-attack watchers, and a Rally multiplier invokes each
 *     Rally watcher / self-Rally exactly twice. Factories that react on no staged path carry a reason.
 *   · REGISTRY ↔ BEHAVIOUR — the engine's `RALLY_WATCHER_EFFECTS` set (read from simulate.ts) EQUALS the
 *     behaviourally derived rally-watcher class, so the constant cannot drift from what the cards do.
 *
 * SABOTAGE PROOFS (recorded 2026-09-11, the git-level reversion run by hand while building the lane):
 *   · `fireFreeRally`'s watcher loop emptied (the exact pre-#1374 shape) → the derivation reports THREE
 *     divergences — Hawkus, Mineral Master and Paragon each "a Rally WATCHER … is not reached by a free
 *     Rally — the Hawkus class". With the fix restored: zero.
 *   · FOUND ON THE LANE'S FIRST RUN, before any sabotage: the multiplier half flagged Hawkus and Mineral
 *     Master ("invoked 1× for one Rally vs 1× unmultiplied — expected exactly 2×") — `RALLY_WATCHER_EFFECTS`
 *     named Paragon alone while the free-Rally set named all three, so with Uron on the board a real Rally
 *     re-fired Paragon and nobody else. Unifying the sets then exposed a second defect: the watcher loops
 *     walked the LIVE board, and Hawkus's proc'd Echo summoning a token shifted Hawkus right so it fired
 *     again. Both fixed in core (`rallyMultiplierWatchers.test.ts` pins them).
 *   · IN-FILE: `deriveRallyDivergences` is fed a doctored observation below and must name the Hawkus class.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIRE_UNOBSERVED, SYNTHETIC_FIRE_SITES, auditFireSites, deriveRallyDivergences, rallyDerivation, type RallyObservation,
} from './firePaths';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

describe('Doc Bot — fire paths: synthetic dispatch sites', () => {
  const audit = auditFireSites();

  it('every direct FACTORIES dispatch in core is classified (a new synthetic path must be named and read)', () => {
    const list = audit.unclassified.map((s) => `${s.key} @${s.file}:${s.line}`);
    expect(list, `Unclassified synthetic fire site(s): ${list.join(' · ')} — add an entry to SYNTHETIC_FIRE_SITES with its kind, its pair, and what the natural counterpart is.`).toEqual([]);
  });

  it('no registry entry describes a site that no longer exists', () => {
    expect(audit.stale, `Stale SYNTHETIC_FIRE_SITES key(s): ${audit.stale.join(', ')} — the site moved or was deleted; re-key or remove.`).toEqual([]);
  });

  it('exactly one site is the natural path (the bus subscription), and the Rally pair covers real sites', () => {
    const natural = Object.entries(SYNTHETIC_FIRE_SITES).filter(([, e]) => e.kind === 'natural').map(([k]) => k);
    expect(natural).toEqual(['simulate.ts#registerEffect#?']);
    const rallySites = audit.sites.filter((s) => SYNTHETIC_FIRE_SITES[s.key]?.pair === 'rally');
    expect(rallySites.length, 'the free-Rally + multiplier loops must be scanned sites, not just registry prose').toBeGreaterThanOrEqual(3);
  });
});

describe('Doc Bot — fire paths: the Rally derivation pair', () => {
  const d = rallyDerivation();

  it('a free Rally and a multiplied Rally reach exactly the watchers a natural Rally reaches', () => {
    const list = d.divergences.map((x) => `${x.factory} (${x.card}): ${x.problem}`);
    expect(list, `Synthetic Rally path diverges from the natural one:\n  ${list.join('\n  ')}`).toEqual([]);
  });

  it('every factory that reacts on no staged path carries a reason, and no reason has gone stale', () => {
    expect(d.unexplained, `onAttack factor(ies) that emitted on NO staged path with no FIRE_UNOBSERVED reason: ${d.unexplained.join(', ')}`).toEqual([]);
    expect(d.staleExcuses, `FIRE_UNOBSERVED entries whose factory now reacts: ${d.staleExcuses.join(', ')} — delete them.`).toEqual([]);
  });

  it("the engine's RALLY_WATCHER_EFFECTS set equals the behaviourally derived rally-watcher class", () => {
    const src = readFileSync(join(ROOT, 'packages/core/src/combat/simulate.ts'), 'utf8');
    const m = /RALLY_WATCHER_EFFECTS = new Set<string>\(\[([^\]]*)\]\)/.exec(src);
    expect(m, 'simulate.ts must declare RALLY_WATCHER_EFFECTS as a literal Set').toBeTruthy();
    const declared = [...m![1]!.matchAll(/'(\w+)'/g)].map((x) => x[1]!).sort();
    const derived = d.observations.filter((o) => o.cls === 'rally-watcher').map((o) => o.factory).sort();
    expect(declared, `the engine names [${declared.join(', ')}] as Rally watchers; the cards behave as [${derived.join(', ')}] — a watcher the engine does not name misses every synthetic Rally`).toEqual(derived);
  });

  it('the classes are populated (the instrument sees something on every side)', () => {
    const count = (cls: RallyObservation['cls']): number => d.observations.filter((o) => o.cls === cls).length;
    expect(count('self-rally')).toBeGreaterThan(10);
    expect(count('rally-watcher')).toBeGreaterThanOrEqual(3);
    expect(count('attack-watcher')).toBeGreaterThanOrEqual(2);
    expect(count('unobserved')).toBe(Object.keys(FIRE_UNOBSERVED).length);
  });

  it('SABOTAGE: a doctored rally-watcher that the free Rally misses is named as the Hawkus class', () => {
    const base = d.observations.find((o) => o.cls === 'rally-watcher')!;
    const doctored: RallyObservation = { ...base, freeOther: false };
    const out = deriveRallyDivergences([doctored]);
    expect(out.length).toBe(1);
    expect(out[0]!.factory).toBe(base.factory);
    expect(out[0]!.problem).toContain('the Hawkus class');
    // …and a multiplier that fails to double is named as the Paragon class.
    const stuck: RallyObservation = { ...base, firesMultiplied: base.fires };
    expect(deriveRallyDivergences([stuck]).map((x) => x.problem).join('\n')).toContain('the Paragon class');
    // …while the real observation passes, so the alarm is specific.
    expect(deriveRallyDivergences([base])).toEqual([]);
  });
});
