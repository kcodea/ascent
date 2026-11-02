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
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { levelProgress } from '@game/progression';
import { defaultTeamName, LEARN_ASCENT, type VersusModifierId, type VersusRoomOptions } from '@game/sim';
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
import { createRoom, enterDuosParty, isDuosParty, leaveDuosParty, leaveRoom, openVersus, setRoomOptions, startGame, takeSeat, useVersus } from '../versus/versusStore';
import { titleContinueNote } from '../titleTextConfig';
import { withAbandonWarning } from '../rank/ratedRun';
import { PhTopNav } from './shell/PhTopNav';
import { PhBackdrop } from './shell/PhBackdrop';
import { PhFriends } from './shell/PhFriends';
import { addSampleInvite, clearSampleInvites, pulseFriends, setFriendsOpen, setPhInvite, usePhShell } from './shell/shellStore';
import { PhButton, PhDialog, PhTabs, phNum } from './kit';
import { GauntletPanel, PracticePanel, VersusPanel, stagePlayable, useGauntletStages } from './ModeOptions';
import { partyModeOf, partyModes, readPartyMode, rememberPartyMode, type PartyMode, type PartyModeId } from './partyModes';
import { setPartyDemo, usePartyDemo } from './partyHomeFlag';
import { SAMPLE_MATE_ID, sampleFriends, sampleHeroes } from './sample';
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
  const lockReason = (m: PartyMode): string | null => {
    if (!inParty) return null;
    if (duosRoom) return m.id === 'duos' ? null : `Your party is queued for Ranked Duos. Leave the party to play ${m.label}.`;
    return m.party === 'solo' ? `${m.label} is solo. Leave the party to play it.` : null;
  };
  const [picked, setPicked] = useState<PartyModeId>(() => readPartyMode());
  const pickedMode = modes.find((m) => m.id === picked) ?? modes[0]!;
  const modeId: PartyModeId = lockReason(pickedMode) ? 'duos' : pickedMode.id;
  const mode = partyModeOf(modeId);
  const pick = (id: PartyModeId): void => { sfx.pulse(); setLockNote(null); setPicked(id); rememberPartyMode(id); };
  const [lockNote, setLockNote] = useState<string | null>(null);
  const slots = Math.max(mode.slots, members.length);
  const open = slots - members.length;

  // ── IN-PLACE OPTIONS (ModeOptions.tsx): the Gauntlet stage and the Versus modifier START reads ──
  const stages = useGauntletStages();
  const [stagePick, setStagePick] = useState<number | null>(null);
  const autoStage = stages.find((x) => x.state === 'available')?.n ?? stages.find((x) => stagePlayable(x.state))?.n ?? null;
  const stage = stagePick !== null && stagePlayable(stages[stagePick - 1]?.state ?? 'locked') ? stagePick : autoStage;
  const [modifier, setModifier] = useState<VersusModifierId | null>(null);
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
      // Host a room with the tab's mode and the picked modifier; the room screen opens only once the room exists.
      const vmode = mode.id === 'versus' ? 'duel' : mode.id === 'group' ? 'group' : 'duos';
      onStart = () => { void hostVersus({ v: 1, mode: vmode, modifiers: modifier ? [modifier] : [] } as VersusRoomOptions, playerName, mode.label); };
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

  if (savedRun && !note && (mode.id === 'practice' || mode.id === 'gauntlet' || mode.id === 'learn' || mode.id === 'ranked')) {
    note = withAbandonWarning('Start replaces your saved game.', savedRun);
  }

  // ── THE ONE FRIENDS LIST's Invite for this mode (shell/shellStore) ──
  const account = friendsAccount();
  const takesParty = mode.id === 'duos';
  const full = members.length + (demo ? sampleInvites.length : 0) >= mode.slots;
  const canInvite = !full && (demo ? takesParty || mode.party === 'team' : takesParty && account && remoteEnabled() && !inGame);
  const memberIds = members.map((m) => m.userId).filter((x): x is string => !!x && x !== me);
  const sendRef = useRef<(f: Friend) => void>(() => undefined);
  sendRef.current = (f: Friend): void => {
    if (demo) { sfx.pulse(); addSampleInvite(f.userId); return; }
    if (!takesParty) return;
    sfx.pulse();
    void (async () => {
      let r = useVersus.getState().room;
      // THE PARTY OPENS ON THE FIRST INVITE: nothing is rated until START, which asks the ranked confirmation.
      if (!r || !isDuosParty(r)) { await enterDuosParty(defaultPartyName(playerName)); r = useVersus.getState().room; }
      if (r && isDuosParty(r)) await inviteFriend(f.userId, 'duos_party', versusRoomRef(r));
    })();
  };
  const inviteReason = full && takesParty ? 'Your party is full.'
    : takesParty ? null
    : mode.party === 'rivals' ? 'Start hosts the room. Invite friends from it.' : `${mode.label} is solo. Pick Ranked Duos to play with a friend.`;
  useEffect(() => {
    setPhInvite({ can: !!canInvite, reason: inviteReason, members: memberIds, modeLabel: mode.label, send: (f) => sendRef.current(f) });
  }, [canInvite, inviteReason, memberIds.join(','), mode.label]);
  useEffect(() => () => { setPhInvite(null); setFriendsOpen(false); }, []);
  // The drawer closes when the screen becomes the docked layout.
  useEffect(() => { if (!phone) setFriendsOpen(false); }, [phone]);
  // A fresh mode clears the open-seat note.
  useEffect(() => { setSeatNote(null); setMenuFor(null); setPickerOpen(false); setSideTab(partyModeOf(modeId).options ? 'settings' : 'friends'); }, [modeId]);
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
  const wasPaged = useRef(pageOpen);
  useEffect(() => { if (wasPaged.current && !pageOpen) setEnterKey((k) => k + 1); wasPaged.current = pageOpen; }, [pageOpen]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [sideTab, setSideTab] = useState<'friends' | 'settings'>(() => (mode.options ? 'settings' : 'friends'));
  const friendsOpen = usePhShell((s) => s.friendsOpen);
  const onOpenSeat = (): void => {
    sfx.pulse();
    if (!demo && (!remoteEnabled() || !account)) { pulseFriends(phone); setSeatNote(remoteEnabled() ? 'Sign in to invite friends.' : 'Invites need the online service.'); return; }
    if (!canInvite) { pulseFriends(phone); setSeatNote(inviteReason); return; }
    setPickerOpen(true);
  };

  const pair = duosRoom ? partyPair(duosRoom) : null;
  const teamLabel = pair ? teamName ?? defaultTeamName(pair[0].name, pair[1].name) : demo && mode.id === 'duos' ? defaultTeamName(members[0]!.name, 'Mike') : null;

  const cardMenu = (m: Member): { label: string; run?: () => void; soon?: boolean }[] => (m.self
    ? [{ label: 'Change portrait', run: () => openAvatarPicker() }, { label: 'View Career', run: () => goTo('career') }]
    : [
        { label: 'Message', run: demo || !m.userId ? undefined : () => openDm(m.userId!) },
        ...(m.userId ? [{ label: 'View Career', run: () => goTo('career') }] : []),
      ].filter((it) => !!it.run));

  // The state strip: on the others' cards (yours only when in a game). In a party your card keeps an empty strip, so
  // every name and medal line sits at the same height across the cards.
  const stateOf = (m: Member): 'show' | 'space' | 'none' => (!m.self || m.state === 'in_game' ? 'show' : members.length > 1 ? 'space' : 'none');
  const cards: JSX.Element[] = members.map((m, i) => (
    <BannerCard key={m.key} m={m} i={i} phone={phone} leader={showLeader && m.leader} showState={stateOf(m)}
      menuOpen={menuFor === m.key} onToggleMenu={() => { sfx.pulse(); setMenuFor((k) => (k === m.key ? null : m.key)); }}
      menu={cardMenu(m)} onPick={(run) => { sfx.pulse(); setMenuFor(null); run(); }} />
  ));
  const pendingNames = demo ? sampleInvites.map((id) => sampleFriends().find((f) => f.userId === id)?.author ?? 'Friend') : [];
  for (let i = 0; i < open; i++) cards.push(<OpenSeat key={`open-${i}`} i={members.length + i} onOpen={onOpenSeat} pending={pendingNames[i] ?? null} />);
  // VERSUS DUOS: two pairs (your team, the rivals), split by the VS mark.
  const row: JSX.Element[] = mode.id === 'vduos' && cards.length === 4
    ? [
        <div key="a" className="ph-pair"><span className="ph-pairlbl mine">Your team</span><div className="ph-pairrow">{cards.slice(0, 2)}</div></div>,
        <span key="vs" className="ph-vs" aria-hidden="true">VS</span>,
        <div key="b" className="ph-pair"><span className="ph-pairlbl rival">Rivals</span><div className="ph-pairrow">{cards.slice(2)}</div></div>,
      ]
    : cards;

  const actions = (
    <div className="ph-actions">
      <div className="ph-side">
        {inParty && !inGame && (
          <PhButton onClick={() => { sfx.pulse(); if (duosRoom) void leaveDuosParty(); else setPartyDemo(false); }}>Leave party</PhButton>
        )}
      </div>
      <button type="button" className="ph-start" disabled={!startOk} onClick={() => { if (!startOk) return; sfx.pulse(); onStart(); }}>
        <span>{startLabel}</span>
      </button>
      <div className="ph-side ph-side-r">
        {/* On a phone the side panel is a drawer: the mode's settings are one press from START. */}
        {phone && mode.options && <PhButton size="s" onClick={() => { sfx.pulse(); setSideTab('settings'); setFriendsOpen(true); }}>{mode.id === 'practice' ? 'Practice' : mode.id === 'gauntlet' ? 'Stages' : 'Rules'}</PhButton>}
        {note && <span className="ph-note" role="status">{note}</span>}
      </div>
    </div>
  );
  // Browse rooms always opens the list (even with a room held: Return is on the home's plate).
  const browseRooms = (): void => { openVersus('versus'); useVersus.setState({ screen: 'browser' }); };

  // THE SIDE PANEL: Friends | the mode's settings. Picking a mode with settings opens its tab once; Friends is a press away.
  const settingsTitle = mode.id === 'practice' ? 'Practice' : mode.id === 'gauntlet' ? 'Gauntlet' : 'Room rules';
  const settings = mode.options ? (
    <div className="ph-settings">
      {mode.id === 'practice' && <PracticePanel />}
      {mode.id === 'gauntlet' && <GauntletPanel selected={stage} onSelect={setStagePick} />}
      {(mode.id === 'versus' || mode.id === 'group' || mode.id === 'vduos') && <VersusPanel modifier={modifier} onModifier={setModifier} onBrowse={browseRooms} />}
    </div>
  ) : null;
  const tab = settings ? sideTab : 'friends';
  const side = (
    <aside className={`ph-sidepanel${phone ? ' drawer' : ''}`} aria-label="Side panel">
      <div className="ph-sidetabs">
        <PhTabs label="Panel" value={tab} onChange={(t) => { sfx.pulse(); setSideTab(t); }}
          tabs={[{ id: 'friends' as const, label: 'Friends' }, ...(settings ? [{ id: 'settings' as const, label: <span className="ph-settab">{settingsTitle}{tab === 'friends' && <i className="ph-tabdot" aria-label="Has settings" />}</span> }] : [])]} />
        {phone && <button type="button" className="ph-iconbtn ph-fclose" aria-label="Close" onClick={() => { sfx.pulse(); setFriendsOpen(false); }}><Icon name="chevron" /></button>}
      </div>
      {tab === 'friends' ? <PhFriends docked embedded /> : settings}
    </aside>
  );

  return (
    <div className={`ph${phone ? ' phone' : ''}`} role="region" aria-label="Your party">
      <PhBackdrop />
      <PhTopNav current="home" friendsDocked={!phone} ownDrawer />

      <div className="ph-modes">
        <PhTabs label="Mode" value={modeId} onChange={pick} onLocked={(_id, reason) => { sfx.deny(); setLockNote(reason); }}
          tabs={modes.map((m) => ({ id: m.id, label: <ModeLabel id={m.id} label={m.label} />, reason: lockReason(m) ?? undefined }))} />
        <span className={`ph-desc${lockNote ? ' locked' : ''}`} role={lockNote ? 'status' : undefined}>{lockNote ?? mode.desc}</span>
      </div>

      <main className="ph-stage" key={enterKey}>
        {/* The head slot: always the same height (the team plate, a saved game, a held room), so the banners never move. */}
        <div className="ph-stagehead">
        {teamLabel && (
          <div className="ph-team">
            <span className="ph-teamlbl">Your team</span>
            <span className="ph-teamname">{teamLabel}</span>
            {!inGame && (duosRoom ? account : demo) && (
              <PhButton variant="plate" size="s" aria-label="Rename team" onClick={() => { sfx.pulse(); if (duosRoom) setNameOpen(true); }}>Rename</PhButton>
            )}
          </div>
        )}
        {(savedRun || versusRoom) && (
          <div className="ph-held">
            {savedRun && (
              <div className="ph-heldrow">
                <span className="ph-heldtxt"><b>Saved game</b><span>{titleContinueNote(savedRun.wave)}</span></span>
                <PhButton variant="primary" size="s" onClick={() => { sfx.pulse(); continueRun(); }}>Continue</PhButton>
              </div>
            )}
            {versusRoom && (
              <div className="ph-heldrow">
                <span className="ph-heldtxt"><b>In a Versus room</b><span>{versusRoom.name}</span></span>
                <PhButton variant="primary" size="s" onClick={() => { sfx.pulse(); openVersus('versus'); }}>Return</PhButton>
                <PhButton size="s" onClick={() => { sfx.pulse(); void leaveRoom(); }}>Leave</PhButton>
              </div>
            )}
          </div>
        )}
        </div>
        <div className={`ph-cards n${slots}${mode.id === 'vduos' ? ' vs' : ''}`} key={mode.id}>{row}</div>
        {actions}
        {vsError && <div className="ph-err" role="alert">{vsError}</div>}
      </main>

      {!phone && side}
      {phone && friendsOpen && <><div className="ph-fcatch" aria-hidden="true" onPointerDown={() => setFriendsOpen(false)} />{side}</>}

      {menuFor && <div className="ph-menucatch" aria-hidden="true" onPointerDown={() => setMenuFor(null)} />}
      {pickerOpen && <InvitePicker onClose={() => setPickerOpen(false)} />}
      {nameOpen && duosRoom && <TeamNamePanel room={duosRoom} me={me} name={teamName} onSaved={setTeamName} onClose={() => setNameOpen(false)} />}
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
async function hostVersus(options: VersusRoomOptions, playerName: string, modeLabel: string): Promise<void> {
  const who = playerName.trim();
  await createRoom((who ? `${who}'s ${modeLabel}` : modeLabel).slice(0, 40));
  if (!useVersus.getState().room) return;
  await setRoomOptions(options);
  await takeSeat('p1'); // the host sits in the first seat (a room opens with its host in the stands)
  openVersus('versus');
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
function BannerCard({ m, i, phone, leader, showState, menuOpen, onToggleMenu, menu, onPick }: {
  m: Member; i: number; phone: boolean; leader: boolean; showState: 'show' | 'space' | 'none'; menuOpen: boolean; onToggleMenu: () => void;
  menu: { label: string; run?: () => void; soon?: boolean }[]; onPick: (run: () => void) => void;
}): JSX.Element {
  const art = phone ? heroThumb(m.art) : m.art;
  return (
    <div className={`ph-cardwrap${menuOpen ? ' menu' : ''}`} style={{ '--i': i } as CSSProperties}>
      <span className="ph-bfoot" aria-hidden="true" />
      <button type="button" className="ph-card" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`${m.self ? 'You' : m.name}. Options`} onClick={onToggleMenu}>
        <span className="ph-card-in">
          {art && <img className="ph-art" src={art} alt="" draggable={false} decoding="sync" />}
          {leader && <span className="ph-lead"><Icon name="crown" /><span>Leader</span></span>}
          <span className="ph-foot">
            <span className="ph-name">{m.name}</span>
            <span className="ph-rank">
              {m.rank
                ? <><RankCrest divisionIndex={m.rank.divisionIndex} size="mini" hideDivision /><span>{m.rank.label}</span></>
                : <span className="ph-muted">{m.self ? 'Unranked' : 'Medal not shown'}</span>}
            </span>
            {(m.titleId || m.level != null) && (
              <span className="ph-sub">{m.titleId ? <TitleBadge id={m.titleId} className="ph-titlebadge" /> : `Level ${m.level}`}</span>
            )}
            {showState === 'show' && <span className={`ph-state s-${m.state}`}>{m.state === 'in_game' ? 'In game' : 'Ready'}</span>}
            {showState === 'space' && <span className="ph-state s-space" aria-hidden="true">&nbsp;</span>}
          </span>
        </span>
      </button>
      <span className="ph-rod" aria-hidden="true" />
      {menuOpen && (
        <div className="ph-cardmenu" role="menu" aria-label={`${m.name} options`}>
          {menu.map((it) => (
            <button key={it.label} type="button" role="menuitem" className="ph-menuitem" disabled={!it.run}
              onClick={() => { if (it.run) onPick(it.run); }}>
              <span>{it.label}</span>{it.soon && <span className="ph-soon">Soon</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** An open seat: points at the friends list (invite from there). */
function OpenSeat({ i, onOpen, pending }: { i: number; onOpen: () => void; pending: string | null }): JSX.Element {
  return (
    <div className="ph-cardwrap open" style={{ '--i': i } as CSSProperties}>
      <span className="ph-bfoot" aria-hidden="true" />
      <button type="button" className="ph-card ph-open" onClick={onOpen} aria-label="Open seat. Invite a friend from your friends list">
        <span className="ph-card-in">
          {pending
            ? <><span className="ph-openlbl">Invited</span><span className="ph-opensub">{pending}</span><span className="ph-opensub">Waiting for an answer</span></>
            : <><span className="ph-invmed" aria-hidden="true"><span>+</span></span><span className="ph-openlbl">Invite</span></>}
        </span>
      </button>
      <span className="ph-rod" aria-hidden="true" />
    </div>
  );
}
