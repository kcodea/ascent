/**
 * SKINS v1: the store-backed half (whose skins a surface shows). The resolver + the `Card` context are in
 * `skinArt.ts` (no store import, so `Card` never pulls the store in). See the header there.
 */
import { useMemo, useRef, type ReactNode } from 'react';
import type { RunCosmeticSnapshot } from '@game/progression';
import { playerOpponent, type LobbySeatState, type PreparedBoard } from '@game/sim';
import { useGame } from '../store';
import { mirrorFor, useProgression } from '../progression/progressionStore';
import { currentUserId } from '../identity';
import { MinionSkinContext, internSnapshot, minionSkinMap } from './skinArt';

export { heroPortrait, internSnapshot, minionSkinMap, skinArtOf, useMinionSkinMap, type MinionSkinMap } from './skinArt';

/** Scope a subtree's minion art to one owner's skins. `snapshot` null = default art for everything inside. */
export function MinionSkins({ snapshot, children }: { snapshot: RunCosmeticSnapshot | null | undefined; children: ReactNode }): JSX.Element {
  useSkinEpoch();
  return <MinionSkinContext.Provider value={minionSkinMap(snapshot)}>{children}</MinionSkinContext.Provider>;
}

/** Subscribe to the server kill switch, so a retire/restore re-renders every skin surface. */
export const useSkinEpoch = (): number => useProgression((s) => s.catalogEpoch);

/** Your LIVE loadout (hero select, the title's Minion Book, the Collection). Null when signed out / unknown. */
export function useLiveLoadout(): RunCosmeticSnapshot | null {
  useSkinEpoch();
  return useProgression((s) => internSnapshot(mirrorFor(currentUserId(), s.mirror)?.loadout));
}

/** The skins RECORDED on the run on screen (yours; a replay shows the recorded ones). */
export function useRunSkins(): RunCosmeticSnapshot | null {
  useSkinEpoch();
  // Interned: the run is cloned on every dispatch, so the raw `run.cosmetics` is a new object after every click.
  return useGame((s) => internSnapshot(s.run.cosmetics));
}

/** An opponent's recorded skins, or null when the player has switched opponent skins off. Never used for your own. */
export function useOpponentSkins(snapshot: RunCosmeticSnapshot | null | undefined): RunCosmeticSnapshot | null {
  useSkinEpoch();
  const show = useGame((s) => s.showOpponentSkins);
  return show && snapshot ? internSnapshot(snapshot) : null;
}

/** The non-hook form of the toggle, for render helpers that already hold the store state. */
export const opponentSkins = (show: boolean, snapshot: RunCosmeticSnapshot | null | undefined): RunCosmeticSnapshot | null => (show && snapshot ? snapshot : null);

/** The skins a seat's owner recorded: the seat's own copy, else the served board's (older lobbies). */
export const seatCosmetics = (seat: Pick<LobbySeatState, 'cosmetics'> | null | undefined, board?: Pick<PreparedBoard, 'snapshot'> | null): RunCosmeticSnapshot | null =>
  seat?.cosmetics ?? board?.snapshot?.cosmetics ?? null;

/**
 * The CURRENT fight's foe skins (through the opponent toggle), for the enemy combat row.
 *
 * Computed only while the run is in combat (`playerOpponent` pairs + prepares; never on a shop click), and CACHED
 * past the settle: the enemy row keeps showing the fight's last frame while the run has already advanced, and the
 * live pairing then names the NEXT foe (the same reason `CombatOpponent` caches its seat). A replay's combat frame
 * sets the phase to combat over the recorded lobby, so it reads the recorded seat too.
 */
export function useCombatFoeSkins(): RunCosmeticSnapshot | null {
  // The lobby is selected ONLY in combat: the reducer hands out a new lobby object on every dispatch, and the
  // enemy row's host (TavernRow) must not re-render on shop clicks for a value it only reads in a fight.
  const inCombat = useGame((s) => s.run.phase === 'combat');
  const lobby = useGame((s) => (s.run.phase === 'combat' ? s.run.lobby : undefined));
  const foe = useMemo(() => (inCombat && lobby ? playerOpponent(lobby) : null), [inCombat, lobby]);
  const cached = useRef<RunCosmeticSnapshot | null>(null);
  if (inCombat && foe) cached.current = seatCosmetics(foe.seat, foe.board);
  return useOpponentSkins(cached.current);
}

/**
 * YOUR skins for a subtree: the run's recorded ones while a run is on screen (`live` false), your live loadout
 * before one (`live` true: the title's Minion Book). Wrapped around every own surface in `Game.tsx`.
 */
export function OwnSkins({ live, children }: { live: boolean; children: ReactNode }): JSX.Element {
  const run = useRunSkins();
  const loadout = useLiveLoadout();
  return <MinionSkins snapshot={live ? loadout : run}>{children}</MinionSkins>;
}
