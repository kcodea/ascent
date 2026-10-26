/**
 * VERSUS — the ROOM, on the arena (owner 2026-10-16: `versuspng2.jpg`, the empty colosseum: blue banners left, red
 * right, the gate in the centre, an empty stone floor, and NO baked-in UI).
 *
 * THE STAGE (owner 2026-10-21, "a 1.5/10, i need an 8/10 minimum", R-VERSUS-ROOM-POLISH-01): the arena is a soft,
 * pre-blurred backdrop under a static grade, so the cards read first. Two fighter seats face each other low and close
 * across the VS mark; under each, only what matters (the Host tag, or Join on an open seat); the host's Start game
 * between them; the spectators as a hand of cards along the bottom (hover lifts one to 90% of the seat card's size,
 * transform only, decided by still hit pads so it never flickers). The room's name heads the stage; Back top left,
 * the room controls bottom left.
 *
 * Everything on it is the game's own pieces: each member is a real game card (VersusPlayerCard) with the in-game
 * minion stat pills at their in-game proportion, the Gem plate buttons, the name-pill tag, the shop's drag, sell zone,
 * landing dust, coins and plate coalesce. Nothing here draws a frame, a bench or an emblem (no code-drawn props); the
 * VS mark is display-font text until it has art.
 *
 * Geometry: the arena box keeps the painting's aspect (2560x1086) at the stage's full height and is centred, so every
 * overlay is a percentage of the PAINTING and lands in the same place at any stage scale. Static paint; the only motion
 * is one-shot transform / opacity (the entrance, the seat moves); the gauntlet cursor comes from the global rule.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { duosMateOf, normalizeVersusOptions, versusDuosStartingVitals, versusStartingVitals, VERSUS_MODE_SEATS, VERSUS_SPECTATOR_CAP, type VersusGroupSeat } from '@game/sim';
import { Icon } from '../Icon';
import { currentUserId } from '../identity';
import { sfx } from '../sfx';
import { useGame } from '../store';
import { playDef } from '../fx/playDef';
import arenaBlur from '../art/versus/arena-blur.webp';
import { publicAssetCssUrl } from '../floatConfig';
import { displaySeconds } from './versusClock';
import { VersusMatchStats } from './VersusMatchStats';
import { freeVersusBotSlot, setVersusBotDisconnected, startVersusBot, stopVersusBot, useVersusBots } from './versusBot';
import { versusTestToolsEnabled } from './versusFlag';
import { resumeSpectating } from './spectate';
import { VersusEmptySeatCard, VersusPlayerCard } from './VersusPlayerCard';
import { MAX_RECORD_IDS, useSeatData, type SeatServerData } from './versusSeatCard';
import { leaveRoom, myRole, setRoomOptions, setVersusStatsOpen, startGame, useVersus, versusRemainingMs, type VersusState } from './versusStore';
import { VersusOptionsPanel, versusOptionsSummary } from './versusOptionsUi';
import { canDragSeatCard, roomWithSeatMove } from './seatDrag';
import { beginSeatDrag, endSeatDrag, SeatDragGhost, useRoomCards, useSeatDragStore, type SeatDragState } from './useSeatDrag';
import type { VersusMember } from './versusRemote';
import { RoomInvitePanel } from '../friends/RoomInvitePanel';
import { friendsAccount } from '../friends/friendsStore';
import { DuosResultOverlay, FriendsOnlyToggle, TeamNamePanel, TeamPlate, partyPair, usePartyTeamName } from './DuosParty';
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

/** How long the entrance runs before the room is fully live (ms). Any click or key finishes it at once. */
export const VS_ENTRANCE_MS = 1250;

/** The card plate's wireframe (the plate coalesce's own mask, `frames/cardplate-wire.webp`): the open seat's silhouette. */
const PLATE_WIRE = publicAssetCssUrl('frames/cardplate-wire.webp');

/**
 * ENTERING THE ROOM (owner 2026-10-21: "make this feel more exciting than simply an instantaneous ui/screen change",
 * R-VERSUS-ROOM-ENTER-01). One short, skippable beat in the game's own language: the screen opens out of the dark
 * (the curtain's reveal), the arena settles in, the fighters stride in from either side, the VS mark slams down with
 * the authored `ground-slam` def and the gate's own open cue, and the hand rises card by card. The motion itself is
 * CSS keyframes on `.vsenter` (transform / opacity only, one shot, versus.css); this hook only arms it, fires the two
 * cues, and finishes everything on the first click or key. Reduced motion skips it.
 */
function useRoomEntrance(stage: RefObject<HTMLDivElement>, roomId: string | undefined): boolean {
  const [on, setOn] = useState(false);
  const played = useRef<string | null>(null);
  // Arm once per room this view opens (a second render, or StrictMode's double effect, never replays it).
  useLayoutEffect(() => {
    if (!roomId || played.current === roomId) return;
    played.current = roomId;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setOn(true);
    sfx.gate('open');
  }, [roomId]);
  useEffect(() => {
    if (!on) return undefined;
    const finish = (): void => {
      for (const a of stage.current?.getAnimations?.({ subtree: true }) ?? []) {
        if ((a as { animationName?: string }).animationName?.startsWith('vsin')) a.finish();
      }
      setOn(false);
    };
    // The VS mark lands: the authored ground slam under it.
    const slam = window.setTimeout(() => {
      const vs = stage.current?.querySelector<HTMLElement>('.vsmark');
      if (!vs) return;
      const r = vs.getBoundingClientRect();
      const c = { x: r.left + r.width / 2, y: r.top + r.height * 0.62 };
      playDef('ground-slam', { source: c, target: c }, { slot: 'over' }); // the board's `under` canvas is beneath the title
    }, 490);
    const done = window.setTimeout(finish, VS_ENTRANCE_MS);
    // The veil takes the skipping click (so it never also presses a button under it); any key skips too.
    const veil = stage.current?.querySelector<HTMLElement>('.vsenter-veil');
    veil?.addEventListener('pointerdown', finish);
    window.addEventListener('keydown', finish);
    return () => {
      window.clearTimeout(slam); window.clearTimeout(done);
      veil?.removeEventListener('pointerdown', finish);
      window.removeEventListener('keydown', finish);
    };
  }, [on, stage]);
  return on;
}

/**
 * THE FACE-OFF BEAT (owner 2026-10-21: "consider one-shot motion when the second fighter arrives"): each time the
 * room goes from one fighter to two, the VS mark is re-keyed so it slams once more (`.vsmark-full`, transform /
 * opacity) and the authored `ground-slam` plays under it. Never on the room's first paint (the entrance owns that).
 */
function useFullBeat(stage: RefObject<HTMLDivElement>, full: boolean): number {
  const [beat, setBeat] = useState(0);
  const was = useRef<boolean | null>(null);
  useEffect(() => {
    const before = was.current;
    was.current = full;
    if (before !== false || !full) return undefined;
    setBeat((b) => b + 1);
    const t = window.setTimeout(() => {
      const vs = stage.current?.querySelector<HTMLElement>('.vsmark');
      if (!vs) return;
      const r = vs.getBoundingClientRect();
      const c = { x: r.left + r.width / 2, y: r.top + r.height * 0.62 };
      playDef('ground-slam', { source: c, target: c }, { slot: 'over' });
    }, 260);
    return () => window.clearTimeout(t);
  }, [full, stage]);
  return beat;
}

/** How long Start game takes to fade and sink away when a seat empties (ms); matches `.vsstart.out` in versus.css. */
const START_EXIT_MS = 220;

/**
 * START GAME'S PRESENCE (owner 2026-10-21: "when the second player takes a seat, the Start game button fades in and
 * floats up into place ... if a seat empties again, it fades and sinks away"). Returns [shown, leaving]: shown while
 * both seats are filled, and for START_EXIT_MS after one empties (leaving), so the exit can play before it unmounts.
 */
function useStartPresence(full: boolean): [boolean, boolean] {
  const [leaving, setLeaving] = useState(false);
  const was = useRef(full);
  useEffect(() => {
    const before = was.current;
    was.current = full;
    if (full) { setLeaving(false); return undefined; }
    if (!before) return undefined;
    setLeaving(true);
    const t = window.setTimeout(() => setLeaving(false), START_EXIT_MS);
    return () => window.clearTimeout(t);
  }, [full]);
  return [full || leaving, !full && leaving];
}

/** A seat's Health and Armor in the running match (R-VERSUS-HEALTH-01): the 1v1 row, or the group table's seat (Duos: its
 *  team's pool); before round 1 commits, its hero's start. Null for a seat that is not in the match. */
function seatPools(match: VersusState['match'], side: VersusGroupSeat): { health: number; armor: number } | null {
  if (!match) return null;
  if (match.group) {
    const raw = match.group.raw;
    const row = raw.seats.find((x) => x.seat === side);
    if (!row) return null;
    const start = raw.options?.mode === 'duos'
      ? versusDuosStartingVitals(row.hero, raw.seats.find((x) => x.seat === duosMateOf(side))?.hero, raw.options)
      : versusStartingVitals(row.hero, raw.options);
    return { health: row.health ?? start.health, armor: row.armor ?? start.armor };
  }
  if (side !== 'p1' && side !== 'p2') return null;
  const start = versusStartingVitals(side === 'p1' ? match.p1_hero : match.p2_hero, match.options);
  return {
    health: (side === 'p1' ? match.p1_health : match.p2_health) ?? start.health,
    armor: (side === 'p1' ? match.p1_armor : match.p2_armor) ?? start.armor,
  };
}

function Seat({ side, m, room, match, me, drag, arena }: { side: VersusGroupSeat; m: VersusMember | null; room: NonNullable<VersusState['room']>; match: VersusState['match']; me: string | null; drag: SeatDragState | null; arena: RefObject<HTMLDivElement> }) {
  // A free bot slot (three at most) and no add in flight: any open seat can take a bot (Group and Duos too).
  const canAddBot = useVersusBots((s) => !s.busy && s.bots.length < 3) && freeVersusBotSlot() != null;
  const open = room.status === 'open';
  const running = room.status === 'in_game' && match && match.phase !== 'complete';
  const mine = room.members.find((x) => x.userId === me) ?? null;
  const iSit = !!mine && mine.role !== 'spectator';
  const isHostViewer = !!me && me === room.host_user_id;
  // THE OPEN SEAT (owner 2026-10-21, R-VERSUS-ROOM-POLISH-03): a seat is taken by DRAGGING your card onto it (and left by
  // dragging it back to the hand); the slot's own text is the only waiting cue.
  const joinable = !m && open && !!mine && !iSit;
  // The drop-target state while a card is dragged over this seat: open = lit, taken = no light (the drop is refused).
  const over = drag && !drag.snap && drag.zone === side ? (drag.valid ? ' vsseat-over' : ' vsseat-bad') : '';
  const live = !open ? 'Waiting for a player' : joinable ? 'Drag your card here' : 'Waiting for an opponent';
  // Under a seated card the open-seat card is invisible: its text holds still until the seat empties again, so a card
  // landing never re-lays out text no one can see (R-VERSUS-ROOM-MOUNTED-01).
  const shownHint = useRef(live);
  if (!m) shownHint.current = live;
  const hint = shownHint.current;
  const mineHere = !!m && canDragSeatCard(room, me, m.userId);
  return (
    <>
      {/* The SEAT: the drop target and an open seat's recessed slot of the seat card's footprint (the plate's wireframe,
          dimmed). The seated player's REAL card (owner 2026-10-16) is not in here: it is that member's one card in the
          room's card layer, placed over this slot (R-VERSUS-ROOM-MOUNTED-01). MY seated card drags from anywhere on the
          seat (R-VERSUS-DRAG-SEAT-01): onto the other open seat to switch, or down to the hand. */}
      <div className={`vspcard vspcard-${side}${over}${mineHere ? ' vsdraggable' : ''}${m ? '' : ' vspcard-open'}${joinable ? ' vspcard-joinable' : ''}`} data-seat={side}
        onPointerDown={mineHere ? (e) => beginSeatDrag(e, m.userId, arena.current) : undefined}>
        {/* The open-seat card is ALWAYS here, under a seated card (owner 2026-10-21: "show the empty seat fade back in,
            not snap in"): it fades out as a card lands and fades back in as the seat empties (`.gone`, one transition).
            Its box is also the seated card's slot (`readRoomGeo`). */}
        <VersusEmptySeatCard hint={hint} gone={!!m} />
        {/* TEST TOOLS (dev / opted-in browsers only): a bot fills this seat through the normal server protocol. The host's
            only, on an empty seat, at ONE fixed place under the seat's footprint (owner 2026-10-21: "add bot jumps
            around and is hard to click"): nothing it sits in moves, and it never moves on hover. Up to three bots, each
            its own account, so a Group or Duos table can be filled alone (owner 2026-10-25). */}
        {!m && open && isHostViewer && versusTestToolsEnabled() && canAddBot && (
          <button className="vsplate vsslot-bot" onClick={() => { sfx.pulse(); void startVersusBot(room.id, side); }}>Add bot</button>
        )}
      </div>
      <div className={`vsgatebox vsgatebox-${side}`}>
        {running && m && (() => {
          const p = seatPools(match, side);
          // The Health box's own content (heart + Health, the Armor badge): the same numbers the game shows.
          return p && (
            <span className="vsgatestate vsgate-hp" aria-label={`Health ${p.health}${p.armor > 0 ? `, Armor ${p.armor}` : ''}`}>
              <Icon name="heartPill" />{p.health}
              {p.armor > 0 && <b className="armval hudpill-arm"><Icon name="armor" /><span className="hp-armplus">+</span>{p.armor}</b>}
            </span>
          );
        })()}
      </div>
    </>
  );
}

/**
 * THE STANDS as a hand of cards (owner 2026-10-16: "spectators should show as cards in hand so you can mouse over to
 * view their cards too"): a flat row along the bottom like the shop hand, tighter the more there are, up to the 20
 * seats. The bench itself holds only its label and one still ANCHOR per hand slot (`.vsbslot`, placed by the hand's CSS
 * from `--n` and its `--off`); the cards are the members' own cards in the room's card layer, placed over the anchors
 * (R-VERSUS-ROOM-MOUNTED-01).
 */
function SpectatorFan({ n }: { n: number }) {
  return (
    <div className="vsbench" style={{ '--n': n } as CSSProperties}>
      {/* THE BENCH (owner 2026-10-21, R-VERSUS-ROOM-STANDS-01): the spectators as a hand, no box behind them; the quiet
          label is centred on the fan just above the cards. */}
      <span className="vsstands-label hudpill-name" aria-hidden="true">Spectators<span className="vsstands-count">{n} / {VERSUS_SPECTATOR_CAP}</span></span>
      {Array.from({ length: n }, (_, i) => <span key={i} className="vsbslot" style={{ '--off': i - (n - 1) / 2 } as CSSProperties} aria-hidden="true" />)}
    </div>
  );
}

/** What a room card draws of its member (the card ignores the role): one object per member for as long as its name and
 *  profile hold, so a seat move (a new member object with a new role) never re-renders the card. */
type CardFace = Pick<VersusMember, 'userId' | 'displayName' | 'profile'>;
function useCardFaces(): (m: VersusMember) => CardFace {
  const cache = useRef(new Map<string, { m: VersusMember; key: string; face: CardFace }>());
  return (m) => {
    const hit = cache.current.get(m.userId);
    if (hit && hit.m === m) return hit.face;
    const key = `${m.displayName}|${JSON.stringify(m.profile ?? {})}`;
    if (hit && hit.key === key) { hit.m = m; return hit.face; }
    const face = { userId: m.userId, displayName: m.displayName, profile: m.profile };
    cache.current.set(m.userId, { m, key, face });
    return face;
  };
}

/**
 * ONE ROOM CARD, mounted for as long as its member is in the room (R-VERSUS-ROOM-MOUNTED-01). `useRoomCards` places it
 * by its transform (a seat, or a hand slot at the hand's smaller scale); nothing here moves it. As a HAND card it keeps
 * the hand's hover (R-VERSUS-HAND-HOVER-01): THE HOVER IS DECIDED BY STILL PADS, NEVER BY THE MOVING CARD. The lift is
 * drawn on `.vsbcard-lift`, which never takes the pointer, so popping up cannot move the card out from under the hand
 * that popped it. `hit` is the card's strip of the fan; `band` widens it a little while hovered (a boundary never
 * flickers between two neighbours); `up` covers the popped card above the fan only while it is up, so the hand can
 * travel onto it and grab it. As a SEAT card the pads are off and it takes no pointer: the open-seat card under it
 * (same box) takes the hover and hands the press to the seat's own drag.
 */
const RoomCard = memo(function RoomCard({ face, server, host, slot, i, draggable, dragSrc, arena }: { face: CardFace; server: SeatServerData | undefined; host: boolean; slot: VersusGroupSeat | 'bench'; i: number; draggable: boolean; dragSrc: boolean; arena: RefObject<HTMLDivElement> }) {
  const seat = slot !== 'bench';
  // The entrance's stagger (`.vsenter`): the fighters stride in at 0.18 s / 0.24 s, the hand rises card by card.
  const delay = slot === 'p1' ? 0.18 : slot === 'p2' ? 0.24 : slot === 'p3' ? 0.3 : slot === 'p4' ? 0.36 : 0.46 + Math.min(i, 8) * 0.045;
  return (
    <div className={`vsmcard ${seat ? `vsmcard-seat vsmcard-${slot}` : 'vsbcard'}${draggable ? ' vsdraggable' : ''}${dragSrc ? ' vsdragsrc' : ''}`} data-vsm={face.userId}
      style={{ '--vsz': seat ? 10 : 10 + i } as CSSProperties}
      onPointerDown={draggable ? (e) => beginSeatDrag(e, face.userId, arena.current) : undefined}>
      <div className="vsmcard-in" style={{ animationDelay: `${delay}s` }}>
        <span className="vsbpads" aria-hidden="true">
          <span className="vsbcard-hit" />
          <span className="vsbcard-band" />
          <span className="vsbcard-hitup" />
        </span>
        <div className="vsbcard-lift">
          <VersusPlayerCard m={face} server={server} host={host} />
        </div>
      </div>
    </div>
  );
});

/**
 * THE ROOM'S CARD LAYER: every member's one card, in the order they arrived (moving a DOM node is a remount for the
 * browser, so a seat move never reorders this list; only a join appends and a leave removes). The hand's order lives
 * in its slots, not here.
 */
function RoomCards({ room, data, me, drag, arena }: { room: NonNullable<VersusState['room']>; data: ReadonlyMap<string, SeatServerData>; me: string | null; drag: SeatDragState | null; arena: RefObject<HTMLDivElement> }) {
  const order = useRef<string[]>([]);
  const faceOf = useCardFaces();
  const byId = new Map(room.members.map((m) => [m.userId, m] as const));
  const kept = order.current.filter((id) => byId.has(id));
  order.current = [...kept, ...room.members.map((m) => m.userId).filter((id) => !kept.includes(id))];
  const benchIndex = new Map(room.members.filter((m) => m.role === 'spectator').map((m, i) => [m.userId, i] as const));
  return (
    <div className="vscards">
      {order.current.map((id) => {
        const m = byId.get(id)!;
        const slot = m.role === 'spectator' ? 'bench' : m.role;
        return (
          <RoomCard key={id} face={faceOf(m)} server={data.get(id)} host={id === room.host_user_id} slot={slot} i={benchIndex.get(id) ?? 0}
            draggable={canDragSeatCard(room, me, id)} dragSrc={drag?.userId === id} arena={arena} />
        );
      })}
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
  const stageRef = useRef<HTMLDivElement>(null);
  // The room's mode re-lays the seats out (two, or four for a group room): it rides the placement signature.
  const roomMode = normalizeVersusOptions(serverRoom?.options).mode;
  useRoomCards(arenaRef, `${room?.members.map((x) => `${x.userId}:${x.role}`).join(',') ?? ''},mode:${roomMode}`);
  useEffect(() => () => endSeatDrag(), []);
  // The room's FX (coins, landing dust, the entrance slam) play on the game's FX canvas, lifted over the room while it
  // is up (versus.css `body.vsroom-on`): a class, so nothing is matched per mutation.
  useEffect(() => { document.body.classList.add('vsroom-on'); return () => document.body.classList.remove('vsroom-on'); }, []);
  const entering = useRoomEntrance(stageRef, serverRoom?.id);
  // Enough players to start: both seats (1v1), or three of the four (group, R-VERSUS-GROUP-05).
  const seatedCount = serverRoom?.members.filter((x) => x.role !== 'spectator').length ?? 0;
  const enough = !!serverRoom && seatedCount >= VERSUS_MODE_SEATS[roomMode].min;
  const [startShown, startLeaving] = useStartPresence(!!serverRoom && serverRoom.status === 'open' && enough);
  const vsBeat = useFullBeat(stageRef, enough);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // FRIENDS (R-FRIENDS-04): Invite friends to this room (accounts only).
  const [inviteOpen, setInviteOpen] = useState(false);
  // RANKED DUOS (phase 3): a party is a ranked_duos room; its team name (either teammate, between games).
  const party = roomMode === 'ranked_duos';
  const [teamName, setTeamName] = usePartyTeamName(party ? serverRoom ?? null : null);
  const [nameOpen, setNameOpen] = useState(false);
  const optionsNotice = useVersus((s) => s.optionsNotice);
  const match = useVersus((s) => s.match);
  const error = useVersus((s) => s.error);
  const setTitleView = useGame((s) => s.setTitleView);
  const gateLeft = useCountdown(room?.status === 'sealed' ? room.gate_deadline : null);
  const bots = useVersusBots();
  const roomBots = bots.bots.filter((b) => b.roomId === serverRoom?.id && b.status === 'playing');
  const allOff = roomBots.length > 0 && roomBots.every((b) => b.disconnected);
  const lastMatch = useVersus((s) => s.lastMatch);
  const statsOpen = useVersus((s) => s.statsOpen);
  // The seat cards' numbers: re-read when a player sits or leaves, and when a match ends and the room reopens. (A
  // hook, so it runs before the no-room return.)
  const fourSeats = roomMode === 'group' || roomMode === 'duos';
  const seatRoles: VersusGroupSeat[] = fourSeats ? ['p1', 'p2', 'p3', 'p4'] : ['p1', 'p2'];
  const seated = seatRoles.map((r) => room?.members.find((x) => x.role === r) ?? null);
  // ONE batched read for every card in the room: every seat and every spectator (at most 24 ids, R-NET-01).
  const seatIds = [...seated.map((x) => x?.userId), ...(room?.members.filter((x) => x.role === 'spectator').map((x) => x.userId) ?? [])]
    .filter((x): x is string => !!x).slice(0, MAX_RECORD_IDS);
  const seatData = useSeatData(seatIds, `${seatIds.join(',')}|${room?.status === 'open' ? 'open' : 'busy'}|${room?.current_match_id ?? ''}|${lastMatch?.matchId ?? ''}`);
  if (!room || !serverRoom) return null;
  const role = myRole(room);
  const host = room.host_user_id === me;
  const spectators = room.members.filter((x) => x.role === 'spectator');
  const open = room.status === 'open';
  const running = room.status === 'in_game' && !!match && match.phase !== 'complete';
  // A group player already out of the running match watches it like the stands (R-VERSUS-GROUP-02).
  const outOfMatch = !!match?.group && !!role && role !== 'spectator' && !match.group.me;
  const isPlayer = !!role && role !== 'spectator' && !outOfMatch;
  const hostEdits = host && open;
  // Who hosts, wherever they sit (a host in the hand has no seat tag): named once, in the room's heading.
  const hostName = room.members.find((x) => x.userId === room.host_user_id)?.displayName?.trim() || null;

  let status: string | null = null;
  // THE GATE (owner 2026-10-14): each player's own entry gate (the ranked doors and crystal) plays over this room; a
  // spectator only sees the wait.
  if (room.status === 'sealed') status = isPlayer ? null : `The players are getting ready. ${gateLeft}s left`;
  else if (running && match!.phase === 'hero_select' && !isPlayer) status = 'The players are choosing heroes';
  else if (running && match!.phase !== 'hero_select' && !isPlayer) status = `Round ${match!.round} is live`;

  return (
    <div ref={stageRef} className={`vsroomstage${entering ? ' vsenter' : ''}`} role="dialog" aria-label={`Versus room ${room.name}`}
      style={{ '--vs-arena': `url(${arenaBlur})`, '--vs-wire': PLATE_WIRE } as CSSProperties}>
      {/* THE BACKDROP (owner 2026-10-21: "blur the background"): a pre-blurred copy of the arena at cover size (a
          static image, never a live blur), under a static grade that darkens the edges and seats the hand. */}
      <div className="vsarena-ext" aria-hidden="true" />
      <div className="vsvignette" aria-hidden="true" />
      <div className={`vsarena${fourSeats ? ' vsgroup' : ''}${roomMode === 'duos' ? ' vsduos' : ''}`} ref={arenaRef}>
        {/* VERSUS DUOS (R-DUOS-01): the seat pairs are the teams; a plate names each pair (the room's own pill style). */}
        {roomMode === 'duos' && <><span className="vsteam vsteam-a hudpill-name">Team 1</span><span className="vsteam vsteam-b hudpill-name">Team 2</span></>}
        {/* RANKED DUOS: the party's team name over its two seats ("Name1 & Name2" until it is named). */}
        {party && <TeamPlate room={room} name={teamName} />}
        {/* The VS mark between the two cards: the game's display font with a static glow until it has its own art. */}
        <div key={vsBeat} className={`vsmark${vsBeat > 0 ? ' vsmark-full' : ''}`} aria-hidden="true">VS</div>
        {seatRoles.map((side, i) => <Seat key={side} side={side} m={seated[i] ?? null} room={room} match={match} me={me} drag={drag} arena={arenaRef} />)}

        {/* THE ACTION AREA (owner 2026-10-21, R-VERSUS-ROOM-POLISH-03): EMPTY until both seats are filled. Then the host's
            Start game (everyone else: "Host starts the match", in the same place) fades in and floats up into place;
            if a seat empties it fades and sinks away (one-shot, transform / opacity). A live match shows its state. */}
        <div className="vsactions">
          {startShown && (
            <div className={`vsstart${startLeaving ? ' out' : ''}`}>
              {host
                ? <button className="vsplate vsprimary" disabled={startLeaving} onClick={() => { sfx.pulse(); void startGame(); }}>Start game</button>
                : <span className="vsstate hudpill-name">Host starts the match</span>}
            </div>
          )}
          {!open && status && <span className="vsstate hudpill-name">{status}</span>}
          {/* VERSUS PHASE 2: a spectator who stepped back to the room watches again from here. */}
          {running && !isPlayer && match!.phase !== 'hero_select' && (
            <button className="vsplate vsprimary" onClick={() => { sfx.pulse(); resumeSpectating(); }}>Watch</button>
          )}
        </div>

        <SpectatorFan n={spectators.length} />
        {/* Every member's card, mounted for the life of the room and placed by transform (R-VERSUS-ROOM-MOUNTED-01). */}
        <RoomCards room={room} data={seatData} me={me} drag={drag} arena={arenaRef} />
      </div>

      {/* The room's name heads the stage, with its host and how many are watching (of the 20 seats, ruling 8) under it. */}
      {/* THE HEADER PLATE (owner 2026-10-21): the room's name and who hosts it on the Gem plate, top centre, level with
          Back and always on screen; the stands' count lives on the stands' own label. */}
      <div className="vsroomhead">
        <span className="vsroomtitle">{room.name}</span>
        <span className="vsroomwatch">{hostName ? `Hosted by ${hostName}` : 'Versus'}</span>
        {/* ROOM OPTIONS (R-VERSUS-OPTIONS-01): what this room plays, for everyone; the host changes it between games.
            A Ranked Duos party plays the live rules, so its pill only names the mode (the options are test tools). */}
        {party && !versusTestToolsEnabled()
          ? <span className="vsroommode hudpill-name">{room.friends_only ? 'Ranked Duos · Friends only' : 'Ranked Duos'}</span>
          : <button type="button" className="vsroommode hudpill-name" aria-label={`Room options: ${versusOptionsSummary(room.options)}`}
          onClick={() => { sfx.pulse(); setOptionsOpen((v) => !v); }}>{versusOptionsSummary(room.options)}</button>}
      </div>
      <div className="vsroomtop">
        <button className="vsplate" onClick={() => { sfx.pulse(); setTitleView('modes'); }}>Back</button>
      </div>
      <div className="vsroomctl">
        {(!party || versusTestToolsEnabled()) && <button className="vsplate" onClick={() => { sfx.pulse(); setOptionsOpen((v) => !v); }}>Room options</button>}
        {friendsAccount() && <button className="vsplate" onClick={() => { sfx.pulse(); setInviteOpen(true); }}>{party ? 'Invite a friend' : 'Invite friends'}</button>}
        {/* RANKED DUOS: the host lists the party or keeps it to friends (owner Q6); either teammate names the team. */}
        {party && hostEdits && <FriendsOnlyToggle room={room} />}
        {/* Alone in my party: the open parties are one click away (leaving this one shows the Ranked Duos list). */}
        {party && open && !partyPair(room) && <button className="vsplate" onClick={() => { sfx.pulse(); void leaveRoom(); }}>Join a party</button>}
        {party && open && isPlayer && partyPair(room) && friendsAccount() && (
          <button className="vsplate" onClick={() => { sfx.pulse(); setNameOpen(true); }}>Team name</button>
        )}
        {lastMatch && open && <button className="vsplate" onClick={() => { sfx.pulse(); setVersusStatsOpen(true); }}>Previous match stats</button>}
        <button className="vsplate" onClick={() => { sfx.pulse(); void stopVersusBot().then(() => leaveRoom()); }}>{running && isPlayer ? 'Leave (concede)' : 'Leave room'}</button>
        {roomBots.length > 0 && (
          <>
            <button className="vsplate" onClick={() => setVersusBotDisconnected(!allOff)}>
              {roomBots.length === 1 ? (allOff ? 'Bot reconnects' : 'Bot disconnects') : (allOff ? 'Bots reconnect' : 'Bots disconnect')}
            </button>
            <button className="vsplate" onClick={() => { void stopVersusBot(); }}>{roomBots.length === 1 ? 'Remove bot' : 'Remove bots'}</button>
          </>
        )}
        {bots.error && <span className="vsgatestate">Bot: {bots.error}</span>}
      </div>

      {/* THE SELL ZONE (the shop's own overlay): a seated card dragged up here goes back to the stands. */}
      {drag && !drag.snap && drag.sellTop !== null && (
        <div className={`sellzone vssellzone${drag.zone === 'stands' ? ' on' : ''}`} style={{ height: drag.sellTop }} aria-hidden="true" />
      )}
      <SeatDragGhost room={room} data={seatData} />

      {optionsOpen && (
        <VersusOptionsPanel options={room.options} editable={hostEdits} onClose={() => setOptionsOpen(false)}
          onChange={(next) => { void setRoomOptions(next); }} />
      )}
      {optionsNotice && <div className="vsoptions-notice hudpill-name" role="status">{optionsNotice}</div>}
      {inviteOpen && <RoomInvitePanel room={room} me={me} onClose={() => setInviteOpen(false)} />}
      {nameOpen && party && <TeamNamePanel room={room} me={me} name={teamName} onSaved={setTeamName} onClose={() => setNameOpen(false)} />}
      {/* RANKED DUOS: the team's place, rating change and medal after a game (the solo end screen's rank sequence). */}
      {party && <DuosResultOverlay />}
      {statsOpen && lastMatch && <VersusMatchStats record={lastMatch} onClose={() => setVersusStatsOpen(false)} />}
      {error && <div className="vserror vsroomerror" role="alert">{error}</div>}
      {/* The entrance's dark: fades out as the room opens, and takes the click that skips the entrance. */}
      {entering && <div className="vsenter-veil" aria-hidden="true" />}
    </div>
  );
}
