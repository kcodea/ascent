/**
 * ONE FINISHED DUOS GAME in Recent Games' DUOS tab (R-DUOS-HISTORY-01): the shared GameCard in its detail layout.
 *
 *   PLACE   your TEAM's placement ("2nd of 4 teams"), banded by the team table (2nd of 4 a good finish, 2nd of 2 the loss).
 *   HERO    your hero; the title is your team's name (or the mode), the subtitle who you played with and their hero, and a
 *           Ranked Duos game shows the rank it was played at.
 *   BOARD   your final board AND your teammate's, each with its runes. Picking a player in the lobby below shows that
 *           player's board alone ("Showing ... Back to yours", the lobby picker's language).
 *   LOBBY   every team, in table order: its placement, name and the round it went out (or Still in / Winner), and its two
 *           players as the lobby picker's tiles (portrait, name, mini board).
 *   META    when, the mode, the length, the rounds, and a rated game's rating change.
 *
 * A pure renderer over the stored record: nothing is recomputed. Recorded Duos boards carry no cosmetics, so every
 * portrait wears the hero's own art.
 */
import { memo, useMemo, useState } from 'react';
import type { DuosHistoryMember, DuosHistoryTeam } from '@game/sim';
import { RUNE_INDEX } from '@game/content';
import { getHero } from '@game/sim';
import { GameCard, placeText } from '../GameCard';
import { GameRank } from '../gameRank';
import { LbHeroFrame } from '../LadderBits';
import { StoredTeam } from '../StoredTeam';
import { RuneEmblem } from '../RuneEmblem';
import { MiniBoard } from '../matchDetails/LobbyPicker';
import { SeatPortrait } from '../matchDetails/MatchScoreboard';
import { lengthText } from '../activePlayClock';
import { playedAtText } from '../leaderboardData';
import { duosBand, duosGameView, duosLengthMs, duosModeLabel, teamFate, teamPlaceText, type DuosGameRow } from './duosHistoryData';
import './duosHistory.css';

const heroName = (id: string): string => (id ? getHero(id).name : 'Unknown hero');
const keyOf = (t: DuosHistoryTeam, m: DuosHistoryMember): string => `${t.team}:${m.seat}`;

/** One member's board with its label and runes (the card's board slot). */
function MemberBoard({ m, label }: { m: DuosHistoryMember; label: string }) {
  const runes = (m.board?.runes ?? []).filter((id) => RUNE_INDEX[id]);
  return (
    <div className="dh-board">
      <div className="dh-board-l"><span className="dh-board-who">{label}</span><span className="dh-board-hero">{heroName(m.heroId)}</span></div>
      {m.board && m.board.minions.length > 0
        ? <StoredTeam minions={m.board.minions} skins={null} label={`${label}'s board`} />
        : <div className="cv2-row-none">{m.board ? 'This board was empty.' : 'No board was recorded for this player.'}</div>}
      {runes.length > 0 && <div className="cv2-runes dh-runes" aria-label={`${label}'s runes`}>{runes.map((id, i) => <RuneEmblem runeId={id} key={`${id}#${i}`} />)}</div>}
    </div>
  );
}

/** The lobby: every team in table order, each its header and its two players' tiles. */
const DuosLobby = memo(function DuosLobby({ teams, myTeam, me, picked, onPick }: {
  teams: readonly DuosHistoryTeam[]; myTeam: DuosHistoryTeam | null; me: DuosHistoryMember | null; picked: string | null; onPick: (key: string | null) => void;
}) {
  const n = teams.length;
  return (
    <section className="lp-tilewrap dh-lobby" aria-label="Teams in this game">
      <span className="lp-tiles-l">The lobby</span>
      <div className={`dh-teams n${n}`}>
        {teams.map((t) => {
          const band = duosBand(t.placement ?? null, n);
          const mine = t === myTeam;
          return (
            <div key={t.team} className={`dh-team lp-${band === 'none' ? 'in' : band}${mine ? ' mine' : ''}`}>
              <div className="dh-team-head">
                <span className="lp-chip-place">{t.placement != null ? placeText(t.placement) : 'Still in'}</span>
                <span className="dh-team-name">{mine ? (t.name ? `${t.name} (your team)` : 'Your team') : t.name ?? 'Team'}</span>
                <span className="lp-tile-out">{teamFate(t)}</span>
              </div>
              <div className="dh-team-tiles">
                {t.members.map((m) => {
                  const key = keyOf(t, m);
                  const self = m === me;
                  const on = self ? picked === null : picked === key;
                  const who = self ? 'You' : m.name;
                  return (
                    <button
                      type="button" key={key} aria-pressed={on}
                      className={`lp-tile dh-tile${on ? ' on' : ''}${self ? ' self' : ''}`}
                      aria-label={`${who}, ${heroName(m.heroId)}. ${teamFate(t)}. Show this board`}
                      onClick={() => onPick(self ? null : key)}
                    >
                      <span className="lp-tile-head">
                        <span className="lp-chip-portrait"><SeatPortrait heroId={m.heroId} skins={null} self={self} /></span>
                        <span className="lp-chip-txt">
                          <span className="lp-chip-name">{who}</span>
                          <span className="dh-tile-hero">{heroName(m.heroId)}</span>
                        </span>
                      </span>
                      <MiniBoard minions={m.board?.minions ?? []} />
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
});

export const DuosGameCard = memo(function DuosGameCard({ row, myId }: { row: DuosGameRow; myId: string | null }) {
  const v = useMemo(() => duosGameView(row.record, myId), [row, myId]);
  const [picked, setPicked] = useState<string | null>(null);
  const n = v.teamCount;
  const band = duosBand(v.place, n);
  const ranked = row.mode === 'ranked_duos';
  const title = v.myTeam?.name ?? duosModeLabel(row.mode);
  const pickedSeat = useMemo(() => {
    if (!picked) return null;
    for (const t of row.record.teams) for (const m of t.members) if (keyOf(t, m) === picked) return { t, m };
    return null;
  }, [picked, row]);
  const when = playedAtText(row.completedAt);
  const delta = row.rank?.delta ?? null;

  const board = pickedSeat
    ? <MemberBoard m={pickedSeat.m} label={pickedSeat.m.name} />
    : (
      <div className="dh-boards">
        {v.me && <MemberBoard m={v.me} label="You" />}
        {v.mate && <MemberBoard m={v.mate} label={v.mate.name} />}
      </div>
    );
  const showing = pickedSeat
    ? `${pickedSeat.m.name}'s board, ${pickedSeat.t === v.myTeam ? 'your teammate' : pickedSeat.t.name ?? 'another team'}, ${teamFate(pickedSeat.t).replace('Out R', 'out in round ').toLowerCase()}`
    : 'Your board and your teammate\'s';

  return (
    <GameCard
      as="div"
      place={v.place}
      band={band}
      label={teamPlaceText(v.place, n)}
      resultClass="lb-verdict"
      className="lb-row rg-card gc-detail dh-card"
      rootProps={{ 'aria-label': `${duosModeLabel(row.mode)}: ${teamPlaceText(v.place, n)}` }}
      hero={<LbHeroFrame heroId={v.me?.heroId} side="self" />}
      title={<span className="lb-row-name">{title}</span>}
      subtitle={<span className="lb-row-herosub">{heroName(v.me?.heroId ?? '')}{v.mate ? ` with ${v.mate.name} (${heroName(v.mate.heroId)})` : ''}</span>}
      record={<span className={`lb-row-record ${band === 'won' || band === 'top4' ? 'won' : 'lost'}`}>{teamPlaceText(v.place, n)}</span>}
      rank={ranked && row.rank ? <GameRank divisionIndex={row.rank.divisionBefore} /> : undefined}
      lobby={(
        <div className="lp-showing" aria-live="polite">
          <span className="lp-showing-l">Showing</span>
          <span className="lp-showing-v">{showing}</span>
          {pickedSeat
            ? <button type="button" className="cv2-btn lp-back pressable" onClick={() => setPicked(null)}><span aria-hidden="true">‹</span>Back to yours</button>
            : <span className="lp-hint">Pick a player below to see their board</span>}
        </div>
      )}
      boardKey={picked ?? undefined}
      board={board}
      meta={(
        <div className="lb-facts">
          {when && <span className="lb-fact lb-fact-when"><span className="lb-when">{when}</span></span>}
          <span className="lb-fact"><span className="lb-fact-l">Mode</span><span className="lb-fact-v">{duosModeLabel(row.mode)}</span></span>
          <span className="lb-fact"><span className="lb-fact-l">Length</span><span className="lb-fact-v">{lengthText(duosLengthMs(row))}</span></span>
          {row.endRound > 0 && <span className="lb-fact"><span className="lb-fact-l">Rounds</span><span className="lb-fact-v">{row.endRound}</span></span>}
          {ranked && delta !== null && (
            <span className="lb-fact"><span className="lb-fact-l">Points</span><span className={`lb-fact-v dh-delta ${delta >= 0 ? 'up' : 'down'}`}>{delta > 0 ? `+${delta}` : delta}</span></span>
          )}
          {ranked && !row.rank && <span className="lb-fact"><span className="lb-fact-v">Unrated</span></span>}
        </div>
      )}
      extra={<DuosLobby teams={row.record.teams} myTeam={v.myTeam} me={v.me} picked={picked} onPick={setPicked} />}
    />
  );
});
