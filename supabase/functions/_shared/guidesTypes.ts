// GENERATED from packages/guides/src/types.ts by `npm run guides:shared`. DO NOT EDIT.
// Edit the source, re-run the script, and commit both; sharedArtifact.test.ts fails CI when they drift.
// Deno module (the guide-write Edge Function imports it); the repo's tsc/eslint skip supabase/**.
/**
 * GUIDES: the wire shapes and limits shared by the client, the `guide-write` Edge Function and the tests
 * (spec: docs/superpowers/specs/2026-10-11-community-guides-design.md).
 *
 * Dependency-free. `npm run guides:shared` copies this file VERBATIM into supabase/functions/_shared/guidesTypes.ts;
 * `sharedArtifact.test.ts` fails CI on drift.
 */

/** Every number here is the owner's (spec section 1). The SQL repeats `guidesPerPlayer` and `savesPerHour`. */
export const GUIDE_LIMITS = Object.freeze({
  guidesPerPlayer: 20,
  title: 40,
  tagline: 80,
  body: 1200,
  byline: 24,
  core: 6,
  enablers: 6,
  mentions: 20,
  tribes: 2,
  pairsWith: 1,
  aliases: 6,
  aliasWord: 24,
  sets: 8,
  savesPerHour: 30,
  importBatch: 50,
  /** The request body ceiling the Edge Function enforces before parsing. */
  bodyBytes: 64 * 1024,
});

/** The "by" line every official guide wears. Reserved: a player's guide can never use it. */
export const TEAM_BYLINE = 'Team Ascent';

export const CARD_ID_RE = /^[a-z0-9_-]{1,48}$/;
/** Never a card id and never a nickname, although they fit the shapes: the client indexes cards in plain objects,
 *  where these three name Object's own members instead of a card. */
export const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
export const TRIBE_RE = /^[a-z]{2,20}$/;
export const SET_ID_RE = /^set[0-9]{1,3}$/;
export const SLUG_RE = /^[a-z0-9-]{3,60}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One `guides` row as the client sees it. */
export interface GuideRecord {
  id: string;
  /** Only on the imported built-in guides. */
  slug: string | null;
  authorId: string | null;
  byline: string;
  official: boolean;
  published: boolean;
  hidden: boolean;
  sets: string[];
  tribes: string[];
  pairsWith: string[];
  iconCard: string;
  title: string;
  tagline: string;
  body: string;
  core: string[];
  enablers: string[];
  mentions: string[];
  aliases: Record<string, string>;
  forkedFrom: string | null;
  forkedTitle: string | null;
  forkedByline: string | null;
  bookmarkCount: number;
  sortOrder: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0);

/** Parse a `guides` row (snake_case). Tolerant of a malformed row; null when it has no id, title or write-up. */
export function parseGuideRecord(v: unknown): GuideRecord | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id);
  const title = str(o.title);
  const body = str(o.body);
  if (!id || !title || !body) return null;
  const aliases: Record<string, string> = {};
  if (o.aliases && typeof o.aliases === 'object' && !Array.isArray(o.aliases)) {
    for (const [k, val] of Object.entries(o.aliases as Record<string, unknown>)) if (typeof val === 'string') aliases[k] = val;
  }
  return {
    id,
    slug: strOrNull(o.slug),
    authorId: strOrNull(o.author_id),
    byline: str(o.byline),
    official: o.official === true,
    published: o.published === true,
    hidden: o.hidden === true,
    sets: strs(o.sets),
    tribes: strs(o.tribes),
    pairsWith: strs(o.pairs_with),
    iconCard: str(o.icon_card),
    title,
    tagline: str(o.tagline),
    body,
    core: strs(o.core),
    enablers: strs(o.enablers),
    mentions: strs(o.mentions),
    aliases,
    forkedFrom: strOrNull(o.forked_from),
    forkedTitle: strOrNull(o.forked_title),
    forkedByline: strOrNull(o.forked_byline),
    bookmarkCount: int(o.bookmark_count),
    sortOrder: int(o.sort_order),
    revision: int(o.revision),
    createdAt: str(o.created_at),
    updatedAt: str(o.updated_at),
  };
}
