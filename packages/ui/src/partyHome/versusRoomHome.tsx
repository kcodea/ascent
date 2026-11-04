/**
 * A VERSUS ROOM IS A STATE OF THE PARTY HOME (owner 2026-11-03: "Launching versus modes should be able to happen from the
 * same party screen ... and not bring you into a new lobby type. The whole point is to basically limit our menus"). There
 * is no room page and no browser page: the Versus tabs show the home's own banner row, and these seats ARE the room's seats.
 * The room is opened invisibly behind the home (an invite, or START) and joining one just fills the same row.
 *
 * `useVersusRoomHome` gives PartyHome everything a held room puts on the home, all through the store's existing calls:
 *  - THE SEATS, in seat order, as the kit's banners (`PhBanner`): the member's portrait, name, Versus record, title, Host
 *    badge, Health and Armor in a match. An open seat is Invite for a seated player and Take seat from the stands.
 *  - DRAG TO SEAT, DRAG UP TO SPECTATE (R-VERSUS-DRAG-SEAT-01) through the classic pure helpers (`versus/seatDrag.ts`) and
 *    `takeSeat`; your card's menu does the same without a drag. An occupied seat refuses and the card springs back.
 *  - THE STANDS: a small strip under the banners, off the layout flow, so the banner row never moves.
 *  - START: the host's once enough sit; everyone else reads what they wait for; Watch for the stands during a match.
 *  - Leave room, Previous match stats and the DEV bot tools, for the row beside START.
 * `OpenRoomsPanel` is the side panel's public room list; `RoomRulesPanel` its rules.
 *
 * PERFORMANCE: static paint. A drag measures the seats ONCE at pick-up and writes only the ghost's transform per frame (one
 * rAF); React hears only a change of drop zone. Phones use the 256 px portrait thumbnails.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { parseCosmeticSnapshot } from '@game/progression';
import { riftDefFor, VERSUS_MODIFIERS, VERSUS_SPECTATOR_CAP, type VersusGroupSeat, type VersusModifierId, type VersusRoomOptions } from '@game/sim';
import { heroThumb } from '../art';
import { hideDragCursorVeil, showDragCursorVeil } from '../dragCursorVeil';
import { getDragFeel } from '../dragFeel';
import { addFriend, friendsAccount, relationOf, useFriends } from '../friends/friendsStore';
import { Icon } from '../Icon';
import { currentUserId } from '../identity';
import { pageHidden } from '../net/backoff';
import { mirrorFor, useProgression } from '../progression/progressionStore';
import { sfx } from '../sfx';
import { opponentSkins, useLiveLoadout } from '../skins/skins';
import { stageHost, toStage } from '../stage';
import { useGame } from '../store';
import { TitleBadge } from '../titles/TitleBadge';
import { TAP_SLOP } from '../touchInput';
import { canDragSeatCard, memberOf, roomWithSeatMove, seatDropOf, seatZoneAt, seatZoneValid, sellLineOf, type SeatDragGeo, type SeatZone } from '../versus/seatDrag';
import { resumeSpectating } from '../versus/spectate';
import { liveRoomView } from '../versus/useSeatDrag';
import { freeVersusBotSlot, setVersusBotDisconnected, startVersusBot, stopVersusBot, useVersusBots } from '../versus/versusBot';
import { displaySeconds } from '../versus/versusClock';
import { versusTestToolsEnabled } from '../versus/versusFlag';
import { VersusMatchStats } from '../versus/VersusMatchStats';
import { versusModifierName, versusOptionsSummary } from '../versus/versusOptionsUi';
import type { VersusMember, VersusRole, VersusRoom, VersusRoomSummary } from '../versus/versusRemote';
import { seatPools } from '../versus/VersusRoom';
import { MAX_RECORD_IDS, playerCardArt, seatCardSource, useSeatData, type SeatServerData } from '../versus/versusSeatCard';
import { clearVersusError, isDuosParty, joinRoom, leaveRoom, myRole, refreshRooms, setRoomOptions, setVersusStatsOpen, startGame, takeSeat, useVersus, versusRemainingMs } from '../versus/versusStore';
import { PhBanner, PhBannerInvite, PhBannerName, PhBannerState, PhButton, PhChip, PhEmpty, PhField, PhRow, PhSegmented } from './kit';
import { openSeatText, ROOM_STATUS, roomJoin, roomModeOf, roomModeShort, roomStartOf, roomTitleOf, seatCap, seatTeams, seatText, VERSUS_OFFLINE_TEXT, visibleRooms, type VersusRoomMode } from './pages/versusPh';
import './pages/versusHome.css';

function useCountdown(iso: string | null | undefined): number | null {
  const [s, setS] = useState<number | null>(() => (iso ? displaySeconds(versusRemainingMs(iso)) : null));
  useEffect(() => {
    if (!iso) { setS(null); return undefined; }
    const tick = (): void => setS(displaySeconds(versusRemainingMs(iso)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [iso]);
  return s;
}

// ── A MEMBER'S FACE: what their banner and tile show (your own live portrait, title and skins; others' through the
//    opponent-cosmetics switch, exactly as the classic seat card) ───────────────────────────────────────────────────────
interface Face { name: string; art: string | undefined; titleId: string | null; record: { wins: number; losses: number } | null }
function useFace(m: Pick<VersusMember, 'userId' | 'displayName' | 'profile'>, server: SeatServerData | undefined, thumb: boolean): Face {
  const own = m.userId === currentUserId();
  const showOpp = useGame((s) => s.showOpponentSkins);
  const myAvatar = useGame((s) => s.playerAvatar);
  const myTitle = useProgression((s) => mirrorFor(currentUserId(), s.mirror)?.equippedTitleId ?? null);
  const myLoadout = useLiveLoadout();
  return useMemo(() => {
    const src = seatCardSource({ member: m, own, showOpp, server, ...(own ? { self: { avatar: myAvatar ?? null, titleId: myTitle, cosmetics: myLoadout } } : {}) });
    const art = playerCardArt(src);
    return { name: src.name || 'Player', art: thumb ? heroThumb(art) : art, titleId: src.titleId, record: src.record };
  }, [m.userId, m.displayName, m.profile, own, showOpp, server, myAvatar, myTitle, myLoadout, thumb]);
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** A banner's foot (a seat, and the drag ghost): name, Versus record, title, state. The kit's PhBanner draws the rest. */
function BannerFoot({ face, medal, state }: { face: Face; medal?: ReactNode; state: ReactNode }) {
  return (
    <>
      <PhBannerName>{face.name}</PhBannerName>
      {medal}
      {face.record && (
        <span className="vsr-rec" aria-label={`Versus record: ${plural(face.record.wins, 'win', 'wins')}, ${plural(face.record.losses, 'loss', 'losses')}`}>
          <b>{face.record.wins}</b><span>{face.record.wins === 1 ? 'win' : 'wins'}</span><i aria-hidden="true" /><b>{face.record.losses}</b><span>{face.record.losses === 1 ? 'loss' : 'losses'}</span>
        </span>
      )}
      {face.titleId && <span className="ph-sub"><TitleBadge id={face.titleId} className="ph-titlebadge" /></span>}
      {state}
    </>
  );
}
/** The Host badge (the kit's Leader badge shape, with the word Host). */
const HOST_BADGE = <><Icon name="crown" /><span>Host</span></>;

/** A seat banner's seat (its `vsr-s-p1` class). */
const seatOfEl = (el: Element): VersusGroupSeat | null => {
  const c = [...el.classList].find((x) => x.startsWith('vsr-s-'));
  return c ? (c.slice(6) as VersusGroupSeat) : null;
};

// ── THE DRAG (R-VERSUS-DRAG-SEAT-01 through the classic pure helpers) ─────────────────────────────────────────────────
interface PhDrag {
  userId: string;
  from: VersusRole;
  zone: SeatZone;
  valid: boolean;
  /** The ghost's layout size (stage px): a seat banner's. */
  w: number;
  h: number;
  /** The sell line (stage px) for a seated card: above it the card goes to the stands. */
  sellTop: number | null;
  /** Springing back: the ghost's target (stage px). */
  snap: { x: number; y: number; s: number } | null;
}

function useRoomDrag(root: RefObject<HTMLElement>): {
  drag: PhDrag | null; ghost: RefObject<HTMLDivElement>; begin: (e: ReactPointerEvent<HTMLElement>, userId: string) => void; clicked: () => boolean;
} {
  const [drag, setDrag] = useState<PhDrag | null>(null);
  const live = useRef<PhDrag | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: 0, y: 0 });
  const teardownRef = useRef<(() => void) | null>(null);
  const dragged = useRef(false);
  const put = (d: PhDrag | null): void => { live.current = d; setDrag(d); };
  const write = (): void => {
    const d = live.current;
    if (!ghost.current || !d || d.snap) return;
    ghost.current.style.transform = `translate(${toStage(pos.current.x) - d.w / 2}px, ${toStage(pos.current.y) - d.h / 2}px)`;
  };
  useEffect(() => () => teardownRef.current?.(), []);
  // The ghost mounts with the drag: place it under the pointer before its first paint.
  useEffect(() => { if (drag && !drag.snap) write(); }, [drag?.userId]);

  const begin = (e: ReactPointerEvent<HTMLElement>, userId: string): void => {
    const el = root.current;
    if (!el || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const me = currentUserId();
    const room = liveRoomView();
    if (useVersus.getState().seatMove || live.current || !canDragSeatCard(room, me, userId)) return;
    const from = memberOf(room, me)!.role;
    // The press's own box: a display-contents wrapper (my seat banner) has none, so its banner stands in.
    const src = e.currentTarget.getBoundingClientRect().width > 0 ? e.currentTarget : (e.currentTarget.querySelector<HTMLElement>('.ph-cardwrap') ?? e.currentTarget);
    const touch = e.pointerType !== 'mouse';
    const threshold = touch ? Math.max(TAP_SLOP, getDragFeel().threshold) : getDragFeel().threshold;
    const x0 = e.clientX;
    const y0 = e.clientY;
    dragged.current = false;
    // No text selection (and its edge auto-scroll) under a held card; the click still fires.
    e.preventDefault();
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* unsupported / detached */ }
    let geo: SeatDragGeo | null = null;
    let origin: { cx: number; cy: number; w: number } | null = null;
    let raf = 0;
    let snapTimer = 0;

    const activate = (): void => {
      // THE ONE LAYOUT PASS of the drag: the card, the seats, the stands, a seat banner's layout size.
      const sr = src.getBoundingClientRect();
      origin = { cx: sr.left + sr.width / 2, cy: sr.top + sr.height / 2, w: sr.width };
      const box = (r: DOMRect): SeatDragGeo['seats'][number]['box'] => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      const seatEls = [...el.querySelectorAll<HTMLElement>('.vsr-seat')];
      const seats = seatEls.map((s) => ({ role: seatOfEl(s), box: box(s.getBoundingClientRect()) })).filter((x): x is { role: VersusGroupSeat; box: SeatDragGeo['seats'][number]['box'] } => !!x.role);
      const stands = el.querySelector<HTMLElement>('.vsr-stands');
      const own = seats.find((s) => s.role === from);
      const sellScreen = from !== 'spectator' && own ? sellLineOf(own.box, y0) : null;
      geo = { seats, sellTop: sellScreen, bench: stands ? box(stands.getBoundingClientRect()) : null };
      const one = seatEls[0];
      const w = one?.offsetWidth || toStage(sr.width);
      const h = one?.offsetHeight || toStage(sr.height);
      pos.current = { x: x0, y: y0 };
      dragged.current = true;
      showDragCursorVeil();
      sfx.cardTouch();
      put({ userId, from, zone: null, valid: false, w, h, sellTop: sellScreen === null ? null : toStage(sellScreen), snap: null });
    };
    const frame = (): void => {
      raf = 0;
      write();
      const d = live.current;
      if (!d || !geo) return;
      const zone = seatZoneAt(from, pos.current.x, pos.current.y, geo);
      if (zone !== d.zone) put({ ...d, zone, valid: seatZoneValid(zone, liveRoomView(), currentUserId()) });
    };
    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return;
      if (!geo) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < threshold) return;
        activate();
      }
      pos.current = { x: ev.clientX, y: ev.clientY };
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const finish = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      hideDragCursorVeil();
    };
    const teardown = (): void => {
      finish();
      window.clearTimeout(snapTimer);
      put(null);
      if (teardownRef.current === teardown) teardownRef.current = null;
    };
    /** The shop's invalid drop: the ghost springs back to where the card was, then the card shows again. */
    const snapBack = (): void => {
      const d = live.current;
      if (!d || !origin) { teardown(); return; }
      const s = toStage(origin.w) / Math.max(1, d.w);
      put({ ...d, zone: null, valid: false, snap: { x: toStage(origin.cx) - d.w / 2, y: toStage(origin.cy) - d.h / 2, s } });
      snapTimer = window.setTimeout(teardown, getDragFeel().snapMs + 40);
    };
    const onUp = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return;
      finish();
      if (!geo) { teardown(); return; } // a click, not a drag
      pos.current = { x: ev.clientX, y: ev.clientY };
      const me2 = currentUserId();
      const drop = seatDropOf(seatZoneAt(from, pos.current.x, pos.current.y, geo), liveRoomView(), me2);
      if (drop.kind === 'take' && me2) {
        if (drop.role === 'spectator') sfx.sell(); else sfx.play();
        teardown();
        void takeSeat(drop.role);
        return;
      }
      if (drop.kind === 'reject') sfx.deny();
      snapBack();
    };
    const onCancel = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return;
      finish();
      if (!geo) { teardown(); return; }
      snapBack();
    };
    teardownRef.current?.();
    teardownRef.current = teardown;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };
  /** A press that ended a drag is not also a click (the card's menu stays shut). Reading it resets it. */
  const clicked = (): boolean => { const was = dragged.current; dragged.current = false; return !was; };
  return { drag, ghost, begin, clicked };
}

// ── THE ROOM ON THE HOME ──────────────────────────────────────────────────────────────────────────────────────────────

export interface VersusRoomHome {
  /** The banner row (seat order), or null with no room held. */
  row: JSX.Element[] | null;
  /** The strip under the banners. */
  stands: JSX.Element | null;
  /** START. */
  start: { label: string; ok: boolean; note: string | null; run: () => void } | null;
  /** The buttons beside START (Leave room, Previous match stats, the DEV bot tools). */
  side: JSX.Element | null;
  /** The drag ghost, the rules notice, the match stats window. */
  layers: JSX.Element | null;
  /** The friends already in the room (the friends list says so). */
  memberIds: string[];
  seatsFree: number;
  dragging: boolean;
}

export function useVersusRoomHome(root: RefObject<HTMLElement>, phone: boolean, onInvite: () => void, myMedal: ReactNode): VersusRoomHome {
  const serverRoom0 = useVersus((s) => s.room);
  const serverRoom = serverRoom0 && !isDuosParty(serverRoom0) ? serverRoom0 : null;
  const seatMove = useVersus((s) => s.seatMove);
  const me = currentUserId();
  const room = useMemo(() => roomWithSeatMove(serverRoom, seatMove, me), [serverRoom, seatMove, me]);
  const match = useVersus((s) => s.match);
  const optionsNotice = useVersus((s) => s.optionsNotice);
  const lastMatch = useVersus((s) => s.lastMatch);
  const statsOpen = useVersus((s) => s.statsOpen);
  const friendsList = useFriends((s) => s.list);
  const { drag, ghost, begin, clicked } = useRoomDrag(root);
  const bots = useVersusBots();
  const canAddBot = !bots.busy && bots.bots.length < 3 && freeVersusBotSlot() != null;
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const gateLeft = useCountdown(room?.status === 'sealed' ? room.gate_deadline : null);
  const mode: VersusRoomMode = roomModeOf(serverRoom?.options);
  // ONE batched read for every card in the room: every seat and every spectator (at most 24 ids, R-NET-01).
  const memberIds = (room?.members ?? []).map((m) => m.userId).slice(0, MAX_RECORD_IDS);
  const seatData = useSeatData(memberIds, `${memberIds.join(',')}|${room?.status === 'open' ? 'open' : 'busy'}|${room?.current_match_id ?? ''}|${lastMatch?.matchId ?? ''}`);
  useEffect(() => { setMenuFor(null); }, [myRole(room), !!drag]);
  useEffect(() => {
    if (!menuFor) return undefined;
    const close = (e: PointerEvent): void => { if (!(e.target as Element | null)?.closest?.('.ph-cardmenu')) setMenuFor(null); };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [menuFor]);

  if (!room || !serverRoom) return { row: null, stands: null, start: null, side: null, layers: null, memberIds: [], seatsFree: 0, dragging: false };
  const teams = seatTeams(mode);
  const role = myRole(room);
  const mine = memberOf(room, me);
  const host = room.host_user_id === me;
  const open = room.status === 'open';
  const running = room.status === 'in_game' && !!match && match.phase !== 'complete';
  // A group player already out of the running match watches it like the stands (R-VERSUS-GROUP-02).
  const outOfMatch = !!match?.group && !!role && role !== 'spectator' && !match.group.me;
  const isPlayer = !!role && role !== 'spectator' && !outOfMatch;
  const seatedCount = room.members.filter((m) => m.role !== 'spectator').length;
  const spectators = room.members.filter((m) => m.role === 'spectator');
  const roomBots = bots.bots.filter((b) => b.roomId === room.id && b.status === 'playing');
  const allOff = roomBots.length > 0 && roomBots.every((b) => b.disconnected);
  const st = roomStartOf({ mode, status: room.status, seated: seatedCount, host, isPlayer, running, phase: match?.phase ?? null, round: match?.round ?? null, gateLeft });
  const watch = running && !isPlayer && match!.phase !== 'hero_select';
  const testTools = host && open && versusTestToolsEnabled();
  const myDraggable = !!me && canDragSeatCard(room, me, me);
  const openSeats = teams.flat().filter((s) => !room.members.some((m) => m.role === s));

  const seatCard = (side: VersusGroupSeat, i: number): JSX.Element => {
    const m = room.members.find((x) => x.role === side) ?? null;
    const over = drag && !drag.snap && drag.zone === side ? (drag.valid ? ' vsr-over' : ' vsr-bad') : '';
    if (!m) {
      const t = openSeatText({ open, mine });
      const target = drag && !drag.snap && seatZoneValid(side, room, me) ? ' vsr-target' : '';
      const fromStands = mine?.role === 'spectator' && t.take;
      return (
        <PhBanner key={side} ghost index={i} className={`vsr-seat vsr-s-${side} vsr-open${over}${target}`}
          label={fromStands ? `Take seat ${side.slice(1)}` : `Open seat ${side.slice(1)}. Invite a friend`}
          onClick={fromStands ? () => { if (!seatMove) { sfx.play(); void takeSeat(side); } } : () => { sfx.pulse(); onInvite(); }}
          overlay={testTools && canAddBot ? (
            /* TEST TOOLS (dev / opted-in browsers only): a bot fills this seat through the normal server protocol. */
            <span className="vsr-botslot"><PhButton size="s" onClick={() => { sfx.pulse(); void startVersusBot(room.id, side); }}>Add bot</PhButton></span>
          ) : undefined}>
          {fromStands
            ? <><span className="ph-invmed" aria-hidden="true"><span>+</span></span><span className="ph-openlbl">Take seat</span><span className="ph-opensub">Or drag your card here</span></>
            : <PhBannerInvite />}
        </PhBanner>
      );
    }
    const mineCard = m.userId === me;
    const canFriend = !mineCard && friendsAccount() && !!friendsList && relationOf(m.userId, { list: friendsList }) === 'none';
    const items: { label: string; run: () => void }[] = mineCard
      ? open ? [...openSeats.map((s) => ({ label: `Move to seat ${s.slice(1)}`, run: () => { sfx.play(); void takeSeat(s); } })), { label: 'Move to spectators', run: () => { sfx.sell(); void takeSeat('spectator'); } }] : []
      : canFriend ? [{ label: 'Add friend', run: () => { sfx.pulse(); void addFriend(m.userId); } }] : [];
    return (
      <SeatBanner key={m.userId} side={side} i={i} m={m} medal={mineCard ? myMedal : null} server={seatData.get(m.userId)} thumb={phone} host={m.userId === room.host_user_id} over={over} hidden={drag?.userId === m.userId}
        pools={running ? seatPools(match, side) : null} sealed={room.status === 'sealed'} draggable={mineCard && myDraggable} onPointerDown={(e) => begin(e, m.userId)}
        items={items} menuOpen={menuFor === m.userId} onToggleMenu={() => { if (!clicked()) return; sfx.pulse(); setMenuFor((k) => (k === m.userId ? null : m.userId)); }}
        onPick={(run) => { setMenuFor(null); run(); }} />
    );
  };

  // The same shapes as the home's own row, so nothing moves when a room opens behind it.
  const row: JSX.Element[] = [];
  let k = 0;
  const cards = teams.map((team) => team.map((s) => seatCard(s, k++)));
  if (mode === 'duos') {
    const myTeam = role === 'p1' || role === 'p2' ? 0 : role === 'p3' || role === 'p4' ? 1 : null;
    const lbl = (t: number): JSX.Element => (myTeam === null
      ? <span className="ph-pairlbl">Team {t + 1}</span>
      : <span className={`ph-pairlbl ${myTeam === t ? 'mine' : 'rival'}`}>{myTeam === t ? 'Your team' : 'Rivals'}</span>);
    row.push(
      <div key="a" className="ph-pair" role="group" aria-label="Team 1">{lbl(0)}<div className="ph-pairrow">{cards[0]}</div></div>,
      <span key="vs" className="ph-vs" aria-hidden="true">VS</span>,
      <div key="b" className="ph-pair" role="group" aria-label="Team 2">{lbl(1)}<div className="ph-pairrow">{cards[1]}</div></div>,
    );
  } else if (mode === 'duel') row.push(...cards[0]!, <span key="vs" className="ph-vs" aria-hidden="true">VS</span>, ...cards[1]!);
  else row.push(...cards[0]!);

  const leave = (): void => { sfx.pulse(); void stopVersusBot().then(() => leaveRoom()); };
  const side = (
    <>
      <PhButton onClick={leave}>{running && isPlayer ? 'Leave (concede)' : 'Leave room'}</PhButton>
      {open && lastMatch && <PhButton onClick={() => { sfx.pulse(); setVersusStatsOpen(true); }}>Previous match stats</PhButton>}
      {roomBots.length > 0 && (
        <>
          <PhButton size="s" onClick={() => setVersusBotDisconnected(!allOff)}>{roomBots.length === 1 ? (allOff ? 'Bot reconnects' : 'Bot disconnects') : (allOff ? 'Bots reconnect' : 'Bots disconnect')}</PhButton>
          <PhButton size="s" onClick={() => { void stopVersusBot(); }}>{roomBots.length === 1 ? 'Remove bot' : 'Remove bots'}</PhButton>
        </>
      )}
    </>
  );
  const sellBand = drag && !drag.snap && drag.sellTop !== null;
  const layers = (
    <>
      {optionsNotice && <div className="vsr-notice" role="status">{optionsNotice}</div>}
      {drag && createPortal(
        <>
          {sellBand && <div className={`vsr-sellband${drag.zone === 'stands' ? ' vsr-on' : ''}`} style={{ height: drag.sellTop! }} aria-hidden="true"><span>Spectate</span></div>}
          <div ref={ghost} className={`vsr-ghost${drag.snap ? ' vsr-snap' : ''}${drag.valid && drag.zone && drag.zone !== 'stands' ? ' vsr-lit' : ''}`} aria-hidden="true"
            style={{ width: drag.w, height: drag.h, ...(drag.snap ? { transform: `translate(${drag.snap.x}px, ${drag.snap.y}px) scale(${drag.snap.s})`, transitionDuration: `${getDragFeel().snapMs}ms` } : {}) }}>
            <GhostCard userId={drag.userId} room={room} data={seatData} host={drag.userId === room.host_user_id} />
          </div>
        </>,
        stageHost(),
      )}
      {statsOpen && lastMatch && <VersusMatchStats record={lastMatch} onClose={() => setVersusStatsOpen(false)} />}
    </>
  );
  return {
    row,
    stands: <Stands spectators={spectators} room={room} me={me} data={seatData} draggingSeated={!!drag && !drag.snap && drag.from !== 'spectator'}
      over={!!drag && !drag.snap && drag.zone === 'stands'} hiddenId={drag?.userId ?? null} onPointerDown={begin} myDraggable={myDraggable} />,
    start: {
      label: st.label, ok: st.canStart || watch, note: bots.error ? `Bot: ${bots.error}` : st.note,
      run: () => { if (watch) resumeSpectating(); else if (st.canStart) void startGame(); },
    },
    side, layers, memberIds: room.members.map((m) => m.userId).filter((id) => id !== me), seatsFree: openSeats.length, dragging: !!drag,
  };
}

/** A seated member's banner (the kit's PhBanner). Mine drags; a tap opens its small menu. */
function SeatBanner({ side, i, m, medal, server, thumb, host, over, hidden, pools, sealed, draggable, onPointerDown, items, menuOpen, onToggleMenu, onPick }: {
  side: VersusGroupSeat; i: number; m: VersusMember; medal: ReactNode; server: SeatServerData | undefined; thumb: boolean; host: boolean; over: string; hidden: boolean;
  pools: { health: number; armor: number } | null; sealed: boolean; draggable: boolean; onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  items: { label: string; run: () => void }[]; menuOpen: boolean; onToggleMenu: () => void; onPick: (run: () => void) => void;
}) {
  const face = useFace(m, server, thumb);
  const state = pools
    ? (
      <span className="ph-state vsr-hp" aria-label={`Health ${pools.health}${pools.armor > 0 ? `, Armor ${pools.armor}` : ''}`}>
        <Icon name="heartPill" /><b>{pools.health}</b>
        {pools.armor > 0 && <><Icon name="armor" /><b>{pools.armor}</b></>}
      </span>
    )
    : sealed ? <PhBannerState tone="in_game">Getting ready</PhBannerState> : null;
  const banner = (
    <PhBanner art={face.art} index={i} badge={host ? HOST_BADGE : undefined}
      className={`vsr-seat vsr-s-${side}${draggable ? ' vsr-mineseat' : ''}${over}${hidden ? ' vsr-src' : ''}`}
      label={draggable ? `You, seat ${side.slice(1)}. Drag to another seat, or up to spectate. Options` : `${face.name}${host ? ', host' : ''}, seat ${side.slice(1)}`}
      onClick={items.length > 0 ? onToggleMenu : undefined} haspopup={items.length > 0} expanded={menuOpen}
      overlay={menuOpen ? (
        <div className="ph-cardmenu" role="menu" aria-label={`${face.name} options`}>
          {items.map((it) => <button key={it.label} type="button" role="menuitem" className="ph-menuitem" onClick={() => onPick(it.run)}><span>{it.label}</span></button>)}
        </div>
      ) : undefined}>
      <BannerFoot face={face} medal={medal} state={state} />
    </PhBanner>
  );
  // My own banner starts the drag (a wrapper that takes no box, so the banner stays a direct item of the row).
  return draggable ? <div className="vsr-dragwrap" onPointerDown={onPointerDown}>{banner}</div> : banner;
}

/** The drag ghost's banner: the dragged member's face at seat size (inert: it never takes focus or a press). */
function GhostCard({ userId, room, data, host }: { userId: string; room: VersusRoom; data: ReadonlyMap<string, SeatServerData>; host: boolean }) {
  const m = memberOf(room, userId);
  const face = useFace(m ?? { userId, displayName: '', profile: {} }, data.get(userId), true);
  return (
    <div className="vsr-ghostwrap" ref={(el) => { el?.setAttribute('inert', ''); }}>
      <PhBanner art={face.art} badge={host ? HOST_BADGE : undefined} className="vsr-ghostin" label={face.name}>
        <BannerFoot face={face} state={null} />
      </PhBanner>
    </div>
  );
}

/** THE STANDS: every spectator as a small tile; mine drags to a seat. */
function Stands({ spectators, room, me, data, draggingSeated, over, hiddenId, onPointerDown, myDraggable }: {
  spectators: VersusMember[]; room: VersusRoom; me: string | null; data: ReadonlyMap<string, SeatServerData>;
  draggingSeated: boolean; over: boolean; hiddenId: string | null; onPointerDown: (e: ReactPointerEvent<HTMLElement>, userId: string) => void; myDraggable: boolean;
}) {
  return (
    <section className={`vsr-stands${draggingSeated ? ' vsr-target' : ''}${over ? ' vsr-over' : ''}${spectators.length === 0 ? ' vsr-nostands' : ''}`} aria-label="Spectators">
      <header className="vsr-standshead">
        <h2>Spectators</h2>
        <span className="vsr-standsn">{spectators.length} / {VERSUS_SPECTATOR_CAP}</span>
        {draggingSeated && <span className="vsr-standshint">Drop here to spectate</span>}
      </header>
      <div className="vsr-tiles" role="list">
        {spectators.length === 0
          ? <span className="vsr-none">No one is watching yet.</span>
          : spectators.map((m) => (
            <StandTile key={m.userId} m={m} server={data.get(m.userId)} thumb host={m.userId === room.host_user_id} you={m.userId === me}
              hidden={hiddenId === m.userId} draggable={m.userId === me && myDraggable} onPointerDown={(e) => onPointerDown(e, m.userId)} />
          ))}
      </div>
    </section>
  );
}

function StandTile({ m, server, thumb, host, you, hidden, draggable, onPointerDown }: {
  m: VersusMember; server: SeatServerData | undefined; thumb: boolean; host: boolean; you: boolean; hidden: boolean; draggable: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
}) {
  const face = useFace(m, server, thumb);
  return (
    <div role="listitem" className={`vsr-tile${you ? ' vsr-tyou' : ''}${draggable ? ' vsr-tdrag' : ''}${hidden ? ' vsr-src' : ''}`}
      onPointerDown={draggable ? onPointerDown : undefined} aria-label={`${face.name}${host ? ', host' : ''}${you ? ', you. Drag to a seat to play' : ''}`}>
      {face.art && <img className="vsr-tileart" src={face.art} alt="" draggable={false} decoding="sync" />}
      <span className="vsr-tilename">{face.name}</span>
      {host && <span className="vsr-tilehost" aria-hidden="true"><Icon name="crown" /></span>}
    </div>
  );
}

// ── THE SIDE PANEL ────────────────────────────────────────────────────────────────────────────────────────────────────

const MODIFIERS: { value: VersusModifierId | null; label: string }[] = [
  { value: null, label: 'None' },
  ...VERSUS_MODIFIERS.map((id) => ({ value: id as VersusModifierId | null, label: versusModifierName(id) })),
];

/**
 * ROOM RULES in the side panel (R-VERSUS-OPTIONS-01). Before a room: the name and the modifier START or an invite opens it
 * with. In a room: its modifier, the host's to change between games (the server validates), read-only for the others.
 */
export function RoomRulesPanel({ room, me, modifier, onModifier, name, onName, placeholder, onBrowse }: {
  room: VersusRoom | null; me: string | null; modifier: VersusModifierId | null; onModifier: (m: VersusModifierId | null) => void;
  name: string; onName: (n: string) => void; placeholder: string; onBrowse: () => void;
}) {
  const editable = !room || (room.host_user_id === me && room.status === 'open');
  const value = room ? (room.options?.modifiers ?? [])[0] ?? null : modifier;
  const pick = (v: VersusModifierId | null): void => {
    sfx.tick();
    if (!room) { onModifier(v); return; }
    if (v !== value) void setRoomOptions({ v: 1, mode: roomModeOf(room.options), modifiers: v ? [v] : [] } as VersusRoomOptions);
  };
  return (
    <>
      {!room && <PhField label="Room name" maxLength={40} placeholder={placeholder} value={name} onChange={(e) => onName(e.target.value)} />}
      <PhSegmented label="Modifier" value={value} options={MODIFIERS} disabled={!editable} max={4} onPick={pick}
        hint={value ? riftDefFor(value, 'versus').blurb : 'The usual rules.'} />
      <div className="pho-note">
        <span>{room ? (editable ? 'Versus is unranked. Changes show for everyone at once.' : 'Only the host can change these, between games.') : 'Press Start to open your room, then invite friends.'}</span>
        {!room && <PhButton size="s" onClick={() => { sfx.pulse(); onBrowse(); }}>Open rooms</PhButton>}
      </div>
    </>
  );
}

const ROOMS_VISIBLE_MS = 5000;
const ROOMS_HIDDEN_MS = 30_000;

/**
 * OPEN ROOMS, the side panel's third tab: the public rooms, this mode's first. Joining one just fills the same banner row
 * (everyone arrives in the stands, R-VERSUS-ROOM-HAND-01). Same refresh as the classic browser (R-NET-BACKOFF-01), only
 * while the tab shows. A list that cannot be read is one friendly line with Retry.
 */
export function OpenRoomsPanel({ mode }: { mode: VersusRoomMode }) {
  const rooms = useVersus((s) => s.rooms);
  const loading = useVersus((s) => s.loading);
  const held = useVersus((s) => s.room);
  const [offline, setOffline] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const read = (): Promise<void> => refreshRooms().then(() => {
    const failed = !!useVersus.getState().error && useVersus.getState().rooms.length === 0;
    setOffline(failed);
    if (failed) clearVersusError(); // this panel says it, once
  });
  useEffect(() => {
    let last = 0;
    const ask = (): void => { last = Date.now(); void read(); };
    ask();
    const id = window.setInterval(() => { if (!pageHidden() || Date.now() - last >= ROOMS_HIDDEN_MS) ask(); }, ROOMS_VISIBLE_MS);
    const onVis = (): void => { if (!pageHidden() && Date.now() - last >= ROOMS_VISIBLE_MS) ask(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  if (offline) {
    return <PhEmpty title={VERSUS_OFFLINE_TEXT} sub="Your other modes still work."
      action={<PhButton variant="primary" disabled={retrying} onClick={() => { sfx.pulse(); setRetrying(true); void read().finally(() => setRetrying(false)); }}>{retrying ? 'Trying' : 'Retry'}</PhButton>} />;
  }
  const all = visibleRooms(rooms.filter((r) => !isDuosParty(r)), 'all');
  const shown = [...all.filter((r) => roomModeOf(r.options) === mode), ...all.filter((r) => roomModeOf(r.options) !== mode)];
  if (shown.length === 0) {
    return <PhEmpty title={loading ? 'Looking for rooms' : 'No rooms open'} sub={loading ? undefined : 'Press Start to open one. This list updates by itself.'} />;
  }
  return (
    <div className="vso-list" role="list" aria-label="Open Versus rooms">
      {held && <span className="pho-hint">Leave your room to join another.</span>}
      {shown.map((r) => <OpenRoomRow key={r.id} r={r} mine={held?.id === r.id} blocked={!!held} />)}
    </div>
  );
}

function OpenRoomRow({ r, mine, blocked }: { r: VersusRoomSummary; mine: boolean; blocked: boolean }) {
  const showOpp = useGame((s) => s.showOpponentSkins);
  const join = roomJoin(r);
  const cap = seatCap(r);
  const mode = roomModeOf(r.options);
  const prof = r.hostProfile ?? {};
  const art = heroThumb(playerCardArt({ avatar: typeof prof.avatar === 'string' && prof.avatar ? prof.avatar : null, favoriteHero: null, cosmetics: opponentSkins(showOpp, parseCosmeticSnapshot(prof.cosmetics) ?? null) }));
  const extra = versusOptionsSummary(r.options).split(' · ').slice(1);
  const sub = [roomModeShort(mode), `${r.players}/${cap}`, ROOM_STATUS[r.status] ?? r.status, ...extra, ...(r.friendsOnly ? ['Friends only'] : []), ...(r.spectators > 0 ? [`${r.spectators} watching`] : [])].join(' · ');
  const title = roomTitleOf(r.name, mode);
  return (
    <PhRow dense className="vso-row" art={art} title={title} sub={sub} selected={mine} label={seatText(r)}
      right={mine ? <PhChip tone="teal">Yours</PhChip> : (
        <PhButton variant={join.primary && !blocked ? 'primary' : 'plate'} size="s" disabled={blocked} aria-label={`${join.label} ${title}`}
          onClick={() => { sfx.pulse(); void joinRoom(r.id, join.as); }}>{join.label}</PhButton>
      )} />
  );
}
