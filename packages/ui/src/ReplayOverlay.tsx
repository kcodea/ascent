import { useGame } from './store';
import { pauseReplay, resumeReplay, setReplaySpeed, seekReplay, endReplay } from './replayDriver';

/**
 * REPLAY VIEWER transport — a floating control bar shown while a recorded run plays back (`replaySession` set).
 * Play/pause, a click-to-seek progress bar (the driver fast-rebuilds the deterministic run to that point), the
 * 1–10× speed slider, and an exit that restores your live run. Presentation is Mike's seam, so this is a plain
 * functional shell for him to restyle; it reads the shared glass vars so the UI Theme tuner reaches it.
 */
export function ReplayOverlay(): JSX.Element | null {
  const s = useGame((st) => st.replaySession);
  if (!s) return null;

  const pct = s.total > 0 ? (s.index / s.total) * 100 : 0;
  const seekFromClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    seekReplay(Math.round(frac * s.total));
  };

  return (
    <div className="replaybar" role="group" aria-label="Replay controls">
      <button
        className="replaybtn pressable"
        onClick={() => (s.playing ? pauseReplay() : resumeReplay())}
        title={s.playing ? 'Pause' : 'Play'}
        aria-label={s.playing ? 'Pause' : 'Play'}
      >
        {s.playing ? '❚❚' : '▶'}
      </button>

      <div className="replayprog" onClick={seekFromClick} role="slider" aria-label="Seek" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} title="Click to seek">
        <div className="replayprog-fill" style={{ width: `${pct}%` }} />
      </div>

      <span className="replayround">Round {s.round}</span>

      <label className="replayspeed" title="Playback speed">
        <span>{s.speed}×</span>
        <input type="range" min={0.5} max={10} step={0.5} value={s.speed} onChange={(e) => setReplaySpeed(Number(e.target.value))} />
      </label>

      <button className="replaybtn ghost pressable" onClick={endReplay} title="Exit replay" aria-label="Exit replay">✕</button>
    </div>
  );
}
