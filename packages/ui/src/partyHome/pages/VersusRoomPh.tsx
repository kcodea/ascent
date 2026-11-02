/**
 * THE VERSUS ROOM under the party home's app shell (DEV switch "Party home (prototype)", owner 2026-11-02). The classic
 * arena room (`versus/VersusRoom.tsx`) is unchanged with the switch off; this is the same room as a party-home screen,
 * under the top nav, for Versus 1v1, Group (3 to 4) and Duos (two teams of two):
 *
 *  - HEADER: the mode and host over the room's name; Back to Play (the room is kept, as before: Play, the logo and Esc go
 *    home too, and Browse rooms or the nav's Versus way back reopens it), Invite friends and Leave room.
 *  - THE SEATS: one tall BANNER CARD per seat, the party home's own card (its classes, partyHome.css): the member's
 *    portrait fading into navy, their name, their Versus record (wins and losses, what the classic seat card's badges
 *    showed), their title, a Host plate, a You plate. 1v1 is two banners across a VS mark; Group four free seats; Duos two
 *    team plates of two across the VS. An open seat says what it waits for; for you, Take seat (or Move here).
 *  - DRAG TO SEAT, DRAG UP TO SPECTATE (R-VERSUS-DRAG-SEAT-01, the classic room's rules through the same pure helpers in
 *    `versus/seatDrag.ts` and the same `takeSeat`): press your card (a seat, or your tile in the stands), drag it onto an
 *    open seat to sit or switch; drag a seated card up past the sell line, or onto the stands, to watch. An occupied
 *    seat refuses with the deny buzz and the card springs back. The keyboard and a tap do the same through the open
 *    seat's Take seat and your card's menu (Move to spectators).
 *  - THE STANDS: every spectator as a small tile (portrait, name, Host, You) with the count of the 20 seats.
 *  - ROOM RULES, in place: the mode and the modifier, the host's to change between games (everyone else reads them).
 *  - START: the party home's gilded plaque, the host's once enough players sit; everyone else reads what they wait for.
 *    During a match a spectator's plaque is Watch. Previous match stats, and the DEV bot test tools, sit beside it.
 *
 * Nothing on the wire changes: every action is the store's existing call. PERFORMANCE: static paint; the cards rise in
 * once (transform / opacity). A drag measures the seats ONCE at pick-up and writes only the ghost's transform per frame
 * (one rAF); React hears only a change of drop zone. Phones: the 256 px portrait thumbnails.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { riftDefFor, VERSUS_MODIFIERS, VERSUS_SPECTATOR_CAP, type VersusGroupSeat, type VersusModifierId, type VersusRoomOptions } from '@game/sim';
import { avatarSrc, heroThumb } from '../../art';
import { isPhone } from '../../deviceClass';
import { hideDragCursorVeil, showDragCursorVeil } from '../../dragCursorVeil';
import { getDragFeel } from '../../dragFeel';
import { Icon } from '../../Icon';
import { currentUserId } from '../../identity';
import { mirrorFor, useProgression } from '../../progression/progressionStore';
import { heroPortrait, opponentSkins, useLiveLoadout } from '../../skins/skins';
import { sfx } from '../../sfx';
import { stageHost, toStage } from '../../stage';
import { useGame } from '../../store';
import { TitleBadge } from '../../titles/TitleBadge';
import { TAP_SLOP } from '../../touchInput';
import { acceptRequest, addFriend, friendsAccount, inviteFriend, relationOf, useFriends, useFriendsListLoop } from '../../friends/friendsStore';
import { cardSkins, handleOf, sortFriends, statusText } from '../../friends/friendBits';
import { displaySeconds } from '../../versus/versusClock';
import { VersusMatchStats } from '../../versus/VersusMatchStats';
import { seatPools } from '../../versus/VersusRoom';
import { freeVersusBotSlot, setVersusBotDisconnected, startVersusBot, stopVersusBot, useVersusBots } from '../../versus/versusBot';
import { versusTestToolsEnabled } from '../../versus/versusFlag';
import { resumeSpectating } from '../../versus/spectate';
import { canDragSeatCard, memberOf, roomWithSeatMove, seatDropOf, seatZoneAt, seatZoneValid, sellLineOf, type SeatDragGeo, type SeatZone } from '../../versus/seatDrag';
import { liveRoomView } from '../../versus/useSeatDrag';
import { MAX_RECORD_IDS, playerCardArt, seatCardSource, useSeatData, type SeatServerData } from '../../versus/versusSeatCard';
import { versusModifierName } from '../../versus/versusOptionsUi';
import { versusRoomRef, type VersusMember, type VersusRole, type VersusRoom } from '../../versus/versusRemote';
import { leaveRoom, myRole, setRoomOptions, setVersusStatsOpen, startGame, takeSeat, useVersus, versusRemainingMs } from '../../versus/versusStore';
import { PhBanner, PhBannerName, PhBannerState, PhButton, PhChip, PhDialog, PhEmpty, PhPage, PhRow, PhSection, PhSegmented } from '../kit';
import { setPhInvite } from '../shell/shellStore';
import { hostSitsFirst, openSeatText, roomModeLabel, roomModeOf, roomStartOf, roomTitleOf, seatTeams, VERSUS_ROOM_MODES, type VersusRoomMode } from './versusPh';
import { openVersusBrowser } from './versusNav';
import '../partyHome.css';
import { playerVersusError } from '../versusCopy';
import './versusPages.css';

/** COMPACT (phones, short windows): the shell's `html[data-ph-compact]`, or a phone. */
function useCompact(): boolean {
  const test = (): boolean => (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-ph-compact')) || isPhone();
  const [c, setC] = useState(test);
  useEffect(() => {
    const on = (): void => setC(test());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return c;
}

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
function BannerFoot({ face, state }: { face: Face; state: ReactNode }) {
  return (
    <>
      <PhBannerName>{face.name}</PhBannerName>
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

// ── THE ROOM ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function VersusRoomPh() {
  const serverRoom = useVersus((s) => s.room);
  const seatMove = useVersus((s) => s.seatMove);
  const me = currentUserId();
  // THE ROOM AS SHOWN (R-VERSUS-DRAG-SEAT-01): the server's room with my seat move applied the moment I make it.
  const room = useMemo(() => roomWithSeatMove(serverRoom, seatMove, me), [serverRoom, seatMove, me]);
  const match = useVersus((s) => s.match);
  const error = useVersus((s) => s.error);
  const optionsNotice = useVersus((s) => s.optionsNotice);
  const lastMatch = useVersus((s) => s.lastMatch);
  const statsOpen = useVersus((s) => s.statsOpen);
  const setTitleView = useGame((s) => s.setTitleView);
  const compact = useCompact();
  const rootRef = useRef<HTMLDivElement>(null);
  const { drag, ghost, begin, clicked } = useRoomDrag(rootRef);
  const bots = useVersusBots();
  const canAddBot = !bots.busy && bots.bots.length < 3 && freeVersusBotSlot() != null;
  const [inviteOpen, setInviteOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const gateLeft = useCountdown(room?.status === 'sealed' ? room.gate_deadline : null);
  const mode: VersusRoomMode = roomModeOf(serverRoom?.options);
  const teams = seatTeams(mode);
  const seats = teams.flat();
  // ONE batched read for every card in the room: every seat and every spectator (at most 24 ids, R-NET-01).
  const memberIds = (room?.members ?? []).map((m) => m.userId).slice(0, MAX_RECORD_IDS);
  const seatData = useSeatData(memberIds, `${memberIds.join(',')}|${room?.status === 'open' ? 'open' : 'busy'}|${room?.current_match_id ?? ''}|${lastMatch?.matchId ?? ''}`);
  // The room's entrance sound: once per room this screen opens (the classic room's gate cue). THE HOST SITS BY DEFAULT
  // (critic round 3, party home only): a room I just created, with nobody else in it yet, seats me in seat 1 through the
  // existing take-seat call (the store steps a creator down to the stands, R-VERSUS-ROOM-HAND-01; everyone who joins
  // still arrives there, and drag to seat / spectate is unchanged).
  const entered = useRef<string | null>(null);
  useEffect(() => {
    if (!serverRoom?.id || entered.current === serverRoom.id) return;
    entered.current = serverRoom.id;
    sfx.gate('open');
    if (hostSitsFirst(serverRoom, currentUserId())) void takeSeat('p1');
  }, [serverRoom?.id]);
  // The nav's friends drawer: invites from this room go through Invite friends (below), so the drawer says so.
  useEffect(() => {
    setPhInvite({ can: false, reason: 'Invite friends to this room with Invite friends in the room.', members: [], modeLabel: roomModeLabel(mode), send: null });
    return () => setPhInvite(null);
  }, [mode]);
  // A drag or a seat change closes my card's menu.
  useEffect(() => { setMenuOpen(false); }, [myRole(room), !!drag]);

  if (!room || !serverRoom) return null;
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
  const hostName = room.members.find((m) => m.userId === room.host_user_id)?.displayName?.trim() || null;
  const roomBots = bots.bots.filter((b) => b.roomId === room.id && b.status === 'playing');
  const allOff = roomBots.length > 0 && roomBots.every((b) => b.disconnected);
  const start = roomStartOf({
    mode, status: room.status, seated: seatedCount, host, isPlayer, running, phase: match?.phase ?? null, round: match?.round ?? null, gateLeft,
  });
  const watch = running && !isPlayer && match!.phase !== 'hero_select';
  const testTools = host && open && versusTestToolsEnabled();
  const myDraggable = !!me && canDragSeatCard(room, me, me);

  const goBack = (): void => { sfx.pulse(); setTitleView('modes'); };
  // Leave goes HOME (critic round 4), not to the room list.
  const leave = (): void => { sfx.pulse(); void stopVersusBot().then(() => leaveRoom()).then(() => setTitleView('modes')); };

  // ── a seat ──
  const seatCard = (side: VersusGroupSeat, i: number): JSX.Element => {
    const m = room.members.find((x) => x.role === side) ?? null;
    const over = drag && !drag.snap && drag.zone === side ? (drag.valid ? ' vsr-over' : ' vsr-bad') : '';
    if (!m) {
      const t = openSeatText({ open, mine });
      const target = drag && !drag.snap && seatZoneValid(side, room, me) ? ' vsr-target' : '';
      return (
        <PhBanner key={side} ghost index={i} className={`vsr-seat vsr-s-${side} vsr-open${over}${target}${t.take ? ' vsr-cantake' : ''}`}
          label={t.take ? `${t.label}: seat ${side.slice(1)}. ${mine?.role === 'spectator' ? 'Take this seat' : 'Move here'}` : `Open seat ${side.slice(1)}`}
          onClick={t.take && !seatMove ? () => { sfx.play(); void takeSeat(side); } : undefined}
          overlay={testTools && canAddBot ? (
            /* TEST TOOLS (dev / opted-in browsers only): a bot fills this seat through the normal server protocol. */
            <span className="vsr-botslot"><PhButton size="s" onClick={() => { sfx.pulse(); void startVersusBot(room.id, side); }}>Add bot</PhButton></span>
          ) : undefined}>
          <span className="ph-invmed" aria-hidden="true"><span>+</span></span>
          <span className="ph-openlbl">{t.take ? (mine?.role === 'spectator' ? 'Take seat' : 'Move here') : t.label}</span>
          {t.sub && <span className="ph-opensub">{t.take ? 'Or drag your card here' : t.sub}</span>}
        </PhBanner>
      );
    }
    return (
      <SeatBanner key={m.userId} side={side} i={i} m={m} server={seatData.get(m.userId)} thumb={compact} host={m.userId === room.host_user_id}
        over={over} hidden={drag?.userId === m.userId}
        pools={running ? seatPools(match, side) : null} sealed={room.status === 'sealed'}
        draggable={m.userId === me && myDraggable} onPointerDown={(e) => begin(e, m.userId)}
        menuOpen={menuOpen && m.userId === me} onToggleMenu={() => { if (!clicked()) return; sfx.pulse(); setMenuOpen((v) => !v); }}
        onSpectate={() => { sfx.sell(); setMenuOpen(false); void takeSeat('spectator'); }} />
    );
  };
  const vs = <span key="vs" className="ph-vs vsr-vs" aria-hidden="true">VS</span>;
  const row: JSX.Element[] = [];
  let k = 0;
  teams.forEach((team, t) => {
    if (t > 0) row.push(vs);
    const cards = team.map((side) => seatCard(side, k++));
    if (mode === 'duos') {
      row.push(
        <div key={`team-${t}`} className="vsr-team" role="group" aria-label={`Team ${t + 1}`}>
          <span className="vsr-teamname">Team {t + 1}</span>
          {cards}
        </div>,
      );
    } else row.push(...cards);
  });

  const rules = <RoomRules options={room.options} editable={host && open} />;
  const sellBand = drag && !drag.snap && drag.sellTop !== null;

  return (
    <div ref={rootRef} className={`vsr${compact ? ' vsr-compact' : ''}${drag ? ' vsr-dragging' : ''}`} role="region" aria-label={`${roomTitleOf(room.name, mode)}, ${roomModeLabel(mode)}`}>
      <PhPage className="vsr-page" wide eyebrow={<>{roomModeLabel(mode)}{hostName ? <span className="vsr-host"> · Hosted by {hostName}</span> : null}</>}
        title={roomTitleOf(room.name, mode)} back={{ label: 'Play', onClick: goBack }}
        actions={(
          <>
            {compact && <PhButton size="s" onClick={() => { sfx.pulse(); setRulesOpen(true); }}>Rules</PhButton>}
            <PhButton size={compact ? 's' : 'm'} variant="ghost" onClick={() => { sfx.pulse(); openVersusBrowser(); }}>All rooms</PhButton>
            {friendsAccount() && <PhButton size={compact ? 's' : 'm'} onClick={() => { sfx.pulse(); setInviteOpen(true); }}>Invite friends</PhButton>}
            <PhButton size={compact ? 's' : 'm'} variant="ghost" onClick={leave}>{running && isPlayer ? 'Leave (concede)' : 'Leave room'}</PhButton>
          </>
        )}>
        <div className="vsr-body">
          <div className="vsr-main">
            <div className={`ph-cards n${seats.length}${teams.length > 1 ? ' vs' : ''}${mode === 'duos' ? ' vsr-duos' : ''} vsr-cards`}>{row}</div>
          </div>
          {!compact && <PhSection className="vsr-rules" title="Room rules" aside={host && open ? undefined : <span>Host only</span>}>{rules}</PhSection>}
        </div>
        <Stands spectators={spectators} room={room} me={me} data={seatData} thumb draggingSeated={!!drag && !drag.snap && drag.from !== 'spectator'}
          over={!!drag && !drag.snap && drag.zone === 'stands'} hiddenId={drag?.userId ?? null} onPointerDown={begin} myDraggable={myDraggable} />
        <div className="ph-actions vsr-actions">
          <div className="ph-side">
            {!open || !lastMatch ? null : <PhButton onClick={() => { sfx.pulse(); setVersusStatsOpen(true); }}>Previous match stats</PhButton>}
            {roomBots.length > 0 && (
              <>
                <PhButton size="s" onClick={() => setVersusBotDisconnected(!allOff)}>
                  {roomBots.length === 1 ? (allOff ? 'Bot reconnects' : 'Bot disconnects') : (allOff ? 'Bots reconnect' : 'Bots disconnect')}
                </PhButton>
                <PhButton size="s" onClick={() => { void stopVersusBot(); }}>{roomBots.length === 1 ? 'Remove bot' : 'Remove bots'}</PhButton>
              </>
            )}
          </div>
          <button type="button" className="ph-start vsr-start" disabled={!start.canStart && !watch}
            onClick={() => {
              if (watch) { sfx.pulse(); resumeSpectating(); return; }
              if (!start.canStart) return;
              sfx.pulse(); void startGame();
            }}>
            <span>{start.label}</span>
          </button>
          <div className="ph-side ph-side-r">
            {start.note && <span className="ph-note" role="status">{start.note}</span>}
            {bots.error && <span className="ph-note">Bot: {bots.error}</span>}
          </div>
        </div>
      </PhPage>

      {optionsNotice && <div className="vsr-notice" role="status">{optionsNotice}</div>}
      {error && <div className="ph-err vsr-err" role="alert">{playerVersusError(error)}</div>}
      {menuOpen && <div className="ph-menucatch vsr-menucatch" aria-hidden="true" onPointerDown={() => setMenuOpen(false)} />}

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

      {rulesOpen && compact && (
        <PhDialog label="Room rules" eyebrow={roomModeLabel(mode)} title="Room rules" onClose={() => setRulesOpen(false)}
          actions={<PhButton variant="primary" onClick={() => { sfx.pulse(); setRulesOpen(false); }}>Done</PhButton>}>
          {rules}
        </PhDialog>
      )}
      {inviteOpen && <InviteDialog room={room} title={roomTitleOf(room.name, mode)} me={me} onClose={() => setInviteOpen(false)} />}
      {statsOpen && lastMatch && <VersusMatchStats record={lastMatch} onClose={() => setVersusStatsOpen(false)} />}
    </div>
  );
}

/** A seated member's banner (the kit's PhBanner). Mine drags (and opens a small menu on a tap). */
function SeatBanner({ side, i, m, server, thumb, host, over, hidden, pools, sealed, draggable, onPointerDown, menuOpen, onToggleMenu, onSpectate }: {
  side: VersusGroupSeat; i: number; m: VersusMember; server: SeatServerData | undefined; thumb: boolean; host: boolean; over: string; hidden: boolean;
  pools: { health: number; armor: number } | null; sealed: boolean; draggable: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void; menuOpen: boolean; onToggleMenu: () => void; onSpectate: () => void;
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
      onClick={draggable ? onToggleMenu : undefined} haspopup={draggable} expanded={menuOpen}
      overlay={menuOpen ? (
        <div className="ph-cardmenu" role="menu" aria-label="Your seat">
          <button type="button" role="menuitem" className="ph-menuitem" onClick={onSpectate}><span>Move to spectators</span></button>
        </div>
      ) : undefined}>
      <BannerFoot face={face} state={state} />
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
function Stands({ spectators, room, me, data, thumb, draggingSeated, over, hiddenId, onPointerDown, myDraggable }: {
  spectators: VersusMember[]; room: VersusRoom; me: string | null; data: ReadonlyMap<string, SeatServerData>; thumb: boolean;
  draggingSeated: boolean; over: boolean; hiddenId: string | null; onPointerDown: (e: ReactPointerEvent<HTMLElement>, userId: string) => void; myDraggable: boolean;
}) {
  return (
    <section className={`vsr-stands${draggingSeated ? ' vsr-target' : ''}${over ? ' vsr-over' : ''}`} aria-label="Spectators">
      <header className="vsr-standshead">
        <h2>Spectators</h2>
        <span className="vsr-standsn">{spectators.length} / {VERSUS_SPECTATOR_CAP}</span>
        {draggingSeated && <span className="vsr-standshint">Drop here to spectate</span>}
      </header>
      <div className="vsr-tiles" role="list">
        {spectators.length === 0
          ? <span className="vsr-none">No one is watching yet.</span>
          : spectators.map((m) => (
            <StandTile key={m.userId} m={m} server={data.get(m.userId)} thumb={thumb} host={m.userId === room.host_user_id} you={m.userId === me}
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
      {you && <span className="vsr-tileyou" aria-hidden="true">You</span>}
    </div>
  );
}

/** ROOM RULES in place: the mode and the modifier (R-VERSUS-OPTIONS-01). The host changes them between games; the
 *  server validates, exactly as the classic Room options window. */
const MODIFIERS: { value: VersusModifierId | null; label: string }[] = [
  { value: null, label: 'None' },
  ...VERSUS_MODIFIERS.map((id) => ({ value: id as VersusModifierId | null, label: versusModifierName(id) })),
];
function RoomRules({ options, editable }: { options: VersusRoomOptions | null | undefined; editable: boolean }) {
  const mode = roomModeOf(options);
  const modifier = (options?.modifiers ?? [])[0] ?? null;
  const send = (next: Partial<VersusRoomOptions>): void => { void setRoomOptions({ v: 1, mode, modifiers: modifier ? [modifier] : [], ...next } as VersusRoomOptions); };
  return (
    <div className="vsr-rulesbody">
      <PhSegmented label="Mode" value={mode} disabled={!editable} options={VERSUS_ROOM_MODES.map((m) => ({ value: m.id, label: m.short }))}
        onPick={(v) => { if (v === mode) return; sfx.tick(); send({ mode: v }); }} hint={VERSUS_ROOM_MODES.find((m) => m.id === mode)?.desc} />
      <PhSegmented label="Modifier" value={modifier} disabled={!editable} options={MODIFIERS} max={4}
        onPick={(v) => { if (v === modifier) return; sfx.tick(); send({ modifiers: v ? [v] : [] }); }}
        hint={modifier ? riftDefFor(modifier, 'versus').blurb : 'The usual rules.'} />
      <span className="vsr-rulesnote">{editable ? 'Versus is unranked. Changes show for everyone at once.' : 'Only the host can change these, between games. Versus is unranked.'}</span>
    </div>
  );
}

/** INVITE FRIENDS (R-FRIENDS-04), in the shell's window: online friends get Invite (the server checks they are online
 *  and the room is open); the others are listed without it. Then "In this room": the members who are not friends yet,
 *  with Add friend. The classic `RoomInvitePanel`'s reads and calls, in the kit. */
function InviteDialog({ room, title, me, onClose }: { room: VersusRoom; title: string; me: string | null; onClose: () => void }) {
  useFriendsListLoop(true);
  const list = useFriends((s) => s.list);
  const flash = useFriends((s) => s.flash);
  const busy = useFriends((s) => s.busy);
  const showOpp = useGame((s) => s.showOpponentSkins);
  const inRoom = new Set(room.members.map((m) => m.userId));
  const friends = list ? sortFriends(list.friends).filter((f) => !inRoom.has(f.userId)) : [];
  const others = room.members.filter((m) => m.userId !== me && (!list || relationOf(m.userId, { list }) !== 'friend'));
  const open = room.status === 'open';
  const target = versusRoomRef(room);
  return (
    <PhDialog label="Invite friends" eyebrow={title} title="Invite friends" onClose={onClose}
      actions={<PhButton onClick={() => { sfx.pulse(); onClose(); }}>Close</PhButton>}>
      <div className="vsr-invite">
        {!open && <span className="vsr-rulesnote">Invites open again when this match ends.</span>}
        {flash && <span className="ph-fflash" role="status">{flash}</span>}
        {!list ? <PhEmpty title="Finding your friends" />
          : friends.length === 0 ? <PhEmpty title="No friends to invite yet" sub="Add friends from Friends in the top bar." />
          : (
            <div className="vsr-invlist" role="list">
              {friends.map((f) => {
                const sent = list.sent.find((x) => x.to === f.userId && x.target === target);
                const label = sent?.status === 'pending' ? 'Invited' : sent?.status === 'declined' ? 'Declined' : 'Invite';
                const art = heroThumb((showOpp ? avatarSrc(f.avatar) : undefined) ?? heroPortrait(f.favoriteHero, opponentSkins(showOpp, cardSkins(f))));
                return (
                  <PhRow key={f.userId} dense className={`ph-friend f-${f.status}`} art={art} title={f.author ?? handleOf(f)}
                    sub={<span className="ph-fstatus"><i aria-hidden="true" />{statusText(f)}</span>}
                    right={open && f.status === 'online' && f.mode !== 'versus_room' ? (
                      <PhButton variant="primary" size="s" disabled={!!busy[`invite:${f.userId}`] || sent?.status === 'pending'}
                        aria-label={`Invite ${handleOf(f)}`} onClick={() => { sfx.pulse(); void inviteFriend(f.userId, 'versus_room', target); }}>{label}</PhButton>
                    ) : undefined} />
                );
              })}
            </div>
          )}
        {others.length > 0 && (
          <>
            <h3 className="vsr-invh">In this room</h3>
            <div className="vsr-invlist" role="list">
              {others.map((m) => (
                <PhRow key={m.userId} dense title={m.displayName || 'Player'} right={<AddFriendPh userId={m.userId} />} />
              ))}
            </div>
          </>
        )}
      </div>
    </PhDialog>
  );
}

/** Add friend on a room member, in the kit (the classic AddFriendButton's states and calls). */
function AddFriendPh({ userId }: { userId: string }) {
  const account = useGame((s) => s.account);
  const rel = useFriends((s) => relationOf(userId, s));
  const busy = useFriends((s) => !!s.busy[userId]);
  const deployed = useFriends((s) => s.deployed);
  if (!account.userId || account.anonymous || !deployed || !friendsAccount() || rel === 'self' || rel === 'blocked') return null;
  if (rel === 'friend') return <PhChip tone="teal">Friends</PhChip>;
  if (rel === 'outgoing') return <PhChip>Request sent</PhChip>;
  if (rel === 'incoming') return <PhButton size="s" variant="primary" disabled={busy} onClick={() => { sfx.pulse(); void acceptRequest(userId); }}>Accept friend</PhButton>;
  return <PhButton size="s" disabled={busy} onClick={() => { sfx.pulse(); void addFriend(userId); }}>Add friend</PhButton>;
}
