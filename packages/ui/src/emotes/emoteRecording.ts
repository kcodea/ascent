/**
 * RECORDING YOUR EMOTES ON YOUR BOARDS (owner 2026-10-13: "record each emote the player uses with its time offset from
 * the start of that turn (shop) / combat start (combat), store it with the seat's recorded snapshot for that round").
 *
 * A lobby run captures its round-N board at `faceOmen` (store.ts), i.e. AFTER the shop turn and BEFORE the combat. So
 * a SHOP emote waits here until its round's board is captured (store.ts folds `takeShopEmotes(round)` into it), and a
 * COMBAT emote is written straight onto that captured board (`recordEmoteOnBoards`). The boards then upload with the
 * run, and the shared pool serves them back with their emotes. Kept free of the store import so store.ts can use it.
 */
import { recordedOf, type EmoteMessage, type RecordedEmote } from '@game/sim';

let pending: { round: number; list: RecordedEmote[] } = { round: -1, list: [] };

/** Hold a shop emote until its round's board is captured. A new round drops the old round's leftovers. */
export function holdShopEmote(m: EmoteMessage): void {
  if (pending.round !== m.round) pending = { round: m.round, list: [] };
  pending.list.push(recordedOf(m));
}

/** The held shop emotes of `round` (and forget them). Empty for any other round. */
export function takeShopEmotes(round: number): RecordedEmote[] {
  if (pending.round !== round || !pending.list.length) return [];
  const out = pending.list;
  pending = { round: -1, list: [] };
  return out;
}

/** Tests / a new run: forget everything held. */
export function resetHeldEmotes(): void {
  pending = { round: -1, list: [] };
}
