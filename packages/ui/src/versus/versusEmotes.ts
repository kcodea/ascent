/**
 * VERSUS emotes over the match channel (2026-10-14), through the game's ONE emote seam (`emotes/emoteTransport.ts`).
 *
 * While a Versus match runs, `installVersusEmotes` swaps the local loopback for a transport whose `send` shows your
 * bubble locally AND broadcasts the agreed wire message `{ emoteId, seat, phase, offsetMs, round }` (seat = `p1` /
 * `p2`) on the room's Realtime channel as the `emote` event. An incoming `emote` from the other seat is validated and
 * delivered locally under `VERSUS_OPPONENT_SEAT`: the opponent's seat in the match's two-seat lobby (`versusLobby`), so
 * the bubble lands exactly where a lobby seat's does (its rail row in the shop, the foe portrait in combat). Uninstalling puts the loopback back. Nothing here records emotes (a Versus board is never uploaded).
 */
import type { EmoteMessage } from '@game/sim';
import { deliverEmote, setEmoteTransport, type EmoteTransport } from '../emotes/emoteTransport';
import { EMOTE_COOLDOWN_MS, VERSUS_FOE_SEAT_ID, type VersusSeat } from '@game/sim';

/** The wire message (the contract agreed with feat/emotes). */
export interface VersusEmoteMessage {
  emoteId: string;
  seat: VersusSeat;
  phase: 'shop' | 'combat';
  offsetMs: number;
  round: number;
}

export const VERSUS_EMOTE_EVENT = 'emote';
/** The local seat id an opponent's emote is shown under: their seat in the two-seat display lobby. */
export const VERSUS_OPPONENT_SEAT = VERSUS_FOE_SEAT_ID;

/** Validate an inbound payload; null when it is not a well-formed Versus emote. */
export function parseVersusEmote(payload: unknown): VersusEmoteMessage | null {
  const p = payload as Partial<VersusEmoteMessage> | null;
  if (!p || typeof p.emoteId !== 'string' || p.emoteId.length > 64) return null;
  if (p.seat !== 'p1' && p.seat !== 'p2') return null;
  if (typeof p.offsetMs !== 'number' || !Number.isFinite(p.offsetMs) || typeof p.round !== 'number') return null;
  if (p.phase !== 'shop' && p.phase !== 'combat') return null;
  return { emoteId: p.emoteId, seat: p.seat, phase: p.phase, offsetMs: p.offsetMs, round: p.round };
}

let mine: VersusSeat | null = null;

/** Install the Versus transport for `seat` over the channel's broadcast `send`. */
export function installVersusEmotes(seat: VersusSeat, send: (event: string, payload: unknown) => void): void {
  mine = seat;
  const transport: EmoteTransport = {
    send(m: EmoteMessage): void {
      deliverEmote(m); // your own bubble, as the loopback does
      const wire: VersusEmoteMessage = { emoteId: m.emoteId, seat, phase: m.phase, offsetMs: m.offsetMs, round: m.round };
      send(VERSUS_EMOTE_EVENT, wire);
    },
    close(): void { if (mine === seat) mine = null; },
  };
  setEmoteTransport(transport);
}

/** Back to the local loopback (the match ended, or the room was left). */
export function uninstallVersusEmotes(): void {
  mine = null;
  setEmoteTransport(null);
}

/** The channel's `emote` handler: show the OTHER seat's emote; ignore our own echo and anything malformed. */
export function receiveVersusEmote(payload: unknown): boolean {
  const m = parseVersusEmote(payload);
  if (!m || !mine || m.seat === mine) return false;
  deliverEmote({ emoteId: m.emoteId, seat: VERSUS_OPPONENT_SEAT, phase: m.phase, offsetMs: m.offsetMs, round: m.round });
  return true;
}

/** The seat id the WATCHED player's own emotes are shown under on a spectator's screen: the watched player is the run on
 *  screen, so their bubble rises from the hero portrait, exactly where the player sees their own (`emoteBubble`). */
export const WATCHED_PLAYER_SEAT = 's0';
/** The shortest gap a spectator accepts between two emotes from one watched seat (the cooldown, less network jitter):
 *  the channel is a public broadcast, so the receiver is the guard against a flood. */
export const WATCHED_EMOTE_GAP_MS = EMOTE_COOLDOWN_MS - 2000;
const watchedLast = new Map<VersusSeat, number>();

/**
 * A SPECTATOR hears a player's emote (owner 2026-10-22: "spectators arent seeing when a player emotes, i think only the
 * player sees the emotes"; R-SPECTATE-EMOTE-02). The same wire message the players trade (`VersusEmoteMessage`): in
 * Versus both players' emotes already travel on the room channel; a live ranked game's publisher forwards the player's
 * (seat `p1`) to its stands. Shown where the watched player sees it: the WATCHED seat's on the hero portrait, the other
 * seat's beside the opponent (the Versus foe). Refused while this client holds a seat (a player has its own path,
 * `receiveVersusEmote`), with no watched seat, malformed, or inside the cooldown for that seat (receiver's clock).
 */
export function receiveWatchedEmote(payload: unknown, watched: VersusSeat | null, now: number = Date.now()): boolean {
  const m = parseVersusEmote(payload);
  if (!m || !watched || mine) return false;
  const last = watchedLast.get(m.seat);
  if (last !== undefined && now - last >= 0 && now - last < WATCHED_EMOTE_GAP_MS) return false;
  watchedLast.set(m.seat, now);
  deliverEmote({ emoteId: m.emoteId, seat: m.seat === watched ? WATCHED_PLAYER_SEAT : VERSUS_OPPONENT_SEAT, phase: m.phase, offsetMs: m.offsetMs, round: m.round });
  return true;
}

/** A new watch (or the tests): forget the per-seat cooldowns. */
export function resetWatchedEmotes(): void {
  watchedLast.clear();
}
