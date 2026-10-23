/**
 * THE EMOTE TRANSPORT SEAM (owner 2026-10-13: "design the emote event as a small transport-agnostic message ... with a
 * clean seam so a later Supabase Realtime broadcast can send/receive it live. Do NOT build Versus").
 *
 * Everything that SHOWS an emote listens here (`subscribeEmotes`); everything that SAYS one goes through `sendEmote`.
 * Today the transport is a local loopback: your own emote is delivered straight back to you, and a served seat's
 * recorded emote is delivered by the replay scheduler (`deliverEmote`, never sent anywhere). A Versus build swaps in a
 * transport whose `send` also broadcasts the `EmoteMessage` on a Realtime channel and whose incoming messages call
 * `deliverEmote`, and nothing else in the game changes.
 *
 * WHO ELSE HEARS WHAT YOU SAY (owner 2026-10-22: "spectators arent seeing when a player emotes, i think only the player
 * sees the emotes"; R-SPECTATE-EMOTE-02). `subscribeSentEmotes` hears every emote THIS player says, whatever transport is
 * installed: the live ranked game's publisher forwards it to the stands while someone watches. It is told once per
 * emote and never delivers anything locally, so the speaker's own bubble still comes back exactly once (the transport).
 */
import type { EmoteMessage } from '@game/sim';

export interface EmoteTransport {
  /** Say an emote. Must eventually deliver it locally too (the speaker sees their own bubble). */
  send(message: EmoteMessage): void;
  /** Stop: drop any channel. */
  close?(): void;
}

type Listener = (message: EmoteMessage) => void;
const listeners = new Set<Listener>();

/** Show an emote on this client (every listener: the bubble layer). Used by transports and the replay scheduler. */
export function deliverEmote(message: EmoteMessage): void {
  for (const fn of [...listeners]) {
    try { fn(message); } catch { /* a listener must never break the sender */ }
  }
}

/** Listen for every emote this client should show. Returns the unsubscribe. */
export function subscribeEmotes(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The default transport: loop straight back. */
export const LOCAL_EMOTE_TRANSPORT: EmoteTransport = { send: deliverEmote };

let transport: EmoteTransport = LOCAL_EMOTE_TRANSPORT;

/** Install a transport (Versus, later). Null puts the local loopback back. */
export function setEmoteTransport(next: EmoteTransport | null): void {
  if (transport !== next) transport.close?.();
  transport = next ?? LOCAL_EMOTE_TRANSPORT;
}

const sentListeners = new Set<Listener>();

/** Hear every emote this player SAYS (not ones delivered from elsewhere). Returns the unsubscribe. */
export function subscribeSentEmotes(fn: Listener): () => void {
  sentListeners.add(fn);
  return () => { sentListeners.delete(fn); };
}

/** Say an emote through the installed transport. */
export function sendEmote(message: EmoteMessage): void {
  transport.send(message);
  for (const fn of [...sentListeners]) {
    try { fn(message); } catch { /* a listener must never break the sender */ }
  }
}
