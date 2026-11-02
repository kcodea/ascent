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
 *  - UNDER IT: the mode tabs and one line on the picked mode. A mode sets the party's seats and what START does.
 *  - CENTRE: one tall banner card per member (chosen portrait, name, title, medal, Ready / In game), you first; an open
 *    seat per free slot opens the friends list.
 *  - BOTTOM CENTRE: START, the one strong accent. Ranked modes ask the ranked confirmation first (R-RANK-06, moved here
 *    from the Play card). Leave party beside it while you are in one.
 *  - RIGHT: the friends list, docked, one click to invite (Ranked Duos). A drawer on a phone.
 *
 * WIRED: every nav tab (the real pages), every mode's START (the real flows), Ranked Duos end to end (the party opens on
 * the first invite, the friend invite, the teammate's card, the team name + Rename, Start for the leader, Leave party,
 * the post-game result). STUBBED (said on screen where it matters): Ready is "seated" (the server has no ready flag
 * before a game), a teammate's medal is not read, and the Versus modes' START opens the existing Versus rooms.
 *
 * PERFORMANCE: static paint; motion is one-shot transform / opacity (the cards rise in, hover lifts). At most four
 * portraits; on a phone they are the 256 px thumbnails (`heroThumb`). The citadel backdrop is a 960 px pre-blurred file.
 */
import { useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { levelProgress } from '@game/progression';
import { defaultTeamName, LEARN_ASCENT, type VersusModifierId, type VersusRoomOptions } from '@game/sim';
import { AVATAR_ART, avatarSrc, heroThumb } from '../art';
import { isPhone } from '../deviceClass';
import { Icon } from '../Icon';
import { currentUserId } from '../identity';
import { MenuBackdrop } from '../MenuBackdrop';
import { MenuMedal } from '../menuIcons';
import { mirrorFor, useProgression } from '../progression/progressionStore';
import { RankCrest } from '../rank/RankBar';
import { useCurrentRank } from '../rank/rankSource';
import { rankLabel } from '../rank/rankFormat';
import { remoteEnabled } from '../remoteBoards';
import { heroPortrait, opponentSkins } from '../skins/skins';
import { sfx } from '../sfx';
import { tempHandle, useGame } from '../store';
import { TitleBadge } from '../titles/TitleBadge';
import { cardSkins, handleOf, sortFriends, statusText } from '../friends/friendBits';
import { addFriendByHandle, friendsAccount, inviteFriend, useFriends, useFriendsListLoop } from '../friends/friendsStore';
import type { Friend } from '../friends/friendsRemote';
import { liveFriends, useDm } from '../friends/dm/dmStore';
import { openDm } from '../friends/dock/dockStore';
import { DuosResultOverlay, TeamNamePanel, partyPair, usePartyTeamName } from '../versus/DuosParty';
import { defaultPartyName } from '../versus/playParty';
import { versusEnabled } from '../versus/versusFlag';
import { versusRoomRef } from '../versus/versusRemote';
import { playerCardArt, seatCardSource, useSeatData } from '../versus/versusSeatCard';
import { createRoom, enterDuosParty, isDuosParty, leaveDuosParty, openVersus, setRoomOptions, startGame, useVersus } from '../versus/versusStore';
import { GauntletPanel, PracticePanel, VersusPanel, stagePlayable, useGauntletStages } from './ModeOptions';
import { PhTopNav } from './shell/PhTopNav';
import { PhButton, PhEmpty, PhRow, PhSection, PhTabs } from './kit';
import { partyModeOf, partyModes, readPartyMode, rememberPartyMode, type PartyModeId } from './partyModes';
import { usePartyBackdrop, usePartyDemo } from './partyHomeFlag';
import './partyHome.css';

/** The citadel backdrop: the title's art, pre-blurred and darkened at build time (960 x 540; a blur needs no more). */
const CITADEL_BLUR = `${import.meta.env.BASE_URL}backdrops/citadel-blur.webp`;

/** One banner card's contents. */
interface Member {
  key: string;
  self: boolean;
  name: string;
  art: string | undefined;
  titleId: string | null;
  /** Your own medal only (a teammate's is not read yet: a stub). */
  rank: ReturnType<typeof useCurrentRank>;
  level: number | null;
  /** Another player in a Versus mode: an opponent, not a teammate (the rail's foe red). */
  rival: boolean;
  state: 'ready' | 'in_game';
  leader: boolean;
}

export interface PartyHomeProps {
  /** A ranked START: the title's nudge + ranked confirmation (R-RANK-06). `then` runs on "Yes" instead of the default. */
  onRankedStart: (kind: 'solo' | 'duos', then?: () => void) => void;
}

/** The sample party's faces (DEV only): bundled hero portraits. */
function sampleHeroes(): string[] {
  return AVATAR_ART.filter((a) => a.kind === 'hero').slice(3, 9).map((a) => a.key);
}

/** Sample friends for the DEV sample party (no backend needed). */
function sampleFriends(): Friend[] {
  const heroes = sampleHeroes();
  const mk = (i: number, name: string, status: Friend['status'], mode: string | null = null): Friend => ({
    userId: `sample-${i}`, author: name, discriminator: String(1000 + i * 37), avatar: null, favoriteHero: heroes[i % heroes.length] ?? null,
    frame: null, skin: null, status, mode, lastSeen: status === 'offline' ? new Date(Date.now() - 3_600_000 * (i + 1)).toISOString() : null,
  });
  return [mk(1, 'Mike', 'online'), mk(2, 'Brisbane', 'in_game', 'ranked'), mk(3, 'Coran', 'online'), mk(4, 'Tamby', 'in_game', 'versus_1v1'), mk(5, 'Fibbsy', 'offline'), mk(6, 'Neptus', 'offline')];
}

export default function PartyHome({ onRankedStart }: PartyHomeProps) {
  const confirmPracticeSetup = useGame((s) => s.confirmPracticeSetup);
  const startGauntlet = useGame((s) => s.startGauntlet);
  const startTutorial = useGame((s) => s.startTutorial);
  const startSceneBuilder = useGame((s) => s.startSceneBuilder);
  const playerName = useGame((s) => s.playerName);
  const playerAvatar = useGame((s) => s.playerAvatar);
  const showOpp = useGame((s) => s.showOpponentSkins);
  const userId = useGame((s) => s.account.userId);
  const me = currentUserId();
  const rank = useCurrentRank();
  const progressionOn = useProgression((s) => s.capability === 'on');
  const mirror = useProgression((s) => mirrorFor(userId, s.mirror));
  const lv = progressionOn && mirror ? levelProgress(mirror.accountXp) : null;
  const demo = usePartyDemo();
  const backdrop = usePartyBackdrop();
  const phone = isPhone();

  // THE PARTY: a Ranked Duos room is the only server-side party today.
  const room = useVersus((s) => s.room);
  const vsError = useVersus((s) => s.error);
  const duosRoom = room && isDuosParty(room) ? room : null;

  const modes = useMemo(() => partyModes({ versus: versusEnabled(), dev: import.meta.env.DEV }), []);
  const [picked, setPicked] = useState<PartyModeId>(() => readPartyMode());
  // In a party, its mode is the party's (switching would leave your teammate behind: a production question, stubbed).
  const modeId: PartyModeId = duosRoom ? 'duos' : modes.some((m) => m.id === picked) ? picked : 'ranked';
  const mode = partyModeOf(modeId);
  const pick = (id: PartyModeId): void => { sfx.pulse(); setPicked(id); rememberPartyMode(id); };

  // IN-PLACE OPTIONS (ModeOptions.tsx): the Gauntlet stage and the Versus modifier START reads (Practice's live in the
  // store's persisted draft).
  const stages = useGauntletStages();
  const [stagePick, setStagePick] = useState<number | null>(null);
  const autoStage = stages.find((x) => x.state === 'available')?.n ?? stages.find((x) => stagePlayable(x.state))?.n ?? null;
  const stage = stagePick !== null && stagePlayable(stages[stagePick - 1]?.state ?? 'locked') ? stagePick : autoStage;
  const [modifier, setModifier] = useState<VersusModifierId | null>(null);

  const [friendsOpen, setFriendsOpen] = useState(false); // the phone's drawer (desktop: always docked)
  const [nameOpen, setNameOpen] = useState(false);
  const [teamName, setTeamName] = usePartyTeamName(duosRoom);
  const seated = duosRoom ? duosRoom.members.filter((m) => m.role === 'p1' || m.role === 'p2') : [];
  const seatIds = seated.map((m) => m.userId);
  const seatData = useSeatData(seatIds, `${seatIds.join(',')}|${duosRoom?.status ?? ''}`);

  // ── the members: you first ──
  const host = duosRoom ? duosRoom.host_user_id === me : true;
  const inGame = duosRoom?.status === 'in_game';
  const members: Member[] = [{
    key: 'self', self: true, name: playerName || tempHandle(userId), art: playerCardArt({ avatar: playerAvatar ?? null, favoriteHero: null, cosmetics: null }),
    titleId: mirror?.equippedTitleId ?? null, rank, level: lv?.level ?? null, rival: false, state: inGame ? 'in_game' : 'ready', leader: host,
  }];
  if (duosRoom) {
    for (const m of seated) {
      if (m.userId === me) continue;
      const src = seatCardSource({ member: m, own: false, showOpp, server: seatData.get(m.userId) });
      members.push({ key: m.userId, self: false, name: src.name, art: playerCardArt(src), titleId: src.titleId, rank: null, level: null, rival: false,
        state: inGame ? 'in_game' : 'ready', leader: duosRoom.host_user_id === m.userId });
    }
  } else if (demo && mode.slots > 1) {
    members.push({ key: 'sample-mate', self: false, name: 'Mike', art: heroPortrait(sampleHeroes()[0], null), titleId: null, rank: null, level: 12,
      rival: mode.party === 'rivals', state: 'ready', leader: false });
  }
  const showLeader = members.length > 1;
  const slots = Math.max(mode.slots, members.length);
  const open = slots - members.length;

  // ── START ──
  let startLabel = 'Start';
  let note: string | null = mode.stub ?? null;
  let startOk = true;
  let onStart: () => void = () => undefined;
  switch (mode.id) {
    case 'ranked': onStart = () => onRankedStart('solo'); break;
    case 'duos':
      if (demo && !duosRoom) { note = 'Sample party. Start does nothing.'; break; }
      if (inGame) { startOk = false; startLabel = 'In game'; break; }
      if (!duosRoom || members.length < 2) { startOk = false; note = 'Invite a teammate to start.'; break; }
      if (!host) { startOk = false; startLabel = 'Waiting'; note = 'Your party leader starts the game.'; break; }
      onStart = () => onRankedStart('duos', () => { void startGame(); });
      break;
    case 'versus': case 'group': case 'vduos': {
      // Host a room with the tab's mode and the picked modifier (the Versus room screen takes it from there).
      const vmode = mode.id === 'versus' ? 'duel' : mode.id === 'group' ? 'group' : 'duos';
      onStart = () => { void hostVersus({ v: 1, mode: vmode, modifiers: modifier ? [modifier] : [] } as VersusRoomOptions, playerName); };
      break;
    }
    case 'practice':
      // The options are set in place: straight to the hero picker with them (the title hides as the picker opens).
      onStart = () => { useGame.setState({ showTitle: false, avatarPickerOpen: false }); confirmPracticeSetup(); };
      break;
    case 'gauntlet':
      if (stage === null) { startOk = false; note = 'No stage is open yet.'; break; }
      note = `Stage ${stage}${stages[stage - 1]?.stage ? `: ${stages[stage - 1]!.stage!.name}` : ''}`;
      onStart = () => startGauntlet(stage);
      break;
    case 'learn': onStart = () => startTutorial(LEARN_ASCENT); break;
    case 'scene': onStart = () => startSceneBuilder(); break;
  }

  // ── inviting (Ranked Duos): the party opens on the first invite; nothing is rated until START, which asks ──
  const invite = async (f: Friend): Promise<void> => {
    if (mode.id !== 'duos' || demo) return;
    sfx.pulse();
    let r = useVersus.getState().room;
    if (!r || !isDuosParty(r)) { await enterDuosParty(defaultPartyName(playerName)); r = useVersus.getState().room; }
    if (r && isDuosParty(r)) await inviteFriend(f.userId, 'duos_party', versusRoomRef(r));
  };
  const canInvite = (mode.id === 'duos' && friendsAccount() && !inGame) || demo;

  const pair = duosRoom ? partyPair(duosRoom) : null;
  const teamLabel = pair ? teamName ?? defaultTeamName(pair[0].name, pair[1].name) : null;

  return (
    <div className={`ph bd-${backdrop}`} role="region" aria-label="Your party">
      {backdrop === 'hall'
        ? <MenuBackdrop screen="modes" />
        : <div className="ph-citadel" style={{ backgroundImage: `url(${CITADEL_BLUR})` }} aria-hidden="true" />}
      <div className="ph-veil" aria-hidden="true" />

      <PhTopNav current="home" extra={phone ? (
        <button type="button" className={`ph-iconbtn${friendsOpen ? ' on' : ''}`} aria-label="Friends" aria-expanded={friendsOpen} onClick={() => { sfx.pulse(); setFriendsOpen((v) => !v); }}>
          <MenuMedal name="friends" className="menumedal ph-navicon" />
        </button>
      ) : undefined} />

      <div className="ph-modes">
        <PhTabs label="Mode" value={modeId} onChange={pick}
          tabs={modes.map((m) => ({ id: m.id, label: m.label, disabled: !!duosRoom && m.id !== 'duos' }))} />
        <span className="ph-desc">{mode.desc}</span>
      </div>

      <main className="ph-stage">
        {teamLabel && (
          <div className="ph-team">
            <span className="ph-teamlbl">Your team</span>
            <span className="ph-teamname">{teamLabel}</span>
            {!inGame && friendsAccount() && <PhButton variant="ghost" size="s" onClick={() => { sfx.pulse(); setNameOpen(true); }}>Rename</PhButton>}
          </div>
        )}
        <div className={`ph-body${mode.options ? ' has-opts' : ''}`}>
          <div className={`ph-cards n${slots}`} key={mode.id}>
            {members.map((m, i) => <BannerCard key={m.key} m={m} i={i} phone={phone} leader={showLeader && m.leader} />)}
            {Array.from({ length: open }, (_, i) => (
              <OpenSeat key={`open-${i}`} i={members.length + i} rival={mode.party === 'rivals'} onOpen={() => { sfx.pulse(); setFriendsOpen(true); }} />
            ))}
          </div>
          {mode.options && (
            <PhSection className="ph-opts" title={mode.id === 'gauntlet' ? 'Pick a stage' : mode.id === 'practice' ? 'Practice setup' : 'Room rules'} key={`o-${mode.id}`}>
              {mode.id === 'practice' && <PracticePanel />}
              {mode.id === 'gauntlet' && <GauntletPanel selected={stage} onSelect={setStagePick} />}
              {(mode.id === 'versus' || mode.id === 'group' || mode.id === 'vduos') && <VersusPanel modifier={modifier} onModifier={setModifier} onBrowse={() => openVersus()} />}
            </PhSection>
          )}
        </div>
        <div className="ph-actions">
          <div className="ph-side">
            {duosRoom && !inGame && <PhButton onClick={() => { sfx.pulse(); void leaveDuosParty(); }}>Leave party</PhButton>}
          </div>
          <button type="button" className="ph-start" disabled={!startOk} onClick={() => { if (!startOk) return; sfx.pulse(); onStart(); }}>
            <span>{startLabel}</span>
          </button>
          <div className="ph-side ph-side-r">{note && <span className="ph-note">{note}</span>}</div>
        </div>
        {vsError && <div className="ph-error" role="alert">{vsError}</div>}
      </main>

      {(!phone || friendsOpen) && (
        <FriendsColumn phone={phone} demo={demo} canInvite={canInvite} modeLabel={mode.label}
          onInvite={(f) => { void invite(f); }} onClose={() => setFriendsOpen(false)} />
      )}

      {nameOpen && duosRoom && <TeamNamePanel room={duosRoom} me={me} name={teamName} onSaved={setTeamName} onClose={() => setNameOpen(false)} />}
      {duosRoom && <DuosResultOverlay />}
    </div>
  );
}

/** Versus: open the rooms area, host a room, then set its rules (the room screen takes over). */
async function hostVersus(options: VersusRoomOptions, playerName: string): Promise<void> {
  openVersus('versus');
  await createRoom(defaultPartyName(playerName).replace(/party$/, 'room'));
  if (useVersus.getState().room) await setRoomOptions(options);
}

/** A member's tall banner card: the portrait fading into navy, then name, title, medal and state at the foot. */
function BannerCard({ m, i, phone, leader }: { m: Member; i: number; phone: boolean; leader: boolean }): JSX.Element {
  const art = phone ? heroThumb(m.art) : m.art;
  return (
    <div className={`ph-card${m.rival ? ' rival' : ''}`} style={{ '--i': i } as CSSProperties}>
      <div className="ph-card-in">
        {art && <img className="ph-art" src={art} alt="" draggable={false} decoding="sync" />}
        {leader && <span className="ph-lead" aria-label="Party leader"><Icon name="crown" /></span>}
        <div className="ph-foot">
          <span className="ph-name">{m.name}</span>
          <span className="ph-sub">
            {m.titleId ? <TitleBadge id={m.titleId} className="ph-titlebadge" /> : m.level != null ? `Level ${m.level}` : null}
          </span>
          <span className="ph-rank">
            {m.rank && <><RankCrest divisionIndex={m.rank.divisionIndex} size="mini" hideDivision /><span>{rankLabel(m.rank)}</span></>}
          </span>
          <span className={`ph-state s-${m.state}`}>{m.state === 'in_game' ? 'In game' : 'Ready'}</span>
        </div>
      </div>
    </div>
  );
}

/** An open seat: press to open the friends list (invite from there). */
function OpenSeat({ i, rival, onOpen }: { i: number; rival: boolean; onOpen: () => void }): JSX.Element {
  return (
    <button type="button" className="ph-card ph-open" style={{ '--i': i } as CSSProperties} onClick={onOpen}
      aria-label={rival ? 'Open seat. Invite a friend to play against' : 'Open seat. Invite a friend'}>
      <span className="ph-card-in">
        <span className="ph-plus" aria-hidden="true">+</span>
        <span className="ph-openlbl">Invite</span>
      </span>
    </button>
  );
}

/** The docked friends list: rail slices (kit `PhRow`), portrait bleeding in from the right, one-click Invite. */
function FriendsColumn({ phone, demo, canInvite, modeLabel, onInvite, onClose }: {
  phone: boolean; demo: boolean; canInvite: boolean; modeLabel: string; onInvite: (f: Friend) => void; onClose: () => void;
}): JSX.Element {
  const account = friendsAccount();
  const live = remoteEnabled() && account && !demo;
  useFriendsListLoop(live);
  const list = useFriends((s) => s.list);
  const failed = useFriends((s) => s.listFailed);
  const flash = useFriends((s) => s.flash);
  const busy = useFriends((s) => Object.keys(s.busy).some((k) => k.startsWith('invite:')));
  const peers = useDm((s) => s.peers);
  const sent = useFriends((s) => s.list?.sent ?? null);
  const room = useVersus((s) => s.room);
  const showOpp = useGame((s) => s.showOpponentSkins);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  const friends = useMemo(() => (demo ? sampleFriends() : sortFriends(liveFriends(list?.friends, peers) ?? [])), [demo, list, peers]);
  const online = friends.filter((f) => f.status !== 'offline').length;
  const target = room && isDuosParty(room) ? versusRoomRef(room) : null;

  let body: JSX.Element;
  if (!demo && !remoteEnabled()) body = <PhEmpty title="Friends are offline" sub="The online service is not connected on this build." />;
  else if (!demo && !account) body = <PhEmpty title="Sign in to add friends" sub="Friends need a saved account." action={<PhButton variant="primary" onClick={() => { sfx.pulse(); openAccountPanel(); }}>Sign in</PhButton>} />;
  else if (!demo && !list) body = <PhEmpty title={failed ? 'Friends are not available right now' : 'Finding your friends'} />;
  else if (friends.length === 0) body = <PhEmpty title="No friends yet" sub="Add one by name and tag, like Name#1234." />;
  else {
    body = (
      <div className="ph-frows" role="list">
        {friends.map((f) => {
          const s = target ? sent?.find((x) => x.to === f.userId && x.target === target) : undefined;
          const label = s?.status === 'pending' ? 'Invited' : s?.status === 'accepted' ? 'Joined' : s?.status === 'declined' ? 'Declined' : 'Invite';
          const art = heroThumb((showOpp ? avatarSrc(f.avatar) : undefined) ?? heroPortrait(f.favoriteHero, opponentSkins(showOpp, cardSkins(f))));
          return (
            <PhRow key={f.userId} className={`ph-friend f-${f.status}`} art={art} title={f.author ?? handleOf(f)}
              sub={<span className="ph-fstatus"><i aria-hidden="true" />{statusText(f)}</span>}
              onClick={demo ? undefined : () => { sfx.pulse(); openDm(f.userId); }} label={`Message ${handleOf(f)}`}
              right={canInvite && f.status === 'online' ? (
                <PhButton variant="primary" size="s" disabled={busy || s?.status === 'pending' || s?.status === 'accepted'}
                  aria-label={`Invite ${handleOf(f)} to ${modeLabel}`} onClick={() => onInvite(f)}>{label}</PhButton>
              ) : undefined} />
          );
        })}
      </div>
    );
  }

  return (
    <aside className={`ph-friends${phone ? ' drawer' : ''}`} aria-label="Friends">
      <div className="ph-fhead">
        <span className="ph-ftitle">Friends</span>
        <span className="ph-fcount">{online} online</span>
        {phone && <button type="button" className="ph-iconbtn ph-fclose" aria-label="Close friends" onClick={() => { sfx.pulse(); onClose(); }}><Icon name="chevron" /></button>}
      </div>
      {(live || demo) && <AddFriend disabled={demo} />}
      {flash && !demo && <div className="ph-fflash" role="status">{flash}</div>}
      {body}
    </aside>
  );
}

function AddFriend({ disabled }: { disabled: boolean }): JSX.Element {
  const [h, setH] = useState('');
  const busy = useFriends((s) => Object.keys(s.busy).some((k) => k.startsWith('handle:')));
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (disabled || !h.trim() || busy) return;
    sfx.pulse();
    void addFriendByHandle(h).then((ok) => { if (ok) setH(''); });
  };
  return (
    <form className="ph-fadd" onSubmit={submit}>
      <input className="ph-finput" value={h} onChange={(e) => setH(e.target.value)} placeholder="Name#1234"
        aria-label="Add a friend by name and tag" maxLength={45} spellCheck={false} autoComplete="off" disabled={disabled} />
      <PhButton type="submit" disabled={disabled || busy || !h.trim()}>Add</PhButton>
    </form>
  );
}
