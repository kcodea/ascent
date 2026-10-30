/**
 * EMOTES IN CHAT (owner 2026-10-30: "emotes in chat (they should probably be shrunk down)"; R-DM-EMOTE-01). A message
 * names an emote by a token in its body, `:<emote id>:` (e.g. `:emote_hi:`), so the stored row, the hub and the SQL
 * stay plain text (no schema change). A token is an emote only when it names a LIVE emote of the game's own set that
 * has its painted bubble in this build; anything else stays as the text it is. An older game shows the token text.
 *
 * Pure and cheap: one regex over a message, only when the message has a colon.
 */
import { cosmeticOf } from '@game/progression';
import { emoteSrc } from '../../emotes/emoteArt';

const TOKEN = /:(emote_[a-z0-9_]{1,60}):/g;

/** The token that puts an emote in a message. */
export const emoteToken = (id: string): string => `:${id}:`;

/** A live emote of the game's set with its art in this build (what a token must name to show as an emote). */
export function isChatEmote(id: string): boolean {
  const def = cosmeticOf(id);
  return !!def && def.category === 'emote' && def.active !== false && !!emoteSrc(id);
}

export type DmPiece = string | { emote: string };

/** A message body as text runs and emotes, in order. A body with no emote answers `[body]`. */
export function dmPieces(body: string): DmPiece[] {
  if (!body.includes(':')) return [body];
  const out: DmPiece[] = [];
  let at = 0;
  for (const m of body.matchAll(TOKEN)) {
    const id = m[1]!;
    if (!isChatEmote(id)) continue;
    const i = m.index!;
    if (i > at) out.push(body.slice(at, i));
    out.push({ emote: id });
    at = i + m[0].length;
  }
  if (!out.length) return [body];
  if (at < body.length) out.push(body.slice(at));
  return out;
}

/** The most emotes a message can hold and still show them big (a message of emotes only). */
export const SOLO_EMOTES_MAX = 3;

/** A message that is only emotes (spaces aside), few enough to show bigger. */
export function emoteOnly(pieces: readonly DmPiece[]): boolean {
  let n = 0;
  for (const p of pieces) {
    if (typeof p === 'string') { if (p.trim()) return false; } else n += 1;
  }
  return n > 0 && n <= SOLO_EMOTES_MAX;
}

/** The emote's name, for screen readers and plain-text places (an aria-label, the toast's label). */
export const emoteName = (id: string): string => cosmeticOf(id)?.name ?? id;

/** A body as plain words: each emote by its name. */
export function dmPlainText(body: string): string {
  return dmPieces(body).map((p) => (typeof p === 'string' ? p : emoteName(p.emote))).join('');
}
