/**
 * THE PARTY HOME, A PROTOTYPE (owner 2026-11-02, DEV only behind the "Party home (prototype)" switch; see partyHomeFlag.ts).
 *
 * Owner: "can you take inspiration from valorant's party view for our lobby and our duo's party view? should the play
 * button take you into a party screen where you select your mode (solo/duo) from there? then starting the game from that
 * screen even as a solo?" and "im wondering if we should have our main screen be this instead, with big cards with your
 * chosen portrait art like in valorant front and center, with the tabs for career etc at the top, then allowing the
 * player to invite from there". Style direction (same day): the Docked lobby rail (lobbyRailDocked.css + the shared
 * `--pill-*` tokens): navy plates, thin gold edges, clean-cut slices, art fading into navy, big white title-font names.
 *
 * THE SCREEN IS YOUR PARTY:
 *  - TOP: the nav bar (the menu sidebar's destinations, as tabs) with Aether and your level on the right.
 *  - UNDER IT: the mode tabs. A mode sets how many banner cards show and what START does.
 *  - CENTRE: one tall banner card per member (your chosen portrait, name, title, medal, Ready / In game), and an open
 *    seat per free slot that opens the friends list.
 *  - BOTTOM CENTRE: START, the one strong accent. Ranked modes ask the ranked confirmation first (R-RANK-06, moved here
 *    from the Play card). Leave party beside it while you are in one.
 *  - RIGHT: the friends list, docked, one click to invite (Ranked Duos).
 *
 * WIRED: every nav tab (the real pages), every mode's START (the real flows), Ranked Duos end to end (opening the party
 * on the first invite, the friend invite, the teammate's card, the team name + Rename, Start for the leader, Leave party,
 * the post-game result). STUBBED (labelled on screen): Ready is "seated" (the server has no ready flag before a game), a
 * teammate's medal is not read, and the Versus modes' START opens the existing Versus rooms instead of seating the party.
 *
 * PERFORMANCE: static paint; the only motion is one-shot transform / opacity (the cards' entrance, hover lifts). At most
 * four portraits; on a phone they are the 256 px thumbnails (`heroThumb`).
 */
import { useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { levelProgress } from '@game/progression';
import { defaultTeamName } from '@game/sim';
import { AVATAR_ART, avatarSrc, heroThumb } from '../art';
import { isPhone } from '../deviceClass';
import { Icon } from '../Icon';
import { currentUserId } from '../identity';
import { MenuBackdrop } from '../MenuBackdrop';
import { MenuMedal, type MenuMedalName } from '../menuIcons';
import { TITLE_LOGO_SRC } from '../AscentLogo';
import { AetherIcon } from '../progression/AetherIcon';
import { aetherVisible, cratesVisible, mirrorFor, useProgression } from '../progression/progressionStore';
import { useHasNewRewards } from '../progression/NewRewardsPopup';
import { RankCrest } from '../rank/RankBar';
import { useCurrentRank } from '../rank/rankSource';
import { rankLabel } from '../rank/rankFormat';
import { remoteEnabled } from '../remoteBoards';
import { heroPortrait, opponentSkins } from '../skins/skins';
import { sfx } from '../sfx';
import { tempHandle, useGame, type MenuDest } from '../store';
import { TitleBadge } from '../titles/TitleBadge';
import { getTitleText } from '../titleTextConfig';
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
import { enterDuosParty, isDuosParty, leaveDuosParty, openVersus, startGame, useVersus } from '../versus/versusStore';
import { partyModeOf, partyModes, readPartyMode, rememberPartyMode, type PartyMode, type PartyModeId } from './partyModes';
import { setPartyDemo, usePartyDemo } from './partyHomeFlag';
import './partyHome.css';

/** One banner card's contents. */
interface Member {
  key: string;
  self: boolean;
  name: string;
  art: string | undefined;
  titleId: string | null;
  /** Your own medal only (a teammate's is not read yet: a stub). */
  rank: ReturnType<typeof useCurrentRank>;
  /** Another player in a Versus mode: an opponent, not a teammate (the rail's foe red). */
  rival: boolean;
  level: number | null;
  state: 'ready' | 'in_game' | 'waiting';
  leader: boolean;
}

export interface PartyHomeProps {
  onSettings: () => void;
  /** A ranked START: the title's nudge + ranked confirmation (R-RANK-06). `then` runs on "Yes" instead of the default. */
  onRankedStart: (kind: 'solo' | 'duos', then?: () => void) => void;
}

/** The sample party's faces (DEV only): the first bundled hero portraits. */
function sampleAvatars(): string[] {
  return AVATAR_ART.filter((a) => a.kind === 'hero').slice(3, 9).map((a) => a.id);
}

/** Sample friends for the DEV sample party (no backend needed). */
function sampleFriends(): Friend[] {
  const av = sampleAvatars();
  const mk = (i: number, name: string, status: Friend['status'], mode: string | null = null): Friend => ({
    userId: `sample-${i}`, author: name, discriminator: String(1000 + i * 37), avatar: null,
    favoriteHero: (av[i % av.length] ?? '').replace(/^hero:/, '') || null, frame: null, skin: null, status, mode, lastSeen: status === 'offline' ? new Date(Date.now() - 3_600_000 * (i + 1)).toISOString() : null,
  });
  return [mk(1, 'Mike', 'online'), mk(2, 'Brisbane', 'in_game', 'ranked'), mk(3, 'Coran', 'online'), mk(4, 'Tamby', 'in_game', 'versus_1v1'), mk(5, 'Fibbsy', 'offline'), mk(6, 'Neptus', 'offline')];
}

export default function PartyHome({ onSettings, onRankedStart }: PartyHomeProps) {
  const goTo = useGame((s) => s.goTo);
  const toggleBook = useGame((s) => s.toggleBook);
  const startPractice = useGame((s) => s.startPractice);
  const startSceneBuilder = useGame((s) => s.startSceneBuilder);
  const setTitleView = useGame((s) => s.setTitleView);
  const playerName = useGame((s) => s.playerName);
  const playerAvatar = useGame((s) => s.playerAvatar);
  const showOpp = useGame((s) => s.showOpponentSkins);
  const userId = useGame((s) => s.account.userId);
  const me = currentUserId();
  const rank = useCurrentRank();
  const progressionOn = useProgression((s) => s.capability === 'on');
  const mirror = useProgression((s) => mirrorFor(userId, s.mirror));
  const aetherOn = useProgression(aetherVisible);
  const collectionOn = useProgression(cratesVisible) || import.meta.env.DEV;
  const newRewards = useHasNewRewards();
  const lv = progressionOn && mirror ? levelProgress(mirror.accountXp) : null;
  const demo = usePartyDemo();
  const phone = isPhone();
  const txt = getTitleText();

  // THE PARTY: a Ranked Duos room is the only server-side party today.
  const room = useVersus((s) => s.room);
  const vsError = useVersus((s) => s.error);
  const duosRoom = room && isDuosParty(room) ? room : null;

  const modes = useMemo(() => partyModes({ versus: versusEnabled(), dev: import.meta.env.DEV }), []);
  const [picked, setPicked] = useState<PartyModeId>(() => readPartyMode());
  // In a party, its mode is the party's (switching would leave your teammate behind: a production question, stubbed).
  const modeId: PartyModeId = duosRoom ? 'duos' : modes.some((m) => m.id === picked) ? picked : 'ranked';
  const mode = partyModeOf(modeId);
  const pick = (m: PartyMode): void => {
    if (m.id === modeId) return;
    sfx.pulse();
    setPicked(m.id);
    rememberPartyMode(m.id);
  };

  const [friendsOpen, setFriendsOpen] = useState(false); // the phone's drawer (desktop: always docked)
  const [nameOpen, setNameOpen] = useState(false);
  const [teamName, setTeamName] = usePartyTeamName(duosRoom);
  const seated = duosRoom ? duosRoom.members.filter((m) => m.role === 'p1' || m.role === 'p2') : [];
  const seatIds = seated.map((m) => m.userId);
  const seatData = useSeatData(seatIds, `${seatIds.join(',')}|${duosRoom?.status ?? ''}`);

  // ── the members ──
  const myName = playerName || tempHandle(userId);
  const myArt = playerCardArt({ avatar: playerAvatar ?? null, favoriteHero: null, cosmetics: null });
  const host = duosRoom ? duosRoom.host_user_id === me : true;
  const inGame = duosRoom?.status === 'in_game';
  const selfMember: Member = {
    key: 'self', self: true, name: myName, art: myArt, titleId: mirror?.equippedTitleId ?? null, rank, level: lv?.level ?? null, rival: false,
    state: inGame ? 'in_game' : 'ready', leader: mode.slots > 1 && host,
  };
  const members: Member[] = [selfMember];
  if (duosRoom) {
    for (const m of seated) {
      if (m.userId === me) continue;
      const src = seatCardSource({ member: m, own: false, showOpp, server: seatData.get(m.userId) });
      members.push({
        key: m.userId, self: false, name: src.name, art: playerCardArt(src), titleId: src.titleId, rank: null, level: null, rival: false,
        state: inGame ? 'in_game' : 'ready', leader: duosRoom.host_user_id === m.userId,
      });
    }
  } else if (demo && mode.slots > 1) {
    const av = sampleAvatars();
    members.push({ key: 'sample-mate', self: false, name: 'Mike', art: avatarSrc(av[0]), titleId: null, rank: null, level: 12, rival: mode.party === 'rivals', state: 'ready', leader: false });
  }
  const slots = Math.max(mode.slots, members.length);
  const open = slots - members.length;

  // ── START ──
  const teammate = members.length >= 2;
  let startLabel = 'Start';
  let startNote: string | null = null;
  let startOk = true;
  let onStart: () => void = () => undefined;
  switch (mode.id) {
    case 'ranked': onStart = () => onRankedStart('solo'); break;
    case 'duos':
      if (demo && !duosRoom) { startNote = 'Sample party. Start does nothing here.'; break; }
      if (inGame) { startOk = false; startLabel = 'In game'; break; }
      if (!duosRoom || !teammate) { startOk = false; startNote = 'Invite a teammate to start.'; break; }
      if (!host) { startOk = false; startLabel = 'Waiting'; startNote = 'Your party leader starts the game.'; break; }
      onStart = () => onRankedStart('duos', () => { void startGame(); });
      break;
    case 'versus': case 'group': case 'vduos': onStart = () => openVersus(); break;
    case 'practice': onStart = () => startPractice(); break;
    case 'gauntlet': onStart = () => setTitleView('gauntlet'); break;
    case 'learn': onStart = () => setTitleView('learn'); break;
    case 'scene': onStart = () => startSceneBuilder(); break;
  }

  // ── inviting ──
  const inviteBusy = useFriends((s) => Object.keys(s.busy).some((k) => k.startsWith('invite:')));
  const invite = async (f: Friend): Promise<void> => {
    if (mode.id !== 'duos' || demo) return;
    sfx.pulse();
    let r = useVersus.getState().room;
    // THE PARTY OPENS ON THE FIRST INVITE (no confirmation yet: nothing is rated until START, which asks).
    if (!r || !isDuosParty(r)) { await enterDuosParty(defaultPartyName(playerName)); r = useVersus.getState().room; }
    if (r && isDuosParty(r)) await inviteFriend(f.userId, 'duos_party', versusRoomRef(r));
  };
  const canInvite = mode.id === 'duos' && friendsAccount() && !inGame;

  const pair = duosRoom ? partyPair(duosRoom) : null;
  const teamLabel = pair ? teamName ?? defaultTeamName(pair[0].name, pair[1].name) : null;

  // ── the nav ──
  const nav: { dest: Exclude<MenuDest, 'menu' | 'modes' | 'friends' | 'settings'>; label: string; icon: MenuMedalName; dot?: boolean }[] = [
    { dest: 'career', label: txt.career, icon: 'career' },
    ...(collectionOn ? [{ dest: 'collection' as const, label: 'Collection', icon: 'collection' as const, dot: newRewards }] : []),
    { dest: 'rankings', label: txt.leaderboard, icon: 'leaderboard' },
    { dest: 'recent', label: 'Recent Games', icon: 'recent' },
    { dest: 'live', label: 'Live Games', icon: 'live' },
    { dest: 'patchnotes', label: 'Patch Notes', icon: 'patchnotes' },
  ];

  return (
    <div className={`ph${phone ? ' ph-phone' : ''}`} role="region" aria-label="Your party">
      <MenuBackdrop screen="modes" />
      <div className="ph-veil" aria-hidden="true" />

      {/* THE NAV BAR: home (this screen), the menu's pages, then Aether and your level. */}
      <header className="ph-top">
        <button type="button" className="ph-brand" aria-label="Home" onClick={() => sfx.pulse()}>
          <img src={TITLE_LOGO_SRC} alt="" draggable={false} decoding="sync" />
          <span>{txt.wordmark}</span>
        </button>
        <nav className="ph-nav" aria-label="Menu">
          <button type="button" className="ph-navtab on" aria-current="page"><MenuMedal name="play" className="menumedal ph-navicon" /><span>Play</span></button>
          {nav.map((n) => (
            <button key={n.dest} type="button" className="ph-navtab" onClick={() => { sfx.pulse(); goTo(n.dest); }}>
              <MenuMedal name={n.icon} className="menumedal ph-navicon" /><span>{n.label}</span>
              {n.dot && <i className="ph-dot" aria-label="New" />}
            </button>
          ))}
          <button type="button" className="ph-navtab" onClick={() => { sfx.pulse(); toggleBook(); }}><MenuMedal name="glossary" className="menumedal ph-navicon" /><span>Compendium</span></button>
        </nav>
        <div className="ph-wallet">
          {/* DEV: the prototype's own controls, clearly labelled. */}
          <div className="ph-proto" role="group" aria-label="Prototype">
            <span className="ph-proto-tag">Prototype</span>
            <button type="button" className={`ph-chipbtn${demo ? ' on' : ''}`} aria-pressed={demo} onClick={() => { sfx.pulse(); setPartyDemo(!demo); }}>Sample party</button>
          </div>
          {aetherOn && mirror && (
            <span className="ph-coin" aria-label={`${mirror.aether ?? 0} Aether`}><AetherIcon className="ph-aether" /><b>{mirror.aether ?? 0}</b></span>
          )}
          {lv && (
            <span className="ph-lv" aria-label={`Level ${lv.level}, ${lv.xpIntoLevel} of ${lv.xpForNextLevel} XP`}>
              <span className="ph-lvnum"><small>Lv</small>{lv.level}</span>
              <span className="ph-lvbar" aria-hidden="true"><span style={{ transform: `scaleX(${lv.fraction})` }} /></span>
            </span>
          )}
          {phone && (
            <button type="button" className="ph-iconbtn" aria-label="Friends" onClick={() => { sfx.pulse(); setFriendsOpen((v) => !v); }}>
              <MenuMedal name="friends" className="menumedal ph-navicon" />
            </button>
          )}
          <button type="button" className="ph-iconbtn" aria-label={txt.settings} onClick={() => { sfx.pulse(); onSettings(); }}>
            <MenuMedal name="settings" className="menumedal ph-navicon" />
          </button>
        </div>
      </header>

      {/* THE MODE TABS: flat, the active one lit with the gold underline. */}
      <div className="ph-modes" role="tablist" aria-label="Mode">
        {modes.map((m) => {
          const locked = !!duosRoom && m.id !== 'duos';
          return (
            <button key={m.id} type="button" role="tab" aria-selected={m.id === modeId}
              className={`ph-mode${m.id === modeId ? ' on' : ''}${m.ranked ? ' rated' : ''}${locked ? ' locked' : ''}`}
              disabled={locked} data-tip={locked ? 'Leave the party to pick another mode.' : undefined}
              onClick={() => pick(m)}>
              {m.label}
            </button>
          );
        })}
      </div>

      <main className="ph-stage">
        <div className="ph-head">
          {teamLabel ? (
            <>
              <span className="ph-eyebrow">Your team</span>
              <span className="ph-title">{teamLabel}</span>
              {!inGame && friendsAccount() && <button type="button" className="ph-chipbtn" onClick={() => { sfx.pulse(); setNameOpen(true); }}>Rename team</button>}
            </>
          ) : (
            <>
              <span className="ph-eyebrow">{mode.ranked ? 'Ranked' : mode.party === 'rivals' ? 'Unranked' : 'Solo'}</span>
              <span className="ph-title">{mode.label}</span>
            </>
          )}
          <span className="ph-desc">{mode.desc}</span>
        </div>

        <div className={`ph-cards n${slots}`} key={mode.id}>
          {members.map((m, i) => <BannerCard key={m.key} m={m} i={i} phone={phone} />)}
          {Array.from({ length: open }, (_, i) => (
            <OpenSeat key={`open-${i}`} i={members.length + i} rival={mode.party === 'rivals'} onOpen={() => { sfx.pulse(); setFriendsOpen(true); }} />
          ))}
        </div>

        <div className="ph-actions">
          <div className="ph-side">
            {duosRoom && !inGame && (
              <button type="button" className="ph-plate" onClick={() => { sfx.pulse(); void leaveDuosParty(); }}>Leave party</button>
            )}
          </div>
          <button type="button" className={`ph-start${mode.ranked ? ' rated' : ''}`} disabled={!startOk}
            onClick={() => { if (!startOk) return; sfx.pulse(); onStart(); }}>
            <span>{startLabel}</span>
          </button>
          <div className="ph-side ph-side-r">
            {startNote && <span className="ph-note">{startNote}</span>}
            {mode.stub && <span className="ph-note ph-stub">{mode.stub}</span>}
          </div>
        </div>
        {vsError && <div className="ph-error" role="alert">{vsError}</div>}
      </main>

      <FriendsColumn open={!phone || friendsOpen} phone={phone} demo={demo} canInvite={canInvite} busy={inviteBusy}
        modeLabel={mode.label} onInvite={(f) => { void invite(f); }} onClose={() => setFriendsOpen(false)} />

      {nameOpen && duosRoom && <TeamNamePanel room={duosRoom} me={me} name={teamName} onSaved={setTeamName} onClose={() => setNameOpen(false)} />}
      {duosRoom && <DuosResultOverlay />}
    </div>
  );
}

/** A member's tall banner card: the portrait fading into navy, the name, title, medal and state at the foot. */
function BannerCard({ m, i, phone }: { m: Member; i: number; phone: boolean }): JSX.Element {
  const art = phone ? heroThumb(m.art) : m.art;
  const state = m.state === 'in_game' ? 'In game' : m.state === 'ready' ? 'Ready' : 'Not ready';
  return (
    <div className={`ph-card${m.self ? ' you' : ''}${m.rival ? ' rival' : ''}`} style={{ '--i': i } as CSSProperties}>
      <div className="ph-card-in">
        {art && <img className="ph-art" src={art} alt="" draggable={false} decoding="async" />}
        {m.self && <span className="ph-you" aria-hidden="true">You</span>}
        {m.leader && <span className="ph-lead" aria-label="Party leader"><Icon name="crown" /></span>}
        <div className="ph-foot">
          <span className="ph-name">{m.name}</span>
          {m.titleId ? <TitleBadge id={m.titleId} className="ph-titlebadge" /> : <span className="ph-sub">{m.level != null ? `Level ${m.level}` : ' '}</span>}
          <span className="ph-rank">
            {m.rank ? (
              <><RankCrest divisionIndex={m.rank.divisionIndex} size="mini" hideDivision /><span>{rankLabel(m.rank)}</span></>
            ) : <span className="ph-muted">{m.self ? 'Unranked' : 'Medal: prototype'}</span>}
          </span>
          <span className={`ph-state s-${m.state}`}>{state}</span>
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
        <span className="ph-openlbl">{rival ? 'Invite a rival' : 'Invite'}</span>
        <span className="ph-opensub">From your friends list</span>
      </span>
    </button>
  );
}

/** The docked friends list: rail-style slices, portrait bleeding in from the right, one-click Invite. */
function FriendsColumn({ open, phone, demo, canInvite, busy, modeLabel, onInvite, onClose }: {
  open: boolean; phone: boolean; demo: boolean; canInvite: boolean; busy: boolean; modeLabel: string;
  onInvite: (f: Friend) => void; onClose: () => void;
}): JSX.Element | null {
  const account = friendsAccount();
  const live = remoteEnabled() && account && !demo;
  useFriendsListLoop(open && live);
  const list = useFriends((s) => s.list);
  const failed = useFriends((s) => s.listFailed);
  const flash = useFriends((s) => s.flash);
  const peers = useDm((s) => s.peers);
  const sent = useFriends((s) => s.list?.sent ?? null);
  const room = useVersus((s) => s.room);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  const friends = useMemo(() => (demo ? sampleFriends() : sortFriends(liveFriends(list?.friends, peers) ?? [])), [demo, list, peers]);
  if (!open) return null;
  const online = friends.filter((f) => f.status !== 'offline').length;
  const target = room && isDuosParty(room) ? versusRoomRef(room) : null;

  let body: ReactNode;
  if (demo) body = null;
  else if (!remoteEnabled()) body = <div className="ph-fempty">Friends need the online service.</div>;
  else if (!account) {
    body = (
      <div className="ph-fempty">
        <div>Sign in to add friends.</div>
        <button type="button" className="ph-plate" onClick={() => { sfx.pulse(); openAccountPanel(); }}>Sign in</button>
      </div>
    );
  } else if (!list) body = <div className="ph-fempty">{failed ? 'Friends are not available right now.' : 'Finding your friends...'}</div>;
  else if (friends.length === 0) body = <div className="ph-fempty">No friends yet. Add one by name and tag, like Name#1234.</div>;

  return (
    <aside className={`ph-friends${phone ? ' drawer' : ''}`} aria-label="Friends">
      <div className="ph-fhead">
        <span className="ph-ftitle">Friends</span>
        <span className="ph-fcount">{online} online</span>
        {phone && <button type="button" className="ph-iconbtn" aria-label="Close friends" onClick={() => { sfx.pulse(); onClose(); }}><Icon name="chevron" /></button>}
      </div>
      {(live || demo) && <AddFriend disabled={demo} />}
      {flash && !demo && <div className="ph-fflash" role="status">{flash}</div>}
      {body ?? (
        <div className="ph-frows" role="list">
          {friends.map((f) => {
            const s = target ? sent?.find((x) => x.to === f.userId && x.target === target) : undefined;
            const label = s?.status === 'pending' ? 'Invited' : s?.status === 'accepted' ? 'Joined' : s?.status === 'declined' ? 'Declined' : 'Invite';
            return (
              <FriendSlice key={f.userId} f={f} showInvite={(canInvite || demo) && f.status === 'online'}
                inviteLabel={label} inviteOff={demo || busy || s?.status === 'pending' || s?.status === 'accepted'}
                modeLabel={modeLabel} onInvite={() => onInvite(f)} onOpen={demo ? undefined : () => { sfx.pulse(); openDm(f.userId); }} />
            );
          })}
        </div>
      )}
      {!canInvite && !demo && account && <div className="ph-fnote">Invites from here are wired for Ranked Duos in this prototype.</div>}
    </aside>
  );
}

function FriendSlice({ f, showInvite, inviteLabel, inviteOff, modeLabel, onInvite, onOpen }: {
  f: Friend; showInvite: boolean; inviteLabel: string; inviteOff: boolean; modeLabel: string; onInvite: () => void; onOpen?: () => void;
}): JSX.Element {
  const showOpp = useGame((s) => s.showOpponentSkins);
  const skins = opponentSkins(showOpp, cardSkins(f));
  const art = heroThumb((showOpp ? avatarSrc(f.avatar) : undefined) ?? heroPortrait(f.favoriteHero, skins));
  return (
    <div role="listitem" className={`ph-fslice f-${f.status}`}>
      <button type="button" className="ph-fmain" onClick={onOpen} aria-label={`Message ${handleOf(f)}`} disabled={!onOpen}>
        {art && <img className="ph-fart" src={art} alt="" draggable={false} decoding="async" />}
        <span className="ph-fwho">
          <span className="ph-fname">{f.author ?? handleOf(f)}</span>
          <span className="ph-fstatus"><i aria-hidden="true" />{statusText(f)}</span>
        </span>
      </button>
      {showInvite && (
        <button type="button" className="ph-finvite" disabled={inviteOff} aria-label={`Invite ${handleOf(f)} to ${modeLabel}`} onClick={onInvite}>
          {inviteLabel}
        </button>
      )}
    </div>
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
      <input className="ph-finput" value={h} onChange={(e) => setH(e.target.value)} placeholder="Add friend: Name#1234"
        aria-label="Add a friend by name and tag" maxLength={45} spellCheck={false} autoComplete="off" disabled={disabled} />
      <button type="submit" className="ph-plate ph-fsub" disabled={disabled || busy || !h.trim()}>Add</button>
    </form>
  );
}

