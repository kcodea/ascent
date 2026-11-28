// GENERATED from packages/progression/src/packRoll.ts by `npm run progression:shared`. DO NOT EDIT.
// Edit the source, re-run the script, and commit both; sharedArtifact.test.ts fails CI when they drift.
// Deno module (the submit-progression Edge Function imports it); the repo's tsc/eslint skip supabase/**.
/**
 * THE PACK ROLL (spec docs/superpowers/specs/2026-11-27-pack-economy-design.md, section 6).
 *
 * A pure, deterministic function of (pack, owned, 15 draws in [0, 1)): five cards, the guaranteed one last. The server's
 * SQL twin (`progression_pack_roll`) must produce the same cards from the same 15 draws, so every step here is integer
 * weights and id-sorted lists, never a float comparison against a rounded table. No `Math.random`: the draws come in.
 * Bump `PACK_ROLL_VERSION` (packEconomy.ts) when any rule here changes.
 *
 * DEPENDENCY-FREE ON PURPOSE: sibling relative imports only (a shared artifact, see `sharedArtifact.ts`).
 */

import {
  COSMETICS, COSMETIC_CATEGORIES, COSMETIC_CATEGORY_DEFS, COSMETIC_RARITIES, crateRarityFallback,
  type CosmeticCategory, type CosmeticDef, type CrateRarity,
} from './progressionCosmetics.ts';
import { DEFAULT_PACK_ECONOMY, type PackEconomy } from './progressionPackEconomy.ts';
import { STYLE_PACK_IDS, type PackCard, type PackLook } from './progressionPacks.ts';

export const PACK_CARD_COUNT = 5;
/** Three draws per card: rarity, category, item. */
export const PACK_DRAW_COUNT = PACK_CARD_COUNT * 3;

export type PoolKind = 'all' | { category: CosmeticCategory } | { style: string };

const byId = (a: CosmeticDef, b: CosmeticDef): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const isRollable = (r: CosmeticDef['rarity']): r is CrateRarity => (COSMETIC_RARITIES as readonly string[]).includes(r);
/** floor(u * n); u is validated in [0, 1) so the index is inside [0, n - 1]. */
const pick = (u: number, n: number): number => Math.floor(u * n);

/**
 * The items a pack can give, owned or not: active, crate-sourced, in an ENABLED category, never Secret (the chest
 * pool's filter without the "not owned" clause), narrowed to a category or a style pack. Sorted by id.
 * (`admin_off` lives only in the database; the SQL adds that clause.)
 */
export function packPool(catalog: readonly CosmeticDef[], kind: PoolKind): CosmeticDef[] {
  return catalog
    .filter((c) => c.active && c.acquisition.type === 'crate' && COSMETIC_CATEGORY_DEFS[c.category].enabled && isRollable(c.rarity))
    .filter((c) => kind === 'all' || ('category' in kind ? c.category === kind.category : (c.packStyles ?? []).includes(kind.style)))
    .sort(byId);
}

/** The rarity a draw lands on over integer weights (rarities below `floor` weigh 0), in COSMETIC_RARITIES order. */
function drawRarity(u: number, odds: Record<CrateRarity, number>, floor: CrateRarity): CrateRarity {
  const at = COSMETIC_RARITIES.indexOf(floor);
  const weight = (i: number): number => (i >= at ? odds[COSMETIC_RARITIES[i]!] : 0);
  const total = COSMETIC_RARITIES.reduce((s, _, i) => s + weight(i), 0);
  const x = u * total;
  let hi = 0;
  let last: CrateRarity = floor;
  for (let i = 0; i < COSMETIC_RARITIES.length; i++) {
    if (weight(i) === 0) continue;
    last = COSMETIC_RARITIES[i]!;
    hi += weight(i);
    if (x < hi) return last;
  }
  return last;
}

/** One card from `pool`: rarity (odds, then fall-back), an equal-odds category, an equal-odds item in id order. */
function drawCard(
  pool: readonly CosmeticDef[], draws: readonly [number, number, number], odds: Record<CrateRarity, number>, floor: CrateRarity,
): CosmeticDef {
  const at = COSMETIC_RARITIES.indexOf(floor);
  const rolled = drawRarity(draws[0], odds, floor);
  const rarity = crateRarityFallback(rolled).find((r) => COSMETIC_RARITIES.indexOf(r) >= at && pool.some((c) => c.rarity === r));
  if (!rarity) throw new Error('rollPack: nothing in the pool at or above the floor');
  const ofRarity = pool.filter((c) => c.rarity === rarity);
  const cats = COSMETIC_CATEGORIES.filter((cat) => ofRarity.some((c) => c.category === cat));
  const cat = cats[pick(draws[1], cats.length)]!;
  const items = ofRarity.filter((c) => c.category === cat); // pool is id-sorted, so this is too
  return items[pick(draws[2], items.length)]!;
}

/** The pool a pack's own guaranteed card draws from (whole catalog for a rarity pack). Throws on a pack not sellable. */
function ownPoolKind(look: PackLook): PoolKind {
  if (look.kind === 'rarity') return 'all';
  if (look.kind === 'category') {
    const cat = look.id.replace(/^category-/, '');
    if (!look.id.startsWith('category-') || !(COSMETIC_CATEGORIES as readonly string[]).includes(cat)) throw new Error(`rollPack: unknown category pack ${look.id}`);
    return { category: cat as CosmeticCategory };
  }
  if (!STYLE_PACK_IDS.includes(look.id)) throw new Error(`rollPack: unknown style pack ${look.id}`);
  return { style: look.id };
}

/**
 * Roll a pack: exactly 5 cards, the guaranteed one last. Cards 1-4 draw from the whole catalog at the Standard odds.
 * Card 5: a rarity pack draws the whole catalog at the odds restricted to its rarity and above; a category / style
 * pack draws its own pool minus everything owned so far (cards 1-4 included), and when that is empty draws its own
 * pool again as a duplicate. A card is a duplicate if owned before the pack or granted by an earlier card.
 */
export function rollPack(input: {
  look: PackLook; owned: Iterable<string>; draws: readonly number[]; catalog?: readonly CosmeticDef[]; eco?: PackEconomy;
}): PackCard[] {
  const { look, draws } = input;
  const eco = input.eco ?? DEFAULT_PACK_ECONOMY;
  const catalog = input.catalog ?? COSMETICS;
  if (draws.length !== PACK_DRAW_COUNT) throw new Error(`rollPack: needs ${PACK_DRAW_COUNT} draws, got ${draws.length}`);
  if (!draws.every((u) => Number.isFinite(u) && u >= 0 && u < 1)) throw new Error('rollPack: every draw must be a finite number in [0, 1)');

  const all = packPool(catalog, 'all');
  const own = packPool(catalog, ownPoolKind(look));
  const have = new Set(input.owned);
  const cards: PackCard[] = [];
  for (let i = 0; i < PACK_CARD_COUNT; i++) {
    const d: [number, number, number] = [draws[i * 3]!, draws[i * 3 + 1]!, draws[i * 3 + 2]!];
    const last = i === PACK_CARD_COUNT - 1;
    let c: CosmeticDef;
    if (!last) c = drawCard(all, d, eco.standardOdds, 'common');
    else if (look.kind === 'rarity') c = drawCard(all, d, eco.standardOdds, look.guaranteedFloor);
    else {
      const fresh = own.filter((x) => !have.has(x.id));
      c = drawCard(fresh.length > 0 ? fresh : own, d, eco.standardOdds, 'common');
    }
    const rarity = c.rarity as CrateRarity;
    cards.push({ rewardId: c.id, rarity, guaranteed: last, duplicate: have.has(c.id) ? { aether: eco.duplicateAether[rarity] } : null });
    have.add(c.id);
  }
  return cards;
}
