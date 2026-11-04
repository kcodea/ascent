/**
 * THE PARTY HOME, A PROTOTYPE (owner 2026-11-02, DEV only behind the "Party home (prototype)" switch; see partyHomeFlag.ts).
 *
 * Owner: "can you take inspiration from valorant's party view for our lobby and our duo's party view? should the play
 * button take you into a party screen where you select your mode (solo/duo) from there? then starting the game from that
 * screen even as a solo?" and "im wondering if we should have our main screen be this instead, with big cards with your
 * chosen portrait art like in valorant front and center, with the tabs for career etc at the top, then allowing the
 * player to invite from there". Style: the Docked lobby rail (shell/shell.css tokens). Bar: "extremely clean".
 *
 * THE SCREEN IS YOUR PARTY:
 *  - A VERSUS ROOM is a state of this screen, not a page (versusRoomHome.tsx): its seats are the banners.
 *  - TOP: the app shell's nav (shell/PhTopNav.tsx), the same bar every menu page wears in the prototype.
 *  - UNDER IT: the mode tabs and one line on the picked mode. A mode sets the party's seats and what START does. In a
 *    party, the solo modes are dimmed with the reason (the party never silently drops a teammate).
 *  - CENTRE: one tall banner card per member (chosen portrait, name, medal, title or level; Ready / In game on the others'
 *    cards), you first; an open seat per free slot points at the friends list. A card opens a small menu (your
 *    portrait and Career; a teammate's message, promote, remove). In a Duos party the team's name plate sits above the
 *    pair with Rename. Beside the cards: the mode's own options, in place (ModeOptions.tsx).
 *  - BOTTOM CENTRE: START, the one strong accent; ranked modes ask the ranked confirmation (R-RANK-06) first, in the
 *    shell's own dialog. Leave party beside it in a party.
 *  - RIGHT: the side panel (owner 2026-11-02: "i dont want the banners to move around from the room options"): two tabs,
 *    Friends (the ONE friends list) and the mode's settings (Practice, Gauntlet, Room rules). Docked at desktop size, the
 *    same drawer on a phone. The banner row never moves: same place and size in every mode, START centred under it.
 *
 * STUBBED (prototype): Ready is "seated" (no server ready flag before a game), a teammate's medal is not read, promote /
 * remove have no server call yet, and a party can only queue Ranked Duos (a server party for every mode is production work).
 *
 * PERFORMANCE: static paint; motion is one-shot transform / opacity (the cards rise in, hover lifts). At most four
 * portraits; on a phone they are the 256 px thumbnails (`heroThumb`).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { levelProgress } from '@game/progression';
import { defaultTeamName, LEARN_ASCENT, TEAM_NAME_MAX, teamNameProblem, type VersusModifierId, type VersusRoomOptions } from '@game/sim';
import { heroThumb, modeArt } from '../art';
import { isPhone } from '../deviceClass';
import { Icon } from '../Icon';
import { currentUserId } from '../identity';
import { mirrorFor, useProgression } from '../progression/progressionStore';
import { RankCrest } from '../rank/RankBar';
import { useCurrentRank } from '../rank/rankSource';
import { rankLabel } from '../rank/rankFormat';
import { remoteEnabled } from '../remoteBoards';
import { heroPortrait } from '../skins/skins';
import { sfx } from '../sfx';
import { anyPageOpen, tempHandle, useGame } from '../store';
import { TitleBadge } from '../titles/TitleBadge';
import { friendsAccount, inviteFriend } from '../friends/friendsStore';
import type { Friend } from '../friends/friendsRemote';
import { openDm } from '../friends/dock/dockStore';
import { DuosResultOverlay, TeamNamePanel, partyPair, usePartyTeamName } from '../versus/DuosParty';
import { defaultPartyName } from '../versus/playParty';
import { versusEnabled } from '../versus/versusFlag';
import { versusRoomRef } from '../versus/versusRemote';
import { playerCardArt, seatCardSource, useSeatData } from '../versus/versusSeatCard';
import { createRoom, enterDuosParty, isDuosParty, leaveDuosParty, openVersus, setRoomOptions, startGame, takeSeat, useVersus } from '../versus/versusStore';
import { titleContinueNote } from '../titleTextConfig';
import { withAbandonWarning } from '../rank/ratedRun';
import { PhTopNav } from './shell/PhTopNav';
import { OpenRoomsPanel, RoomRulesPanel, useVersusRoomHome } from './versusRoomHome';
import { defaultRoomName, roomModeOf, roomTitleOf } from './pages/versusPh';
import { PhBackdrop } from './shell/PhBackdrop';
import { PhFriends } from './shell/PhFriends';
import { addSampleInvite, clearSampleInvites, removeSampleInvite, setFriendsOpen, setPhInvite, usePhShell } from './shell/shellStore';
import { PhBanner, PhBannerInvite, PhBannerName, PhBannerState, PhButton, PhDialog, PhField, PhLeaderBadge, PhTabs, phNum } from './kit';
import { GauntletPanel, PracticePanel, stagePlayable, useGauntletStages } from './ModeOptions';
import { partyModeOf, partyModes, readPartyMode, rememberPartyMode, type PartyMode, type PartyModeId } from './partyModes';
import { setPartyDemo, usePartyDemo } from './partyHomeFlag';
import { SAMPLE_MATE_ID, sampleFriends, sampleHeroes } from './sample';
import { playerVersusError, useVersusDown } from './versusCopy';
import { versusModifierName } from '../versus/versusOptionsUi';
import './partyHome.css';

/** One banner card's contents. */
interface Member {
  key: string;
  userId: string | null;
  self: boolean;
  name: string;
  art: string | undefined;
  titleId: string | null;
  /** The medal line: crest + label. Null: not known (a teammate's medal is not read yet). */
  rank: { divisionIndex: number; label: string } | null;
  level: number | null;
  state: 'ready' | 'in_game';
  leader: boolean;
}

/** COMPACT (phones, short windows): the same test Title.tsx uses for `html[data-ph-compact]`. The friends list becomes the
 *  nav's drawer and the cards use the phone thumbnails. */
function useCompact(): boolean {
  const test = (): boolean => document.documentElement.hasAttribute('data-ph-compact') || isPhone();
  const [c, setC] = useState(test);
  useEffect(() => {
    const on = (): void => setC(test());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return c;
}

export interface PartyHomeProps {
  /** A ranked START: the title's nudge + ranked confirmation (R-RANK-06). `then` runs on "Yes" instead of the default. */
  onRankedStart: (kind: 'solo' | 'duos', then?: () => void) => void;
}

export default function PartyHome({ onRankedStart }: PartyHomeProps) {
  const confirmPracticeSetup = useGame((s) => s.confirmPracticeSetup);
  const startGauntlet = useGame((s) => s.startGauntlet);
  const startTutorial = useGame((s) => s.startTutorial);
  const goTo = useGame((s) => s.goTo);
  const openAvatarPicker = useGame((s) => s.openAvatarPicker);
  const playerName = useGame((s) => s.playerName);
  const playerAvatar = useGame((s) => s.playerAvatar);
  const showOpp = useGame((s) => s.showOpponentSkins);
  const userId = useGame((s) => s.account.userId);
  const pageOpen = useGame(anyPageOpen);
  const savedRun = useGame((s) => s.savedRun);
  const continueRun = useGame((s) => s.continueRun);
  const setPracticeDraft = useGame((s) => s.setPracticeDraft);
  const me = currentUserId();
  const rank = useCurrentRank();
  const progressionOn = useProgression((s) => s.capability === 'on');
  const mirror = useProgression((s) => mirrorFor(userId, s.mirror));
  const lv = progressionOn && mirror ? levelProgress(mirror.accountXp) : null;
  const demo = usePartyDemo();
  const phone = useCompact();

  // THE PARTY: a Ranked Duos room is the only server-side party today; the DEV sample party stands in for one.
  const room = useVersus((s) => s.room);
  const vsError = useVersus((s) => s.error);
  const duosRoom = room && isDuosParty(room) ? room : null;
  const versusRoom = room && !isDuosParty(room) ? room : null;
  const inParty = !!duosRoom || demo;

  // ── the members: you first ──
  const seated = duosRoom ? duosRoom.members.filter((m) => m.role === 'p1' || m.role === 'p2') : [];
  const seatIds = seated.map((m) => m.userId);
  const seatData = useSeatData(seatIds, `${seatIds.join(',')}|${duosRoom?.status ?? ''}`);
  const host = duosRoom ? duosRoom.host_user_id === me : true;
  const inGame = duosRoom?.status === 'in_game';
  const members: Member[] = [{
    key: 'self', userId: me, self: true, name: playerName || tempHandle(userId), art: playerCardArt({ avatar: playerAvatar ?? null, favoriteHero: null, cosmetics: null }),
    titleId: mirror?.equippedTitleId ?? null, rank: rank ? { divisionIndex: rank.divisionIndex, label: rankLabel(rank) } : null,
    level: lv?.level ?? null, state: inGame ? 'in_game' : 'ready', leader: host,
  }];
  if (duosRoom) {
    for (const m of seated) {
      if (m.userId === me) continue;
      const src = seatCardSource({ member: m, own: false, showOpp, server: seatData.get(m.userId) });
      members.push({ key: m.userId, userId: m.userId, self: false, name: src.name, art: playerCardArt(src), titleId: src.titleId, rank: null, level: null,
        state: inGame ? 'in_game' : 'ready', leader: duosRoom.host_user_id === m.userId });
    }
  } else if (demo) {
    members.push({ key: 'sample-mate', userId: SAMPLE_MATE_ID, self: false, name: 'Mike', art: heroPortrait(sampleHeroes()[0], null), titleId: null,
      rank: { divisionIndex: 7, label: rankLabel(7) }, level: null, state: 'ready', leader: false });
  }
  // The sample party's sent invites wait in the next open seat (DEV, no backend).
  const sampleInvites = usePhShell((s) => s.sampleInvites);
  const showLeader = members.length > 1;

  // ── the modes: in a party, only the modes that take it ──
  const modes = useMemo(() => partyModes({ versus: versusEnabled(), dev: import.meta.env.DEV }), []);
  // A VERSUS ROOM IS A STATE OF THIS SCREEN (versusRoomHome.tsx): the tabs follow it. The host can switch between the Versus
  // modes while the room is open; anything else waits until the room is left, like a party.
  const roomTab: PartyModeId | null = versusRoom ? ({ duel: 'versus', group: 'group', duos: 'vduos' } as const)[roomModeOf(versusRoom.options)] : null;
  const roomHost = !!versusRoom && versusRoom.host_user_id === me && versusRoom.status === 'open';
  const lockReason = (m: PartyMode): string | null => {
    if (versusRoom) return m.id === roomTab || (roomHost && m.party === 'rivals') ? null : `You are in a Versus room. Leave it to play ${m.label}.`;
    if (!inParty) return null;
    if (duosRoom) return m.id === 'duos' ? null : `Your party is queued for Ranked Duos. Leave the party to play ${m.label}.`;
    return m.party === 'solo' ? `${m.label} is solo. Leave the party to play it.` : null;
  };
  const [picked, setPicked] = useState<PartyModeId>(() => readPartyMode());
  const pickedMode = modes.find((m) => m.id === picked) ?? modes[0]!;
  const modeId: PartyModeId = roomTab ?? (lockReason(pickedMode) ? 'duos' : pickedMode.id);
  const mode = partyModeOf(modeId);
  const pick = (id: PartyModeId): void => {
    sfx.pulse(); setLockNote(null); setPicked(id); rememberPartyMode(id);
    if (versusRoom) void setRoomOptions({ v: 1, mode: id === 'versus' ? 'duel' : id === 'group' ? 'group' : 'duos', modifiers: versusRoom.options?.modifiers ?? [] } as VersusRoomOptions);
  };
  const [lockNote, setLockNote] = useState<string | null>(null);
  const [hoverNote, setHoverNote] = useState<string | null>(null);
  // A locked tab's reason shows as a brief toast under the tabs, then the line returns to the mode's description.
  useEffect(() => { if (!lockNote) return undefined; const t = window.setTimeout(() => setLockNote(null), 2600); return () => window.clearTimeout(t); }, [lockNote]);
  const [demoTeam, setDemoTeam] = useState<string | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState<null | (() => void)>(null);
  const slots = Math.max(mode.slots, members.length);
  const open = slots - members.length;

  // ── IN-PLACE OPTIONS (ModeOptions.tsx): the Gauntlet stage and the Versus modifier START reads ──
  const stages = useGauntletStages();
  const [stagePick, setStagePick] = useState<number | null>(null);
  const autoStage = stages.find((x) => x.state === 'available')?.n ?? stages.find((x) => stagePlayable(x.state))?.n ?? null;
  const stage = stagePick !== null && stagePlayable(stages[stagePick - 1]?.state ?? 'locked') ? stagePick : autoStage;
  const [modifier, setModifier] = useState<VersusModifierId | null>(null);
  const [roomName, setRoomName] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  // My banner keeps its medal line in a room, so the name never jumps when a room opens behind the screen.
  const myMedal = (
    <span className="ph-rank">
      {members[0]!.rank
        ? <><RankCrest divisionIndex={members[0]!.rank.divisionIndex} size="mini" hideDivision /><span>{members[0]!.rank.label}</span></>
        : <span className="ph-muted">Unranked</span>}
    </span>
  );
  const vh = useVersusRoomHome(rootRef, phone, () => setPickerOpen(true), myMedal);
  // The tab stays on the room's mode after leaving it, and a returning member lands back in their room (the store's rejoin).
  useEffect(() => { if (roomTab) { setPicked(roomTab); rememberPartyMode(roomTab); } }, [roomTab]);
  // Joining from Open rooms: the list has done its job, so the panel shows the room's rules.
  useEffect(() => { if (versusRoom?.id) setSideTab((t) => (t === 'rooms' ? 'settings' : t)); }, [versusRoom?.id]);
  useEffect(() => { if (mode.party === 'rivals' && !useVersus.getState().room) openVersus('versus'); }, [mode.party]);
  const hostName = (): string => roomName.trim() || (playerName.trim() ? `${playerName.trim()}'s ${mode.label}` : defaultRoomName('', mode.id === 'versus' ? 'duel' : mode.id === 'group' ? 'group' : 'duos'));
  const [nameOpen, setNameOpen] = useState(false);
  const [teamName, setTeamName] = usePartyTeamName(duosRoom);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [seatNote, setSeatNote] = useState<string | null>(null);

  // ── START ──
  let startLabel = 'Start';
  let note: string | null = seatNote;
  let startOk = true;
  let onStart: () => void = () => undefined;
  switch (mode.id) {
    case 'ranked': onStart = () => onRankedStart('solo'); break;
    case 'duos':
      if (demo && !duosRoom) { onStart = () => onRankedStart('duos', () => undefined); break; }
      if (inGame) { startOk = false; startLabel = 'In game'; break; }
      if (!duosRoom || members.length < 2) { startOk = false; note = note ?? 'Invite a teammate to start.'; break; }
      if (!host) { startOk = false; startLabel = 'Waiting'; note = 'Your party leader starts the game.'; break; }
      onStart = () => onRankedStart('duos', () => { void startGame(); });
      break;
    case 'versus': case 'group': case 'vduos': {
      // In a room: its START (the host's once enough sit; everyone else reads what they wait for).
      if (vh.start) { startLabel = vh.start.label; startOk = vh.start.ok; note = vh.start.note ?? note; onStart = vh.start.run; break; }
      // No room yet: START opens one behind this screen, with the tab's mode and the picked rules. Nothing navigates.
      const vmode = mode.id === 'versus' ? 'duel' : mode.id === 'group' ? 'group' : 'duos';
      onStart = () => { void hostVersus({ v: 1, mode: vmode, modifiers: modifier ? [modifier] : [] } as VersusRoomOptions, hostName()); };
      break;
    }
    case 'practice':
      // The options are set in place: straight to the hero picker with them (the title hides as the picker opens).
      onStart = () => {
        // The Heroes row reads Beginner when the draft has never been set: make that explicit before the offer is rolled.
        if (!useGame.getState().practiceDraft.heroes) setPracticeDraft({ heroes: 'beginner' });
        useGame.setState({ showTitle: false, avatarPickerOpen: false });
        confirmPracticeSetup();
      };
      break;
    case 'gauntlet':
      if (stage === null) { startOk = false; note = 'No stage is open yet.'; break; }
      note = `Stage ${stage}${stages[stage - 1]?.stage ? `: ${stages[stage - 1]!.stage!.name}` : ''}`;
      onStart = () => startGauntlet(stage);
      break;
    case 'learn': onStart = () => startTutorial(LEARN_ASCENT); break;
  }

  // THE SERVER LINE: its own line under the mode's note, so the mode's hint always shows. Only on the modes that use the
  // Versus server, cleared on a mode change and on recovery (a stale error never follows you to another mode).
  const usesServer = mode.party === 'rivals' || mode.id === 'duos';
  const vsDown = useVersusDown();
  const serverName = mode.id === 'duos' ? 'Ranked Duos' : 'Versus';
  const vsCopy = usesServer ? playerVersusError(vsError) : null;
  const downLine = `${serverName} is offline right now.`;
  const issue = vsDown && usesServer ? downLine : vsCopy;
  // The server is down: START is the same dim, disabled START as a Duos party with no teammate; the line says why.
  if (vsDown && usesServer && !versusRoom && !duosRoom) { startOk = false; onStart = () => undefined; }
  // A phone has no line under the tabs: a locked tab's reason reads here.
  if (phone && lockNote) note = lockNote;
  // A phone has no room for the description line: its first sentence sits beside START when nothing else needs the slot.
  if (phone && !note && !issue) note = mode.desc.split('. ')[0]!.replace(/\.$/, '');
  // A saved game waiting: Start asks first (Ranked's own confirmation already names it).
  if (savedRun && (mode.id === 'practice' || mode.id === 'gauntlet' || mode.id === 'learn')) {
    const go = onStart;
    onStart = () => setConfirmOverwrite(() => go);
  }

  // ── THE ONE FRIENDS LIST's Invite for this mode (shell/shellStore) ──
  const account = friendsAccount();
  const takesParty = mode.id === 'duos';
  const full = vh.row ? vh.seatsFree === 0 : members.length + (demo ? sampleInvites.length : 0) >= mode.slots;
  const takesFriends = takesParty || mode.party === 'rivals';
  const canInvite = !full && (!versusRoom || versusRoom.status === 'open') && (demo ? takesFriends : takesFriends && account && remoteEnabled() && !inGame);
  const memberIds = vh.row ? vh.memberIds : members.map((m) => m.userId).filter((x): x is string => !!x && x !== me);
  const sendRef = useRef<(f: Friend) => void>(() => undefined);
  sendRef.current = (f: Friend): void => {
    if (demo) { sfx.pulse(); addSampleInvite(f.userId); return; }
    if (mode.party === 'rivals') {
      // Versus: host the room (with the rules set here) if none is held, then invite into it.
      sfx.pulse();
      const vmode = mode.id === 'versus' ? 'duel' : mode.id === 'group' ? 'group' : 'duos';
      void (async () => {
        let r = useVersus.getState().room;
        if (!r || isDuosParty(r)) { await hostVersus({ v: 1, mode: vmode, modifiers: modifier ? [modifier] : [] } as VersusRoomOptions, hostName()); r = useVersus.getState().room; }
        if (r && !isDuosParty(r)) await inviteFriend(f.userId, 'versus_room', versusRoomRef(r));
      })();
      return;
    }
    if (!takesParty) return;
    sfx.pulse();
    void (async () => {
      let r = useVersus.getState().room;
      // THE PARTY OPENS ON THE FIRST INVITE: nothing is rated until START, which asks the ranked confirmation.
      if (!r || !isDuosParty(r)) { await enterDuosParty(defaultPartyName(playerName)); r = useVersus.getState().room; }
      if (r && isDuosParty(r)) await inviteFriend(f.userId, 'duos_party', versusRoomRef(r));
    })();
  };
  const inviteReason = vsDown && takesFriends ? downLine : full && takesFriends ? (takesParty ? 'Your party is full.' : 'Every seat is taken.')
    : takesFriends ? null
    : `${mode.label} is solo. Pick Ranked Duos to play with a friend.`;
  useEffect(() => {
    setPhInvite({ can: !!canInvite, reason: inviteReason, members: memberIds, modeLabel: mode.label, send: (f) => sendRef.current(f) });
  }, [canInvite, inviteReason, memberIds.join(','), mode.label]);
  useEffect(() => () => { setPhInvite(null); setFriendsOpen(false); }, []);
  // The drawer closes when the screen becomes the docked layout.
  useEffect(() => { if (!phone) setFriendsOpen(false); }, [phone]);
  // A fresh mode clears the open-seat note.
  useEffect(() => { setSeatNote(null); setMenuFor(null); setPickerOpen(false); setSideTab(partyModeOf(modeId).options ? 'settings' : 'friends'); }, [modeId]);
  // A Versus error belongs to the press that made it: a new mode, or leaving the party, starts clean.
  useEffect(() => { if (useVersus.getState().error) useVersus.setState({ error: null }); }, [modeId, inParty]);
  useEffect(() => { if (!demo) clearSampleInvites(); }, [demo]);
  // Esc closes an open card menu first (and only it).
  useEffect(() => {
    if (!menuFor) return undefined;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setMenuFor(null); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [menuFor]);

  // Back from a page: the stage replays its short entrance (transform / opacity), so the hop is never a hard cut.
  const [enterKey, setEnterKey] = useState(0);
  // PHONE: a mark at the end of the mode tabs while more wait off the edge.
  const modesRef = useRef<HTMLDivElement>(null);
  const [moreTabs, setMoreTabs] = useState(false);
  useEffect(() => {
    const row = modesRef.current?.querySelector('.phk-tabs');
    if (!row || !phone) { setMoreTabs(false); return undefined; }
    const on = (): void => setMoreTabs(row.scrollLeft + row.clientWidth < row.scrollWidth - 4);
    on();
    row.addEventListener('scroll', on, { passive: true });
    return () => row.removeEventListener('scroll', on);
  }, [phone, modes.length]);
  const wasPaged = useRef(pageOpen);
  useEffect(() => { if (wasPaged.current && !pageOpen) setEnterKey((k) => k + 1); wasPaged.current = pageOpen; }, [pageOpen]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [sideTab, setSideTab] = useState<'friends' | 'settings' | 'rooms'>(() => (mode.options ? 'settings' : 'friends'));
  const friendsOpen = usePhShell((s) => s.friendsOpen);
  const onOpenSeat = (): void => {
    sfx.pulse();
    // The picker always opens: it lists who you can invite, or says plainly why not (signed out, offline, full).
    setPickerOpen(true);
  };

  const pair = duosRoom ? partyPair(duosRoom) : null;
  const teamLabel = pair ? teamName ?? defaultTeamName(pair[0].name, pair[1].name) : demo && mode.id === 'duos' ? demoTeam ?? defaultTeamName(members[0]!.name, 'Mike') : null;

  const cardMenu = (m: Member): { label: string; run?: () => void; soon?: boolean }[] => (m.self
    ? [{ label: 'Change portrait', run: () => openAvatarPicker() }, { label: 'View Career', run: () => goTo('career') }]
    : [
        { label: 'Message', run: demo || !m.userId ? undefined : () => openDm(m.userId!) },
        ...(m.userId ? [{ label: 'View Career', run: () => goTo('career') }] : []),
      ].filter((it) => !!it.run));

  // The state strip: on the others' cards (yours only when in a game). Your card always keeps the empty strip: ONE foot
  // layout, so the name and medal never move when someone joins.
  const stateOf = (m: Member): 'show' | 'space' => (!m.self || m.state === 'in_game' ? 'show' : 'space');
  const cards: JSX.Element[] = members.map((m, i) => (
    <BannerCard key={m.key} m={m} i={i} phone={phone} leader={showLeader && m.leader} showState={stateOf(m)} rival={mode.party === 'rivals' && !m.self && mode.id !== 'vduos'}
      menuOpen={menuFor === m.key} onToggleMenu={() => { sfx.pulse(); setMenuFor((k) => (k === m.key ? null : m.key)); }}
      menu={cardMenu(m)} onPick={(run) => { sfx.pulse(); setMenuFor(null); run(); }} />
  ));
  const pending = demo ? sampleInvites.map((id) => sampleFriends().find((f) => f.userId === id)).filter((f): f is Friend => !!f) : [];
  for (let i = 0; i < open; i++) {
    const p = pending[i];
    cards.push(p
      ? <PhBanner key={`open-${i}`} index={members.length + i} className="pending" art={heroThumb(heroPortrait(p.favoriteHero, null))} label={`${p.author ?? 'Friend'}, invited`}
          overlay={<button type="button" className="ph-cancelinv" onClick={() => { sfx.pulse(); removeSampleInvite(p.userId); }}>Cancel</button>}>
          <PhBannerName>{p.author ?? 'Friend'}</PhBannerName>
          <span className="ph-rank"><span className="ph-muted">Invited</span></span>
          <span className="ph-sub">{'\u00a0'}</span>
          <PhBannerState tone="space" />
        </PhBanner>
      : <OpenSeat key={`open-${i}`} i={members.length + i} onOpen={onOpenSeat} pending={null} optional={mode.id === 'group' && members.length + i === 3} />);
  }
  // VERSUS DUOS: two pairs (your team, the rivals), split by the VS mark.
  const row: JSX.Element[] = mode.id === 'versus' && cards.length === 2
    ? [cards[0]!, <span key="vs" className="ph-vs" aria-hidden="true">VS</span>, cards[1]!]
    : mode.id === 'vduos' && cards.length === 4
    ? [
        <div key="a" className="ph-pair"><span className="ph-pairlbl mine">Your team</span><div className="ph-pairrow">{cards.slice(0, 2)}</div></div>,
        <span key="vs" className="ph-vs" aria-hidden="true">VS</span>,
        <div key="b" className="ph-pair"><span className="ph-pairlbl rival">Rivals</span><div className="ph-pairrow">{cards.slice(2)}</div></div>,
      ]
    : cards;

  const rule = versusRoom ? (versusRoom.options?.modifiers ?? [])[0] ?? null : modifier;
  const actions = (
    <div className="ph-actions">
      {vh.stands}
      <div className="ph-side">
        {vh.side}
        {inParty && !inGame && (
          <PhButton onClick={() => { sfx.pulse(); if (duosRoom) void leaveDuosParty(); else setPartyDemo(false); }}>Leave party</PhButton>
        )}
        {/* On a phone the saved game's Continue sits here (the head row stays slim). */}
        {phone && savedRun && !inParty && <PhButton size="s" variant="primary" className="ph-phonecontinue" onClick={() => { sfx.pulse(); continueRun(); }}>Continue</PhButton>}
      </div>
      <button type="button" className="ph-start" disabled={!startOk} onClick={() => { if (!startOk) return; sfx.pulse(); onStart(); }}>
        <span>{startLabel}</span>
      </button>
      <div className="ph-side ph-side-r">
        {/* On a phone the side panel is a drawer: the mode's settings are one press from START. */}
        {phone && mode.options && <PhButton size="s" onClick={() => { sfx.pulse(); setSideTab('settings'); setFriendsOpen(true); }}>{mode.id === 'practice' ? 'Practice' : mode.id === 'gauntlet' ? 'Stages' : 'Rules'}</PhButton>}
        {(note || issue) && (
          <span className="ph-notes" role="status">
            {note && <span className="ph-note">{note}</span>}
            {issue && <span className="ph-note ph-issue">{issue}</span>}
          </span>
        )}
      </div>
    </div>
  );
  // THE SIDE PANEL: Friends | the mode's settings. Picking a mode with settings opens its tab once; Friends is a press away.
  const settingsTitle = mode.id === 'practice' ? 'Practice' : mode.id === 'gauntlet' ? 'Gauntlet' : 'Rules';
  const settings = mode.options ? (
    <div className="ph-settings">
      {mode.id === 'practice' && <PracticePanel />}
      {mode.id === 'gauntlet' && <GauntletPanel selected={stage} onSelect={setStagePick} />}
      {mode.party === 'rivals' && <RoomRulesPanel room={versusRoom} me={me} modifier={modifier} onModifier={setModifier} name={roomName} onName={setRoomName}
        placeholder={hostName()} onBrowse={() => setSideTab('rooms')} />}
    </div>
  ) : null;
  const tab = settings ? sideTab : 'friends';
  const side = (
    <aside className={`ph-sidepanel${phone ? ' drawer' : ''}`} aria-label="Side panel">
      <div className="ph-sidetabs">
        <PhTabs label="Panel" value={tab} onChange={(t) => { sfx.pulse(); setSideTab(t); }}
          tabs={[{ id: 'friends' as const, label: 'Friends' }, ...(settings ? [{ id: 'settings' as const, label: <span className="ph-settab">{settingsTitle}</span> }] : []),
            ...(mode.party === 'rivals' ? [{ id: 'rooms' as const, label: 'Open rooms' }] : [])]} />
        {phone && <button type="button" className="ph-iconbtn ph-fclose" aria-label="Close" onClick={() => { sfx.pulse(); setFriendsOpen(false); }}><Icon name="chevron" /></button>}
      </div>
      {tab === 'friends' ? <PhFriends docked embedded /> : tab === 'rooms' ? <div className="ph-settings"><OpenRoomsPanel mode={roomModeOf({ v: 1, mode: mode.id === 'group' ? 'group' : mode.id === 'vduos' ? 'duos' : 'duel', modifiers: [] } as VersusRoomOptions)} /></div> : settings}
    </aside>
  );

  return (
    <div ref={rootRef} className={`ph${phone ? ' phone' : ''}${vh.dragging ? ' vsr-dragging' : ''}`} role="region" aria-label="Your party">
      <PhBackdrop />
      <PhTopNav current="home" friendsDocked={!phone} ownDrawer />

      <div ref={modesRef} className={`ph-modes${moreTabs ? ' more' : ''}`}>
        <PhTabs label="Mode" value={modeId} onChange={pick} onLocked={(_id, reason) => { sfx.deny(); setLockNote(reason); }} onLockedHover={setHoverNote}
          tabs={modes.map((m) => ({ id: m.id, label: <ModeLabel id={m.id} label={m.label} />, reason: lockReason(m) ?? undefined }))} />
        {/* A locked tab's reason takes the description's own line for a moment: it never covers the stage. */}
        <span className={`ph-desc${lockNote || hoverNote ? ' locked' : ''}`} role={lockNote ? 'status' : undefined}>{lockNote ?? hoverNote ?? mode.desc}</span>
      </div>

      <main className="ph-stage" key={enterKey}>
        {/* The head slot: always the same height (the team plate, a saved game, a held room), so the banners never move. */}
        <div className="ph-stagehead">
        {!teamLabel && mode.party === 'rivals' && (
          <div className="ph-team">
            <span className="ph-teamlbl">{versusRoom ? roomTitleOf(versusRoom.name, roomModeOf(versusRoom.options)) : 'Unranked room'}</span>
            <span className="ph-teamname">{rule ? versusRuleName(rule) : 'Usual rules'}</span>
          </div>
        )}
        {teamLabel && (
          <div className="ph-team">
            <span className="ph-teamlbl">Your team</span>
            <span className="ph-teamname">{teamLabel}</span>
            {!inGame && (duosRoom ? account : demo) && (
              <PhButton variant="plate" size="s" aria-label="Rename team" onClick={() => { sfx.pulse(); setNameOpen(true); }}>Rename</PhButton>
            )}
          </div>
        )}
        {savedRun && (
          <div className="ph-held">
            <div className="ph-heldrow">
              <span className="ph-heldtxt"><b>Saved game</b><span>{savedRunMode(savedRun)} · {titleContinueNote(savedRun.wave)}</span></span>
              <PhButton variant="primary" size="s" onClick={() => { sfx.pulse(); continueRun(); }}>Continue</PhButton>
            </div>
          </div>
        )}
        </div>
        <div className={`ph-cards n${slots}${mode.id === 'vduos' ? ' vs' : ''}`} key={mode.id}>{vh.row ?? row}</div>
        {actions}
      </main>

      {!phone && side}
      {phone && friendsOpen && <><div className="ph-fcatch" aria-hidden="true" onPointerDown={() => setFriendsOpen(false)} />{side}</>}

      {vh.layers}
      {menuFor && <div className="ph-menucatch" aria-hidden="true" onPointerDown={() => setMenuFor(null)} />}
      {pickerOpen && <InvitePicker onClose={() => setPickerOpen(false)} />}
      {nameOpen && duosRoom && <TeamNamePanel room={duosRoom} me={me} name={teamName} onSaved={setTeamName} onClose={() => setNameOpen(false)} />}
      {nameOpen && !duosRoom && demo && <SampleRename name={demoTeam} fallback={defaultTeamName(members[0]!.name, 'Mike')} onSave={(n) => { setDemoTeam(n || null); setNameOpen(false); }} onClose={() => setNameOpen(false)} />}
      {confirmOverwrite && savedRun && (
        <PhDialog label="Replace your saved game?" eyebrow="Saved game" title="Start a new game?" onClose={() => setConfirmOverwrite(null)}
          actions={<>
            <PhButton variant="primary" size="l" onClick={() => { sfx.pulse(); const go = confirmOverwrite; setConfirmOverwrite(null); go(); }}>Start new game</PhButton>
            <PhButton size="l" onClick={() => { sfx.pulse(); setConfirmOverwrite(null); }}>Keep it</PhButton>
          </>}>
          <p>{withAbandonWarning(`This replaces your saved game (${savedRunMode(savedRun)}, ${titleContinueNote(savedRun.wave)}).`, savedRun)}</p>
        </PhDialog>
      )}
      {duosRoom && <DuosResultOverlay />}
    </div>
  );
}

/** A mode tab's label: the mode's painted tile in the gilded emblem frame (the owner's medallion art), then its name. */
const MODE_TILE: Record<PartyModeId, string> = {
  ranked: 'lobby', duos: 'lobby', versus: 'versus', group: 'versus', vduos: 'versus', practice: 'practice', gauntlet: 'gauntlet', learn: 'learn',
};
function ModeLabel({ id, label }: { id: PartyModeId; label: string }): JSX.Element {
  const art = modeArt(MODE_TILE[id]);
  return (
    <span className="ph-modelbl">
      <span className="ph-emblem" aria-hidden="true">{art && <img src={art} alt="" draggable={false} decoding="sync" />}</span>
      <span>{phNum(label)}</span>
    </span>
  );
}

/** Versus: host a room, set its rules, then show the room screen. A failure stays on the home and says why. */
/** A Versus rule's name (the room's modifier). */
function versusRuleName(id: VersusModifierId): string { return versusModifierName(id); }

/** A saved run's mode, in player words. */
function savedRunMode(run: { mode?: string } | null | undefined): string {
  const m = run?.mode;
  return m === 'lobby' ? 'Ranked' : m === 'practice' ? 'Practice' : m === 'tutorial' ? 'Learn' : m === 'gauntlet' ? 'Gauntlet' : m === 'versus' ? 'Versus' : 'Game';
}

/** The sample party's Rename: a small window with the team name field (DEV, no server). */
const NAME_PROBLEM: Record<string, string> = {
  name_length: 'A team name is 2 to 16 characters.',
  name_chars: 'Use letters, numbers and single spaces only.',
};
/** The sample party's Rename: the server's own rule (teamNameProblem), Enter saves, an empty field keeps the default. */
function SampleRename({ name, fallback, onSave, onClose }: { name: string | null; fallback: string; onSave: (n: string) => void; onClose: () => void }): JSX.Element {
  const [v, setV] = useState(name ?? '');
  const problem = v.trim() ? teamNameProblem(v) : null;
  const save = (): void => { if (problem) return; sfx.pulse(); onSave(v.trim()); };
  return (
    <PhDialog label="Team name" title="Team name" onClose={onClose}
      actions={<>
        <PhButton variant="primary" size="l" disabled={!!problem} onClick={save}>Save</PhButton>
        <PhButton size="l" onClick={() => { sfx.pulse(); onClose(); }}>Cancel</PhButton>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <PhField label="Name" value={v} placeholder={fallback} maxLength={TEAM_NAME_MAX} autoFocus onChange={(e) => setV(e.target.value)}
          error={problem ? NAME_PROBLEM[problem] : undefined} hint="Leave it empty to use your two names. Either teammate can rename between games." />
      </form>
    </PhDialog>
  );
}

/** Open a Versus room behind this screen: the host seated, the rules set. Nothing navigates; the banner row IS the room. */
async function hostVersus(options: VersusRoomOptions, name: string): Promise<void> {
  await createRoom(name.slice(0, 40));
  if (!useVersus.getState().room) return;
  await setRoomOptions(options);
  await takeSeat('p1'); // the host sits in the first seat (a room opens with its host in the stands)
}

/** The invite picker an open seat opens: the online friends with Invite (the one friends list, in a window). */
function InvitePicker({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <PhDialog label="Invite a friend" title="Invite a friend" onClose={onClose}
      actions={<PhButton onClick={() => { sfx.pulse(); onClose(); }}>Done</PhButton>}>
      <div className="ph-picker"><PhFriends docked picker /></div>
    </PhDialog>
  );
}

/** A member's tall banner card: the portrait fading into navy, then name, medal, title or level, and (others) the state.
 *  Pressing it opens its small menu. */
function BannerCard({ m, i, phone, leader, showState, rival, menuOpen, onToggleMenu, menu, onPick }: {
  m: Member; i: number; phone: boolean; leader: boolean; showState: 'show' | 'space'; rival?: boolean; menuOpen: boolean; onToggleMenu: () => void;
  menu: { label: string; run?: () => void; soon?: boolean }[]; onPick: (run: () => void) => void;
}): JSX.Element {
  const art = phone ? heroThumb(m.art) : m.art;
  const overlay = menuOpen ? (
    <div className="ph-cardmenu" role="menu" aria-label={`${m.name} options`}>
      {menu.map((it) => (
        <button key={it.label} type="button" role="menuitem" className="ph-menuitem" disabled={!it.run}
          onClick={() => { if (it.run) onPick(it.run); }}>
          <span>{it.label}</span>{it.soon && <span className="ph-soon">Soon</span>}
        </button>
      ))}
    </div>
  ) : null;
  return (
    <PhBanner art={art} index={i} className={rival ? 'rival' : undefined} badge={leader ? <PhLeaderBadge /> : undefined} onClick={onToggleMenu} label={`${m.self ? 'You' : m.name}. Options`}
      haspopup expanded={menuOpen} overlay={overlay}>
            <PhBannerName>{m.name}</PhBannerName>
            <span className="ph-rank">
              {m.rank
                ? <><RankCrest divisionIndex={m.rank.divisionIndex} size="mini" hideDivision /><span>{m.rank.label}</span></>
                : <span className="ph-muted">{m.self ? 'Unranked' : 'Medal not shown'}</span>}
            </span>
            <span className="ph-sub">{m.titleId ? <TitleBadge id={m.titleId} className="ph-titlebadge" /> : m.level != null ? `Level ${m.level}` : '\u00a0'}</span>
            {showState === 'show' && <PhBannerState tone={m.state}>{m.state === 'in_game' ? 'In game' : 'Ready'}</PhBannerState>}
            {showState === 'space' && <PhBannerState tone="space" />}
    </PhBanner>
  );
}

/** An open seat: points at the friends list (invite from there). */
function OpenSeat({ i, onOpen, pending, optional }: { i: number; onOpen: () => void; pending: string | null; optional?: boolean }): JSX.Element {
  return (
    <PhBanner ghost index={i} onClick={onOpen} label="Open seat. Invite a friend from your friends list">
      <PhBannerInvite pending={pending} note={optional ? 'Optional seat' : undefined} />
    </PhBanner>
  );
}
