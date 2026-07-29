import { CARD_INDEX } from '@game/content';
import type { StoredFxDef } from '../defStore';
import { primitiveLabel } from './copy';
import { bindingFor, effectiveTables } from '../../choreo/bindings';
import { getScore } from '../../choreo/score';
import type { MomentKind } from '../../choreo/kinds';
import { listDefs } from '../fxDefs';
import type { FxCardRow } from './catalogView';

/** The colour buckets a def can be filed under. `neutral` is not a failure — it is the honest answer for a
 *  white, black or grey stop, which is what stops 1 and 4 of nearly every palette are. */
export const FX_HUES = ['red', 'orange', 'gold', 'green', 'cyan', 'blue', 'violet', 'magenta', 'neutral'] as const;
export type FxHue = (typeof FX_HUES)[number];

/** Below this saturation, or outside this lightness band, a colour has no hue worth filing under. */
const MIN_SATURATION = 0.18;
const MIN_LIGHTNESS = 0.08;
const MAX_LIGHTNESS = 0.94;

/** Hue ranges in degrees, in the order they are tested. Upper bound exclusive; the last entry wraps. */
const HUE_RANGES: [FxHue, number, number][] = [
  ['red', 345, 360],
  ['red', 0, 18],
  ['orange', 18, 38],
  ['gold', 38, 65],
  ['green', 65, 160],
  ['cyan', 160, 200],
  ['blue', 200, 255],
  ['violet', 255, 300],
  ['magenta', 300, 345],
];

/**
 * The colour bucket for one 0xRRGGBB stop.
 *
 * Total by construction: anything non-finite, out of range, or too grey/dark/bright to have a meaningful hue
 * returns `neutral` rather than throwing or guessing. That matters because it is fed raw palette numbers
 * straight out of def JSON, which is untrusted input.
 */
export function hueBucketOf(rgb: number): FxHue {
  if (!Number.isFinite(rgb) || rgb < 0 || rgb > 0xffffff) return 'neutral';
  const r = ((rgb >> 16) & 255) / 255;
  const g = ((rgb >> 8) & 255) / 255;
  const b = (rgb & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (l < MIN_LIGHTNESS || l > MAX_LIGHTNESS) return 'neutral';
  const d = max - min;
  if (d === 0) return 'neutral';
  const s = d / (1 - Math.abs(2 * l - 1));
  if (s < MIN_SATURATION) return 'neutral';

  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;

  for (const [hue, lo, hi] of HUE_RANGES) if (h >= lo && h < hi) return hue;
  return 'neutral';
}

export type FxMotion = 'travels' | 'in place';

export interface FxFacets {
  /** Human primitive names in layer order, de-duplicated: `Ring + Burst + Trail`. */
  shape: string;
  hue: FxHue;
  motion: FxMotion;
}

/** Which palette stop identifies a def's colour. Stop 1 is a near-black rim and stop 4 is `#ffffff` in
 *  nearly every shipped palette — only stop 2 carries a hue anyone would name. */
const IDENTIFYING_STOP = 1;

/**
 * Everything about a def that can be worked out from the def itself. No authoring, so it is always correct
 * and never needs back-filling for the defs that already exist.
 */
export function deriveFacets(def: StoredFxDef): FxFacets {
  const seen: string[] = [];
  for (const l of def.layers) if (!seen.includes(l.primitive)) seen.push(l.primitive);
  const shape = seen.map(primitiveLabel).join(' + ');

  // Count buckets in layer order so the FIRST layer wins a tie simply by being counted first.
  const counts = new Map<FxHue, number>();
  let best: FxHue | null = null;
  for (const l of def.layers) {
    const palette = l.params.palette;
    if (!Array.isArray(palette)) continue;
    const stop = palette[IDENTIFYING_STOP];
    if (typeof stop !== 'number') continue;
    const bucket = hueBucketOf(stop);
    if (bucket === 'neutral') continue;
    const n = (counts.get(bucket) ?? 0) + 1;
    counts.set(bucket, n);
    if (best === null || n > (counts.get(best) ?? 0)) best = bucket;
  }

  return {
    shape,
    hue: best ?? 'neutral',
    motion: def.layers.some((l) => l.anchor === 'travel') ? 'travels' : 'in place',
  };
}

export interface FxBindingCard {
  cardId: string;
  /** The card's display name, or the raw id when the card is unknown (see `missing` below). */
  name: string;
  tribe: string;
  /** True when a binding names a card that is not in `CARD_INDEX` — surfaced rather than skipped. */
  missing: boolean;
}

export interface FxBindings {
  kinds: MomentKind[];
  cards: FxBindingCard[];
}

/**
 * def id → what binds to it. Reads the LIVE resolver (`effectiveTables`, which folds in any session
 * overrides), so the browser shows what would actually play right now rather than what the committed file
 * says.
 */
export function bindingsByDef(): Map<string, FxBindings> {
  const out = new Map<string, FxBindings>();
  const entry = (id: string): FxBindings => {
    const found = out.get(id) ?? { kinds: [], cards: [] };
    out.set(id, found);
    return found;
  };

  const tables = effectiveTables();
  for (const [kind, binding] of Object.entries(tables.kinds)) entry(binding.def).kinds.push(kind as MomentKind);
  for (const [cardId, byKind] of Object.entries(tables.cards)) {
    const card = CARD_INDEX[cardId];
    for (const binding of Object.values(byKind)) {
      if (!binding) continue;
      entry(binding.def).cards.push({
        cardId,
        name: card?.name ?? cardId,
        tribe: card?.tribe ?? 'unknown',
        missing: card === undefined,
      });
    }
  }
  return out;
}

export interface FxKindCoverage {
  kind: MomentKind;
  /** The def bound to this kind, or null when nothing is — the gap the coverage lens exists to show. */
  def: string | null;
}

/**
 * Every moment kind with its bound def or null, in the score's own order.
 *
 * The kind LIST still comes from `getScore()` — that is the authority on which kinds exist — but the def
 * comes from the resolver, since a kind's cue no longer carries one.
 *
 * Safe only because two things hold together: `SCORE_DEFAULTS` is typed `Record<MomentKind, Cue[]>`, a TOTAL
 * record over every kind, and `bindings.test.ts` separately enforces that `bindings.json` cannot name a kind
 * outside that set. Break either and a bound kind missing from this list would vanish from the coverage
 * lens — which exists precisely to show gaps, so it would hide exactly what it was built to reveal.
 */
export function kindCoverage(): FxKindCoverage[] {
  return (Object.keys(getScore()) as MomentKind[]).map((kind) => ({
    kind,
    def: bindingFor(null, kind)?.def ?? null,
  }));
}

export interface FxCatalogEntry {
  def: StoredFxDef;
  facets: FxFacets;
  bindings: FxBindings;
}

const NO_BINDINGS: FxBindings = { kinds: [], cards: [] };

/**
 * Ids under this prefix are archetype BASES for the preset gallery. They are deliberately bound to nothing,
 * so leaving them in would pad the "nothing bound" column of the by-event lens — degrading the very coverage
 * map that lens exists to provide. They stay reachable for editing through the Workbench's "Start from"
 * picker, which reads `listDefs()` directly rather than the catalog.
 */
export const PRESET_ID_PREFIX = 'preset-';

/**
 * The whole library, as one array. Every view in the browser reads THIS and nothing else — which is the
 * point: "which def fires on Bloodbinder" is computed once here rather than separately per lens, so the
 * lenses cannot disagree with each other.
 *
 * Not memoised. `listDefs()` is already cached in `fxDefs.ts`, the derivations are a few dozen arithmetic
 * ops over ~20 defs, and the browser rebuilds only when it opens — caching here would mean owning an
 * invalidation story for a save, and that is exactly the bug class the def registry already had.
 */
export function buildCatalog(): FxCatalogEntry[] {
  const bindings = bindingsByDef();
  return listDefs()
    .filter((def) => !def.id.startsWith(PRESET_ID_PREFIX))
    .map((def) => ({ def, facets: deriveFacets(def), bindings: bindings.get(def.id) ?? { ...NO_BINDINGS } }))
    .sort((a, b) => a.def.id.localeCompare(b.def.id));
}

/**
 * One row per card in the game, with its explicit per-card effect or null.
 *
 * DELIBERATELY not limited to cards that have an override. This lens answers "which cards have bespoke
 * effects, and which tribes are bare" — and the bare half of that is invisible if unbound cards are dropped.
 *
 * `defId` is only ever an EXPLICIT override. It does not attempt to work out which moment kinds a card can
 * produce: that is a static analysis of effect data which cannot be exact, because many moments only exist
 * at runtime. A null here means "uses whatever its moments give it", not "shows nothing".
 */
export function buildCardRows(): FxCardRow[] {
  const cards = effectiveTables().cards;
  return Object.values(CARD_INDEX).map((card) => {
    const byKind = cards[card.id];
    const first = byKind ? Object.values(byKind).find((b) => b !== undefined) : undefined;
    return { cardId: card.id, name: card.name, tribe: card.tribe, defId: first?.def ?? null };
  });
}
