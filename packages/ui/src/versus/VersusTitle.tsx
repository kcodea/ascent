/**
 * VERSUS — the title's room browser: create a room, join a player seat, or watch (owner rulings 2026-10-13). The
 * room itself is `VersusRoom.tsx` (the painted arena), which the Title shows in place of this view.
 */
import { useEffect, useState } from 'react';
import { sfx } from '../sfx';
import {
  clearVersusError, createRoom, joinRoom, refreshRooms, useVersus,
} from './versusStore';
import './versus.css';

const STATUS: Record<string, string> = { open: 'Open', sealed: 'Starting', in_game: 'In game' };

function Browser() {
  const rooms = useVersus((s) => s.rooms);
  const loading = useVersus((s) => s.loading);
  const [name, setName] = useState('');
  useEffect(() => {
    void refreshRooms();
    const id = window.setInterval(() => void refreshRooms(), 5000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="vsbrowser">
      <div className="vscreate">
        <input className="vsinput" maxLength={40} placeholder="Room name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Room name" />
        <button className="vsplate" onClick={() => { sfx.pulse(); void createRoom(name); }}>Create room</button>
        <button className="vsplate" onClick={() => { sfx.pulse(); void refreshRooms(); }} aria-label="Refresh the room list">Refresh</button>
      </div>
      <div className="vsrooms" role="list">
        {rooms.length === 0 && <div className="vsempty">{loading ? 'Looking for rooms...' : 'No rooms yet. Create one.'}</div>}
        {rooms.map((r) => (
          <div key={r.id} className="vsroomrow" role="listitem">
            <span className="vsroomname">{r.name}</span>
            <span className="vsroomhost">{r.hostName ?? 'Someone'}</span>
            <span className="vsroomcount">{r.players}/2</span>
            <span className={`vsroomstatus s-${r.status}`}>{STATUS[r.status]}</span>
            <span className="vsroomspec">{r.spectators > 0 ? `${r.spectators} watching` : ''}</span>
            {r.status === 'open' && r.players < 2
              ? <button className="vsplate" onClick={() => { sfx.pulse(); void joinRoom(r.id, 'player'); }}>Join</button>
              : <span aria-hidden="true" />}
            <button className="vsplate" onClick={() => { sfx.pulse(); void joinRoom(r.id, 'spectator'); }}>Watch</button>
          </div>
        ))}
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
