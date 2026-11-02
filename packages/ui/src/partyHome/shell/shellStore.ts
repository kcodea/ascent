/**
 * THE APP SHELL's small shared state (party home prototype, DEV only): the ONE friends list's drawer, a one-shot "look
 * here" pulse for it, what an Invite does right now (the party home registers it; menu pages have none), and the nav's
 * intent for the Collection page (the Crates tab opens it on the crate shop). No persistence, nothing ticks.
 */
import type { ComponentType } from 'react';
import { create } from 'zustand';
import type { Friend } from '../../friends/friendsRemote';

export interface PhInvite {
  /** Invites are offered (a mode that takes a party, and an account). */
  can: boolean;
  /** Why not, when `can` is false and a reason helps (shown under the list). */
  reason: string | null;
  /** User ids already in your party: their row says "In party" instead of Invite. */
  members: readonly string[];
  /** The mode an invite is for (the button's label). */
  modeLabel: string;
  send: ((f: Friend) => void) | null;
}

export interface PhShellState {
  friendsOpen: boolean;
  /** Bumped to replay the friends list's one-shot highlight (an open seat pressed). */
  friendsPulse: number;
  invite: PhInvite;
  /** The Collection page should open on the crate shop (read once by the page). */
  collectionIntent: 'shop' | null;
  /** THE COMPENDIUM PAGE under the shell: a content component the Compendium builder registers (`setCompendiumPage`).
   *  While one is registered, the shell mounts it under the nav in place of the book's modal (nav tab lit). */
  compendiumPage: ComponentType | null;
}

const NO_INVITE: PhInvite = { can: false, reason: null, members: [], modeLabel: '', send: null };

export const usePhShell = create<PhShellState>(() => ({ friendsOpen: false, friendsPulse: 0, invite: NO_INVITE, collectionIntent: null, compendiumPage: null }));
/** Register the Compendium's page content (call once at module load; null removes it). */
export const setCompendiumPage = (c: ComponentType | null): void => usePhShell.setState({ compendiumPage: c });

export const setFriendsOpen = (open: boolean): void => usePhShell.setState({ friendsOpen: open });
export const toggleFriends = (): void => usePhShell.setState((s) => ({ friendsOpen: !s.friendsOpen }));
/** Point at the friends list with a one-shot highlight (`open`: also open it, where it is a drawer). */
export const pulseFriends = (open = false): void => usePhShell.setState((s) => ({ friendsOpen: open || s.friendsOpen, friendsPulse: s.friendsPulse + 1 }));
export const setPhInvite = (invite: PhInvite | null): void => usePhShell.setState({ invite: invite ?? NO_INVITE });
export const setCollectionIntent = (intent: 'shop' | null): void => usePhShell.setState({ collectionIntent: intent });
/** The Collection page reads (and clears) the nav's intent when it opens. */
export function takeCollectionIntent(): 'shop' | null {
  const i = usePhShell.getState().collectionIntent;
  if (i) usePhShell.setState({ collectionIntent: null });
  return i;
}
