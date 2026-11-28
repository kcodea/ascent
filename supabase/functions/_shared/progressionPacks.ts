// GENERATED from packages/progression/src/packs.ts by `npm run progression:shared`. DO NOT EDIT.
// Edit the source, re-run the script, and commit both; sharedArtifact.test.ts fails CI when they drift.
// Deno module (the submit-progression Edge Function imports it); the repo's tsc/eslint skip supabase/**.
/**
 * THE PACK OPEN RESULT CONTRACT (spec docs/superpowers/specs/2026-11-23-pack-opening-design.md, section 5).
 *
 * What a pack opening is handed: the pack that was opened, 1..5 cards in reveal order (the single guaranteed card is
 * always LAST), and optionally the Aether balance after any duplicate refunds. The economy project's server answers in
 * this shape; the opening UI only ever sees the parsed value.
 *
 * DEPENDENCY-FREE ON PURPOSE, like the other progression files: sibling relative imports only. A shared
 * artifact (the Edge Functions import the generated copy).
 */

import { COSMETIC_RARITIES, type CrateRarity } from './progressionCosmetics.ts';

/** What art / name / colour a pack shows. */
export interface PackLook {
  kind: 'rarity' | 'category' | 'themed';
  id: string;
  name: string;
  /** The rarity the pack's guaranteed card is at least. */
  guaranteedFloor: CrateRarity;
}

export interface PackCard {
  /** A cosmetic id. Unknown ids are legal (a newer server): the UI shows the "update the game" face. */
  rewardId: string;
  /** Drives the card back: the server's word, not re-derived from the catalog. */
  rarity: CrateRarity;
  /** Exactly one card per pack; it is the last in `cards`. */
  guaranteed: boolean;
  /** Null = new to the player; otherwise the Aether the duplicate dismantled into. */
  duplicate: { aether: number } | null;
}

export interface PackOpenResult {
  /** The owned pack that was opened (idempotency is the server's job). */
  packId: string;
  pack: PackLook;
  /** 1..5 cards. */
  cards: readonly PackCard[];
  /** The player's balance after any duplicate refunds, when the server reports it. */
  aether?: number;
}

const PACK_KINDS: readonly string[] = ['rarity', 'category', 'themed'];
const MAX_CARDS = 5;

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isRarity = (v: unknown): v is CrateRarity => typeof v === 'string' && (COSMETIC_RARITIES as readonly string[]).includes(v);
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function parsePackLook(v: unknown): PackLook | null {
  if (!isRecord(v)) return null;
  if (typeof v.kind !== 'string' || !PACK_KINDS.includes(v.kind)) return null;
  if (typeof v.id !== 'string' || typeof v.name !== 'string' || !isRarity(v.guaranteedFloor)) return null;
  return Object.freeze({ kind: v.kind as PackLook['kind'], id: v.id, name: v.name, guaranteedFloor: v.guaranteedFloor });
}

function parsePackCard(v: unknown): PackCard | null {
  if (!isRecord(v)) return null;
  if (typeof v.rewardId !== 'string' || !isRarity(v.rarity) || typeof v.guaranteed !== 'boolean') return null;
  let duplicate: PackCard['duplicate'] = null;
  if (v.duplicate !== null) {
    if (!isRecord(v.duplicate) || !isCount(v.duplicate.aether)) return null;
    duplicate = Object.freeze({ aether: v.duplicate.aether });
  }
  return Object.freeze({ rewardId: v.rewardId, rarity: v.rarity, guaranteed: v.guaranteed, duplicate });
}

/**
 * Parse a pack open answer. Null on anything malformed: not 1..5 cards, not exactly one guaranteed card, the guaranteed
 * card not last, an unknown rarity or pack kind, a duplicate that is not a non-negative whole Aether, a non-string
 * `rewardId`, or a present-but-invalid `aether`. An unknown `rewardId` STRING is accepted. Returns a fresh frozen
 * object, never the input.
 */
export function parsePackOpenResult(v: unknown): PackOpenResult | null {
  if (!isRecord(v)) return null;
  if (typeof v.packId !== 'string') return null;
  const pack = parsePackLook(v.pack);
  if (!pack) return null;
  if (!Array.isArray(v.cards) || v.cards.length < 1 || v.cards.length > MAX_CARDS) return null;
  const cards: PackCard[] = [];
  for (const raw of v.cards) {
    const c = parsePackCard(raw);
    if (!c) return null;
    cards.push(c);
  }
  const guaranteed = cards.filter((c) => c.guaranteed).length;
  if (guaranteed !== 1 || !cards[cards.length - 1]!.guaranteed) return null;
  if (v.aether !== undefined && !isCount(v.aether)) return null;
  const out: PackOpenResult = v.aether === undefined
    ? { packId: v.packId, pack, cards: Object.freeze(cards) }
    : { packId: v.packId, pack, cards: Object.freeze(cards), aether: v.aether };
  return Object.freeze(out);
}

/** The total Aether the pack's duplicates dismantled into. */
export const packDuplicateAether = (r: PackOpenResult): number => r.cards.reduce((s, c) => s + (c.duplicate?.aether ?? 0), 0);
