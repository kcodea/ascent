import { useRef } from 'react';
import type { MomentKind } from './choreo/kinds';
import type { Anchor, Channel } from './choreo/score';
import { getScore, setCue } from './choreo/score';
import { getLungeConfig } from './lungeConfig';
import { msToPx, pxToMs, clampOffset, type TrackWindow } from './choreo/timelineMath';

/** The known ms time of each anchor (start = 0; contact/landed from the lunge + pull-back durations). */
const anchorMs = (at: Anchor): number => {
  const c = getLungeConfig();
  if (at === 'contact') return (c.windupDur + c.strikeDur) * 1000;
  if (at === 'landed') return (0.1 + 0.24) * 1000; // runRiseReturn delay + duration
  return 0;
};

export function ChoreoTimeline({ kind, onChange }: { kind: MomentKind; onChange: () => void }) {
  const cues = getScore()[kind];
  const trackRef = useRef<HTMLDivElement | null>(null);
  const times = cues.map((c) => anchorMs(c.at) + (c.offset ?? 0));
  const maxMs = Math.max(300, ...times.map((t) => t + 60));

  const drag = (ch: Channel, at: Anchor) => (e: React.PointerEvent): void => {
    const track = trackRef.current;
    if (!track) return;
    const w: TrackWindow = { widthPx: track.clientWidth, maxMs };
    const startX = e.clientX;
    const anchor = anchorMs(at);
    const cue = getScore()[kind].find((c) => c.ch === ch);
    const startOff = cue?.offset ?? 0;
    const startPx = msToPx(anchor + startOff, w);
    const move = (ev: PointerEvent): void => {
      const off = clampOffset(pxToMs(startPx + (ev.clientX - startX), w) - anchor, at);
      setCue(kind, ch, { offset: off });
      onChange();
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.preventDefault();
  };

  const anchorsUsed = (['start', 'contact', 'landed'] as Anchor[]).filter((a) => cues.some((c) => c.at === a));

  return (
    <div className="choreo-track" ref={trackRef}>
      {anchorsUsed.map((a) => (
        <div className="choreo-anchor" key={a} style={{ left: `${(anchorMs(a) / maxMs) * 100}%` }}><b>{a}</b></div>
      ))}
      {cues.map((c) => (
        <div
          key={c.ch}
          className={`choreo-chip${c.enabled === false ? ' off' : ''}`}
          style={{ left: `${((anchorMs(c.at) + (c.offset ?? 0)) / maxMs) * 100}%` }}
          onPointerDown={drag(c.ch, c.at)}
          title={`${c.ch} @ ${c.at} ${c.offset ?? 0}ms`}
        >{c.ch}</div>
      ))}
    </div>
  );
}
