import { COSMETIC_CATEGORY_DEFS, RARITY_LABELS, cosmeticOf, type CosmeticCategory, type CosmeticDef } from '@game/progression';
import { skinArtOf } from '../skins/skinArt';
import { emoteSrc } from '../emotes/emoteArt';
import { frameSrc } from '../portraitFrame/portraitFrameConfig';
import { CARD_PLATE_LOOKS } from '../cardPlate/cardPlateLook';

/**
 * The reward plate's label and preview art, shared by the chest opener (`CrateOpener`) and the pack opener.
 * Moved out of `CrateOpener.tsx` unchanged for the five art categories.
 */

/** The reward's player-facing name; a newer server's item on an older client still reads sensibly. */
export function rewardLabel(rewardId: string | null): { name: string; kind: string; rarity: string | null; rarityLabel: string | null } {
  return labelForDef(cosmeticOf(rewardId) ?? undefined);
}

function labelForDef(def: CosmeticDef | undefined): { name: string; kind: string; rarity: string | null; rarityLabel: string | null } {
  if (!def) return { name: 'New reward', kind: 'Update the game to see it', rarity: null, rarityLabel: null };
  // Skins name themselves as skins ("New hero skin"), not "New hero" (the Collection tab is called Heroes).
  const kind = def.category === 'title' ? 'New title'
    : def.category === 'hero_skin' ? 'New hero skin'
    : def.category === 'minion_skin' ? 'New minion skin'
    : `New ${COSMETIC_CATEGORY_DEFS[def.category].label.replace(/s$/, '').toLowerCase()}`;
  return { name: def.name, kind, rarity: def.rarity, rarityLabel: RARITY_LABELS[def.rarity] };
}

export type RewardArtKind = 'hero' | 'minion' | 'emote' | 'plate' | 'frame';
export type RewardEmblem = 'title' | 'announcer' | 'music' | 'hero_attack' | 'board' | 'unknown';

export interface RewardPreview {
  label: ReturnType<typeof rewardLabel>;
  art: { kind: RewardArtKind; url: string } | null;
  emblem: RewardEmblem | null;
  category: CosmeticCategory | null;
}

/** A skin shows its art beside the plate (owner 2026-09-29); an emote its bubble (2026-10-15); a card plate and a portrait
 *  frame the art their Collection tile shows (owner 2026-11-02). Attack animations, announcers and titles get an emblem. */
export function artKindOf(category: CosmeticCategory | undefined): RewardArtKind | null {
  return category === 'hero_skin' ? 'hero' : category === 'minion_skin' ? 'minion' : category === 'emote' ? 'emote'
    : category === 'card_plate' ? 'plate' : category === 'portrait_frame' ? 'frame' : null;
}

/** The art url for a def of an art category; undefined when the art is missing. */
export function artUrlOf(kind: RewardArtKind, def: CosmeticDef | undefined): string | undefined {
  return kind === 'emote' ? emoteSrc(def?.id)
    : kind === 'plate' ? (typeof def?.assets.art === 'string' ? CARD_PLATE_LOOKS[def.assets.art]?.thumb : undefined)
    : kind === 'frame' ? (def ? frameSrc(def.id) : undefined)
    : skinArtOf(def);
}

const EMBLEMS: readonly RewardEmblem[] = ['title', 'announcer', 'music', 'hero_attack', 'board'];

/** Pure core of `rewardPreview`, exported so a category with no catalog item yet (board, music) can be tested. */
export function previewForDef(def: CosmeticDef | undefined): RewardPreview {
  const label = labelForDef(def);
  if (!def) return { label, art: null, emblem: 'unknown', category: null };
  const kind = artKindOf(def.category);
  if (kind) {
    const url = artUrlOf(kind, def);
    if (url) return { label, art: { kind, url }, emblem: null, category: def.category };
    return { label, art: null, emblem: 'unknown', category: def.category };
  }
  const emblem = EMBLEMS.find((e) => e === def.category) ?? 'unknown';
  return { label, art: null, emblem, category: def.category };
}

export function rewardPreview(rewardId: string | null): RewardPreview {
  return previewForDef(cosmeticOf(rewardId) ?? undefined);
}
