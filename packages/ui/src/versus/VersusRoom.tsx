/**
 * VERSUS — the ROOM, on the painted arena (owner 2026-10-16: `versuspng2.jpg`, the empty colosseum: blue banners left,
 * red right, the gate in the centre, an empty stone floor, and NO baked-in UI).
 *
 * Everything on it is the game's own pieces: each seated player is a real game card (VersusPlayerCard, blue side left,
 * red side right) with HOST / the seat on the Gem-plate pill under it, an Open seat is the same card dimmed with Take
 * seat over it, the VS mark between them, the status line, and the spectators as a hand-style fan of small player cards
 * along the bottom (hover lifts one to full size, transform only). The room controls are on the Gem plate. Nothing here
 * draws a frame, a bench or an emblem (no code-drawn props); the VS mark is display-font text until it has art.
 *
 * Geometry: the arena box keeps the painting's aspect (2560x1086) at the stage's full height and is centred, so the
 * sides crop on a 16:9 stage and every overlay is a percentage of the PAINTING, landing in the same place at any stage
 * scale. Static image + a static vignette, no looping paint; the gauntlet cursor comes from the global button rule.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { VERSUS_HEARTS, VERSUS_SPECTATOR_CAP } from '@game/sim';
import { currentUserId } from '../identity';
import { sfx } from '../sfx';
import { useGame } from '../store';
import arenaArt from '../art/versus/arena.webp';
import { displaySeconds } from './versusClock';
import { VersusMatchStats } from './VersusMatchStats';
import { setVersusBotDisconnected, startVersusBot, stopVersusBot, useVersusBot } from './versusBot';
import { versusTestToolsEnabled } from './versusFlag';
import { resumeSpectating } from './spectate';
import { VersusEmptySeatCard, VersusPlayerCard } from './VersusPlayerCard';
import { MAX_RECORD_IDS, useSeatData, type SeatServerData } from './versusSeatCard';
import { leaveRoom, myRole, setVersusStatsOpen, startGame, takeSeat, useVersus, versusRemainingMs, type VersusState } from './versusStore';
import type { VersusMember } from './versusRemote';
import './versus.css';


function useCountdown(iso: string | null | undefined): number {
  const [s, setS] = useState(() => displaySeconds(versusRemainingMs(iso)));
  useEffect(() => {
    if (!iso) return undefined;
    const tick = (): void => setS(displaySeconds(versusRemainingMs(iso)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [iso]);
  return s;
}

function Seat({ side, m, room, match, server }: { side: 'p1' | 'p2'; m: VersusMember | null; room: NonNullable<VersusState['room']>; match: VersusState['match']; server: SeatServerData | undefined }) {
  const botStatus = useVersusBot((s) => s.status);
  const open = room.status === 'open';
  const running = room.status === 'in_game' && match && match.phase !== 'complete';
  const isHost = !!m && m.userId === room.host_user_id;
  return (
    <>
      {/* A seated player is a REAL card (owner 2026-10-16); an open seat is the same card, dimmed, with Take seat. */}
      <div className={`vspcard vspcard-${side}`}>
        {m ? <VersusPlayerCard m={m} server={server} /> : <VersusEmptySeatCard />}
        {!m && open && (
          <span className="vsseatbtns">
            <button className="vsplate vstake" onClick={() => { sfx.pulse(); void takeSeat(side); }}>Take seat</button>
            {/* TEST TOOLS (dev / opted-in browsers only): a bot fills this seat through the normal server protocol. */}
            {versusTestToolsEnabled() && botStatus === 'off' && (
              <button className="vsplate vstake" onClick={() => { sfx.pulse(); void startVersusBot(room.id); }}>Add bot</button>
            )}
          </span>
        )}
      </div>
      {/* The seat's pill under the card, in the side's colour: HOST on the host's seat, the seat otherwise. */}
      <div className={`vsseatlabel vsseatlabel-${side}`}>
        <span className={`vsstatus vsseatpill vsseatpill-${side}${isHost ? ' vsseatpill-host' : ''}`}>{!m ? 'Open seat' : isHost ? 'Host' : side === 'p1' ? 'Player 1' : 'Player 2'}</span>
      </div>
      <div className={`vsgatebox vsgatebox-${side}`}>
        {running && m && <span className="vsgatestate">{side === 'p1' ? match!.p1_hearts : match!.p2_hearts} / {VERSUS_HEARTS} hearts</span>}
      </div>
    </>
  );
}

/**
 * THE STANDS as a hand of cards (owner 2026-10-16: "spectators should show as cards in hand so you can mouse over to
 * view their cards too"): each spectator is a small player card, fanned and overlapped like the hand (`.row.hand .card`:
 * a tilt per position about a point below the row, so the row arcs), tighter the more there are, up to the 20 seats.
 * Hovering one lifts it upright to full size (one transform; nothing is measured). Memoised per member.
 */
function SpectatorFan({ spectators, data }: { spectators: readonly VersusMember[]; data: ReadonlyMap<string, SeatServerData> }) {
  const n = spectators.length;
  return (
    <div className="vsbench" style={{ '--n': n } as CSSProperties}>
      <span className="vsstatus vsbench-label">Spectators</span>
      {n === 0 && <span className="vsbench-empty">No one is watching yet.</span>}
      {spectators.map((m, i) => (
        <div key={m.userId} className="vsbcard" style={{ '--i': i, '--off': i - (n - 1) / 2 } as CSSProperties}>
          <VersusPlayerCard m={m} server={data.get(m.userId)} bench />
        </div>
      ))}
    </div>
  );
}

export function VersusRoom() {
  const room = useVersus((s) => s.room);
  const match = useVersus((s) => s.match);
  const error = useVersus((s) => s.error);
  const setTitleView = useGame((s) => s.setTitleView);
  const gateLeft = useCountdown(room?.status === 'sealed' ? room.gate_deadline : null);
  const bot = useVersusBot();
  const lastMatch = useVersus((s) => s.lastMatch);
  const statsOpen = useVersus((s) => s.statsOpen);
  // The seat cards' numbers: re-read when a player sits or leaves, and when a match ends and the room reopens. (A
  // hook, so it runs before the no-room return.)
  const p1 = room?.members.find((x) => x.role === 'p1') ?? null;
  const p2 = room?.members.find((x) => x.role === 'p2') ?? null;
  // ONE batched read for every card in the room: both seats and every spectator (at most 22 ids, R-NET-01).
  const seatIds = [p1?.userId, p2?.userId, ...(room?.members.filter((x) => x.role === 'spectator').map((x) => x.userId) ?? [])]
    .filter((x): x is string => !!x).slice(0, MAX_RECORD_IDS);
  const seatData = useSeatData(seatIds, `${seatIds.join(',')}|${room?.status === 'open' ? 'open' : 'busy'}|${room?.current_match_id ?? ''}|${lastMatch?.matchId ?? ''}`);
  if (!room) return null;
  const me = currentUserId();
  const role = myRole(room);
  const host = room.host_user_id === me;
  const seat = (r: 'p1' | 'p2'): VersusMember | null => room.members.find((x) => x.role === r) ?? null;
  const spectators = room.members.filter((x) => x.role === 'spectator');
  const open = room.status === 'open';
  const running = room.status === 'in_game' && !!match && match.phase !== 'complete';
  const isPlayer = role === 'p1' || role === 'p2';

  let status: string | null = null;
  // THE GATE (owner 2026-10-14): each player's own entry gate (the ranked doors and crystal) plays over this room; a
  // spectator only sees the wait.
  if (room.status === 'sealed') status = isPlayer ? null : `The players are getting ready. ${gateLeft}s left.`;
  else if (open && !host && isPlayer) status = 'Waiting for the host to start.';
  else if (running && match!.phase === 'hero_select' && !isPlayer) status = 'The players are choosing heroes.';
  else if (running && match!.phase !== 'hero_select' && !isPlayer) status = `Round ${match!.round} is live.`;

  return (
    <div className="vsroomstage" role="dialog" aria-label={`Versus room ${room.name}`} style={{ '--vs-arena': `url(${arenaArt})` } as CSSProperties}>
      <div className="vsarena-ext" aria-hidden="true" />
      <div className="vsarena">
        <img className="vsarena-art" src={arenaArt} alt="" draggable={false} decoding="sync" />
        {/* Readability on the bright arena: a static vignette (gradients only, no blur, no animation). */}
        <div className="vsvignette" aria-hidden="true" />
        {/* The VS mark between the two cards. The old VS emblem was baked into the old painting; until it has its own
            art this is the game's display font with a static glow. */}
        <div className="vsmark" aria-hidden="true">VS</div>
        <Seat side="p1" m={p1} room={room} match={match} server={p1 ? seatData.get(p1.userId) : undefined} />
        <Seat side="p2" m={p2} room={room} match={match} server={p2 ? seatData.get(p2.userId) : undefined} />

        <div className="vscenter">
          {open && host && (
            <button className="vsplate vsstartbtn" disabled={!seat('p1') || !seat('p2')} onClick={() => { sfx.pulse(); void startGame(); }}>Start game</button>
          )}
          {status && <div className="vsstatus">{status}</div>}
          {/* VERSUS PHASE 2: a spectator who stepped back to the room watches again from here. */}
          {running && !isPlayer && match!.phase !== 'hero_select' && (
            <button className="vsplate vsstartbtn" onClick={() => { sfx.pulse(); resumeSpectating(); }}>Watch</button>
          )}
        </div>

        <SpectatorFan spectators={spectators} data={seatData} />
      </div>

      <div className="vsroomtop">
        <button className="vsplate" onClick={() => { sfx.pulse(); setTitleView('modes'); }}>Back</button>
        <span className="vsroomtitle">{room.name}</span>
        {/* The stands: how many are watching, of the 20 seats (ruling 8). */}
        <span className="vsroomwatch">{spectators.length > 0 ? `${spectators.length} / ${VERSUS_SPECTATOR_CAP} watching` : 'No one watching'}</span>
      </div>
      <div className="vsroomctl">
        {open && isPlayer && <button className="vsplate" onClick={() => { sfx.pulse(); void takeSeat('spectator'); }}>Move to the stands</button>}
        {lastMatch && open && <button className="vsplate" onClick={() => { sfx.pulse(); setVersusStatsOpen(true); }}>Previous match stats</button>}
        <button className="vsplate" onClick={() => { sfx.pulse(); void stopVersusBot().then(() => leaveRoom()); }}>{running && isPlayer ? 'Leave (concede)' : 'Leave room'}</button>
        {bot.status === 'playing' && bot.roomId === room.id && (
          <>
            <button className="vsplate" onClick={() => setVersusBotDisconnected(!bot.disconnected)}>{bot.disconnected ? 'Bot reconnects' : 'Bot disconnects'}</button>
            <button className="vsplate" onClick={() => { void stopVersusBot(); }}>Remove bot</button>
          </>
        )}
        {bot.status === 'error' && <span className="vsgatestate">Bot: {bot.error}</span>}
      </div>

      {statsOpen && lastMatch && <VersusMatchStats record={lastMatch} onClose={() => setVersusStatsOpen(false)} />}
      {error && <div className="vserror vsroomerror" role="alert">{error}</div>}
    </div>
  );
}
