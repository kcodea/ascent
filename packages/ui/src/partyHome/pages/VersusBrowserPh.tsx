/**
 * THE VERSUS ROOM BROWSER under the party home's app shell (DEV switch "Party home (prototype)", owner 2026-11-02: "dont
 * forget about the lobby browser as well"). The classic browser (`versus/VersusTitle.tsx`) is unchanged with the switch
 * off; this is the same browser in the shell's language, built from the kit, under the top nav:
 *
 *  - HEADER: Versus / Rooms, Back to Play (the nav's Play, the logo and Esc go home too), and a live chip (the list
 *    refreshes itself, so there is no Refresh button).
 *  - HOST A ROOM: the name (prefilled "<you>'s room"), the mode (1v1, Group, Duos; it starts on the party home's Versus tab
 *    when that is where you came from) and Create room. Create is the store's own: the room opens and the mode is set
 *    on it (the host can change it in the room, like before).
 *  - OPEN ROOMS: filter tabs by mode with counts, then one rail row per room (the host's portrait fading in from the
 *    right, the room's name over its host and rules, the mode, the seats as pips with a count, the status, the watchers
 *    and Join or Watch). Rooms you can sit in come first. Empty: one plain line and a Create room shortcut.
 *
 * Same reads and refresh cadence as the classic browser (5 s while visible, 30 s hidden, R-NET-BACKOFF-01). Static paint;
 * the gauntlet cursor comes from the global rule. Phones: the 256 px thumbnails for the portraits.
 */
import { useEffect, useMemo, useState } from 'react';
import { parseCosmeticSnapshot } from '@game/progression';
import { heroThumb } from '../../art';
import { Icon } from '../../Icon';
import { pageHidden } from '../../net/backoff';
import { opponentSkins } from '../../skins/skins';
import { sfx } from '../../sfx';
import { useGame } from '../../store';
import { versusOptionsSummary } from '../../versus/versusOptionsUi';
import type { VersusRoomSummary } from '../../versus/versusRemote';
import { playerCardArt } from '../../versus/versusSeatCard';
import { stopVersusBot } from '../../versus/versusBot';
import { clearVersusError, createRoom, isDuosParty, joinRoom, leaveRoom, refreshRooms, setRoomOptions, useVersus } from '../../versus/versusStore';
import { PhButton, PhChip, PhEmpty, PhField, PhPage, PhRow, PhSection, PhSegmented, PhTabs } from '../kit';
import { readPartyMode } from '../partyModes';
import {
  defaultRoomName, ROOM_STATUS, VERSUS_OFFLINE_TEXT, roomModeLabel, roomTitleOf, roomCounts, roomJoin, roomModeOf, roomModeShort, seatCap, seatText, visibleRooms, VERSUS_ROOM_MODES,
  type RoomFilter, type VersusRoomMode,
} from './versusPh';
import { returnToVersusRoom } from './versusNav';
import './versusPages.css';

const ROOMS_VISIBLE_MS = 5000;
const ROOMS_HIDDEN_MS = 30_000;

/** The party home's Versus tab, as a room mode (the Create picker starts there). */
function homeMode(): VersusRoomMode {
  const m = readPartyMode();
  return m === 'group' ? 'group' : m === 'vduos' ? 'duos' : 'duel';
}

export function VersusBrowserPh() {
  const allRooms = useVersus((s) => s.rooms);
  // VERSUS ROOMS ONLY (R-RANKED-DUOS-SPLIT-01): a Ranked Duos party never shows here (the store and server filter too).
  const rooms = useMemo(() => allRooms.filter((r) => !isDuosParty(r)), [allRooms]);
  const loading = useVersus((s) => s.loading);
  const error = useVersus((s) => s.error);
  const playerName = useGame((s) => s.playerName);
  const goTo = useGame((s) => s.goTo);
  const [mode, setMode] = useState<VersusRoomMode>(homeMode);
  const [name, setName] = useState(() => defaultRoomName(playerName, homeMode()));
  const [filter, setFilter] = useState<RoomFilter>('all');
  const [creating, setCreating] = useState(false);
  // IN A ROOM ALREADY (critic round 3): the list still shows, with a plate to go back to it or leave it. Creating or
  // joining another waits until you leave (the server refuses a second room).
  const held = useVersus((s) => (s.room && !isDuosParty(s.room) ? s.room : null));
  // OFFLINE (critic round 4): the last list read failed (no game server, no connection). The page then shows ONE friendly
  // state with Retry instead of an empty list under a technical error. Read from this page's own refreshes, so an
  // error from something else (a refused join) never reads as offline.
  const [offline, setOffline] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // The list refreshes every 5 s while the page is visible; a background tab asks only every 30 s, and coming back to
  // the tab refreshes at once (R-NET-BACKOFF-01, the classic browser's cadence).
  useEffect(() => {
    let last = 0;
    const ask = (): void => { last = Date.now(); void refreshRooms().then(() => setOffline(!!useVersus.getState().error && useVersus.getState().rooms.length === 0)); };
    ask();
    const id = window.setInterval(() => { if (!pageHidden() || Date.now() - last >= ROOMS_HIDDEN_MS) ask(); }, ROOMS_VISIBLE_MS);
    const onVis = (): void => { if (!pageHidden() && Date.now() - last >= ROOMS_VISIBLE_MS) ask(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const create = (): void => {
    if (creating || held) return;
    sfx.pulse();
    setCreating(true);
    void (async () => {
      await createRoom(name.trim() || defaultRoomName(playerName, mode));
      // The store opens the room; the mode is the host's room option (the classic room's Room options, set at once).
      if (useVersus.getState().room && mode !== 'duel') await setRoomOptions({ v: 1, mode, modifiers: [] });
    })().finally(() => setCreating(false));
  };

  const counts = roomCounts(rooms);
  const shown = visibleRooms(rooms, filter);
  const home = (): void => { sfx.pulse(); goTo('menu'); };
  const retry = (): void => {
    sfx.pulse();
    setRetrying(true);
    clearVersusError();
    void refreshRooms().then(() => setOffline(!!useVersus.getState().error && useVersus.getState().rooms.length === 0)).finally(() => setRetrying(false));
  };

  if (offline && !held) {
    return (
      <PhPage className="vsb-page" eyebrow="Versus" title="Rooms" back={{ label: 'Play', onClick: home }}>
        <PhSection className="vsb-offline">
          <PhEmpty title={VERSUS_OFFLINE_TEXT} sub="Your other modes still work."
            action={<PhButton variant="primary" onClick={retry} disabled={retrying}>{retrying ? 'Trying' : 'Retry'}</PhButton>} />
        </PhSection>
      </PhPage>
    );
  }

  return (
    <PhPage className="vsb-page" eyebrow="Versus" title="Rooms" back={{ label: 'Play', onClick: home }}>
      {held && (
        <div className="vsb-held" role="status">
          <span className="vsb-heldlbl">In a room</span>
          <span className="vsb-heldname">{roomTitleOf(held.name, roomModeOf(held.options))}</span>
          <span className="vsb-heldmode">{roomModeLabel(roomModeOf(held.options))} · {held.members.length} in the room</span>
          <span className="vsb-heldact">
            <PhButton variant="primary" onClick={() => { sfx.pulse(); returnToVersusRoom(); }}>Return</PhButton>
            <PhButton variant="ghost" onClick={() => { sfx.pulse(); void stopVersusBot().then(() => leaveRoom()); }}>Leave</PhButton>
          </span>
        </div>
      )}
      {error && !offline && (
        <div className="vsph-err" role="alert">
          <span>{error}</span>
          <PhButton size="s" onClick={() => { sfx.pulse(); clearVersusError(); }}>OK</PhButton>
        </div>
      )}

      <PhSection className="vsb-host" title="Host a room" aside={<span>Unranked. Friends join from your invite or this list.</span>}>
        <form className="vsb-create" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <PhField className="vsb-field" label="Room name" maxLength={40} placeholder={defaultRoomName(playerName, mode)} value={name}
            onChange={(e) => setName(e.target.value)} />
          <PhSegmented label="Mode" value={mode} options={VERSUS_ROOM_MODES.map((m) => ({ value: m.id, label: m.short }))}
            onPick={(v) => { sfx.tick(); setMode(v); }} />
          <PhButton type="submit" variant="primary" size="l" className="vsb-createbtn" disabled={creating || !!held}>Create room</PhButton>
        </form>
        <span className="vsb-modehint">{held ? 'Leave your room to host or join another.' : VERSUS_ROOM_MODES.find((m) => m.id === mode)?.desc}</span>
      </PhSection>

      <div className="vsb-listhead">
        <h2 className="vsb-h2">Open rooms</h2>
        <PhTabs label="Filter rooms by mode" value={filter} onChange={(f) => { sfx.tick(); setFilter(f); }}
          tabs={[{ id: 'all' as RoomFilter, label: <>All <span className="vsb-n">{counts.all}</span></> },
            ...VERSUS_ROOM_MODES.map((m) => ({ id: m.id as RoomFilter, label: <>{m.short} <span className="vsb-n">{counts[m.id]}</span></> }))]} />
      </div>

      {shown.length === 0 ? (
        <PhSection>
          <PhEmpty
            title={loading && rooms.length === 0 ? 'Looking for rooms' : filter === 'all' ? 'No rooms open' : `No ${roomModeShort(filter)} rooms open`}
            sub={loading && rooms.length === 0 ? 'One moment.' : 'Host one above and invite a friend. This list updates by itself.'}
          />
        </PhSection>
      ) : (
        <div className="vsb-list" role="list" aria-label="Versus rooms">
          {shown.map((r) => <RoomRow key={r.id} r={r} mine={held?.id === r.id} blocked={!!held} />)}
        </div>
      )}
    </PhPage>
  );
}

/** One room as a rail row. */
function RoomRow({ r, mine, blocked }: { r: VersusRoomSummary; mine: boolean; blocked: boolean }) {
  const showOpp = useGame((s) => s.showOpponentSkins);
  const host = r.hostName?.trim() || 'Someone';
  const join = roomJoin(r);
  const cap = seatCap(r);
  const mode = roomModeOf(r.options);
  // The host's face: their profile picture, else their hero in their skin (only with "Show opponent cosmetics").
  const prof = r.hostProfile ?? {};
  const art = heroThumb(playerCardArt({ avatar: typeof prof.avatar === 'string' && prof.avatar ? prof.avatar : null, favoriteHero: null,
    cosmetics: opponentSkins(showOpp, parseCosmeticSnapshot(prof.cosmetics) ?? null) }));
  // The rules beyond the mode (the modifier), then Friends only.
  const extra = versusOptionsSummary(r.options).split(' · ').slice(1);
  const sub = [`Hosted by ${host}`, ...extra, ...(r.friendsOnly ? ['Friends only'] : [])].join(' · ');
  const go = (): void => { sfx.pulse(); if (mine) returnToVersusRoom(); else void joinRoom(r.id, join.as); };
  const tone = r.status === 'open' ? 'teal' : r.status === 'sealed' ? 'gold' : 'neutral';
  return (
    <PhRow className={`vsb-row s-${r.status}`} selected={mine} art={art} title={roomTitleOf(r.name, mode)} sub={sub}
      lead={<PhChip className="vsb-mode">{roomModeShort(mode)}</PhChip>}
      count={(
        <span className="vsb-seats" aria-label={seatText(r)}>
          <span className="vsb-pips" aria-hidden="true">{Array.from({ length: cap }, (_, k) => <i key={k} className={k < r.players ? 'on' : undefined} />)}</span>
          <span className="vsb-seatn" aria-hidden="true">{r.players}/{cap}</span>
        </span>
      )}
      right={(
        <>
          <PhChip tone={tone}>{ROOM_STATUS[r.status] ?? r.status}</PhChip>
          <span className={`vsb-watch${r.spectators > 0 ? '' : ' vsb-nowatch'}`} aria-label={`${r.spectators} watching`}><Icon name="eye" />{r.spectators}</span>
          <PhButton variant={mine || (join.primary && !blocked) ? 'primary' : 'plate'} size="m" className="vsb-join" onClick={go} disabled={blocked && !mine}
            aria-label={`${mine ? 'Return to' : join.label} ${roomTitleOf(r.name, mode)}`}>{mine ? 'Return' : join.label}</PhButton>
        </>
      )}
    />
  );
}
