/**
 * THE EMOTE TRANSPORT SEAM (owner 2026-10-13: "design the emote event as a small transport-agnostic message ... with a
 * clean seam so a later Supabase Realtime broadcast can send/receive it live. Do NOT build Versus").
 *
 * Everything that SHOWS an emote listens here (`subscribeEmotes`); everything that SAYS one goes through `sendEmote`.
 * Today the transport is a local loopback: your own emote is delivered straight back to you, and a served seat's
 * recorded emote is delivered by the replay scheduler (`deliverEmote`, never sent anywhere). A Versus build swaps in a
 * transport whose `send` also broadcasts the `EmoteMessage` on a Realtime channel and whose incoming messages call
 * `deliverEmote`, and nothing else in the game changes.
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

/** Say an emote through the installed transport. */
export function sendEmote(message: EmoteMessage): void {
  transport.send(message);
}
