import { useEffect, useRef, useState } from 'react';
import { effectiveMutes, type EditorLayer } from './layerModel';
import { reorderTargetIndex, type ReorderDrag } from './dragEdit';
import { anchorLabel, primitiveLabel, primitiveBlurb } from './copy';

/**
 * The composition's layer list — extracted out of the god-component `Workbench.tsx` (which still owns every
 * piece of STATE this renders; this file is purely presentation + the grip-drag gesture). Props are the same
 * handlers Workbench always had wired to this exact JSX; where a Workbench handler's signature didn't already
 * match a prop 1:1 (`onReorder`'s arbitrary `(from, to)` vs. the ↑/↓ buttons' single-step `reorderLayer`;
 * `onRename`'s `(i, name)` vs. the old inline-rename-textbox reading Workbench's own `renameText` state), the
 * caller (`Workbench.tsx`) wraps its existing logic rather than this file re-implementing it — see the prop
 * wiring at the `<LayersPanel .../>` call site.
 *
 * The one thing genuinely NEW here is the grip: pointerdown on `.fxwb-layer-grip` starts a reorder drag,
 * pointer capture keeps the move/up events routed to the grip even once the cursor leaves the row, and the
 * drop target is resolved via `resolveDrop` (a thin wrapper over `dragEdit.ts`'s already-tested
 * `reorderTargetIndex` — see `LayersPanel.test.ts`). Row tops are measured ONCE at pointerdown and cached;
 * `pointermove` only does arithmetic against that cache, never touches layout (the repo's "don't read
 * getBoundingClientRect per frame" rule — see CLAUDE.md's performance section).
 */
export interface LayersPanelProps {
  layers: readonly EditorLayer[];
  selected: number;
  onSelect: (i: number) => void;
  onReorder: (from: number, to: number) => void;
  onAdd: (primitive: string) => void;
  onDuplicate: (i: number) => void;
  onRemove: (i: number) => void;
  onToggleMute: (i: number) => void;
  onToggleSolo: (i: number) => void;
  onRename: (i: number, name: string) => void;
  primitives: readonly string[];
}

/** Where the row grabbed at `from` should land, given the pointer's current Y (viewport px) and the cached
 *  row-top offsets captured at drag-start. A thin wrapper: the actual arithmetic is `dragEdit.ts`'s
 *  `reorderTargetIndex`, already covered by `dragEdit.test.ts` — this only proves the panel wires it
 *  correctly (see `LayersPanel.test.ts`). */
export function resolveDrop(from: number, pointerY: number, rowTops: number[]): number {
  const drag: ReorderDrag = { fromIndex: from, count: rowTops.length };
  return reorderTargetIndex(drag, pointerY, rowTops);
}

export function LayersPanel(props: LayersPanelProps): React.ReactElement {
  const { layers, selected, onSelect, onReorder, onAdd, onDuplicate, onRemove, onToggleMute, onToggleSolo, onRename } = props;

  // Silenced BY SOLO (rather than by its own mute) reads the same way `Workbench.tsx` computed it inline
  // before the extraction: `effectiveMutes(layers)`, a pure function of the layer list.
  const liveMutes = effectiveMutes(layers);

  // The "Add new primitive" picker: a button that opens a big CENTERED WINDOW of every primitive WITH its
  // one-line definition (owner ask), so you choose what to add by what it DOES, not by guessing an id, and see
  // them ALL at once in a grid rather than scrolling a cramped menu. Click a primitive to add it and close;
  // click the scrim or Esc to dismiss.
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setPickerOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickerOpen]);

  // The in-place rename textbox: which row (if any) is being edited, and its in-progress text. This used to
  // live in Workbench (`renaming`/`renameText`), but the JSX that reads it moved here, so the state moves
  // with it — `onRename(i, name)` only fires once, on commit, with the finished text.
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [renameText, setRenameText] = useState('');
  const startRename = (i: number): void => {
    setRenamingIndex(i);
    setRenameText(layers[i]?.name ?? '');
  };
  const cancelRename = (): void => setRenamingIndex(null);
  const commitRename = (i: number): void => {
    if (renamingIndex !== i) return; // already committed / cancelled
    setRenamingIndex(null);
    onRename(i, renameText);
  };

  // Row-top cache for the in-flight grip drag: measured ONCE at pointerdown (never per pointermove — see the
  // file doc comment). `dragFrom`/`dropAt` are the only pieces that need to re-render the list as the pointer
  // moves; the row elements themselves stay referentially stable.
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rowTopsRef = useRef<number[]>([]);
  const dragFromRef = useRef<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const onGripPointerDown = (i: number) => (e: React.PointerEvent<HTMLSpanElement>): void => {
    e.stopPropagation(); // don't also select the row out from under the drag
    rowTopsRef.current = props.layers.map((_, idx) => rowRefs.current[idx]?.getBoundingClientRect().top ?? 0);
    dragFromRef.current = i;
    setDragFrom(i);
    setDropAt(i);
    e.currentTarget.setPointerCapture(e.pointerId); // keeps move/up routed here past the row's edge
  };

  const onGripPointerMove = (e: React.PointerEvent<HTMLSpanElement>): void => {
    const from = dragFromRef.current;
    if (from === null) return;
    setDropAt(resolveDrop(from, e.clientY, rowTopsRef.current));
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

  return (
    <div className="fxwb-layers">
      {layers.map((l, i) => (
        <div
          key={i}
          ref={(el) => { rowRefs.current[i] = el; }}
          className={
            `fxwb-layer-row${i === selected ? ' on' : ''}${l.muted === true ? ' muted' : ''}` +
            `${l.solo === true ? ' solo' : ''}` +
            `${liveMutes[i] && l.muted !== true ? ' silenced' : ''}` +
            `${dragFrom !== null && dropAt === i ? ' fxwb-layer-drop' : ''}`
          }
          onClick={() => onSelect(i)}
        >
          <span
            className="fxwb-layer-grip"
            role="button"
            aria-label={`Drag to reorder ${l.name ?? primitiveLabel(l.primitive)}`}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={onGripPointerDown(i)}
            onPointerMove={onGripPointerMove}
            onPointerUp={endGripDrag}
            onPointerCancel={endGripDrag}
          >⠿</span>
          {renamingIndex === i ? (
            <input
              className="fxwb-layer-rename"
              type="text"
              aria-label="Layer name"
              spellCheck={false}
              autoFocus
              placeholder={l.primitive}
              value={renameText}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenameText(e.target.value)}
              onBlur={() => commitRename(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(i);
                else if (e.key === 'Escape') cancelRename();
              }}
            />
          ) : (
            <span
              className="fxwb-layer-name"
              aria-label={l.name === undefined ? 'Double-click to name this layer' : `${l.name} (${l.primitive}) — double-click to rename`}
              onDoubleClick={(e) => { e.stopPropagation(); startRename(i); }}
            >
              {l.name ?? l.primitive}
            </span>
          )}
          {/* Anchor sits in the row meta so a composition reads at a glance — "which layer is pinned to
              the target and which one rides the arc?" is the first question you ask of one. A NAMED layer
              keeps its primitive id here, so naming never costs you the "what is this?" answer. */}
          <span className="fxwb-layer-meta" aria-description={anchorLabel(l.anchor)}>
            {l.name === undefined ? '' : `${l.primitive} · `}
            {l.anchor} · @{l.at}ms · {l.life === null ? 'full' : `${l.life}ms`}{l.muted === true ? ' · muted' : ''}{l.solo === true ? ' · solo' : ''}
          </span>
          <span className="fxwb-layer-btns">
            <button
              className={`fxwb-layer-mute${l.muted === true ? ' on' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleMute(i); }}
              aria-label={l.muted === true ? 'Muted — click to bring this layer back' : 'Mute this layer (isolate the others)'}
            >{l.muted === true ? '◐' : '👁'}</button>
            <button
              className={`fxwb-layer-solo${l.solo === true ? ' on' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleSolo(i); }}
              aria-label={l.solo === true ? 'Soloed — click to bring the other layers back' : 'Solo this layer (only soloed layers play)'}
            >{l.solo === true ? '◉' : '○'}</button>
            <button
              onClick={(e) => { e.stopPropagation(); startRename(i); }}
              aria-label="Rename this layer (or double-click its name)"
            >✎</button>
            <button
              onClick={(e) => { e.stopPropagation(); onDuplicate(i); }}
              aria-label="Duplicate this layer (a full copy of its tuning, inserted below)"
            >⧉</button>
            <button
              onClick={(e) => { e.stopPropagation(); onReorder(i, i - 1); }}
              disabled={i === 0}
              aria-label="Move up"
            >↑</button>
            <button
              onClick={(e) => { e.stopPropagation(); onReorder(i, i + 1); }}
              disabled={i === layers.length - 1}
              aria-label="Move down"
            >↓</button>
            {layers.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(i); }}
                aria-label="Remove layer"
              >✕</button>
            )}
          </span>
        </div>
      ))}
      <div className="fxwb-layer-add">
        <button
          type="button"
          className={`fxwb-addprim-btn${pickerOpen ? ' on' : ''}`}
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen(true)}
        >
          ＋ Add new primitive
        </button>
      </div>
      {pickerOpen && (
        <div
          className="fxwb-addprim-scrim"
          onClick={(e) => { if (e.target === e.currentTarget) setPickerOpen(false); }}
        >
          <div className="fxwb-addprim-window" role="dialog" aria-label="Add a primitive">
            <div className="fxwb-addprim-head">
              <span className="fxwb-addprim-title">Add a primitive</span>
              <button
                type="button"
                className="fxwb-addprim-close"
                aria-label="Close"
                onClick={() => setPickerOpen(false)}
              >✕</button>
            </div>
            <div className="fxwb-addprim-grid" role="menu">
              {props.primitives.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  className="fxwb-addprim-item"
                  onClick={() => { onAdd(id); setPickerOpen(false); }}
                >
                  <span className="fxwb-addprim-name">{primitiveLabel(id)}</span>
                  <span className="fxwb-addprim-blurb">{primitiveBlurb(id)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
