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
import { VERSUS_FOE_SEAT_ID, type VersusSeat } from '@game/sim';

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
