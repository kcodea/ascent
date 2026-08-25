import { useRef, useState } from 'react';
import { primitiveLabel } from './copy';
import { reorderTargetIndex } from './dragEdit';
import type { EditorLayer } from './layerModel';
import {
  pointerToMs,
  resolveTimingDrag,
  rulerTicks,
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
  /** Seek the playhead to `ms` — fired by dragging the empty track background. */
  onSeek(ms: number): void;
  /** Move the layer at `from` to land at `to` — fired by dragging a row's reorder grip. Same contract as
   *  `LayersPanel`'s `onReorder`; the Workbench wires both to the same `reorderLayerTo`. */
  onReorder(from: number, to: number): void;
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
  onSeek,
  onReorder,
}: TimelineProps): React.ReactElement {
  const trackRef = useRef<HTMLDivElement | null>(null);
  // The drag in flight, plus the track rect measured ONCE at pointerdown. Reading layout per pointermove is
  // the classic drag stutter (see `docs/performance.md` and `insertRectsRef` in Recruit) — and it would be
  // wrong as well as slow here, since the rect cannot change mid-drag.
  const dragRef = useRef<{ drag: TimelineDrag; rect: { left: number; width: number } } | null>(null);
  // A SEPARATE ref for the track-background scrub gesture, so it can never interleave with a bar move/resize
  // (dragRef above). A bar/grip pointerdown calls stopPropagation, so it never reaches the track handler in
  // the first place — this ref just keeps the two drag lifecycles from ever touching.
  const seekRef = useRef<{ rect: { left: number; width: number } } | null>(null);

  // Vertical lane reorder, driven by each row's LEFT grip — mirrors `LayersPanel`'s grip-drag exactly (see
  // that file's doc comment). `rowRefs` holds one element per row; `rowTopsRef` is the cache of each row's
  // top offset, measured ONCE at pointerdown and never touched again until the next drag starts. Its OWN ref
  // (not `dragRef`/`seekRef` above) so a lane reorder can never interleave with a bar move/resize or a track
  // seek — the grip's own pointerdown stops propagation before either of those handlers ever sees the event.
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rowTopsRef = useRef<number[]>([]);
  const dragFromRef = useRef<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const onGripPointerDown = (i: number) => (e: React.PointerEvent<HTMLSpanElement>): void => {
    e.stopPropagation(); // never reaches beginDrag (bar) or beginSeek (track) underneath
    // CRITICAL: bound to the LIVE layers list, not a raw (possibly over-long) ref array — a stale ref past
    // the current layer count resolves out of range after a delete (the Phase 1 grip-drag bug).
    rowTopsRef.current = layers.map((_, idx) => rowRefs.current[idx]?.getBoundingClientRect().top ?? 0);
    dragFromRef.current = i;
    setDragFrom(i);
    setDropAt(i);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onGripPointerMove = (e: React.PointerEvent<HTMLSpanElement>): void => {
    const from = dragFromRef.current;
    if (from === null) return;
    setDropAt(reorderTargetIndex({ fromIndex: from, count: layers.length }, e.clientY, rowTopsRef.current));
  };

  const endGripDrag = (e: React.PointerEvent<HTMLSpanElement>): void => {
    const from = dragFromRef.current;
    if (from === null) return;
    const to = dropAt ?? from;
    dragFromRef.current = null;
    setDragFrom(null);
    setDropAt(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (to !== from) onReorder(from, to);
  };

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

  // Scrub the playhead by dragging the empty track background — the track itself, or the empty space in a
  // row beside its bar. A pointerdown that started on a bar or its resize grip never reaches here at all:
  // `beginDrag` calls `e.stopPropagation()`, so this handler only ever fires for the track div or a row's
  // background. The `closest` check is belt-and-suspenders against that guarantee, not the only guard.
  const beginSeek = (e: React.PointerEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('.fxwb-timeline-bar')) return;
    const track = trackRef.current;
    if (track === null) return;
    const box = track.getBoundingClientRect();
    const rect = { left: box.left, width: box.width };
    seekRef.current = { rect };
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeek(pointerToMs(e.clientX, rect, durationMs));
  };

  const onSeekMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const active = seekRef.current;
    if (active === null) return;
    onSeek(pointerToMs(e.clientX, active.rect, durationMs));
  };

  const endSeek = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (seekRef.current === null) return;
    seekRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const playheadPct = durationMs > 0 ? Math.max(0, Math.min(1, timeMs / durationMs)) * 100 : 0;
  const ticks = rulerTicks(durationMs);

  return (
    <div className="fxwb-timeline">
      <div className="fxwb-timeline-head">
        <span className="fxwb-timeline-title">Timeline</span>
        <span className="fxwb-timeline-hint">drag a bar to move it · drag its right edge to set how long it lasts</span>
        <span className="fxwb-timeline-readout">{Math.round(timeMs)} / {durationMs}ms</span>
      </div>
      {/* The time ruler. Purely decorative — `pointer-events: none` in CSS — so it can sit above the track
          without ever intercepting a drag on a bar underneath it. */}
      <div className="fxwb-timeline-ruler">
        {ticks.map((t) => (
          <span
            key={t.ms}
            className={`fxwb-timeline-tick${t.major ? ' major' : ''}`}
            style={{ left: `${t.pct}%` }}
          >
            {t.major && <span className="fxwb-timeline-ticklabel">{t.label}</span>}
          </span>
        ))}
      </div>
      <div
        className="fxwb-timeline-track"
        ref={trackRef}
        onPointerDown={beginSeek}
        onPointerMove={onSeekMove}
        onPointerUp={endSeek}
        onPointerCancel={endSeek}
      >
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
            <div
              className={`fxwb-timeline-row${dragFrom !== null && dropAt === i ? ' fxwb-timeline-drop' : ''}`}
              key={i}
              ref={(el) => { rowRefs.current[i] = el; }}
            >
              <span
                className="fxwb-timeline-reorder-grip"
                role="button"
                aria-label={`Drag to reorder ${label}`}
                title="Drag to reorder"
                onPointerDown={onGripPointerDown(i)}
                onPointerMove={onGripPointerMove}
                onPointerUp={endGripDrag}
                onPointerCancel={endGripDrag}
              >⠿</span>
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
