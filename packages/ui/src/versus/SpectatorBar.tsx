/**
 * VERSUS PHASE 2 — the spectator's control (owner 2026-10-14: "spectators should be able to change the player they are
 * spectating within a spectator ui"). Both players as plates (Match details' seat portrait in their skin and frame,
 * name, hearts), the watched one lit; click a plate, or press 1 / 2, to watch that player's screen. Instant: both
 * views are cached (spectate.ts). Leave goes back to the room. In a fight the same plates pick whose side it is shown
 * from. Built from existing pieces: the seat portrait, the name-pill plate, the heart pill icon, the Gem plate button.
 */
import { useEffect } from 'react';
import type { VersusSeat } from '@game/sim';
import { Icon } from '../Icon';
import { SeatPortrait } from '../matchDetails/MatchScoreboard';
import { sfx } from '../sfx';
import { useGame } from '../store';
import { leaveSpectating, useSpectate, watchSeat } from './spectate';
import { useVersus } from './versusStore';
import '../matchDetails/matchDetails.css';

const SEATS: readonly VersusSeat[] = ['p1', 'p2'];

export function SpectatorBar(): JSX.Element | null {
  const active = useSpectate((s) => s.active);
  const seat = useSpectate((s) => s.seat);
  const match = useVersus((s) => s.match);
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
  if (!active || !match) return null;
  return (
    <div className="vsspec" role="group" aria-label="Spectating">
      <span className="vsspec-label">Watching</span>
      <div className="vsspec-seats">
        {SEATS.map((s, i) => {
          const hero = s === 'p1' ? match.p1_hero : match.p2_hero;
          const name = s === 'p1' ? match.p1_name : match.p2_name;
          const [mine, theirs] = shown.split('|');
          const fromScreen = shown ? Number(s === seat ? mine : theirs) : NaN;
          const hearts = Number.isFinite(fromScreen) ? fromScreen : s === 'p1' ? match.p1_hearts : match.p2_hearts;
          return (
            <button key={s} type="button" className={`vsspec-seat hudpill-name${seat === s ? ' on' : ''}`} aria-pressed={seat === s}
              aria-label={`Watch ${name} (${i + 1})`} onClick={() => { if (seat !== s) { sfx.tick(); watchSeat(s); } }}>
              {hero && <SeatPortrait heroId={hero} skins={null} self={false} />}
              <span className="vsspec-name">{name}</span>
              <span className="vsspec-hearts"><Icon name="heartPill" />{hearts}</span>
              <kbd className="vsspec-key" aria-hidden="true">{i + 1}</kbd>
            </button>
          );
        })}
      </div>
      <button type="button" className="vsplate vsspec-leave" onClick={() => { sfx.pulse(); leaveSpectating(); }}>Leave</button>
    </div>
  );
}
