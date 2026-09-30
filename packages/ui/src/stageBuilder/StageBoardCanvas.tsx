import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { CARD_INDEX, GAUNTLET_BOARD_MAX } from '@game/content';
import { Card, type CardView } from '../Card';
import { MinionSkins } from '../skins/skins';
import { UnitEditor } from '../UnitEditor';
import { rectToStage, stageHost, stageViewport, toStage } from '../stage';
import { useStageBuilder } from './stageBuilderStore';
import {
  addMinion, moveMinion, removeMinion, roundTier, roundToSnapshot, setMinionStats, swapMinionCard, toggleAddedKeyword,
  toggleMinionGolden,
} from './stageDraft';
import { allMinions, searchMinions } from './minionSearch';
import { DRAG_THRESHOLD, reorderIndexAt, slideSlots, slotPitch, type SlotRect } from './canvasReorder';

/**
 * DEV-only STAGE BOARD CANVAS — the visual half of the Stage Builder (owner ask 2026-09-29: "i only need to edit
 * the opponent warband … lets show the combat phase UI instead"). While the builder is open it covers the whole
 * stage, opaque, with the combat board art and ONLY the opponent's warband for the selected round: no player
 * warband, no shop or its controls, no lobby rail. The recruit screen beneath is covered and unreachable.
 *
 *  - Double-click a unit → the shared `UnitEditor`, anchored to it, editing the DRAFT (stats, ADDED keywords —
 *    the card's printed ones show locked on — Golden, card swap with search, remove).
 *  - Click a "+" slot → a card search; picking appends that minion at its printed stats and opens the editor on it.
 *  - Press-and-drag a unit sideways → the others slide a slot to make room (transform-only, like the warband's
 *    "make room" slide); dropping commits `moveMinion` (owner ask 2026-09-29). A press only becomes a drag past
 *    `DRAG_THRESHOLD`, so clicks and double-clicks still work. Slot rects are read ONCE when the drag starts; the
 *    dragged card follows the pointer via a transform written straight to its element (no React render per move),
 *    and React re-renders only when the insertion gap changes.
 *
 * Every edit goes through `editDraft` + the pure `stageDraft.ts` helpers, so the panel's minion list (which reads
 * the same draft) stays in sync, and the round is marked dirty the same way. Mounted from `SandboxDevPanels` in
 * the lazily loaded `StageBuilder.tsx`, so none of this reaches the player bundle. Portalled into `stageHost()`
 * below the panel's z-index (see `.stbc` in styles.css).
 */

/** The swap list for the unit editor: every minion card, with the search haystack. Built once. */
let swapCards: { id: string; name: string; hay: string }[] | null = null;
const allSwapCards = (): { id: string; name: string; hay: string }[] =>
  (swapCards ??= allMinions().map((c) => ({ id: c.id, name: c.name, hay: c.hay })));

type Editing = { index: number; rect: DOMRect | null };
/** A live reorder: the dragged unit's resting index, the current insertion index, and the slide step (stage px). */
type Dragging = { from: number; gap: number; pitch: number };
type Picking = { rect: DOMRect };

const toDomRect = (el: Element): DOMRect => {
  const r = rectToStage(el.getBoundingClientRect());
  return new DOMRect(r.left, r.top, r.width, r.height);
};

export function StageBoardCanvas() {
  const draft = useStageBuilder((s) => s.draft);
  const round = useStageBuilder((s) => s.round);
  const stageNumber = useStageBuilder((s) => s.stageNumber);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [picking, setPicking] = useState<Picking | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  /** Detaches the in-flight press's window listeners (a press that unmounts / changes round mid-drag). */
  const endPressRef = useRef<(() => void) | null>(null);
  useEffect(() => () => endPressRef.current?.(), []);

  // A different round (or stage) is a different board: close whatever was open on the old one.
  useEffect(() => { endPressRef.current?.(); setEditing(null); setPicking(null); setDragging(null); }, [round, stageNumber]);

  const board = draft?.rounds[round - 1]?.board ?? [];
  // The authored minions as the fight will see them (printed + added keywords merged, golden flag).
  const minions = useMemo(() => (draft ? roundToSnapshot(draft, round, 1).minions : []), [draft, round]);
  const views = useMemo<CardView[]>(() => minions.map((m) => {
    const def = CARD_INDEX[m.cardId];
    const mult = m.golden ? 2 : 1;
    return {
      name: def?.name ?? m.cardId,
      cardId: m.cardId,
      tribe: def?.tribe ?? 'neutral',
      ...(def?.tribe2 ? { tribe2: def.tribe2 } : {}),
      attack: m.attack,
      health: m.health,
      keywords: m.keywords ?? [...(def?.keywords ?? [])],
      golden: m.golden ?? false,
      text: def?.text ?? '',
      tier: def?.tier,
      ...(def ? { baseAttack: def.attack * mult, baseHealth: def.health * mult } : {}),
    };
  }), [minions]);

  // A unit opened right after an add has no measured rect yet: measure its card once it has rendered.
  useLayoutEffect(() => {
    if (!editing || editing.rect) return;
    const el = rowRef.current?.querySelector(`[data-stbc-slot="${editing.index}"]`);
    if (el) setEditing({ index: editing.index, rect: toDomRect(el) });
  }, [editing]);

  const closeEditor = useCallback((): void => setEditing(null), []);
  const closePicker = useCallback((): void => setPicking(null), []);
  const edit = useStageBuilder.getState().editDraft;

  /** Press on a unit: arm a drag that starts only once the pointer travels past the threshold. */
  const onSlotPointerDown = (e: ReactPointerEvent<HTMLDivElement>, from: number): void => {
    if (e.button !== 0 || !rowRef.current) return;
    endPressRef.current?.();
    const row = rowRef.current;
    const startX = e.clientX;
    const startY = e.clientY;
    const r = round;
    let el: HTMLElement | null = null;
    let slots: SlotRect[] = [];
    let gap = -1;
    const move = (ev: PointerEvent): void => {
      const dx = ev.clientX - startX;
      if (gap < 0) {
        if (Math.hypot(dx, ev.clientY - startY) < DRAG_THRESHOLD) return;
        // DRAG START — the one layout read of the whole drag: every slot's resting box, in screen space.
        const els = [...row.querySelectorAll<HTMLElement>('[data-stbc-slot]')];
        slots = els.map((s) => { const b = s.getBoundingClientRect(); return { left: b.left, width: b.width }; });
        el = els[from] ?? null;
        gap = from;
        setEditing(null);
        setPicking(null);
        setDragging({ from, gap, pitch: toStage(slotPitch(slots)) });
      }
      if (el) el.style.transform = `translateX(${toStage(dx)}px)`;
      const next = reorderIndexAt(slots, ev.clientX, from, gap);
      if (next !== gap) { gap = next; setDragging((d) => (d ? { ...d, gap: next } : d)); }
    };
    const detach = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      endPressRef.current = null;
    };
    const finish = (commit: boolean): void => {
      detach();
      if (gap < 0) return; // never became a drag: a plain click
      if (el) el.style.transform = '';
      setDragging(null);
      const to = gap;
      if (commit && to !== from) edit((st) => moveMinion(st, r, from, to));
    };
    const up = (): void => finish(true);
    const cancel = (): void => finish(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    endPressRef.current = () => finish(false);
  };

  const pickCard = (cardId: string): void => {
    const index = board.length;
    if (index >= GAUNTLET_BOARD_MAX) return;
    edit((s) => addMinion(s, round, cardId));
    setPicking(null);
    setEditing({ index, rect: null });
  };

  if (!draft) return null;
  const tier = roundTier(draft, round);
  const cur = editing ? board[editing.index] : undefined;
  const def = cur ? CARD_INDEX[cur.cardId] : undefined;
  const empty = Math.max(0, GAUNTLET_BOARD_MAX - board.length);

  return createPortal(
    <div className="stbc" aria-label={`Stage ${draft.number} round ${round}: the opponent's warband`}>
      <div className="boardbg boardbg--combat shown" aria-hidden="true" />
      <div className="stbc-head">
        <span className="stbc-stage">Stage {draft.number} · {draft.name}</span>
        <span className="stbc-round">Round {round}</span>
        <span className="stbc-opp">{draft.opponentName}</span>
        <span className="stbc-tier">Tier {tier}</span>
      </div>
      <div className="stbc-hint">Double-click a unit to edit it · drag to reorder · + adds one</div>
      <div className={`row stbc-row${dragging ? ' reordering' : ''}`} ref={rowRef}>
        <MinionSkins snapshot={null}>
          {views.map((v, i) => (
            <div
              key={`${i}-${v.cardId}`}
              className={`stbc-slot${editing?.index === i ? ' editing' : ''}${dragging?.from === i ? ' dragged' : ''}`}
              data-stbc-slot={i}
              style={dragging && slideSlots(i, dragging.from, dragging.gap) !== 0
                ? { transform: `translateX(${slideSlots(i, dragging.from, dragging.gap) * dragging.pitch}px)` }
                : undefined}
              onPointerDown={(e) => onSlotPointerDown(e, i)}
              onDragStart={(e) => e.preventDefault()}
              onDoubleClick={(e) => { setPicking(null); setEditing({ index: i, rect: toDomRect(e.currentTarget) }); }}
            >
              <Card card={v} forceCompact own={false} />
            </div>
          ))}
        </MinionSkins>
        {Array.from({ length: empty }, (_, i) => (
          <button
            key={`empty-${i}`}
            type="button"
            className="stbc-add"
            onClick={(e) => { setEditing(null); setPicking({ rect: toDomRect(e.currentTarget) }); }}
            aria-label={`Add a minion to round ${round}`}
          >
            +
          </button>
        ))}
      </div>

      {editing && cur && editing.rect && (
        <UnitEditor
          value={{ cardId: cur.cardId, attack: cur.attack, health: cur.health, keywords: [...(def?.keywords ?? []), ...(cur.addedKeywords ?? [])] }}
          anchor={editing.rect}
          cards={allSwapCards()}
          searchable
          lockedKeywords={def?.keywords ?? []}
          onChange={(patch) => {
            const i = editing.index;
            if (patch.cardId !== undefined) {
              const cardId = patch.cardId;
              edit((s) => swapMinionCard(s, round, i, cardId));
            } else {
              edit((s) => setMinionStats(s, round, i, patch));
            }
          }}
          onToggleKeyword={(kw) => { const i = editing.index; edit((s) => toggleAddedKeyword(s, round, i, kw)); }}
          golden={cur.golden === true}
          onToggleGolden={() => { const i = editing.index; edit((s) => toggleMinionGolden(s, round, i)); }}
          onRemove={() => { const i = editing.index; setEditing(null); edit((s) => removeMinion(s, round, i)); }}
          onClose={closeEditor}
        />
      )}
      {picking && <AddPicker anchor={picking.rect} onPick={pickCard} onClose={closePicker} />}
    </div>,
    stageHost(),
  );
}

/** The "+" slot's card search: type, pick (or Enter for the top match). Escape / a click outside closes. */
function AddPicker({ anchor, onPick, onClose }: { anchor: DOMRect; onPick: (cardId: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchMinions(query).slice(0, 12), [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    const onDown = (e: PointerEvent): void => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);

  const vp = stageViewport();
  const width = 260;
  const left = Math.max(8, Math.min(vp.w - width - 8, anchor.left + anchor.width / 2 - width / 2));
  const top = Math.min(vp.h - 8, anchor.bottom + 6);

  return createPortal(
    <div className="uned stbc-picker" ref={ref} style={{ left, top, width }} onPointerDown={(e) => e.stopPropagation()}>
      <input
        className="uned-find"
        autoFocus
        value={query}
        placeholder="add a minion: name, tribe, keyword…"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); onPick(results[0].id); } }}
        aria-label="Search every minion card. Space-separated terms must all match. Enter adds the top match."
      />
      {results.length > 0 && (
        <div className="uned-found">
          {results.map((c) => (
            <button key={c.id} className="uned-foundrow" onClick={() => onPick(c.id)}>
              <span className={`sb-t sb-t${c.tier}`}>{c.tier}</span> {c.name}
            </button>
          ))}
        </div>
      )}
      {query.trim() !== '' && results.length === 0 && <div className="stbc-none">no card matches</div>}
    </div>,
    stageHost(),
  );
}
