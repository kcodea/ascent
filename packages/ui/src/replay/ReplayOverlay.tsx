import { useGame } from '../store';
import { pauseReplay, resumeReplay, setReplaySpeed, seekReplay, endReplay, replayFrameTimes } from './replayPlayer';

/**
 * REPLAY VIEWER transport — a floating control bar shown while a recorded run plays back (`replaySession`
 * set). Salvaged from the killed v1 branch (PR #956) and re-pointed at the v2 state-replay player: progress
 * and click-to-seek are now proportional to the recorded timeline (`tMs`), not an action index — a seek is
 * "jump to the frame active at time T", O(log n), no rebuild. Presentation is Mike's seam, so this is a
 * plain functional shell for him to restyle; it reads the shared glass vars so the UI Theme tuner reaches it.
 */
export function ReplayOverlay(): JSX.Element | null {
  const s = useGame((st) => st.replaySession);
  if (!s) return null;

  const times = replayFrameTimes();
  const duration = times.length > 0 ? times[times.length - 1]! : 0;
  const cur = times[Math.min(s.index, times.length - 1)] ?? 0;
  const pct = s.ended ? 100 : duration > 0 ? (cur / duration) * 100 : 0;
  const seekFromClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    seekReplay(frac * duration);
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

      <span className="replayround">{s.authorName ? `${s.authorName} · ` : ''}{s.ended ? 'Final' : `Round ${s.round}`}</span>

      <label className="replayspeed" title="Playback speed">
        <span>{s.speed}×</span>
        <input type="range" min={0.5} max={10} step={0.5} value={s.speed} onChange={(e) => setReplaySpeed(Number(e.target.value))} />
      </label>

      <button className="replaybtn ghost pressable" onClick={endReplay} title="Exit replay" aria-label="Exit replay">✕</button>
    </div>
  );
}
