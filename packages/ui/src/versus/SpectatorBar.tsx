/**
 * VERSUS PHASE 2 — the spectator's chrome (owner 2026-10-14: "spectators should be able to change the player they are
 * spectating within a spectator ui"; re-laid out 2026-10-16, R-SPECTATE-HUD-01: "maybe in the top left it shows me as
 * a spectator, and if there are multiple players to spectate, that can be in the bottom right instead").
 *
 * TOP LEFT: me, as a spectator (`SpectatorSelf`: my plate and emotes, the rest of the stands, Leave). BOTTOM RIGHT: the
 * switcher (`WatchedPanel`): both players as plates (Match details' seat portrait in their skin and frame, name pill,
 * heart pill), the watched one lit; click a plate, or press 1 / 2, to watch that player's screen. Instant: both views
 * are cached (spectate.ts). In a fight the same plates pick whose side it is shown from.
 */
import { useEffect, useMemo } from 'react';
import type { VersusSeat } from '@game/sim';
import { sfx } from '../sfx';
import { useGame } from '../store';
import { leaveSpectating, useSpectate, watchSeat } from './spectate';
import { useVersus } from './versusStore';
import { SpectatorCursor } from './SpectatorCursor';
import { SpectatorSelf, WatchedPanel, type WatchSeat } from './SpectatorHud';

const SEATS: readonly VersusSeat[] = ['p1', 'p2'];

export function SpectatorBar(): JSX.Element | null {
  const active = useSpectate((s) => s.active);
  const seat = useSpectate((s) => s.seat);
  const match = useVersus((s) => s.match);
  const room = useVersus((s) => s.room);
  // Hearts as the SCREEN shows them (the watched run's two-seat lobby: settled when the fight on screen lands), so the
  // bar never tells the result of a fight that is still playing. The match row is the fallback.
  const shown = useGame((s) => { const l = s.run.lobby; return l ? `${l.seats[0]?.resolve ?? ''}|${l.seats[1]?.resolve ?? ''}` : ''; });
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target instanceof HTMLElement && e.target.closest('input, textarea'))) return;
      if (e.key === '1' || e.key === '2') {
        e.preventDefault();
        sfx.tick();
        watchSeat(e.key === '1' ? 'p1' : 'p2');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
  const seats = useMemo((): WatchSeat[] => {
    if (!match) return [];
    const [mine, theirs] = shown.split('|');
    return SEATS.map((s) => {
      const user = s === 'p1' ? match.p1_user : match.p2_user;
      const fromScreen = shown ? Number(s === seat ? mine : theirs) : NaN;
      return {
        key: s,
        name: s === 'p1' ? match.p1_name : match.p2_name,
        heroId: s === 'p1' ? match.p1_hero : match.p2_hero,
        profile: room?.members.find((m) => m.userId === user)?.profile,
        hearts: Number.isFinite(fromScreen) ? fromScreen : s === 'p1' ? match.p1_hearts : match.p2_hearts,
        on: seat === s,
        pick: () => watchSeat(s),
      };
    });
  }, [match, room, seat, shown]);
  if (!active || !match) return null;
  return (
    <>
      <SpectatorCursor />
      <SpectatorSelf onLeave={leaveSpectating} />
      <WatchedPanel seats={seats} />
    </>
  );
}
