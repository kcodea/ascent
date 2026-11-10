/**
 * VERSUS — THE STATE OF MY OWN CONNECTION (R-VERSUS-LINK-STATUS-01, netcode audit F2, owner 2026-11-10: "when my own
 * socket is down the shop looks normal for 20+ s"). The room socket (`VersusCfClient`) always knew whether it was open,
 * retrying or closed for good; nothing on screen ever said so. This is that state, fed by the transport itself
 * (`versusCfRemote.ts`), for the small status the player sees (`VersusConnectionStatus.tsx`).
 *
 *  - `idle`: no room socket (or one still opening for the first time).
 *  - `open`: connected.
 *  - `down`: dropped, and reconnecting by itself (100 ms doubling to 3 s; `since` = when it dropped).
 *  - `dead`: closed for good (`reason`): this account opened the game somewhere else (`replaced`), a refused sign-in,
 *    another game version. It will NOT reconnect by itself; `reclaimVersusLink` opens it again.
 *
 * Pure state plus what the status shows for it (`versusLinkView`); no timers here.
 */
import { create } from 'zustand';

export type VersusLinkStatus = 'idle' | 'open' | 'down' | 'dead';

export interface VersusLinkState {
  status: VersusLinkStatus;
  /** When the current status began (ms, this device's clock). */
  since: number;
  /** Why a `dead` socket closed (the room's close reason). */
  reason: string | null;
  /** A reclaim ("Play here") is in flight. */
  reclaiming: boolean;
}

export const useVersusLink = create<VersusLinkState>(() => ({ status: 'idle', since: 0, reason: null, reclaiming: false }));

/** The transport reports its socket's state. A repeat of the same state keeps its `since`. */
export function noteVersusLink(status: VersusLinkStatus, reason: string | null = null, now = Date.now()): void {
  const cur = useVersusLink.getState();
  if (cur.status === status && cur.reason === reason) return;
  useVersusLink.setState({ status, since: now, reason, reclaiming: status === 'dead' ? false : cur.reclaiming && status !== 'open' });
}

/** What the transport lets the status do: open a socket that closed for good, and forget the socket on a local exit. */
interface LinkActions { reclaim: () => Promise<void>; drop: () => void }
let actions: LinkActions | null = null;
export function setVersusLinkActions(a: LinkActions | null): void { actions = a; }

/** "Play here": open my socket again (the room then closes the other one as replaced). */
export async function reclaimVersusLink(): Promise<void> {
  if (!actions || useVersusLink.getState().reclaiming) return;
  useVersusLink.setState({ reclaiming: true });
  try { await actions.reclaim(); } catch { /* still closed: the status shows it again */ } finally {
    if (useVersusLink.getState().reclaiming) useVersusLink.setState({ reclaiming: false });
  }
}

/** Leaving the room on THIS screen only (the game goes on wherever it is open): forget the socket. */
export function dropVersusLink(): void {
  actions?.drop();
  useVersusLink.setState({ status: 'idle', since: Date.now(), reason: null, reclaiming: false });
}

/** A drop shorter than this is never shown: the first four retries (100 + 200 + 400 + 800 ms) fit inside it. */
export const LINK_SHOW_AFTER_MS = 1_500;
/** Past this the status says "Connection lost" and what happens next. The room's own measure of "away" in Ranked Duos
 *  (`RANKED_AWAY_GRACE_MS`): from here my seat is treated as absent, so this is when the consequence is true. */
export const LINK_LOST_AFTER_MS = 12_000;

export type VersusLinkMode = 'ranked_duos' | 'duos' | 'group' | 'duel' | null;

export interface VersusLinkView {
  kind: 'none' | 'reconnecting' | 'lost' | 'elsewhere' | 'closed';
  title: string;
  body: string | null;
  /** `elsewhere` / `closed`: the two ways on. */
  actions: boolean;
}

const NONE: VersusLinkView = { kind: 'none', title: '', body: null, actions: false };

/** What happens to my seat while I am gone, by mode (player text: short plain sentences). */
function whileGone(mode: VersusLinkMode, inMatch: boolean): string {
  if (!inMatch) return 'Still trying to reconnect.';
  if (mode === 'ranked_duos') return 'Still trying. Your board fights on its own until you are back.';
  return 'Still trying. The match waits 30 seconds for you. After that your board fights on its own.';
}

const CLOSED_TEXT: Record<string, string> = {
  version_mismatch: 'The game was updated. Reload the page to keep playing.',
  unauthorized: 'Your sign-in ran out. Try again to sign back in.',
  refused: 'The room refused this connection.',
};

/**
 * What the status shows (pure). `seated`: I hold a player seat in the room. `downFor`: ms since the socket dropped.
 * A spectator sees only the closed-for-good states; a short drop shows nothing at all.
 */
export function versusLinkView(x: { link: Pick<VersusLinkState, 'status' | 'reason'>; downFor: number; inRoom: boolean; seated: boolean; inMatch: boolean; mode: VersusLinkMode }): VersusLinkView {
  if (!x.inRoom) return NONE;
  if (x.link.status === 'dead') {
    if (x.link.reason === 'room_closed' || x.link.reason === 'closed' || x.link.reason === 'bye') return NONE; // the room is gone: its own screen says so
    if (x.link.reason === 'replaced') {
      return { kind: 'elsewhere', title: 'Open somewhere else', body: 'This game is open in another tab or window. You can play here instead.', actions: true };
    }
    return { kind: 'closed', title: 'Connection lost', body: CLOSED_TEXT[x.link.reason ?? ''] ?? 'The connection closed. Try again.', actions: true };
  }
  if (x.link.status !== 'down' || !x.seated || x.downFor < LINK_SHOW_AFTER_MS) return NONE;
  if (x.downFor < LINK_LOST_AFTER_MS) return { kind: 'reconnecting', title: 'Reconnecting', body: null, actions: false };
  return { kind: 'lost', title: 'Connection lost', body: whileGone(x.mode, x.inMatch), actions: false };
}
