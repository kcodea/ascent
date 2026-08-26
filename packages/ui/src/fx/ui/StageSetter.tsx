import { useRef } from 'react';
import {
  addActor,
  moveActor,
  removeActor,
  setActorRole,
  setPoint,
  type StageRole,
  type StageState,
  type StageZone,
} from './stageModel';
import { reorderTargetIndex } from './dragEdit';
import { StageCard } from './StageCard';

export interface StageSetterProps {
  stage: StageState;
  onChange: (next: StageState) => void;
  selectedActor: string | null;
  onSelectActor: (uid: string | null) => void;
}

/** Short label per role for the segmented picker — mirrors `StageCard`'s own `ROLE_LABEL` badge text so the
 *  picker and the card agree on what each role is called. */
const ROLE_LABEL: Record<StageRole, string> = {
  source: 'SRC',
  target: 'TGT',
  struck: 'HIT',
  selfBuffed: 'SELF',
  buffed: 'BUFF',
  none: 'NONE',
};
const ROLES: readonly StageRole[] = ['source', 'target', 'struck', 'selfBuffed', 'buffed', 'none'];
const POINTS: readonly ('source' | 'target' | 'cursor')[] = ['source', 'target', 'cursor'];

/** A card's live screen position, captured once at drag-start — the DOM read a card-reorder drag needs and
 *  must never repeat per pointermove (see `docs/performance.md`'s "don't read layout per frame" rule, the
 *  same discipline `Timeline.tsx`'s `rowTopsRef` follows for its vertical lane reorder). */
interface ZoneCapture {
  rect: { top: number; bottom: number };
  /** uids in on-screen left-to-right order at drag-start, each paired with its card's left edge. */
  cards: { uid: string; left: number }[];
}

interface CardDragCapture {
  uid: string;
  tavern: ZoneCapture;
  warband: ZoneCapture;
}

interface PointDragCapture {
  which: 'source' | 'target' | 'cursor';
  rect: { left: number; top: number; width: number; height: number };
}

/** Which zone a card drop lands in: the midpoint between the two rows' captured rects — above it is tavern
 *  (the top row), at/below it is warband (the bottom row). Pure so it can be reasoned about independent of
 *  the DOM capture that feeds it. */
function dropZoneFor(capture: CardDragCapture, pointerY: number): StageZone {
  const boundary = (capture.tavern.rect.bottom + capture.warband.rect.top) / 2;
  return pointerY <= boundary ? 'tavern' : 'warband';
}

/** Which slot within `zone` a card drop lands at, from the captured left-edges of every card that was in
 *  that zone at drag-start — the dragged card's OWN captured position included, when it started in this
 *  zone, exactly like `Timeline.tsx`'s `rowTopsRef` includes the dragged row's own original top. Leaving it
 *  in is what lets the last position resolve correctly with just one other card on the row: dropping it
 *  keeps the full boundary set `reorderTargetIndex` needs to place the pointer past the final item, not just
 *  before it. `dropCard` (which excludes the dragged uid from the array it actually inserts into) clamps the
 *  result, so an index that pointed at the dragged card's own old slot still lands as a valid insertion. */
function dropIndexFor(capture: CardDragCapture, zone: StageZone, pointerX: number): number {
  const cards = (zone === 'tavern' ? capture.tavern : capture.warband).cards;
  return reorderTargetIndex({ fromIndex: 0, count: cards.length }, pointerX, cards.map((c) => c.left));
}

/** Renumber every actor in `zone` to `uidsInOrder`'s slots (0, 1, 2, …) — the contiguous-slot cleanup
 *  `moveActor`'s own doc comment says is the caller's job. Pure; folds a sequence of `moveActor` calls. */
function reslotZone(stage: StageState, zone: StageZone, uidsInOrder: readonly string[]): StageState {
  return uidsInOrder.reduce((s, uid, i) => moveActor(s, uid, zone, i), stage);
}

/** Land a dragged actor at `insertIndex` within `targetZone`, against the CURRENT stage (not the drag-start
 *  DOM capture — the model is the source of truth for order once the pointer lifts). Renumbers `targetZone`
 *  contiguously with the dragged actor inserted, and — when the drag crossed zones — renumbers the actor's
 *  old zone too, so a cross-zone move never leaves a slot gap behind it. */
function dropCard(stage: StageState, uid: string, targetZone: StageZone, insertIndex: number): StageState {
  const dragged = stage.actors.find((a) => a.uid === uid);
  if (dragged === undefined) return stage;
  const sourceZone = dragged.zone;
  const targetOthers = stage.actors
    .filter((a) => a.zone === targetZone && a.uid !== uid)
    .sort((a, b) => a.slot - b.slot)
    .map((a) => a.uid);
  const clamped = Math.max(0, Math.min(insertIndex, targetOthers.length));
  const targetOrder = [...targetOthers.slice(0, clamped), uid, ...targetOthers.slice(clamped)];
  let next = reslotZone(stage, targetZone, targetOrder);
  if (sourceZone !== targetZone) {
    const sourceOrder = stage.actors
      .filter((a) => a.zone === sourceZone && a.uid !== uid)
      .sort((a, b) => a.slot - b.slot)
      .map((a) => a.uid);
    next = reslotZone(next, sourceZone, sourceOrder);
  }
  return next;
}

/**
 * The Stage Setter's composable canvas: two zone rows of mock `StageCard`s an author can add to, select,
 * re-role, remove and drag-reorder, plus three draggable point handles (`source`/`target`/`cursor`) an FX
 * layer can bind to. Everything here is presentation — every mutation goes through `stageModel`'s pure ops
 * and out through `onChange`; this component owns no state of its own beyond the two in-flight drag refs
 * (never persisted, never read by anything outside a single gesture).
 *
 * The `<div data-zone="…"><div className="row">…</div></div>` ancestry is load-bearing, not cosmetic:
 * `reactTargets.ts`'s `rowUids`/`otherRowUids` climb from a card's `[data-uid]` to its nearest `.row`, and
 * `otherRowUids` then looks for every OTHER `.row` on the page — so a `reach: 'board'` react layer only
 * finds the opposing row's units if a second real `.row` actually exists. `[data-zone]` itself matches
 * `boardAnchors.ts`'s `board` anchor. Both rows are ALWAYS rendered (even empty) so that ancestry never goes
 * missing just because the author hasn't populated one side yet.
 *
 * Point handles are positioned as a PERCENTAGE of this component's own stage box (`fxwb-stage-canvas`), not
 * the viewport — cheap to render, and self-consistent with how a drag converts pointer px back to a fraction
 * (the stage rect is measured once at pointerdown, see `PointDragCapture`). The scenario harness (Task 5)
 * reads each handle's `getBoundingClientRect()` at read-time, which is already viewport coordinates, so no
 * fraction↔px conversion needs to agree between this file and that one.
 */
export function StageSetter({ stage, onChange, selectedActor, onSelectActor }: StageSetterProps): React.ReactElement {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const tavernRowRef = useRef<HTMLDivElement | null>(null);
  const warbandRowRef = useRef<HTMLDivElement | null>(null);

  // The drag in flight, if any — at most one of these is non-null at a time. Both are refs (not state): the
  // rect/DOM capture inside them must never trigger a re-render on its own, only the `onChange` calls a move
  // actually produces (mirrors `Timeline.tsx`'s `dragRef`/`rowTopsRef` split).
  const pointDragRef = useRef<PointDragCapture | null>(null);
  const cardDragRef = useRef<CardDragCapture | null>(null);

  const beginPointDrag = (which: 'source' | 'target' | 'cursor') => (e: React.PointerEvent): void => {
    const box = stageRef.current;
    if (box === null) return;
    e.preventDefault();
    e.stopPropagation();
    const r = box.getBoundingClientRect();
    pointDragRef.current = { which, rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
    box.setPointerCapture(e.pointerId);
  };

  const captureZone = (row: HTMLDivElement | null): ZoneCapture => {
    if (row === null) return { rect: { top: 0, bottom: 0 }, cards: [] };
    const r = row.getBoundingClientRect();
    const cards = [...row.querySelectorAll<HTMLElement>('[data-uid]')].map((el) => ({
      uid: el.getAttribute('data-uid') ?? '',
      left: el.getBoundingClientRect().left,
    }));
    return { rect: { top: r.top, bottom: r.bottom }, cards };
  };

  const beginCardDrag = (uid: string) => (e: React.PointerEvent): void => {
    const box = stageRef.current;
    if (box === null) return;
    cardDragRef.current = {
      uid,
      tavern: captureZone(tavernRowRef.current),
      warband: captureZone(warbandRowRef.current),
    };
    box.setPointerCapture(e.pointerId);
  };

  // Single move/up pair on the stage box handles BOTH drag kinds — a point handle sets pointer capture on
  // the stage box itself (not on the handle), so a fast drag that outruns the cursor still delivers moves
  // here regardless of which element is actually under the pointer.
  const onStagePointerMove = (e: React.PointerEvent): void => {
    const pd = pointDragRef.current;
    if (pd !== null) {
      const fx = (e.clientX - pd.rect.left) / pd.rect.width;
      const fy = (e.clientY - pd.rect.top) / pd.rect.height;
      onChange(setPoint(stage, pd.which, { x: fx, y: fy })); // setPoint clamps to 0..1 itself
    }
    // Card drags commit only on release (endStageDrag) — see that handler's comment for why.
  };

  const endStageDrag = (e: React.PointerEvent): void => {
    const box = stageRef.current;
    if (pointDragRef.current !== null) {
      pointDragRef.current = null;
    } else if (cardDragRef.current !== null) {
      const cd = cardDragRef.current;
      const zone = dropZoneFor(cd, e.clientY);
      const idx = dropIndexFor(cd, zone, e.clientX);
      onChange(dropCard(stage, cd.uid, zone, idx));
      cardDragRef.current = null;
    }
    if (box?.hasPointerCapture(e.pointerId)) box.releasePointerCapture(e.pointerId);
  };

  const selected = stage.actors.find((a) => a.uid === selectedActor) ?? null;

  const renderZone = (zone: StageZone, rowRef: { current: HTMLDivElement | null }): React.ReactElement => {
    const actors = stage.actors.filter((a) => a.zone === zone).sort((a, b) => a.slot - b.slot);
    return (
      <div className="fxwb-stage-zone" data-zone={zone}>
        <span className="fxwb-stage-zone-label">{zone}</span>
        <div className="row" ref={rowRef}>
          {actors.map((actor) => (
            <StageCard
              key={actor.uid}
              actor={actor}
              selected={actor.uid === selectedActor}
              onSelect={() => onSelectActor(actor.uid === selectedActor ? null : actor.uid)}
              onPointerDownDrag={beginCardDrag(actor.uid)}
            />
          ))}
          <button
            type="button"
            className="fxwb-stage-add"
            onClick={() => onChange(addActor(stage, zone))}
            title={`Add a card to ${zone}`}
          >
            ＋ add card
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="fxwb-stagesetter">
      <div
        className="fxwb-stage-canvas"
        ref={stageRef}
        onPointerMove={onStagePointerMove}
        onPointerUp={endStageDrag}
        onPointerCancel={endStageDrag}
      >
        {renderZone('tavern', tavernRowRef)}
        {renderZone('warband', warbandRowRef)}
        {POINTS.map((which) => {
          const p = stage[which];
          return (
            <div
              key={which}
              className={`fxwb-stage-handle fxwb-stage-handle-${which}`}
              data-handle={which}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
              title={which}
              onPointerDown={beginPointDrag(which)}
            />
          );
        })}
      </div>
      {selected !== null && (
        <div className="fxwb-stage-inspector">
          <span className="fxwb-stage-inspector-label">{selected.uid}</span>
          <div className="fxwb-stage-roles" role="group" aria-label="Actor role">
            {ROLES.map((role) => (
              <button
                key={role}
                type="button"
                className={`fxwb-stage-role-btn${selected.role === role ? ' on' : ''}`}
                onClick={() => onChange(setActorRole(stage, selected.uid, role))}
              >
                {ROLE_LABEL[role]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="fxwb-stage-remove"
            onClick={() => {
              onChange(removeActor(stage, selected.uid));
              onSelectActor(null);
            }}
          >
            ✕ remove
          </button>
        </div>
      )}
    </div>
  );
}
