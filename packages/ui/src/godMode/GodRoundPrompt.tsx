// packages/ui/src/godMode/GodRoundPrompt.tsx
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { stageHost } from '../stage';
import { GOD_ROUNDS } from './godBoards';
import './godMode.css';

/** Where the last-picked round is remembered (per viewer), so the prompt opens on it next time. */
export const GOD_ROUND_KEY = 'ascent.godmode.round';

/** The last-picked round, clamped to 1–15; 1 when nothing (or junk) is stored. */
export function loadGodRound(): number {
  try { return Math.min(15, Math.max(1, Math.round(Number(localStorage.getItem(GOD_ROUND_KEY))) || 1)); } catch { return 1; }
}

/** GOD MODE End Turn prompt (owner 2026-10-08): pick a round; clicking it starts the fight against a random real
 *  player board from that round. Inert while the board is being fetched. */
export function GodRoundPrompt({ lastRound, busy, message, onPick, onClose }: {
  lastRound: number; busy: boolean; message: string | null; onPick: (round: number) => void; onClose: () => void;
}) {
  // Esc backs out to the shop. Capture phase + stopPropagation so the same press doesn't ALSO open the Esc menu
  // (Game.tsx's window listener) underneath — the prompt owns Esc while it is up (the PortraitSignInGate pattern).
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (!busy) onClose();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [busy, onClose]);
  return createPortal(
    <div className="godround-scrim" role="dialog" aria-label="Choose your opponent's round">
      <div className="godround">
        <button type="button" className="godround-x" aria-label="Back to the shop" disabled={busy} onClick={onClose}>✕</button>
        <h2 className="godround-q">What round should your opponent board be on?</h2>
        <div className="godround-grid">
          {GOD_ROUNDS.map((r) => (
            <button key={r} type="button" disabled={busy} className={`godround-btn${r === lastRound ? ' on' : ''}`}
              aria-label={`Round ${r}`} onClick={() => { if (!busy) onPick(r); }}>{r}</button>
          ))}
        </div>
        {busy && <div className="godround-note">Finding a board…</div>}
        {!busy && message && <div className="godround-note warn">{message}</div>}
      </div>
    </div>,
    stageHost(),
  );
}
