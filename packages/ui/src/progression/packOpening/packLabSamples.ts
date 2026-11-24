import {
  COSMETIC_RARITIES, cosmeticOf,
  type CosmeticCategory, type CrateRarity, type PackCard, type PackLook, type PackOpenResult,
} from '@game/progression';
import { SECRET_PACK_LOOK_ID } from './packArt';

/**
 * THE PACK LAB'S SAMPLE PACKS (dev only). Ready-made `PackOpenResult`s the owner opens to feel the tear, the sleeve and
 * the flip, plus a look picker that re-dresses any of them. Ids are real catalog ids so the faces show real art.
 *
 * The catalog has NO board or music items yet (those categories are disabled in COSMETIC_CATEGORY_DEFS), so the
 * `every-category` samples use two clearly-named fake ids for them. `rewardPreview` renders an unknown id as the "update
 * the game" face, which is the honest picture of a board or music card today. `sampleCategoryOf` resolves a card's
 * category through the catalog, then through `FALLBACK_CATEGORY`, so the "covers all ten categories" test is real.
 */

/** Fake ids for the categories the catalog does not have yet. Delete an entry the day the catalog gains the real item. */
const FALLBACK_CATEGORY: Readonly<Record<string, CosmeticCategory>> = {
  lab_fake_board: 'board',
  lab_fake_music: 'music',
};

/** A card's category: the catalog's word, else the Lab's fallback table, else null (a truly unknown id). */
export function sampleCategoryOf(rewardId: string): CosmeticCategory | null {
  return cosmeticOf(rewardId)?.category ?? FALLBACK_CATEGORY[rewardId] ?? null;
}

const rarityLook = (r: CrateRarity): PackLook => ({ kind: 'rarity', id: `rarity-${r}`, name: `${r[0]!.toUpperCase()}${r.slice(1)} Pack`, guaranteedFloor: r });
const categoryLook = (id: CosmeticCategory, name: string, floor: CrateRarity = 'rare'): PackLook => ({ kind: 'category', id: `category-${id}`, name, guaranteedFloor: floor });

/** The look picker's options: a pack per rarity, a few category packs, and themed placeholders. */
export const PACK_LAB_LOOKS: readonly PackLook[] = [
  ...COSMETIC_RARITIES.map(rarityLook),
  categoryLook('hero_skin', 'Hero Skin Pack'),
  categoryLook('minion_skin', 'Minion Skin Pack'),
  categoryLook('emote', 'Emote Pack'),
  categoryLook('card_plate', 'Card Plate Pack', 'epic'),
  { kind: 'themed', id: 'themed-launch', name: 'Launch Pack (placeholder)', guaranteedFloor: 'epic' },
  { kind: 'themed', id: 'themed-season', name: 'Season Pack (placeholder)', guaranteedFloor: 'legendary' },
  // the owner's Secret wrapper; Secret is not a rarity yet, so it glows at an Ancient floor for now
  { kind: 'themed', id: SECRET_PACK_LOOK_ID, name: 'Secret Pack', guaranteedFloor: 'ancient' },
];

const RANK: Readonly<Record<CrateRarity, number>> = { common: 0, rare: 1, epic: 2, legendary: 3, ancient: 4 };

/** The result re-dressed in `look`; the guaranteed card is raised to the look's floor so the sample stays honest. */
export function withLook(result: PackOpenResult, look: PackLook): PackOpenResult {
  const cards = result.cards.map((c): PackCard => (
    c.guaranteed && RANK[c.rarity] < RANK[look.guaranteedFloor] ? { ...c, rarity: look.guaranteedFloor } : c
  ));
  return { ...result, pack: look, cards };
}

export interface PackLabSample { id: string; label: string; result: PackOpenResult; delayMs?: number; fail?: boolean }

const card = (rewardId: string, rarity: CrateRarity, aether?: number, guaranteed = false): PackCard => (
  { rewardId, rarity, guaranteed, duplicate: aether === undefined ? null : { aether } }
);

const make = (id: string, label: string, look: PackLook, cards: readonly PackCard[], extra: { delayMs?: number; fail?: boolean } = {}): PackLabSample => (
  { id, label, result: { packId: `lab-${id}`, pack: look, cards }, ...extra }
);

const rare = rarityLook('rare');
const epic = rarityLook('epic');
const legendary = rarityLook('legendary');
const ancient = rarityLook('ancient');

export const PACK_LAB_SAMPLES: readonly PackLabSample[] = [
  make('all-new', 'All new (5 cards)', rare, [
    card('title_wanderer', 'common'), card('skin_blackbelt_1', 'common'), card('emote_angry_mushy', 'common'),
    card('alpha_tester', 'rare'), card('plate_aquarium_rocks', 'rare', undefined, true),
  ]),
  make('mixed-dupes', 'Mixed duplicates', rare, [
    card('title_wanderer', 'common', 20), card('skin_blackbelt_1', 'common'), card('frame_glass_shard', 'rare', 60),
    card('title_kingbreaker', 'epic'), card('plate_moonstone', 'epic', 120, true),
  ]),
  make('legendary-guaranteed', 'Legendary guaranteed', legendary, [
    card('title_wanderer', 'common'), card('frame_honey', 'common'), card('attack_coin', 'rare'),
    card('skin_bram_1', 'rare', 60), card('skin_soren_2', 'legendary', undefined, true),
  ]),
  make('ancient-guaranteed', 'Ancient guaranteed', ancient, [
    card('title_wanderer', 'common'), card('emote_nervous_jensen', 'rare'), card('title_kingbreaker', 'epic', 120),
    card('attack_blast', 'legendary'), card('plate_mooncloud', 'ancient', undefined, true),
  ]),
  // Two packs = ten cards = all ten categories (board and music via the fake ids above).
  make('every-category-a', 'Every category (1 of 2)', epic, [
    card('announcer_lemon', 'legendary'), card('skin_frank_1', 'common'), card('skin_blackbelt_1', 'common'),
    card('title_the_unbroken', 'legendary'), card('attack_cards', 'epic', undefined, true),
  ]),
  make('every-category-b', 'Every category (2 of 2)', epic, [
    card('lab_fake_board', 'rare'), card('lab_fake_music', 'rare'), card('frame_multichrome_energy', 'epic'),
    card('emote_flirty_midas', 'epic'), card('plate_blossom', 'legendary', undefined, true),
  ]),
  make('unknown-reward', 'Unknown reward (newer server)', rare, [
    card('title_wanderer', 'common'), card('future_reward_from_a_newer_server', 'rare'), card('frame_honey', 'common'),
    card('lab_unknown_item', 'rare'), card('plate_aquarium_rocks', 'rare', undefined, true),
  ]),
  make('slow', 'Slow server (5 s wait at the pop)', rare, [
    card('title_wanderer', 'common'), card('frame_honey', 'common'), card('emote_angry_mushy', 'common'),
    card('alpha_tester', 'rare'), card('plate_aquarium_rocks', 'rare', undefined, true),
  ], { delayMs: 5000 }),
  make('failed', 'Failed (server error at the pop)', rare, [card('title_wanderer', 'rare', undefined, true)], { fail: true }),
];


/** The timers a Lab run has pending; `cancelLabTimers` clears them so none fires after the opener closes or the panel unmounts. */
export type LabTimers = Set<ReturnType<typeof setTimeout>>;
export const cancelLabTimers = (timers: LabTimers): void => { for (const t of timers) clearTimeout(t); timers.clear(); };

/**
 * The `open` the Lab hands PackOpener for one run: waits the sample's `delayMs` (on a cancellable timer), then answers
 * with the result dressed in the RUN's look, or an error for `fail`. A cancelled wait never settles.
 */
export function makeLabOpen(
  sample: PackLabSample, look: PackLook, timers: LabTimers,
): () => Promise<{ status: 'ok'; result: PackOpenResult } | { status: 'error'; reason: string }> {
  return () => new Promise((resolve) => {
    const answer = (): void => {
      resolve(sample.fail ? { status: 'error', reason: 'lab: simulated failure' } : { status: 'ok', result: withLook(sample.result, look) });
    };
    if (!sample.delayMs) { answer(); return; }
    const t = setTimeout(() => { timers.delete(t); answer(); }, sample.delayMs);
    timers.add(t);
  });
}
