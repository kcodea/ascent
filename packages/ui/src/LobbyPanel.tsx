import { playerOpponent, type RunLobby } from '@game/sim';
import { heroArt } from './art';
import { Icon } from './Icon';

/**
 * The 8-seat table, shown in a LOBBY run.
 *
 * A lobby has no course clock and no Oath — the only things that matter are who is still standing, how much
 * health each of them has, and who you're about to fight. So the panel shows exactly that, ordered by health so
 * the table reads as a ladder you're climbing rather than a fixed list.
 */
export function LobbyPanel({ lobby }: { lobby: RunLobby }): JSX.Element | null {
  if (!lobby) return null;
  const foe = playerOpponent(lobby)?.seat ?? null;
  const living = lobby.seats.filter((s) => s.alive);
  // Living seats first, strongest to weakest; the fallen keep their placement order underneath.
  const rows = [...lobby.seats].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.alive) return (b.resolve + b.armor) - (a.resolve + a.armor);
    return (a.placement ?? 99) - (b.placement ?? 99);
  });

  return (
    <div className="lobbypanel">
      <div className="lobbyhead">
        <span className="lobbyround">Round {lobby.round}</span>
        <span className="lobbyalive">{living.length} left</span>
      </div>
      <div className="lobbyseats">
        {rows.map((seat) => {
          const isYou = seat.id === 's0';
          const isFoe = foe?.id === seat.id;
          const hp = seat.resolve + seat.armor;
          return (
            <div
              key={seat.id}
              className={`lobbyseat${isYou ? ' you' : ''}${isFoe ? ' foe' : ''}${seat.alive ? '' : ' dead'}`}
              title={seat.alive ? `${seat.label} — ${seat.resolve} Resolve${seat.armor ? ` +${seat.armor} Armor` : ''}` : `${seat.label} — knocked out round ${seat.eliminatedRound}`}
            >
              <img className="lobbyface" src={heroArt(seat.heroId)} alt="" />
              <span className="lobbyname">{seat.label}</span>
              {seat.alive ? (
                <span className="lobbyhp">
                  <Icon name="heart" />{seat.resolve}
                  {seat.armor > 0 && <span className="lobbyarmor">+{seat.armor}</span>}
                </span>
              ) : (
                <span className="lobbyplace">{seat.placement ? `#${seat.placement}` : 'out'}</span>
              )}
              {/* The one piece of forward information the panel owes you: who you're about to fight. */}
              {isFoe && <span className="lobbyvs">VS</span>}
              {/* A bar reading against the STARTING pool, so a chipped seat is obvious at a glance. */}
              {seat.alive && (
                <span className="lobbybar">
                  <span style={{ width: `${Math.max(0, Math.min(100, (hp / (lobby.rules.startingResolve + lobby.rules.startingArmor)) * 100))}%` }} />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
