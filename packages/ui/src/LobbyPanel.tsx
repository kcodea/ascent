import { useEffect, useRef, useState } from 'react';
import {
  boardIntel, getHero, lastPlayerEncounter, lastRoundDamage, playerOpponent, seatResults,
  type LobbySeatState, type RunLobby, type SeatIntel,
} from '@game/sim';
import { floatLobbyDamageOnSeat } from './lobbyDamageFx';
import { heroArt } from './art';
import { Icon } from './Icon';

/**
 * The 8-seat table, shown in a LOBBY run.
 *
 * A lobby has no course clock and no Oath — what matters is who is still standing, how much health each of them
 * has, and who you're about to fight.
 *
 * EVERY SEAT IS THE SAME SIZE (owner ask 2026-07-31). The next opponent used to get a large card above the
 * table; it made the rail two different things stacked, and the one seat you most want to compare against the
 * others was the one you couldn't. The next foe is now marked in place — a NEXT chip and an accent ring — so
 * the table reads as one scannable column.
 *
 * SCOUTING lives on hover instead. Each enemy seat opens a card with what they are playing (dominant tribe,
 * tier, triples) and their last three fights. That is the read the big card was standing in for, and it works
 * for all seven opponents rather than just the imminent one.
 */
export function LobbyPanel({ lobby }: { lobby: RunLobby }): JSX.Element | null {
  // Hooks must run unconditionally — the early return for a missing lobby lives after them.
  const firedRound = useRef(0);
  const [hovered, setHovered] = useState<string | null>(null);

  // WHAT YOU JUST DID TO THEM. The rail prints every seat's loss as a static number, but a win is the moment
  // the mode is about and shouldn't read the same as a draw until you scan the table — so the damage you dealt
  // floats over the seat that took it, once, on the round it happened.
  //
  // Keyed on the round rather than on a render: the panel re-renders constantly during a shop phase, and the
  // rows re-sort by health the instant a round settles, so anything tied to the element's lifetime would fire
  // repeatedly or not at all. `rAF` waits for the re-sorted rows to be laid out before measuring one.
  useEffect(() => {
    if (!lobby || lobby.round === firedRound.current) return;
    firedRound.current = lobby.round;
    const last = lastPlayerEncounter(lobby);
    if (!last || last.dealt <= 0) return; // a draw or a loss has nothing to announce
    const raf = requestAnimationFrame(() => floatLobbyDamageOnSeat(last.foe.id, last.dealt));
    return () => cancelAnimationFrame(raf);
  }, [lobby?.round, lobby]);

  if (!lobby) return null;
  const next = playerOpponent(lobby);
  const foe = next?.seat ?? null;
  // The foe's board is already prepared by `playerOpponent`, so reading it here is free — and it means the
  // imminent opponent has CURRENT intel even on round 1, before any settle has recorded any.
  const foeIntel: SeatIntel | undefined = next ? boardIntel(next.board, lobby.round) : undefined;
  const dmg = lastRoundDamage(lobby);
  const living = lobby.seats.filter((s) => s.alive);
  const maxHp = lobby.rules.startingResolve + lobby.rules.startingArmor;
  // Living seats first, strongest to weakest; the fallen keep their placement order underneath.
  const rows = [...lobby.seats].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.alive) return (b.resolve + b.armor) - (a.resolve + a.armor);
    return (a.placement ?? 99) - (b.placement ?? 99);
  });

  return (
    <div className="lobbyrail">
      <div className="lobbyhead">
        <span className="lobbyround">Round {lobby.round}</span>
        <span className="lobbyalive">{living.length} left</span>
      </div>

      <div className="lobbyseats">
        {rows.map((seat) => {
          const isYou = seat.id === 's0';
          const isFoe = foe?.id === seat.id;
          const hp = seat.resolve + seat.armor;
          const d = dmg[seat.id];
          const intel = isFoe ? foeIntel : seat.intel;
          return (
            <div
              key={seat.id}
              data-seat={seat.id}
              className={`lobbyseat${isYou ? ' you' : ''}${isFoe ? ' foe' : ''}${seat.alive ? '' : ' dead'}`}
              // Scouting is for OPPONENTS — your own board is on screen in front of you.
              onMouseEnter={isYou ? undefined : () => setHovered(seat.id)}
              onMouseLeave={isYou ? undefined : () => setHovered((h) => (h === seat.id ? null : h))}
            >
              <img className="lobbyface" src={heroArt(seat.heroId)} alt="" />
              {/* Name and chip share ONE grid cell so adding the chip cannot shift the health column — the row
                  has to keep the same shape whether or not this seat is the next foe. */}
              <span className="lobbynameline">
                <span className="lobbyname">{seat.label}</span>
                {isFoe && <span className="lobbynextchip">Next</span>}
              </span>
              {/* What last round cost this seat. The cell always renders — an omitted one would reflow the row
                  and leave the health column jittering between seats — but it stays blank at 0, because a
                  column of zeroes is noise and "no number" already reads as unscathed. */}
              <span className="lobbydmg" key={`d${lobby.round}`}>
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
              {hovered === seat.id && <ScoutCard lobby={lobby} seat={seat} intel={intel} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TRIBE_LABEL: Record<string, string> = {
  beast: 'Beasts', dragon: 'Dragons', undead: 'Undead', mech: 'Mechs',
  demon: 'Demons', kobold: 'Kobolds', dwarf: 'Dwarves', neutral: 'Neutral',
};

/**
 * The hover read on one opponent: what they are playing, and how their last three fights went.
 *
 * Rendered ONLY while hovered rather than always-mounted-and-hidden — eight of these permanently in the tree,
 * each mapping the encounter log, is work the shop phase does not need to do every frame.
 */
function ScoutCard({ lobby, seat, intel }: { lobby: RunLobby; seat: LobbySeatState; intel?: SeatIntel }): JSX.Element {
  const results = seatResults(lobby, seat.id, 3);
  const stale = intel && intel.round < lobby.round;
  return (
    <div className="lobbyscout" role="tooltip">
      <div className="lobbyscout-head">
        <span className="lobbyscout-name">{seat.label}</span>
        <span className="lobbyscout-hero">{getHero(seat.heroId).power.name}</span>
      </div>

      {intel ? (
        <div className="lobbyscout-stats">
          <span className="lobbyscout-stat"><b>{intel.topTribe ? TRIBE_LABEL[intel.topTribe] : 'Mixed'}</b><i>build</i></span>
          <span className="lobbyscout-stat"><b>T{intel.tier}</b><i>tier</i></span>
          <span className="lobbyscout-stat"><b>{intel.triples}</b><i>triples</i></span>
        </div>
      ) : (
        // Honest about not knowing, rather than printing zeroes that look like a read.
        <div className="lobbyscout-empty">No intel yet</div>
      )}
      {/* A stale read is labelled instead of being passed off as current — the seat has not fought since. */}
      {stale && <div className="lobbyscout-stale">as of round {intel!.round}</div>}

      <div className="lobbyscout-log">
        {results.length === 0 ? (
          <div className="lobbyscout-empty">No fights yet</div>
        ) : results.map((r) => (
          <div className={`lobbyscout-row ${r.outcome}`} key={r.round}>
            <span className="lobbyscout-vs">vs {r.foeLabel}</span>
            <span className="lobbyscout-dmg">{r.taken > 0 ? `−${r.taken}` : r.dealt > 0 ? `+${r.dealt}` : '0'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
