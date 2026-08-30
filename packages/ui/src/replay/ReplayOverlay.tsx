import { useCallback, useEffect, useRef, useState } from 'react';
import { useGame } from '../store';
import { pauseReplay, resumeReplay, setReplaySpeed, seekReplayIndex, endReplay, replayEffectiveTimes, replayFrameTimes } from './replayPlayer';

/**
 * REPLAY VIEWER transport — a floating control bar shown while a recorded run plays back (`replaySession`
 * set). Progress and seeking are proportional to the recorded timeline (`tMs`), not an action index: a seek
 * is "jump to the frame active at time T", O(log n), no rebuild.
 *
 * ── The 2026-08-30 pass (owner: *"replay scrub bar is very clunky"*) ──────────────────────────────────────
 *
 * It was click-to-seek only. Every correction cost a fresh aim-and-click, there was no handle to say where
 * you were, and — the part that made it feel broken rather than merely sparse — **no clock at all**. A viewer
 * could not answer "how far into this am I?" except by reading a round number.
 *
 * So: DRAG to scrub (tracked on the window, so releasing outside the bar still ends the drag rather than
 * leaving it stuck), a visible handle, an elapsed/total readout, and keyboard control.
 *
 * A seek is issued only when the target INDEX changes, never per pointermove: a high-polling-rate mouse
 * would otherwise fire hundreds of identical seeks a second, and each one re-renders the whole board.
 */

/** m:ss — replays run to minutes, so hours never appear. */
function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function ReplayOverlay(): JSX.Element | null {
  const s = useGame((st) => st.replaySession);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  /** The last index a drag actually seeked to — the throttle that keeps it to one seek per frame. */
  const lastSeek = useRef(-1);

  /** The frame index (and raw recorded time) for a fraction along the bar. */
  const targetFor = useCallback((frac: number): { index: number; atTMs: number } | null => {
    const times = replayEffectiveTimes();
    const duration = times.length > 0 ? times[times.length - 1]! : 0;
    if (duration <= 0) return null;
    const target = Math.max(0, Math.min(1, frac)) * duration;
    // Map the bar fraction through the CLAMPED timeline to a frame index (the last frame at or before the
    // target watch-time), then seek by index — a raw-tMs seek would undo the clamping.
    let lo = 0, hi = times.length - 1, ans = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (times[mid]! <= target) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    // Recover the RAW recorded time of the scrub target (paced deltas are literal above the sanity floor, so
    // the in-step remainder maps 1:1), for the mid-step inspect-trail apply.
    const raw = replayFrameTimes();
    return { index: ans, atTMs: (raw[ans] ?? 0) + Math.max(0, target - times[ans]!) };
  }, []);

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

  // KEYBOARD — the other half of "clunky". Stepping one frame back is the single most common thing a viewer
  // wants, and aiming a mouse at an 8px bar for it is miserable.
  const playing = s?.playing ?? false;
  const index = s?.index ?? 0;
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
      if (e.key === 'Home') { e.preventDefault(); seekReplayIndex(0); return; }
      if (e.key === 'End') { e.preventDefault(); seekReplayIndex(Math.max(0, total - 1)); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s, playing, index]);

  if (!s) return null;

  // The CLAMPED timeline, not raw tMs: bar position ≡ actual watch time, so an idle gap in the capture (a
  // player AFK mid-run) doesn't compress all real play into a sliver of the bar (found live 2026-08-19).
  const times = replayEffectiveTimes();
  const duration = times.length > 0 ? times[times.length - 1]! : 0;
  const cur = times[Math.min(s.index, times.length - 1)] ?? 0;
  const pct = s.ended ? 100 : duration > 0 ? (cur / duration) * 100 : 0;
  // The fill GLIDES to the next frame's position over exactly the armed step's remaining window (a long
  // literal think used to park the bar dead, which read as broken — owner report 2026-08-19). scaleX with a
  // linear transition: compositor-only. A DRAG suppresses the glide — the bar must track the pointer, not
  // ease towards where playback was heading.
  const nextPct = duration > 0 ? ((times[Math.min(s.index + 1, times.length - 1)] ?? cur) / duration) * 100 : 0;
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
        aria-label="Seek"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        title="Drag to scrub · ← → step a frame · Space play/pause"
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

      <span className="replaytime" title="Elapsed / total watch time">{clock(cur)}<i> / </i>{clock(duration)}</span>

      <span className="replayround">{s.authorName ? `${s.authorName} · ` : ''}{s.ended ? 'Final' : `Round ${s.round}`}</span>

      <label className="replayspeed" title="Playback speed">
        <span>{s.speed}×</span>
        <input type="range" min={0.5} max={5} step={0.5} value={s.speed} onChange={(e) => setReplaySpeed(Number(e.target.value))} />
      </label>

      <button className="replaybtn ghost pressable" onClick={endReplay} title="Exit replay" aria-label="Exit replay">✕</button>
    </div>
  );
}
