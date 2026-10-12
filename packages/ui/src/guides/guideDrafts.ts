/**
 * GUIDES: what the editor holds, and how it becomes the document the server accepts. Pure: no React, no network.
 *
 * The author types a title, a write-up and picks cards. Two things are worked out for them at save time:
 *  - `mentions`: the cards of THIS set the write-up names (owner 2026-10-11: any card name lights up as you type),
 *    so they become hoverable for readers. Whole names only, capitals ignored, the longest name first.
 *  - `sets`: the sets the guide shows in (the carry-over rule, `guideSetsFor`).
 *
 * A guide holding a card that is missing from the set cannot be saved (`draftProblems`), so a saved guide is always
 * whole in the set it was saved in.
 */
import type { Tribe } from '@game/core';
import { poolFor, type SetId } from '@game/content';
import { GUIDE_LIMITS, TEAM_BYLINE, guideSetsFor, validateGuideDraft } from '@game/guides';
import { BUNDLED_GUIDE_DATA } from './guides.bundled';
import { GUIDES, SET_FACTS, poolIdsFor, type Guide } from './guides';
import type { GuideDraftInput } from './guidesRemote';

/** A guide while it is being edited. Nicknames are rows (a word and a card) so a half-typed one can exist. */
export interface EditorDraft {
  /** The server row being edited; null for a new guide. */
  rowId: string | null;
  /** The revision that row was loaded at. */
  revision: number | null;
  official: boolean;
  byline: string;
  tribes: Tribe[];
  pairsWith: Tribe[];
  iconCard: string;
  title: string;
  tagline: string;
  body: string;
  core: string[];
  enablers: string[];
  /** Nickname rows. A row's card counts as one of the guide's cards: it must be in the set (`missingIn`). */
  aliases: Array<{ word: string; card: string }>;
  /** The guide this one was duplicated from (a server row id), sent only when the guide is first created. */
  forkedFrom: string | null;
}

export function emptyDraft(byline: string): EditorDraft {
  return { rowId: null, revision: null, official: false, byline, tribes: [], pairsWith: [], iconCard: '', title: '', tagline: '', body: '', core: [], enablers: [], aliases: [], forkedFrom: null };
}

export function draftFromGuide(g: Guide): EditorDraft {
  return {
    rowId: g.rowId,
    revision: g.rowId ? g.revision : null,
    official: g.official,
    byline: g.byline,
    tribes: [...g.tribes],
    pairsWith: [...(g.pairsWith ?? [])],
    iconCard: g.iconCard,
    title: g.title,
    tagline: g.tagline,
    body: g.body,
    core: [...g.core],
    enablers: [...g.enablers],
    aliases: Object.entries(g.aliases ?? {}).map(([word, card]) => ({ word, card })),
    forkedFrom: null,
  };
}

/** A copy to edit: a NEW private guide under `byline`, remembering the guide it came from (when that has a row). */
export function duplicateDraft(g: Guide, byline: string): EditorDraft {
  const suffix = ' (copy)';
  const title = [...g.title].slice(0, GUIDE_LIMITS.title - suffix.length).join('') + suffix;
  return { ...draftFromGuide(g), rowId: null, revision: null, official: false, byline, title, forkedFrom: g.rowId };
}

export const sameDraft = (a: EditorDraft, b: EditorDraft): boolean => JSON.stringify(a) === JSON.stringify(b);

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface NameIndex { byName: Map<string, string>; re: RegExp | null }
const nameIndex = new Map<SetId, NameIndex>();
/** A set's card names (lower case -> id) and one expression that finds any of them as a whole name, longest first. */
function namesOf(setId: SetId): NameIndex {
  let hit = nameIndex.get(setId);
  if (!hit) {
    const byName = new Map<string, string>();
    for (const c of poolFor(setId).all) {
      const key = c.name.toLowerCase();
      if (!byName.has(key)) byName.set(key, c.id);
    }
    const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
    // A whole name: not glued to a letter or digit on either side (a card name may itself end in punctuation).
    hit = { byName, re: names.length ? new RegExp(`(?<![a-z0-9])(?:${names.join('|')})(?![a-z0-9])`, 'gi') : null };
    nameIndex.set(setId, hit);
  }
  return hit;
}

/** The cards of `setId` that `body` names, in the order they first appear, without those in `listed`. */
export function mentionsFor(body: string, setId: SetId, listed: readonly string[]): string[] {
  const { byName, re } = namesOf(setId);
  if (!re || !body) return [];
  const skip = new Set(listed);
  const out: string[] = [];
  for (const m of body.matchAll(re)) {
    const id = byName.get(m[0].toLowerCase());
    if (!id || skip.has(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= GUIDE_LIMITS.mentions) break;
  }
  return out;
}

/**
 * The draft's cards that are not in `setId`'s pool (archived, moved, or gone), each once: Core, Enablers and the card of
 * every nickname row (a nickname's card counts as one of the guide's cards; a row with no card yet is skipped).
 */
export function missingIn(d: EditorDraft, setId: SetId): string[] {
  const pool = poolIdsFor(setId);
  const nicknameCards = d.aliases.map((a) => a.card).filter((id) => id !== '');
  return [...new Set([...d.core, ...d.enablers, ...nicknameCards])].filter((id) => !pool.has(id));
}

/** The document for `guide-write`. Derives `mentions` and `sets`; never sends a half-typed nickname. */
export function toWire(d: EditorDraft, setId: SetId): GuideDraftInput {
  const aliases: Record<string, string> = {};
  for (const a of d.aliases) {
    const word = a.word.trim();
    if (word && a.card) aliases[word] = a.card;
  }
  const listed = [...d.core, ...d.enablers];
  // A nickname's card that is not Core or Enabler must be listed, so those take their slots first; the write-up's
  // names fill what is left. (Order is not shown to players.)
  const mentions: string[] = [];
  for (const id of Object.values(aliases)) {
    if (!listed.includes(id) && !mentions.includes(id) && mentions.length < GUIDE_LIMITS.mentions) mentions.push(id);
  }
  for (const id of mentionsFor(d.body, setId, [...listed, ...mentions])) {
    if (mentions.length >= GUIDE_LIMITS.mentions) break;
    mentions.push(id);
  }
  const sets = guideSetsFor({ core: d.core, enablers: d.enablers, mentions, tribes: d.tribes, pairsWith: d.pairsWith }, SET_FACTS);
  return {
    ...(d.rowId ? { id: d.rowId, revision: d.revision ?? 1 } : {}),
    official: d.official,
    byline: d.official ? TEAM_BYLINE : d.byline,
    sets,
    tribes: [...d.tribes],
    pairsWith: [...d.pairsWith],
    iconCard: d.iconCard || d.core[0] || '',
    title: d.title,
    tagline: d.tagline,
    body: d.body,
    core: [...d.core],
    enablers: [...d.enablers],
    mentions,
    aliases,
    ...(d.rowId ? {} : { forkedFrom: d.forkedFrom }),
  };
}

/** What the editor tells the author about each part of the guide the limits refuse. */
const HELP: Readonly<Record<string, string>> = {
  title: `Give the guide a title of up to ${GUIDE_LIMITS.title} characters.`,
  tagline: `Keep the tagline to ${GUIDE_LIMITS.tagline} characters.`,
  body: `Write the guide, in up to ${GUIDE_LIMITS.body.toLocaleString('en-US')} characters.`,
  byline: `Add a "by" line of up to ${GUIDE_LIMITS.byline} characters.`,
  core: `Add 1 to ${GUIDE_LIMITS.core} Core cards, each once.`,
  enablers: `Use up to ${GUIDE_LIMITS.enablers} Enablers, each once.`,
  iconCard: 'Pick an art icon.',
  tribes: `Pick up to ${GUIDE_LIMITS.tribes} tribes that are in this set.`,
  pairsWith: 'Pick a "pairs with" tribe that is in this set.',
  aliases: `Each nickname needs a word and a card, up to ${GUIDE_LIMITS.aliases} nicknames.`,
  mentions: 'The write-up names too many cards.',
  sets: 'Add cards from this set.',
};

/** Which tribe field to blame when this set is left out: "pairs with" only when every picked tribe is on the roster and it is not. */
function tribeField(d: EditorDraft, setId: SetId): 'tribes' | 'pairsWith' {
  const roster = new Set<string>(SET_FACTS.find((f) => f.id === setId)?.tribes ?? []);
  return d.tribes.every((t) => roster.has(t)) && d.pairsWith.some((t) => !roster.has(t)) ? 'pairsWith' : 'tribes';
}

/** Why this draft cannot be saved yet, most important first. Empty = it can. */
export function draftProblems(d: EditorDraft, setId: SetId): Array<{ field: string; message: string }> {
  const missing = missingIn(d, setId);
  if (missing.length > 0) {
    return [{ field: 'cards', message: missing.length === 1 ? 'Remove the card that is missing or removed before saving.' : 'Remove the cards that are missing or removed before saving.' }];
  }
  const wire = toWire(d, setId);
  const v = validateGuideDraft(wire);
  if (!v.ok) {
    // Two refusals are reported under the field the author can act on. An empty Core row leaves no art icon, and the
    // server checks the icon first: say Core. With every card in this set, an empty `sets` can only mean a tribe that
    // shares no roster with these cards: say tribes.
    const field = v.field === 'iconCard' && d.core.length === 0 ? 'core' : v.field === 'sets' ? tribeField(d, setId) : v.field;
    return [{ field, message: HELP[field] ?? 'Something on this guide is not valid.' }];
  }
  // Every card is in this set, so the only way this set is absent from `sets` is a tribe that is not on its roster.
  if (!wire.sets.includes(setId)) {
    const field = tribeField(d, setId);
    return [{ field, message: HELP[field]! }];
  }
  return [];
}

/** The built-in guides as the documents the team-only import sends (the Import button and the round-trip test). */
export function builtInImportPayload(): GuideDraftInput[] {
  return BUNDLED_GUIDE_DATA.map((b) => {
    const guide = GUIDES.find((g) => g.id === b.id);
    if (!guide) throw new Error(`built-in guide ${b.id} has no matching Guide`);
    return {
      slug: b.id,
      official: true,
      byline: TEAM_BYLINE,
      sets: [...guide.sets],
      tribes: [...b.tribes],
      pairsWith: [...(b.pairsWith ?? [])],
      iconCard: b.iconCard,
      title: b.title,
      tagline: b.tagline,
      body: b.body,
      core: [...b.core],
      enablers: [...b.enablers],
      mentions: [...(b.mentions ?? [])],
      aliases: { ...(b.aliases ?? {}) },
    };
  });
}
