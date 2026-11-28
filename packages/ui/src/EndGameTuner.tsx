import { useState } from 'react';
import type { RunState } from '@game/sim';
import { useGame } from './store';

/**
 * DEV ONLY: END THIS PRACTICE GAME (owner 2026-11-27: "add a dev tuner to win or lose the current practice game so i can test the
 * animations"). Sets the table so the NEXT fight really ends the game at the chosen place: the seats that finish below it are out
 * (with their places), your Health drops to 1 with a single 1/1 for a loss, or one rival is left on 1 Health against a board of
 * huge minions for a win. Then End Turn and End Combat play the real ending: the gate, the crystal, the journey, the results.
 * Practice only, in the Shop; nothing is written to any record a ranked game reads.
 */
export function setUpPracticeEnd(place: number): string | null {
  const st = useGame.getState();
  const run = st.run as RunState;
  if (run.mode !== 'practice') return 'Start a Practice game first.';
  if (run.phase !== 'recruit') return 'Use it in the Shop.';
  const lobby = run.lobby;
  if (!lobby) return 'This game has no table.';
  const seats = lobby.seats.map((s) => ({ ...s }));
  const n = seats.length;
  const p = Math.max(1, Math.min(n, Math.round(place)));
  const others = seats.slice(1).filter((s) => s.alive);
  // Opponents still standing after the setup: 1 for a win, p - 1 for a loss (you then go out at place p).
  const keep = p === 1 ? 1 : p - 1;
  if (others.length < keep) return `Only ${others.length + 1} players are left: pick ${others.length + 1}th or better.`;
  // Places already taken by seats out earlier stay theirs; the new knockouts take the places just above them.
  const taken = new Set(seats.filter((s) => s.placement !== undefined).map((s) => s.placement));
  let nextPlace = n;
  const out = others.slice(keep);
  for (const s of out) {
    while (taken.has(nextPlace)) nextPlace--;
    s.alive = false; s.resolve = 0; s.armor = 0; s.placement = nextPlace; s.eliminatedRound = Math.max(0, lobby.round - 1); // out BEFORE this round, so a bye is a real ghost fight
    taken.add(nextPlace);
  }
  const standing = others.slice(0, keep);
  let board = run.board;
  let resolve = run.resolve;
  let armor = run.armor;
  if (p === 1) {
    // A WIN: the last rival on 1 Health, and a board that cannot lose.
    for (const s of standing) { s.resolve = 1; s.armor = 0; }
    const cardId = run.board[0]?.cardId ?? run.shop[0]?.cardId;
    if (!cardId) return 'Buy or roll a minion first, so there is a card to build the winning board from.';
    board = Array.from({ length: 7 }, (_, i) => ({ ...(run.board[0] ?? {}), uid: `devwin${i}`, cardId, attack: 400, health: 400, golden: false, keywords: [] })) as RunState['board'];
  } else {
    // A LOSS: you on 1 Health with a single 1/1 (an EMPTY board sits the round out, and then nothing is fought or lost); the rivals
    // safe on full Health.
    for (const s of standing) { s.resolve = Math.max(s.resolve, 30); }
    const cardId = run.board[0]?.cardId ?? run.shop[0]?.cardId;
    if (!cardId) return 'Roll the Shop first, so there is a card to lose with.';
    board = [{ ...(run.board[0] ?? {}), uid: 'devlose0', cardId, attack: 1, health: 1, golden: false, keywords: [] }] as RunState['board'];
    resolve = 1; armor = 0;
  }
  seats[0] = { ...seats[0]!, resolve, armor };
  // Your rival this round is NAMED (the lobby's forced opponent, the hook Versus uses): with an odd table left, the pairing could
  // otherwise hand you the round's bye, and a bye fights nothing and costs nothing.
  const foe = standing[0]!;
  useGame.setState({ run: { ...run, board, resolve, armor, lobby: { ...lobby, seats, forcedOpponent: { round: lobby.round, seatId: foe.id } } } });
  return null;
}

const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

export function EndGameTuner(): JSX.Element {
  const [note, setNote] = useState('Pick a place, then End Turn and End Combat.');
  const seats = useGame((s) => s.run.lobby?.seats.length ?? 8);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 4 }}>
      <div style={{ fontSize: 12, opacity: 0.8 }}>Practice only. Sets the table so the next fight ends the game at that place.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {ORD.slice(0, seats).map((label, i) => (
          <button key={label} type="button" onClick={() => setNote(setUpPracticeEnd(i + 1) ?? `Set for ${label}. Now End Turn, then End Combat.`)}
            style={{ padding: '8px 0', fontWeight: 800, background: i === 0 ? '#5a4310' : i < 4 ? '#14432a' : '#4a1512', color: '#fff', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 6 }}>
            {i === 0 ? 'Win' : label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12 }}>{note}</div>
    </div>
  );
}
