/**
 * BEAT SYSTEM PR 8 — the drag-timeline: a horizontal view of the scheduled beats where each beat's HOLD edge
 * is draggable to tune its hold time (a tactile complement to the numeric fields). Geometry is all pure
 * (timelineMath.ts); this component just measures the track once per drag and maps pointer x → holdMs into the
 * draft. Snapping at 25/50ms (Alt disables). Dev-only, no gameplay impact.
 */
import { useMemo, useRef, useState } from 'react';
import type { PresentationBatch } from '@game/core';
import { scheduleBeats } from './beatTimeline';
import { resolveBeatTiming, type BeatTiming, type BeatTimingOverrides } from './beatTiming';
import { beatRegionsPx, fitScale, holdFromDragPx, rulerTicks, msToPx } from './timelineMath';
import { timingKeysFor } from './beatTiming';

const TRACK_W = 640;
const SNAP = 25;
const POLICY_TINT: Record<string, string> = { ownBeat: '#7fd18a', foldedCue: '#8ab6e0', passive: '#c9a0e0', intentionallySilent: '#8a93a8' };

export function BeatTimelineStrip({ batch, overrides, editKey, onHoldChange }: {
  batch: PresentationBatch;
  overrides: BeatTimingOverrides;
  /** The draft key edits write to (from the selected library row) — a hold drag patches its holdMs. */
  editKey: string;
  onHoldChange: (key: string, holdMs: number) => void;
}): React.ReactElement {
  const schedule = useMemo(
    () => scheduleBeats(batch, (t) => resolveBeatTiming(t, overrides)),
    [batch, overrides],
  );
  const pxPerMs = useMemo(() => fitScale(schedule.totalMs, TRACK_W), [schedule.totalMs]);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ trackLeft: number; beatIdx: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent, beatIdx: number): void => {
    e.preventDefault();
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { trackLeft: rect.left, beatIdx }; // MEASURE ONCE per drag (blueprint §16.5)
    setDragging(true);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    const d = dragRef.current;
    if (!d) return;
    const beat = schedule.beats[d.beatIdx];
    if (!beat) return;
    const x = e.clientX - d.trackLeft;
    const snap = e.altKey ? 0 : SNAP;
    onHoldChange(editKey, holdFromDragPx(beat, x, pxPerMs, snap));
  };
  const endDrag = (): void => { dragRef.current = null; setDragging(false); };

  const ticks = rulerTicks(schedule.totalMs);

  return (
    <div className="bl-tl" style={{ width: TRACK_W }}>
      <div className="bl-tl-ruler">
        {ticks.map((t) => (
          <span key={t} className="bl-tl-tick" style={{ left: msToPx(t, pxPerMs) }}>{t}</span>
        ))}
      </div>
      <div
        ref={trackRef}
        className="bl-tl-track"
        style={{ width: TRACK_W }}
        onPointerMove={dragging ? onPointerMove : undefined}
        onPointerUp={endDrag}
        onPointerLeave={dragging ? endDrag : undefined}
      >
        {schedule.beats.map((b, i) => {
          const r = beatRegionsPx(b, pxPerMs);
          // A beat is editable here only if its trigger resolves to the same draft key the inspector edits
          // (so dragging one Lapidary beat moves both its repeats, and doesn't touch an unrelated source).
          const editable = timingKeysFor(b.trigger).includes(editKey) || `family:${b.trigger.policy}` === editKey;
          const tint = POLICY_TINT[b.trigger.policy] ?? '#888';
          return (
            <div key={b.id} className="bl-tl-beat" style={{ left: r.startPx, width: r.totalPx }} title={`${b.trigger.source.label ?? b.trigger.source.id} — ${b.trigger.trigger}`}>
              <div className="bl-tl-windup" style={{ width: r.windupPx }} />
              <div className="bl-tl-hold" style={{ width: r.holdPx, background: tint }} />
              <div className="bl-tl-recovery" style={{ width: r.recoveryPx }} />
              {editable && (
                <div
                  className="bl-tl-handle"
                  style={{ left: r.holdEndPx - r.startPx }}
                  onPointerDown={(e) => onPointerDown(e, i)}
                  title="Drag to change hold (Alt: no snap)"
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="bl-tl-legend">
        <span><i style={{ background: '#3a4468' }} /> wind-up</span>
        <span><i style={{ background: '#7fd18a' }} /> hold</span>
        <span><i style={{ background: '#2a3048' }} /> recovery</span>
        <span className="bl-prov">drag the ▎handle to tune hold · snaps {SNAP}ms (Alt: off)</span>
      </div>
    </div>
  );
}

export type { BeatTiming };
