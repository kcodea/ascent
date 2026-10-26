/**
 * VERSUS DUOS — THE HAND-OFF ON SCREEN (owner 2026-10-25: "boards flying in after one another"; R-DUOS-TAGTEAM-01).
 *
 * The fight itself is one ordinary combat replay: a `tagIn` event replaces that side's row with the teammate's board,
 * whose bodies fly in (`.unit.tagin`, styles.css). This module adds what a replay alone cannot know: WHO is fighting
 * now on each side. The foe's hero slot (`useDuosCombat.foeSeatId`, read by CombatOpponent) and yours
 * (`selfSeatId`, read by StatusBar) swap to the player whose board is live, name pill and the team's Health box with it, the new face
 * fading in (`.duosswap`). That is the ONLY sign of a hand-off (owner 2026-10-26: "dont show the 'xyz swoops in' or
 * whatever. just have the current portrait of the player side or opponent side swap to the player who's board is live.
 * we dont need to add more ui elements that are unnecessary"): the "steps in" plate is gone.
 * Derived from the result's own `duosFirst` + the match's seats: pure reads, no network.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import type { CombatEvent, CombatResult } from '@game/core';
import { useVersus } from './versusStore';
import { useSpectate } from './spectate';
import { duosCombatAt, type DuosCombatNow } from './versusGroupView';

interface DuosCombatState {
  /** The rail seat id of the board the opponent side is fighting with right now (null = the forced opponent). */
  foeSeatId: string | null;
  /** The rail seat id of MY TEAMMATE while their board fights on my side (null = my own board). The player hero slot
   *  reads it so my side's portrait follows my side's board exactly as the foe's does (R-SYMMETRY-01). */
  selfSeatId: string | null;
  /** The latest hand-off on screen: which side, whose board, and its event index. */
  tag: DuosCombatNow['tag'];
  /** A Duos fight is on screen (the hero slots key their art by the live player, so a swap fades the new face in). */
  on: boolean;
}
export const useDuosCombat = create<DuosCombatState>(() => ({ foeSeatId: null, selfSeatId: null, tag: null, on: false }));

/** Recruit calls this with the replay's cursor: keeps `useDuosCombat` in step with the fight on screen. */
export function useDuosCombatSync(combat: CombatResult | undefined, events: readonly CombatEvent[], processedEnd: number, fighting: boolean): void {
  const viewer = useVersus((s) => s.match?.group?.me ?? null);
  const watched = useSpectate((s) => (s.active ? s.seat : null));
  const raw = useVersus((s) => s.match?.group?.raw ?? null);
  const seat = viewer ?? watched;
  useEffect(() => {
    const cur = useDuosCombat.getState();
    if (!fighting || !combat?.duosFirst || !seat || !raw) {
      if (cur.foeSeatId || cur.selfSeatId || cur.tag || cur.on) useDuosCombat.setState({ foeSeatId: null, selfSeatId: null, tag: null, on: false });
      return;
    }
    const now = duosCombatAt(combat, raw, seat, events, processedEnd);
    if (!cur.on || cur.foeSeatId !== now.foeSeatId || cur.selfSeatId !== now.selfSeatId || cur.tag?.at !== now.tag?.at || cur.tag?.kind !== now.tag?.kind) useDuosCombat.setState({ ...now, on: true });
  }, [combat, events, processedEnd, fighting, seat, raw]);
}
