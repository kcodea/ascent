import { describe, expect, it } from 'vitest';
import {
  hueBucketOf, FX_HUES, deriveFacets, bindingsByDef, kindCoverage, codeCoverage, codeScanCaveat, usageOf,
  callSitePath, callSitesLabel,
} from './catalog';
import type { StoredFxDef } from '../defStore';
import { getScore } from '../../choreo/score';

describe('hueBucketOf', () => {
  it('buckets the saturated stop of each shipped palette', () => {
    expect(hueBucketOf(0xd41f1f)).toBe('red');
    expect(hueBucketOf(0xff9c1e)).toBe('orange');
    expect(hueBucketOf(0xffb81f)).toBe('gold');
    expect(hueBucketOf(0x7ade22)).toBe('green');
    expect(hueBucketOf(0x2ee0ac)).toBe('cyan');
    expect(hueBucketOf(0x2f8bff)).toBe('blue');
    expect(hueBucketOf(0xc936ef)).toBe('violet');
    expect(hueBucketOf(0xff33a8)).toBe('magenta');
  });

  // THE trap this function exists to avoid. Stop 4 is #ffffff in nearly every def and stop 1 is a near-black
  // rim; both have no usable hue, so bucketing either would make most defs look identical.
  it('calls a colourless value neutral rather than inventing a hue', () => {
    expect(hueBucketOf(0xffffff)).toBe('neutral');
    expect(hueBucketOf(0x000000)).toBe('neutral');
    expect(hueBucketOf(0x808080)).toBe('neutral');
  });

  it('is total for junk input', () => {
    expect(hueBucketOf(Number.NaN)).toBe('neutral');
    expect(hueBucketOf(-1)).toBe('neutral');
  });

  it('FX_HUES lists every bucket the function can return', () => {
    const samples = [0xd41f1f, 0xff9c1e, 0xffb81f, 0x7ade22, 0x2ee0ac, 0x2f8bff, 0xc936ef, 0xff33a8, 0xffffff];
    samples.forEach((n) => expect(FX_HUES).toContain(hueBucketOf(n)));
  });
});

const def = (layers: StoredFxDef['layers']): StoredFxDef => ({ version: 1, id: 'd', duration: 900, layers });
const layer = (primitive: string, over: Partial<StoredFxDef['layers'][number]> = {}) =>
  ({ primitive, anchor: 'source' as const, at: 0, params: {}, ...over });

describe('deriveFacets', () => {
  it('labels the shape from the primitives, in layer order, using the human names', () => {
    const f = deriveFacets(def([layer('shockwave'), layer('burst'), layer('ribbon')]));
    expect(f.shape).toBe('Ring + Burst + Trail');
  });

  it('collapses repeated primitives so three bursts do not read as three things', () => {
    expect(deriveFacets(def([layer('burst'), layer('burst'), layer('burst')])).shape).toBe('Burst');
  });

  it('takes the SECOND palette stop, not the first or last', () => {
    // stop 1 near-black rim, stop 2 the identifying red, stop 4 white.
    const f = deriveFacets(def([layer('burst', { params: { palette: [0x0a0a0a, 0xd41f1f, 0xff8a5c, 0xffffff] } })]));
    expect(f.hue).toBe('red');
  });

  it('uses the most common bucket across layers, ties going to the first layer', () => {
    const f = deriveFacets(def([
      layer('burst', { params: { palette: [0, 0x2f8bff, 0, 0] } }),
      layer('burst', { params: { palette: [0, 0xd41f1f, 0, 0] } }),
      layer('burst', { params: { palette: [0, 0xd41f1f, 0, 0] } }),
    ]));
    expect(f.hue).toBe('red');

    const tied = deriveFacets(def([
      layer('burst', { params: { palette: [0, 0x2f8bff, 0, 0] } }),
      layer('burst', { params: { palette: [0, 0xd41f1f, 0, 0] } }),
    ]));
    expect(tied.hue).toBe('blue');
  });

  it('is neutral when no layer carries a palette at all', () => {
    expect(deriveFacets(def([layer('burst')])).hue).toBe('neutral');
  });

  it('reports motion from the travel anchor', () => {
    expect(deriveFacets(def([layer('burst', { anchor: 'target' })])).motion).toBe('in place');
    expect(deriveFacets(def([layer('burst'), layer('ribbon', { anchor: 'travel' })])).motion).toBe('travels');
  });

  it('survives an empty layer list', () => {
    const f = deriveFacets(def([]));
    expect(f.shape).toBe('');
    expect(f.hue).toBe('neutral');
    expect(f.motion).toBe('in place');
  });
});

describe('bindingsByDef', () => {
  const index = bindingsByDef();

  it('maps a def id to the moment kinds whose cue names it', () => {
    expect(index.get('ward-gained')?.kinds).toContain('shieldGain');
  });

  it('maps a def id to the cards that override to it, with their tribes', () => {
    const ruby = index.get('ruby-lance');
    expect(ruby?.cards.map((c) => c.cardId)).toContain('bloodbinder');
    expect(ruby?.cards.find((c) => c.cardId === 'bloodbinder')?.tribe).toBe('demon');
  });

  // `burst-thin-trail` is a committed but deliberately unbound def (a travelling ribbon + burst draft): no
  // kind cue and no card override names it. If a future migration DOES bind it, re-point this at whatever
  // committed def is still unbound rather than deleting the case — "unbound ⇒ no entry" is the invariant.
  it('has no entry for a def nothing binds to', () => {
    expect(index.get('burst-thin-trail')).toBeUndefined();
  });

  // The distinction the whole change turns on: `strike-impact` has no binding EITHER, and this map is right
  // to omit it — it is not a bindings bug. It plays from code, and `usage` is what tells the two apart.
  it('has no entry for a def that plays from code, because nothing BINDS it', () => {
    expect(index.get('strike-impact')).toBeUndefined();
  });
});

/**
 * The three states, decided in one place.
 *
 * Before the pixiFx migration "no binding" was near enough "inert" and the library said so. Seven defs then
 * started playing from direct `playDef()` calls with no binding at all, and the single label became a lie.
 */
describe('usageOf', () => {
  const none = { kinds: [], cards: [] };

  it('calls a def with a kind cue bound', () => {
    expect(usageOf({ kinds: ['shieldGain'], cards: [] }, [])).toBe('bound');
  });

  it('calls a def with only a card override bound', () => {
    expect(usageOf({ kinds: [], cards: [{ cardId: 'x', name: 'X', tribe: 'demon', missing: false }] }, [])).toBe('bound');
  });

  // THE fix. A def nothing binds but code fires must not share a label with a dead draft.
  it('calls a def that only code fires "code", not unused', () => {
    expect(usageOf(none, ['Recruit.tsx'])).toBe('code');
  });

  it('calls a def with neither unused', () => {
    expect(usageOf(none, [])).toBe('unused');
  });

  // A binding is what an author can retarget from this browser, so it leads; the call sites ride along on the
  // entry regardless, so nothing is hidden by the precedence.
  it('prefers the binding when a def is both', () => {
    expect(usageOf({ kinds: ['shieldGain'], cards: [] }, ['Recruit.tsx'])).toBe('bound');
  });
});

describe('codeCoverage', () => {
  const rows = codeCoverage();

  it('lists the defs the game plays with no moment kind, each with the files that fire it', () => {
    expect(rows.map((r) => r.defId)).toContain('strike-impact');
    expect(rows.find((r) => r.defId === 'strike-impact')?.files).toEqual(['choreo/channels/impact.ts']);
  });

  it('never lists a def with no call site — the row would have nothing to say', () => {
    expect(rows.every((r) => r.files.length > 0)).toBe(true);
  });

  // A def with a binding belongs in the kind list above; repeating it here would double-count the map.
  it('does not repeat a bound def', () => {
    expect(rows.some((r) => r.defId === 'ward-gained')).toBe(false);
  });

  // The blind spot is STATED. A view that silently under-reports is the failure being fixed, so the caveat
  // has to name the unresolvable sites rather than imply the scan is total.
  it('states what the scan cannot resolve', () => {
    expect(codeScanCaveat()).toContain('choreo/score.ts');
    expect(codeScanCaveat()).toContain('variable');
  });
});

describe('kindCoverage', () => {
  const coverage = kindCoverage();

  it('lists EVERY moment kind, bound or not', () => {
    expect(coverage.length).toBe(Object.keys(getScore()).length);
  });

  it('names the def for a bound kind', () => {
    expect(coverage.find((c) => c.kind === 'shieldGain')?.def).toBe('ward-gained');
  });

  // Gaps are the entire point of the coverage lens.
  it('reports null for a kind with no authored def', () => {
    const gap = coverage.find((c) => c.kind === 'summon');
    expect(gap).toBeDefined();
    expect(gap?.def).toBeNull();
  });
});

/**
 * THE guard, asserted through the catalog's OWN view rather than the raw tables (`bindings.test.ts` covers
 * those). A binding naming a def that does not exist is a silent no-op at runtime — `playDef` returns null
 * and nothing plays, indistinguishable from a binding that was never wired, which is the ambiguity that cost
 * a long debugging session on Bloodbinder. Reading `bindingsByDef()` means a bug in the catalog's own
 * transformation — a def id dropped or mangled on the way through — is caught here too, which is the part
 * the raw-table test cannot see.
 */
describe('binding integrity', () => {
  it('every def id the browser would render a row for exists in the registry', async () => {
    await import('../primitives');
    const { listDefs } = await import('../fxDefs');
    const known = new Set(listDefs().map((d) => d.id));
    const missing = [...bindingsByDef().keys()].filter((id) => !known.has(id));
    expect(missing, `bindings naming defs that do not exist: ${missing.join(', ')}`).toEqual([]);
  });
});

import { buildCatalog, PRESET_ID_PREFIX } from './catalog';
import { registerSavedDef } from '../fxDefs';

describe('buildCatalog', () => {
  it('returns one entry per registered def, exactly once', async () => {
    await import('../primitives');
    const { listDefs } = await import('../fxDefs');
    const catalog = buildCatalog();
    const browsable = listDefs().filter((d) => !d.id.startsWith(PRESET_ID_PREFIX));
    expect(catalog.length).toBe(browsable.length);
    expect(new Set(catalog.map((e) => e.def.id)).size).toBe(catalog.length);
  });

  // Preset bases are start-points, deliberately bound to nothing. Leaving them in would pad the "nothing
  // bound" column of the by-event lens — the exact signal that lens exists to give.
  it('excludes preset bases — they are start-points, not bound effects', () => {
    registerSavedDef({ version: 1, id: 'preset-bolt', duration: 100, layers: [] } as never);
    expect(buildCatalog().some((e) => e.def.id === 'preset-bolt')).toBe(false);
  });

  it('carries the derived facets and the bindings on each entry', async () => {
    await import('../primitives');
    const entry = buildCatalog().find((e) => e.def.id === 'ward-gained');
    expect(entry?.facets.shape).toBeTruthy();
    expect(entry?.bindings.kinds).toContain('shieldGain');
    expect(entry?.usage).toBe('bound');
  });

  /**
   * `burst-thin-trail` is the fixture for GENUINELY inert: a committed draft with no binding and no call
   * site. Keep that meaning if it ever gets wired — re-point the case at whatever def is still dead rather
   * than deleting it. It is the control the `code` case is measured against.
   */
  it('gives an unbound def empty bindings rather than undefined, and calls it unused', async () => {
    await import('../primitives');
    const entry = buildCatalog().find((e) => e.def.id === 'burst-thin-trail');
    expect(entry?.bindings).toEqual({ kinds: [], cards: [] });
    expect(entry?.callSites).toEqual([]);
    expect(entry?.usage).toBe('unused');
  });

  /**
   * THE regression. Every one of these plays constantly and none of them has a binding, so before this they
   * all rendered in the "nothing bound" column of a coverage map an author was trying to read.
   */
  it('calls a def that only code fires "code", never "unused"', async () => {
    await import('../primitives');
    const catalog = buildCatalog();
    for (const id of ['coins', 'click-puff', 'damage-burst', 'landing-dust', 'impact-dust', 'death-dissolve', 'strike-impact']) {
      const entry = catalog.find((e) => e.def.id === id);
      expect(entry, `${id} is missing from the catalog`).toBeDefined();
      expect(entry?.usage, `${id} should read as played from code`).toBe('code');
      expect(entry?.callSites.length, `${id} should name the files that fire it`).toBeGreaterThan(0);
    }
  });

  it('sorts by id so the list is stable between renders', async () => {
    await import('../primitives');
    const ids = buildCatalog().map((e) => e.def.id);
    expect(ids).toEqual([...ids].sort());
  });
});

import { buildCardRows } from './catalog';
import { CARD_INDEX } from '@game/content';

describe('buildCardRows', () => {
  const rows = buildCardRows();

  // EVERY card, not just the bound ones: seeing which tribes are bare is the point of the card lens, and
  // that is invisible if unbound cards are hidden.
  it('returns one row per card in CARD_INDEX', () => {
    expect(rows.length).toBe(Object.keys(CARD_INDEX).length);
  });

  it('names the explicit override for a card that has one', () => {
    expect(rows.find((r) => r.cardId === 'bloodbinder')?.defId).toBe('ruby-lance');
  });

  it('reports null for a card with no bespoke effect', () => {
    const plain = rows.find((r) => r.cardId !== 'bloodbinder' && r.defId === null);
    expect(plain).toBeDefined();
  });

  it('carries the tribe through for grouping', () => {
    expect(rows.find((r) => r.cardId === 'bloodbinder')?.tribe).toBe('demon');
  });
});

/**
 * A call site the author can act on. The scan reports `packages/ui/src`-relative paths, which are only
 * unambiguous if you already know the root — so the library prints the whole thing.
 */
describe('call-site paths', () => {
  it('prefixes the scan root so the path can be pasted somewhere', () => {
    expect(callSitePath('Recruit.tsx')).toBe('packages/ui/src/Recruit.tsx');
    expect(callSitePath('choreo/channels/impact.ts')).toBe('packages/ui/src/choreo/channels/impact.ts');
  });

  it('joins every site of a def into one line', () => {
    expect(callSitesLabel(['Recruit.tsx', 'useCombatReplay.ts'])).toBe(
      'packages/ui/src/Recruit.tsx · packages/ui/src/useCombatReplay.ts',
    );
    expect(callSitesLabel([])).toBe('');
  });

  // A real snapshot row, so this fails if the scan ever starts reporting something the prefix does not fit
  // (an absolute path, say, or a `../` escape).
  it('produces a path that resolves for every def the scan found', () => {
    for (const row of codeCoverage()) {
      for (const file of row.files) {
        expect(callSitePath(file).startsWith('packages/ui/src/')).toBe(true);
        expect(callSitePath(file)).not.toContain('..');
      }
    }
  });
});
