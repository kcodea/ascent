import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CARD_INDEX, GAUNTLET_BOARD_MAX } from '@game/content';
import { Card, type CardView } from '../Card';
import { MinionSkins } from '../skins/skins';
import { UnitEditor } from '../UnitEditor';
import { rectToStage, stageHost, stageViewport } from '../stage';
import { useStageBuilder } from './stageBuilderStore';
import {
  addMinion, removeMinion, roundTier, roundToSnapshot, setMinionStats, swapMinionCard, toggleAddedKeyword,
  toggleMinionGolden,
} from './stageDraft';
import { allMinions, searchMinions } from './minionSearch';

/**
 * DEV-only STAGE BOARD CANVAS — the visual half of the Stage Builder (owner ask 2026-09-29: "i only need to edit
 * the opponent warband … lets show the combat phase UI instead"). While the builder is open it covers the whole
 * stage, opaque, with the combat board art and ONLY the opponent's warband for the selected round: no player
 * warband, no shop or its controls, no lobby rail. The recruit screen beneath is covered and unreachable.
 *
 *  - Double-click a unit → the shared `UnitEditor`, anchored to it, editing the DRAFT (stats, ADDED keywords —
 *    the card's printed ones show locked on — Golden, card swap with search, remove).
 *  - Click a "+" slot → a card search; picking appends that minion at its printed stats and opens the editor on it.
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

  // A different round (or stage) is a different board: close whatever was open on the old one.
  useEffect(() => { setEditing(null); setPicking(null); }, [round, stageNumber]);

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
      <div className="stbc-hint">Double-click a unit to edit it · + adds one</div>
      <div className="row stbc-row" ref={rowRef}>
        <MinionSkins snapshot={null}>
          {views.map((v, i) => (
            <div
              key={`${i}-${v.cardId}`}
              className={`stbc-slot${editing?.index === i ? ' editing' : ''}`}
              data-stbc-slot={i}
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
