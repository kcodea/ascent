/**
 * PING UI KEYS (owner 2026-10-30: "mentors/players should be able to ping discover card options, runes etc as well";
 * R-PING-08). Every choosable or inspectable thing on screen that is not a play-zone card or a shop button carries a
 * SEMANTIC key as its `data-ping` attribute. A ping on it travels as `{ t: 'ui', k }` and each viewer finds the same key
 * on their own layout (never a pixel position). The key names WHICH offer too (an option's index and id, plus a short
 * signature of the whole offer for a Discover), so a ping never jumps to a different option: when the key's element
 * leaves the screen (the Discover closed, the option was taken, the next offer opened) the ping goes with it.
 *
 * Pure and dependency-free (the wire rule for a key is `PING_UI_KEY` in `@game/versus-cf/pings`).
 */
import { PING_UI_KEY } from '@game/versus-cf/pings';

/** One key part: only the characters a key may carry. */
const part = (v: string | number): string => String(v).replace(/[^A-Za-z0-9_.-]/g, '');

/** A short, stable signature of a whole offer (FNV-1a, base 36): two different Discovers in a row never share keys. */
export function offerSig(ids: readonly string[]): string {
  let h = 0x811c9dc5;
  const s = ids.join('|');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36).slice(0, 5);
}

/** Build a key from its parts, or undefined when it would not pass the wire rule (then the spot is simply not pingable). */
export function pingKey(...parts: (string | number)[]): string | undefined {
  const k = parts.map(part).join(':').slice(0, 64);
  return PING_UI_KEY.test(k) ? k : undefined;
}

/** A Discover option (every `run.discover`: a card Discover, a hero-quest Discover, a spell's or a Gift's pick). */
export const discKey = (ids: readonly string[], i: number): string | undefined => pingKey('disc', i, ids[i] ?? '', offerSig(ids));
/** A hero-power Discover option (Mimic, Void, Power Shifter). */
export const powKey = (ids: readonly string[], i: number): string | undefined => pingKey('pow', i, ids[i] ?? '', offerSig(ids));
/** A Choose One option (the card's or the Equipment's id). */
export const chooseKey = (id: string, i: number): string | undefined => pingKey('choose', i, id);
/** An Ancient on offer. */
export const ancientKey = (id: string, i: number): string | undefined => pingKey('anc', i, id);
/** A Quest Shop offer. */
export const questOfferKey = (id: string): string | undefined => pingKey('qoffer', id);
/** A Runeforge offer. */
export const forgeKey = (id: string, i: number): string | undefined => pingKey('forge', i, id);
/** An equipped rune (its badge in the rune row). */
export const runeKey = (id: string, i: number): string | undefined => pingKey('rune', i, id);
/** A quest in the quest tracker (active or pending). */
export const questKey = (id: string): string | undefined => pingKey('quest', id);
/** A lobby rail row (a seat). */
export const railKey = (seatId: string): string | undefined => pingKey('rail', seatId);
/** The HUD spots with one element each. */
export const PING_HERO = 'hero';
export const PING_HEROPOWER2 = 'heropower2';
export const PING_EQUIP = 'equip';
export const PING_MATE = 'mate';
