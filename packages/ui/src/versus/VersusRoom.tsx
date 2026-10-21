/**
 * VERSUS — the ROOM, on the painted arena (owner 2026-10-16: `versuspng2.jpg`, the empty colosseum: blue banners left,
 * red right, the gate in the centre, an empty stone floor, and NO baked-in UI).
 *
 * Everything on it is the game's own pieces: each seated player is a real game card (VersusPlayerCard, blue side left,
 * red side right) with HOST / the seat on the Gem-plate pill under it, an Open seat is the same card dimmed with Take
 * seat over it, the VS mark between them, the status line, and the spectators as a hand-style fan of small player cards
 * along the bottom (hover lifts one to full size, transform only, decided by still hit pads so it never flickers). The room controls are on the Gem plate. Nothing here
 * draws a frame, a bench or an emblem (no code-drawn props); the VS mark is display-font text until it has art.
 *
 * Geometry: the arena box keeps the painting's aspect (2560x1086) at the stage's full height and is centred, so the
 * sides crop on a 16:9 stage and every overlay is a percentage of the PAINTING, landing in the same place at any stage
 * scale. Static image + a static vignette, no looping paint; the gauntlet cursor comes from the global button rule.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
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
import { canDragSeatCard, roomWithSeatMove } from './seatDrag';
import { beginSeatDrag, endSeatDrag, SeatDragGhost, useSeatDragStore, useSeatFlip, type SeatDragState } from './useSeatDrag';
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

/** The drag classes a room card's wrapper wears (R-VERSUS-DRAG-SEAT-01): `vsdraggable` = my own card in an open room
 *  (press and drag it), `vsdragsrc` = the card the ghost was lifted from (hidden while it flies). */
function dragClass(m: VersusMember | null, room: NonNullable<VersusState['room']>, me: string | null, drag: SeatDragState | null): string {
  if (!m) return '';
  return `${canDragSeatCard(room, me, m.userId) ? ' vsdraggable' : ''}${drag?.userId === m.userId ? ' vsdragsrc' : ''}`;
}

function Seat({ side, m, room, match, server, me, drag, arena }: { side: 'p1' | 'p2'; m: VersusMember | null; room: NonNullable<VersusState['room']>; match: VersusState['match']; server: SeatServerData | undefined; me: string | null; drag: SeatDragState | null; arena: RefObject<HTMLDivElement> }) {
  const botStatus = useVersusBot((s) => s.status);
  const open = room.status === 'open';
  const running = room.status === 'in_game' && match && match.phase !== 'complete';
  const isHost = !!m && m.userId === room.host_user_id;
  // The drop-target state while a card is dragged over this seat: open = lit, taken = no light (the drop is refused).
  const over = drag && !drag.snap && drag.zone === side ? (drag.valid ? ' vsseat-over' : ' vsseat-bad') : '';
  return (
    <>
      {/* A seated player is a REAL card (owner 2026-10-16); an open seat is the same card, dimmed, with Join. MY card
          drags (R-VERSUS-DRAG-SEAT-01): onto the other open seat to switch, or up to the stands. */}
      <div className={`vspcard vspcard-${side}${over}${dragClass(m, room, me, drag)}`} data-seat={side}
        onPointerDown={m && canDragSeatCard(room, me, m.userId) ? (e) => beginSeatDrag(e, m.userId, arena.current) : undefined}>
        {m ? <VersusPlayerCard m={m} server={server} /> : <VersusEmptySeatCard />}
        {!m && open && (
          <span className="vsseatbtns">
            <button className="vsplate vstake" onClick={() => { sfx.pulse(); void takeSeat(side); }}>Join</button>
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
function SpectatorFan({ spectators, data, room, me, drag, arena }: { spectators: readonly VersusMember[]; data: ReadonlyMap<string, SeatServerData>; room: NonNullable<VersusState['room']>; me: string | null; drag: SeatDragState | null; arena: RefObject<HTMLDivElement> }) {
  const n = spectators.length;
  return (
    <div className="vsbench" style={{ '--n': n } as CSSProperties}>
      <span className="vsstatus vsbench-label">Spectators</span>
      {n === 0 && <span className="vsbench-empty">No one is watching yet.</span>}
      {spectators.map((m, i) => (
        <div key={m.userId} className={`vsbcard${dragClass(m, room, me, drag)}`} style={{ '--i': i, '--off': i - (n - 1) / 2 } as CSSProperties}
          onPointerDown={canDragSeatCard(room, me, m.userId) ? (e) => beginSeatDrag(e, m.userId, arena.current) : undefined}>
          {/* THE HOVER IS DECIDED BY STILL PADS, NEVER BY THE MOVING CARD (owner 2026-10-20, R-VERSUS-HAND-HOVER-01): the
              card's lift is drawn on `.vsbcard-lift`, which never takes the pointer, so popping up cannot move the card
              out from under the hand that popped it. `hit` is the card's strip of the fan; `band` widens it a little
              while hovered (a boundary never flickers between two neighbours); `up` covers the popped card above the
              fan only while it is up, so the hand can travel onto it and grab it. */}
          <span className="vsbcard-hit" aria-hidden="true" />
          <span className="vsbcard-band" aria-hidden="true" />
          <span className="vsbcard-hitup" aria-hidden="true" />
          <div className="vsbcard-lift">
            <VersusPlayerCard m={m} server={data.get(m.userId)} bench />
          </div>
        </div>
      ))}
    </div>
  );
}

export function VersusRoom() {
  const serverRoom = useVersus((s) => s.room);
  const seatMove = useVersus((s) => s.seatMove);
  const me = currentUserId();
  // THE ROOM AS SHOWN (R-VERSUS-DRAG-SEAT-01): the server's room with my seat move applied the moment I make it.
  const room = useMemo(() => roomWithSeatMove(serverRoom, seatMove, me), [serverRoom, seatMove, me]);
  const drag = useSeatDragStore((s) => s.drag);
  const arenaRef = useRef<HTMLDivElement>(null);
  useSeatFlip(arenaRef, room?.members.map((x) => `${x.userId}:${x.role}`).join(',') ?? '');
  useEffect(() => () => endSeatDrag(), []);
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
  if (!room || !serverRoom) return null;
  const role = myRole(room);
  const host = room.host_user_id === me;
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
      <div className="vsarena" ref={arenaRef}>
        <img className="vsarena-art" src={arenaArt} alt="" draggable={false} decoding="sync" />
        {/* Readability on the bright arena: a static vignette (gradients only, no blur, no animation). */}
        <div className="vsvignette" aria-hidden="true" />
        {/* The VS mark between the two cards. The old VS emblem was baked into the old painting; until it has its own
            art this is the game's display font with a static glow. */}
        <div className="vsmark" aria-hidden="true">VS</div>
        <Seat side="p1" m={p1} room={room} match={match} server={p1 ? seatData.get(p1.userId) : undefined} me={me} drag={drag} arena={arenaRef} />
        <Seat side="p2" m={p2} room={room} match={match} server={p2 ? seatData.get(p2.userId) : undefined} me={me} drag={drag} arena={arenaRef} />

        <div className="vscenter">
          {open && host && (
            <button className="vsplate vsstartbtn" disabled={!serverRoom.members.some((x) => x.role === 'p1') || !serverRoom.members.some((x) => x.role === 'p2')} onClick={() => { sfx.pulse(); void startGame(); }}>Start game</button>
          )}
          {status && <div className="vsstatus">{status}</div>}
          {/* VERSUS PHASE 2: a spectator who stepped back to the room watches again from here. */}
          {running && !isPlayer && match!.phase !== 'hero_select' && (
            <button className="vsplate vsstartbtn" onClick={() => { sfx.pulse(); resumeSpectating(); }}>Watch</button>
          )}
        </div>

        <SpectatorFan spectators={spectators} data={seatData} room={room} me={me} drag={drag} arena={arenaRef} />
      </div>

      <div className="vsroomtop">
        <button className="vsplate" onClick={() => { sfx.pulse(); setTitleView('modes'); }}>Back</button>
        <span className="vsroomtitle">{room.name}</span>
        {/* The stands: how many are watching, of the 20 seats (ruling 8). */}
        <span className="vsroomwatch">{spectators.length > 0 ? `${spectators.length} / ${VERSUS_SPECTATOR_CAP} watching` : 'No one watching'}</span>
      </div>
      <div className="vsroomctl">
        {open && isPlayer && <button className="vsplate" onClick={() => { sfx.pulse(); void takeSeat('spectator'); }}>Spectate</button>}
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

      {/* THE SELL ZONE (the shop's own overlay): a seated card dragged up here goes back to the stands. */}
      {drag && !drag.snap && drag.sellTop !== null && (
        <div className={`sellzone vssellzone${drag.zone === 'stands' ? ' on' : ''}`} style={{ height: drag.sellTop }} aria-hidden="true" />
      )}
      <SeatDragGhost room={room} data={seatData} />

      {statsOpen && lastMatch && <VersusMatchStats record={lastMatch} onClose={() => setVersusStatsOpen(false)} />}
      {error && <div className="vserror vsroomerror" role="alert">{error}</div>}
    </div>
  );
}
