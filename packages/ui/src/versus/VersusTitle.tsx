/**
 * VERSUS — the title's room browser: create a room, join one, or watch (owner rulings 2026-10-13). Everyone arrives in
 * the room's hand (R-VERSUS-ROOM-HAND-01). The room itself is `VersusRoom.tsx`, which the Title shows in place of this.
 *
 * MODERNISED (owner 2026-10-21: "improve the versus lobby viewer so it looks modernized and clean. this looks like a
 * 1999 menu", R-VERSUS-BROWSER-01): one menu panel (the Career panel look) sized to its content. On top, Create room is
 * the call to action with its name field built in (prefilled "<you>'s room"). Under it, each room is a card: the host's
 * face in the portrait ring, the room's name over the host's name, the two seats as two sockets (filled or empty), a
 * small status pill, the watchers with the eye icon, and a clear Join (an open room) or Watch (a running one). No room
 * open: one quiet line that says how to start one. The list refreshes itself every 5 s, so there is no Refresh button.
 * Existing primitives only (the Gem plate, the name pill, the portrait ring, the game's icons); motion is the plate's
 * own one-shot hover nudge.
 */
import { useEffect, useState } from 'react';
import { sfx } from '../sfx';
import { useGame } from '../store';
import { Icon } from '../Icon';
import { MemberRing } from './MemberRing';
import {
  clearVersusError, createRoom, joinRoom, refreshRooms, useVersus,
} from './versusStore';
import type { VersusRoomSummary } from './versusRemote';
import { versusOptionsSummary } from './versusOptionsUi';
import './versus.css';

const STATUS: Record<string, string> = { open: 'Open', sealed: 'Starting', in_game: 'In game' };

/** The room name the Create field starts with: "<name>'s room" (or "Versus room" without a name). */
export function defaultRoomName(playerName: string): string {
  const n = playerName.trim();
  return n ? `${n}'s room`.slice(0, 40) : 'Versus room';
}

function RoomCard({ r }: { r: VersusRoomSummary }) {
  const open = r.status === 'open';
  const host = r.hostName?.trim() || 'Someone';
  // The room's seats for its mode (2, or 4 for a group room) and what it plays (R-VERSUS-OPTIONS-01): joiners know
  // what they are joining.
  const cap = r.maxPlayers ?? 2;
  const go = (): void => { sfx.pulse(); void joinRoom(r.id, open && r.players < cap ? 'player' : 'spectator'); };
  return (
    <div className={`vsrcard s-${r.status}`} role="listitem">
      <MemberRing name={host} profile={r.hostProfile} className="vsrcard-ring" />
      <div className="vsrcard-who">
        <span className="vsrcard-name">{r.name || `${host}'s room`}</span>
        <span className="vsrcard-host"><Icon name="crown" /> {host}</span>
        <span className="vsrcard-mode">{versusOptionsSummary(r.options)}</span>
      </div>
      <div className="vsrcard-seats" aria-label={`${r.players} of ${cap} seats taken`}>
        {Array.from({ length: cap }, (_, i) => <span key={i} className={`vsrseat${i < r.players ? ' on' : ''}`} />)}
      </div>
      <span className={`vsrstatus s-${r.status}`}>{STATUS[r.status] ?? r.status}</span>
      <span className={`vsrwatch${r.spectators > 0 ? '' : ' none'}`} aria-label={`${r.spectators} watching`}><Icon name="eye" /> {r.spectators}</span>
      <button className={`vsplate vsrjoin${open ? ' primary' : ''}`} onClick={go}>{open ? 'Join' : 'Watch'}</button>
    </div>
  );
}

function Browser() {
  const rooms = useVersus((s) => s.rooms);
  const loading = useVersus((s) => s.loading);
  const playerName = useGame((s) => s.playerName);
  const [name, setName] = useState(() => defaultRoomName(playerName));
  useEffect(() => {
    void refreshRooms();
    const id = window.setInterval(() => void refreshRooms(), 5000);
    return () => window.clearInterval(id);
  }, []);
  const create = (): void => { sfx.pulse(); void createRoom(name.trim() || defaultRoomName(playerName)); };
  return (
    <div className="vsbrowser">
      <form className="vscreate" onSubmit={(e) => { e.preventDefault(); create(); }}>
        <input className="vsinput" maxLength={40} placeholder={defaultRoomName(playerName)} value={name} onChange={(e) => setName(e.target.value)} aria-label="Room name" />
        <button type="submit" className="vsplate vscreatebtn">Create room</button>
      </form>
      <div className="vsrooms-head">
        <span className="vsrooms-title">Open rooms</span>
        <span className="vsrooms-live" aria-hidden="true">Updates live</span>
      </div>
      <div className="vsrooms" role="list">
        {rooms.length === 0 && <div className="vsempty">{loading ? 'Looking for rooms...' : 'No rooms open. Create one and invite a friend.'}</div>}
        {rooms.map((r) => <RoomCard key={r.id} r={r} />)}
      </div>
    </div>
  );
}

export function VersusTitle() {
  const error = useVersus((s) => s.error);
  return (
    <div className="vstitle">
      {error && <div className="vserror" role="alert">{error} <button className="vsplate" onClick={() => { sfx.pulse(); clearVersusError(); }}>OK</button></div>}
      <Browser />
    </div>
  );
}
