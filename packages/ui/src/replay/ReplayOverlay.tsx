import { useCallback, useEffect, useRef, useState } from 'react';
import { useGame } from '../store';
import {
  pauseReplay, resumeReplay, setReplaySpeed, seekReplayIndex, endReplay,
  replayEffectiveTimes, replayFrameTimes, replayRoundSpan,
} from './replayPlayer';

/**
 * REPLAY VIEWER transport — the control bar shown while a recorded run plays back (`replaySession` set).
 *
 * ── Scoped to ONE ROUND (owner ask 2026-08-30) ────────────────────────────────────────────────────────────
 *
 * *"have the timer only show that round's time, not the full game. so the player clicks a round and can then
 * easily scrub through that round."*
 *
 * The bar used to span the whole run. On an 18-minute replay that put a single round inside about 40 pixels,
 * so finding the moment a fight turned meant nudging one pixel at a time and overshooting by half a round.
 * The bar now spans the CURRENT ROUND only: the same drag that used to cross the game now crosses one round,
 * a roughly 25× finer target on a long replay.
 *
 * Round SELECTION is the round rail's job (it is mounted beside this and seeks by round), so nothing is lost
 * — the two controls split coarse and fine between them instead of one control trying to be both.
 *
 * The clock reads `0:12 / 1:30` WITHIN the round, with the round's own label beside it, so it is always clear
 * which round the numbers belong to.
 *
 * ── Everything else it learned on 2026-08-30 ──────────────────────────────────────────────────────────────
 *
 * Drag to scrub (tracked on the `window`, so releasing outside the bar cannot leave it stuck), a handle, and
 * keyboard control. Speed is a MENU rather than a slider: a 0.5-step range input meant dragging a 90px track
 * to pick one of ten values, and landing on 3× exactly was luck. A seek is issued only when the target INDEX
 * changes, never per `pointermove`.
 */

/** m:ss — a round is at most minutes long, so hours never appear. */
function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The speeds worth offering. Halves below 1 (to study a beat), whole numbers above (to clear a slow turn). */
const SPEEDS = [0.5, 1, 1.5, 2, 3, 5] as const;

export function ReplayOverlay(): JSX.Element | null {
  const s = useGame((st) => st.replaySession);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  /** The last index a drag actually seeked to — the throttle that keeps it to one seek per frame. */
  const lastSeek = useRef(-1);

  const index = s?.index ?? 0;
  const playing = s?.playing ?? false;

  /** The frame index for a fraction along the bar, mapped through THIS ROUND's span. */
  const targetFor = useCallback((frac: number): { index: number; atTMs: number } | null => {
    const times = replayEffectiveTimes();
    if (times.length === 0) return null;
    const { from, to } = replayRoundSpan(index);
    const t0 = times[from] ?? 0;
    const t1 = times[to] ?? t0;
    if (t1 <= t0) return { index: from, atTMs: replayFrameTimes()[from] ?? 0 };
    const target = t0 + Math.max(0, Math.min(1, frac)) * (t1 - t0);
    // Search only WITHIN the round, so a drag can never leave it — coarse movement belongs to the rail.
    let lo = from, hi = to, ans = from;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (times[mid]! <= target) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    // Recover the RAW recorded time of the scrub target (paced deltas are literal above the sanity floor, so
    // the in-step remainder maps 1:1), for the mid-step inspect-trail apply.
    const raw = replayFrameTimes();
    return { index: ans, atTMs: (raw[ans] ?? 0) + Math.max(0, target - times[ans]!) };
  }, [index]);

  const seekToFrac = useCallback((frac: number, force = false): void => {
    const t = targetFor(frac);
    if (!t) return;
    if (!force && t.index === lastSeek.current) return; // same frame — nothing to redraw
    lastSeek.current = t.index;
    seekReplayIndex(t.index, { atTMs: t.atTMs });
  }, [targetFor]);

  const fracFromClientX = (clientX: number): number => {
    const el = barRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };

  // The drag lives on the WINDOW while it lasts: releasing outside the bar — or off the window entirely —
  // must still end it, or the bar stays stuck in scrub mode.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent): void => { seekToFrac(fracFromClientX(e.clientX)); };
    const onUp = (): void => { setDragging(false); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, seekToFrac]);

  // Close the speed menu on an outside click or Escape — a menu you can only close by picking from it is a
  // trap, and this one floats over the board.
  useEffect(() => {
    if (!speedOpen) return;
    const onDown = (e: PointerEvent): void => {
      if (!(e.target as HTMLElement).closest('.replayspeed')) setSpeedOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setSpeedOpen(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [speedOpen]);

  // KEYBOARD. Stepping one frame is the single most common thing a viewer wants, and aiming a mouse at the
  // bar for it is miserable.
  useEffect(() => {
    if (!s) return;
    const onKey = (e: KeyboardEvent): void => {
      // Never steal keys from a text field (the bug reporter, the perf screen's note box).
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const total = replayEffectiveTimes().length;
      if (e.key === ' ') { e.preventDefault(); if (playing) pauseReplay(); else resumeReplay(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seekReplayIndex(Math.max(0, index - 1)); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); seekReplayIndex(Math.min(total - 1, index + 1)); return; }
      // Home / End land on the edges of THIS ROUND, matching what the bar now spans.
      if (e.key === 'Home') { e.preventDefault(); seekReplayIndex(replayRoundSpan(index).from); return; }
      if (e.key === 'End') { e.preventDefault(); seekReplayIndex(replayRoundSpan(index).to); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s, playing, index]);

  if (!s) return null;

  // THE ROUND's span, in the CLAMPED timeline — bar position ≡ actual watch time, so an idle gap in the
  // capture (a player AFK mid-round) doesn't compress the rest into a sliver (found live 2026-08-19).
  const times = replayEffectiveTimes();
  const { from, to } = replayRoundSpan(s.index);
  const t0 = times[from] ?? 0;
  const t1 = times[to] ?? t0;
  const roundMs = Math.max(0, t1 - t0);
  const cur = Math.max(0, (times[Math.min(s.index, times.length - 1)] ?? t0) - t0);
  const pct = s.ended ? 100 : roundMs > 0 ? (cur / roundMs) * 100 : 0;
  // The fill GLIDES to the next frame's position over exactly the armed step's remaining window (a long
  // literal think used to park the bar dead, which read as broken — owner report 2026-08-19). scaleX with a
  // linear transition: compositor-only. A DRAG suppresses the glide — the bar must track the pointer.
  const nextT = times[Math.min(s.index + 1, to)] ?? (t0 + cur);
  const nextPct = roundMs > 0 ? (Math.max(0, nextT - t0) / roundMs) * 100 : 0;
  const glideMs = !dragging && s.playing && s.stepEndsAtReal != null ? Math.max(0, s.stepEndsAtReal - performance.now()) : 0;
  const fillPct = s.ended ? 100 : glideMs > 0 ? nextPct : pct;

  return (
    <div className="replaybar" role="group" aria-label="Replay controls">
      <button
        className="replaybtn pressable"
        onClick={() => (s.playing ? pauseReplay() : resumeReplay())}
        title={s.playing ? 'Pause (Space)' : 'Play (Space)'}
        aria-label={s.playing ? 'Pause' : 'Play'}
      >
        {s.playing ? '❚❚' : '▶'}
      </button>

      <div
        ref={barRef}
        className={`replayprog${dragging ? ' scrubbing' : ''}`}
        onPointerDown={(e) => {
          e.preventDefault();
          setDragging(true);
          seekToFrac(fracFromClientX(e.clientX), true); // force: a click on the current frame should still land
        }}
        role="slider"
        tabIndex={0}
        aria-label={`Seek within round ${s.round}`}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        title="Drag to scrub this round · ← → step a frame · Space play/pause"
      >
        <div
          className="replayprog-fill"
          style={{
            transform: `scaleX(${fillPct / 100})`,
            transition: glideMs > 0 ? `transform ${Math.round(glideMs)}ms linear` : 'none',
          }}
        />
        {/* The handle, positioned off the SETTLED percentage rather than the glide target, so it marks where
            the replay actually is instead of where it is heading. */}
        <div className="replayprog-knob" style={{ left: `${pct}%` }} aria-hidden="true" />
      </div>

      <span className="replaytime" title={`Position within round ${s.round}`}>
        {clock(cur)}<i> / </i>{clock(roundMs)}
      </span>

      <span className="replayround">{s.authorName ? `${s.authorName} · ` : ''}{s.ended ? 'Final' : `Round ${s.round}`}</span>

      {/* SPEED as a menu, not a slider: a 0.5-step range meant dragging a 90px track to hit one of ten values,
          and landing on 3× exactly was luck. Six named speeds, one click each. */}
      <div className="replayspeed">
        <button
          className="replayspeed-btn pressable"
          onClick={() => setSpeedOpen((o) => !o)}
          title="Playback speed"
          aria-haspopup="menu"
          aria-expanded={speedOpen}
        >
          {s.speed}× <span className="replayspeed-caret" aria-hidden="true">▾</span>
        </button>
        {speedOpen && (
          <div className="replayspeed-menu" role="menu">
            {SPEEDS.map((sp) => (
              <button
                key={sp}
                className={`replayspeed-opt${sp === s.speed ? ' on' : ''}`}
                role="menuitemradio"
                aria-checked={sp === s.speed}
                onClick={() => { setReplaySpeed(sp); setSpeedOpen(false); }}
              >
                {sp}×
              </button>
            ))}
          </div>
        )}
      </div>

      <button className="replaybtn ghost pressable" onClick={endReplay} title="Exit replay" aria-label="Exit replay">✕</button>
    </div>
  );
}
