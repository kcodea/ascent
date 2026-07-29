import { useRef } from 'react';
import { primitiveLabel } from './copy';
import type { EditorLayer } from './layerModel';
import {
  pointerToMs,
  resolveTimingDrag,
  spanOf,
  spanToTrack,
  type TimelineDrag,
  type TimelineDragMode,
} from './timelineModel';

export interface TimelineProps {
  layers: EditorLayer[];
  /** Which layers are silenced right now (mute and solo already folded together). */
  mutes: boolean[];
  selected: number;
  durationMs: number;
  /** Live playhead position in ms. */
  timeMs: number;
  onSelect(index: number): void;
  /** Commit a drag step. `field` distinguishes a move from a resize so the workbench's history can coalesce
   *  each gesture into ONE undo entry (see `retimeLayer`). */
  onRetime(index: number, at: number, life: number | null, field: 'at' | 'life'): void;
}

/**
 * A bar per layer across the composition, with a playhead — the composition as a PICTURE.
 *
 * Before this, a composition's timing existed only as two range inputs on whichever layer happened to be
 * selected, so "the burst fires 200ms into the trail" was something you had to hold in your head and verify
 * by watching. Overlap, gaps and ordering are the whole substance of a multi-layer effect and none of them
 * were visible.
 *
 * Drag the body of a bar to move it, drag its right edge to change how long it lasts. All the arithmetic is
 * in `timelineModel.ts` (pure and tested); this file is the DOM and the pointer plumbing only. The model
 * file is NOT called `timeline.ts`: that differs from this one only by case, which typecheck accepts and
 * the bundler does not on a case-insensitive filesystem.
 */
export function Timeline({
  layers,
  mutes,
  selected,
  durationMs,
  timeMs,
  onSelect,
  onRetime,
}: TimelineProps): React.ReactElement {
  const trackRef = useRef<HTMLDivElement | null>(null);
  // The drag in flight, plus the track rect measured ONCE at pointerdown. Reading layout per pointermove is
  // the classic drag stutter (see `docs/performance.md` and `insertRectsRef` in Recruit) — and it would be
  // wrong as well as slow here, since the rect cannot change mid-drag.
  const dragRef = useRef<{ drag: TimelineDrag; rect: { left: number; width: number } } | null>(null);

  const beginDrag = (e: React.PointerEvent, index: number, mode: TimelineDragMode): void => {
    const track = trackRef.current;
    if (track === null) return;
    e.preventDefault();
    e.stopPropagation();
    const box = track.getBoundingClientRect();
    const rect = { left: box.left, width: box.width };
    const layer = layers[index];
    dragRef.current = {
      rect,
      drag: {
        index,
        mode,
        startAt: layer.at,
        startLife: layer.life,
        grabMs: pointerToMs(e.clientX, rect, durationMs),
      },
    };
    // Pointer capture on the bar itself, so a fast drag that outruns the cursor (or leaves the panel
    // entirely) keeps delivering moves to this element instead of silently stopping mid-gesture.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onSelect(index);
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const active = dragRef.current;
    if (active === null) return;
    const pointerMs = pointerToMs(e.clientX, active.rect, durationMs);
    const { at, life } = resolveTimingDrag(active.drag, pointerMs, durationMs);
    onRetime(active.drag.index, at, life, active.drag.mode === 'move' ? 'at' : 'life');
  };

  const endDrag = (e: React.PointerEvent): void => {
    if (dragRef.current === null) return;
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const playheadPct = durationMs > 0 ? Math.max(0, Math.min(1, timeMs / durationMs)) * 100 : 0;

  return (
    <div className="fxwb-timeline">
      <div className="fxwb-timeline-head">
        <span className="fxwb-timeline-title">Timeline</span>
        <span className="fxwb-timeline-hint">drag a bar to move it · drag its right edge to set how long it lasts</span>
      </div>
      <div className="fxwb-timeline-track" ref={trackRef}>
        {layers.map((l, i) => {
          const span = spanOf(l, durationMs);
          const { left, width } = spanToTrack(span, durationMs);
          const label = l.name ?? primitiveLabel(l.primitive);
          // Fraction ACROSS THE BAR (not the track) at which a travelling layer reaches its target. Null
          // when the layer has no early arrival to show — no travel window, or one that just matches its end.
          const barMs = span.endMs - span.startMs;
          const arrivalFrac =
            l.anchor === 'travel' && typeof l.travelMs === 'number' && l.travelMs > 0 && l.travelMs < barMs
              ? l.travelMs / barMs
              : null;
          return (
            <div className="fxwb-timeline-row" key={i}>
              <div
                className={`fxwb-timeline-bar${i === selected ? ' on' : ''}${mutes[i] ? ' muted' : ''}`}
                style={{ left: `${left * 100}%`, width: `${width * 100}%` }}
                title={`${label} — starts at ${span.startMs}ms, ${span.full ? 'runs to the end' : `lasts ${l.life}ms`}`}
                onPointerDown={(e) => beginDrag(e, i, 'move')}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <span className="fxwb-timeline-label">{label}</span>
                {/* Where a travelling layer ARRIVES, when that is earlier than its end. Without a mark the
                    dwell after the arrival is invisible on the bar, and the whole reason to set a travel
                    window is to see that dwell relative to whatever fires next. */}
                {arrivalFrac !== null && (
                  <span
                    className="fxwb-timeline-arrival"
                    style={{ left: `${arrivalFrac * 100}%` }}
                    title={`Arrives after ${l.travelMs}ms, then holds for the rest of the layer`}
                  />
                )}
                {/* The resize grip. Its own pointerdown (stopped from reaching the bar) is what makes edge
                    vs body two different gestures rather than one ambiguous one. */}
                <span
                  className="fxwb-timeline-grip"
                  title="Drag to set how long this layer lasts"
                  onPointerDown={(e) => beginDrag(e, i, 'resize')}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
              </div>
            </div>
          );
        })}
        {/* Purely decorative: `pointer-events: none` in CSS, so it can never intercept a drag on a bar
            passing underneath it. */}
        <div className="fxwb-timeline-playhead" style={{ left: `${playheadPct}%` }} />
      </div>
    </div>
  );
}
