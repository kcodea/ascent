import { useEffect, useRef } from 'react';
import { getHero, lastPlayerEncounter, lastRoundDamage, playerOpponent, type RunLobby } from '@game/sim';
import { floatLobbyDamageOnSeat } from './lobbyDamageFx';
import { heroArt } from './art';
import { Icon } from './Icon';

/**
 * The 8-seat table, shown in a LOBBY run.
 *
 * A lobby has no course clock and no Oath — what matters is who is still standing, how much health each of them
 * has, and who you're about to fight. Two things get prominence over the bare list:
 *
 *  - The NEXT OPPONENT gets a full card at the top rather than a marker in a row. You pick your board around one
 *    specific enemy each round, so the one thing you're planning against shouldn't be the smallest text on
 *    screen (owner ask 2026-07-29).
 *  - DAMAGE from the round that just resolved prints as a number on each seat. A bar that silently drops tells
 *    you something changed but not how much, and how much is the read on whether you're actually winning.
 */
export function LobbyPanel({ lobby }: { lobby: RunLobby }): JSX.Element | null {
  if (!lobby) return null;
  const next = playerOpponent(lobby);
  const foe = next?.seat ?? null;
  const dmg = lastRoundDamage(lobby);
  const living = lobby.seats.filter((s) => s.alive);
  const maxHp = lobby.rules.startingResolve + lobby.rules.startingArmor;
  // Living seats first, strongest to weakest; the fallen keep their placement order underneath.
  const rows = [...lobby.seats].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.alive) return (b.resolve + b.armor) - (a.resolve + a.armor);
    return (a.placement ?? 99) - (b.placement ?? 99);
  });

  // WHAT YOU JUST DID TO THEM. The rail prints every seat's loss as a static number, but a win is the moment
  // the mode is about and shouldn't read the same as a draw until you scan the table — so the damage you dealt
  // floats over the seat that took it, once, on the round it happened.
  //
  // Keyed on the round rather than on a render: the panel re-renders constantly during a shop phase, and the
  // rows re-sort by health the instant a round settles, so anything tied to the element's lifetime would fire
  // repeatedly or not at all. `rAF` waits for the re-sorted rows to be laid out before measuring one.
  const firedRound = useRef(0);
  useEffect(() => {
    if (lobby.round === firedRound.current) return;
    firedRound.current = lobby.round;
    const last = lastPlayerEncounter(lobby);
    if (!last || last.dealt <= 0) return; // a draw or a loss has nothing to announce
    const raf = requestAnimationFrame(() => floatLobbyDamageOnSeat(last.foe.id, last.dealt));
    return () => cancelAnimationFrame(raf);
  }, [lobby.round, lobby]);

  return (
    <div className="lobbyrail">
      <div className="lobbyhead">
        <span className="lobbyround">Round {lobby.round}</span>
        <span className="lobbyalive">{living.length} left</span>
      </div>

      {/* THE FIGHT YOU'RE PLANNING AGAINST — the one enemy this shop phase is actually about. */}
      {foe && (
        <div className="lobbynext">
          <img className="lobbynextface" src={heroArt(foe.heroId)} alt="" />
          <div className="lobbynextinfo">
            <span className="lobbynextlbl">Next foe</span>
            <span className="lobbynextname">{foe.label}</span>
            <span className="lobbynextsub">{getHero(foe.heroId).power.name}</span>
          </div>
          <div className="lobbynexthp">
            <span className="lobbyhp"><Icon name="heart" />{foe.resolve}</span>
            {foe.armor > 0 && <span className="lobbyarmor">+{foe.armor}</span>}
          </div>
        </div>
      )}

      <div className="lobbyseats">
        {rows.map((seat) => {
          const isYou = seat.id === 's0';
          const isFoe = foe?.id === seat.id;
          const hp = seat.resolve + seat.armor;
          const d = dmg[seat.id];
          return (
            <div
              key={seat.id}
              data-seat={seat.id}
              className={`lobbyseat${isYou ? ' you' : ''}${isFoe ? ' foe' : ''}${seat.alive ? '' : ' dead'}`}
              title={seat.alive
                ? `${seat.label} — ${seat.resolve} Resolve${seat.armor ? ` +${seat.armor} Armor` : ''}`
                : `${seat.label} — knocked out round ${seat.eliminatedRound}`}
            >
              <img className="lobbyface" src={heroArt(seat.heroId)} alt="" />
              <span className="lobbyname">{seat.label}</span>
              {/* What last round cost this seat. The cell always renders — an omitted one would reflow the row
                  and leave the health column jittering between seats — but it stays blank at 0, because a
                  column of zeroes is noise and "no number" already reads as unscathed. */}
              <span className="lobbydmg" key={`d${lobby.round}`} title={d?.taken ? `Took ${d.taken} last round` : undefined}>
                {seat.alive && d && d.taken > 0 ? `−${d.taken}` : ''}
              </span>
              {seat.alive ? (
                <span className="lobbyhp">
                  <Icon name="heart" />{seat.resolve}
                  {seat.armor > 0 && <span className="lobbyarmor">+{seat.armor}</span>}
                </span>
              ) : (
                <span className="lobbyplace">{seat.placement ? `#${seat.placement}` : 'out'}</span>
              )}
              {seat.alive && (
                <span className="lobbybar">
                  <span style={{ width: `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%` }} />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
