// packages/ui/src/godMode/GodModePanel.tsx
import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { activeSet } from '@game/content';
import { godRuneBlocked } from '@game/sim';
import { useGame } from '../store';
import { onStageChange, stageHost, stageViewport, toStage } from '../stage';
import { SceneBuilderPreview, type SbPreviewTarget } from '../SceneBuilderPreview';
import { cardRowsFor, filterCards, matches, runeRowsFor, searchTerms, tribesIn, type CardRow, type RuneRow } from '../cardSearch';
import { clampGodPanelPos, loadGodPanelPrefs, saveGodPanelPrefs, type GodPanelPrefs } from './godPanelPrefs';
import { godPanelLocked } from './godPick';
import './godMode.css';

/**
 * GOD MODE panel (owner 2026-10-08): a player-facing learning tool, loaded only for a God Mode run and shown only in
 * the shop phase. Minions / Spells print into the shop (`godPrint`); Runes / Epic runes are granted (`godGrantRune`).
 * Tier + Tribe chips filter minions and spells (spells ignore Tribe). Separate from the DEV Scene Builder; shares
 * only the search module and the hover preview.
 *
 * While a Discover / quest / Runeforge / targeting / Ancients window owns the screen (`godPanelLocked`, the same gates
 * the reducer refuses God Mode actions behind) the panel is visibly INERT: greyed, rows disabled, with a line saying why —
 * never a click that silently does nothing.
 */
const TIERS = [1, 2, 3, 4, 5, 6];
const tribeLabel = (t: string): string => (t === 'neutral' ? 'Neutral' : t.charAt(0).toUpperCase() + t.slice(1));

type ListProps<T extends { id: string; name: string }> = {
  label: string; rows: readonly T[]; query: string; setQuery: (q: string) => void; onPick: (r: T) => void;
  onHover: (r: T, el: HTMLElement) => void; onLeave: () => void; locked: boolean; owned?: (r: T) => boolean; meta: (r: T) => string;
};

/** One searchable list. Memoized with stable callbacks so a hover / toast re-render of the panel doesn't re-render
 *  every row of all four lists. */
const List = memo(function List<T extends { id: string; name: string }>({ label, rows, query, setQuery, onPick, onHover, onLeave, locked, owned, meta }: ListProps<T>) {
  return (
    <section className="godp-list" aria-label={label}>
      <div className="godp-lh">{label}</div>
      <input className="godp-search" value={query} placeholder={`Search ${label.toLowerCase()}…`} aria-label={`Search ${label}`}
        onChange={(e) => setQuery(e.target.value)} />
      <div className="godp-rows" onMouseLeave={onLeave}>
        {rows.map((r) => {
          const isOwned = owned?.(r) ?? false;
          return (
            <button key={r.id} type="button" className="godp-row" disabled={locked || isOwned}
              aria-label={isOwned ? `${r.name} (owned)` : r.name}
              onClick={() => { if (!locked && !isOwned) onPick(r); }}
              onMouseEnter={(e) => onHover(r, e.currentTarget)} onFocus={(e) => onHover(r, e.currentTarget)} onBlur={onLeave}>
              <span className="godp-name">{r.name}</span><span className="godp-meta">{isOwned ? 'owned' : meta(r)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}) as <T extends { id: string; name: string }>(p: ListProps<T>) => ReactElement;

const tierMeta = (r: CardRow): string => `T${r.tier}`;
const noMeta = (): string => '';

export function GodModePanel() {
  const run = useGame((s) => s.run);
  const dispatch = useGame((s) => s.dispatch);
  const [prefs, setPrefs] = useState<GodPanelPrefs>(loadGodPanelPrefs);
  const update = useCallback((p: Partial<GodPanelPrefs>) => setPrefs((cur) => { const next = { ...cur, ...p }; saveGodPanelPrefs(next); return next; }), []);
  const [q, setQ] = useState({ minions: '', spells: '', runes: '', epic: '' });
  const [preview, setPreview] = useState<SbPreviewTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragEndRef = useRef<(() => void) | null>(null);

  const setId = run.setId ?? activeSet().id;
  const cards = useMemo(() => cardRowsFor(setId), [setId]);
  const runes = useMemo(() => runeRowsFor(setId), [setId]);
  const tribes = useMemo(() => tribesIn(cards), [cards]);
  const minions = useMemo(() => filterCards(cards, { spell: false, terms: searchTerms(q.minions), tiers: prefs.tiers, tribes: prefs.tribes }), [cards, q.minions, prefs.tiers, prefs.tribes]);
  const spells = useMemo(() => filterCards(cards, { spell: true, terms: searchTerms(q.spells), tiers: prefs.tiers, tribes: [] }), [cards, q.spells, prefs.tiers]);
  const basic = useMemo(() => runes.filter((r) => !r.epic && matches(r.hay, searchTerms(q.runes))), [runes, q.runes]);
  const epic = useMemo(() => runes.filter((r) => r.epic && matches(r.hay, searchTerms(q.epic))), [runes, q.epic]);

  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), 1800); return () => window.clearTimeout(t); }, [toast]);
  // A drag in flight when the panel unmounts (the fight starts) must not leave window listeners behind.
  useEffect(() => () => dragEndRef.current?.(), []);
  // The saved spot is clamped to the CURRENT stage on every render, and a stage resize re-renders: a panel parked
  // on a wide window can never be stranded off-stage on a narrower one (its header always stays grabbable). The
  // saved prefs keep the original spot, so it returns there when the window is wide again.
  const [, setStageTick] = useState(0);
  useEffect(() => onStageChange(() => setStageTick((n) => n + 1)), []);
  const pos0 = clampGodPanelPos(prefs, stageViewport());

  // Hover preview: one rect read per hover (never per frame), converted to stage px for the preview's placement.
  const hover = useCallback((kind: 'card' | 'rune', id: string, el: HTMLElement): void => {
    const row = el.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    const right = Math.max(row.right, panel?.right ?? 0);
    setPreview({ kind, id, anchor: new DOMRect(toStage(row.left), toStage(row.top), toStage(right - row.left), toStage(row.height)) });
  }, []);
  const hoverCard = useCallback((r: CardRow, el: HTMLElement) => hover('card', r.id, el), [hover]);
  const hoverRune = useCallback((r: RuneRow, el: HTMLElement) => hover('rune', r.id, el), [hover]);
  const leave = useCallback(() => setPreview(null), []);

  const print = useCallback((r: CardRow): void => dispatch({ type: 'godPrint', cardId: r.id }), [dispatch]);
  const grant = useCallback((r: RuneRow): void => {
    const before = useGame.getState().run.ownedRunes?.length ?? 0;
    dispatch({ type: 'godGrantRune', runeId: r.id });
    if ((useGame.getState().run.ownedRunes?.length ?? 0) > before) setToast(`Gained ${r.name}`); // only when it landed
  }, [dispatch]);
  const owned = useCallback((r: RuneRow): boolean => godRuneBlocked(run, r.id), [run]);
  const setMinionQ = useCallback((v: string) => setQ((c) => ({ ...c, minions: v })), []);
  const setSpellQ = useCallback((v: string) => setQ((c) => ({ ...c, spells: v })), []);
  const setRuneQ = useCallback((v: string) => setQ((c) => ({ ...c, runes: v })), []);
  const setEpicQ = useCallback((v: string) => setQ((c) => ({ ...c, epic: v })), []);

  // Drag by the header: pointer deltas in screen px → stage px, clamped to the stage. The element is moved directly
  // (no React render per pointer move — the lists are long); the position is committed to prefs on release.
  const onHeadDown = (e: ReactPointerEvent): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const el = panelRef.current;
    if (!el) return;
    const start = { x: e.clientX, y: e.clientY, px: pos0.x, py: pos0.y };
    let pos = { x: pos0.x, y: pos0.y };
    const move = (ev: PointerEvent): void => {
      pos = clampGodPanelPos({ x: start.px + toStage(ev.clientX - start.x), y: start.py + toStage(ev.clientY - start.y) }, stageViewport());
      el.style.left = `${pos.x}px`;
      el.style.top = `${pos.y}px`;
    };
    const end = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      dragEndRef.current = null;
    };
    const up = (): void => { end(); update({ x: pos.x, y: pos.y }); };
    dragEndRef.current?.();
    dragEndRef.current = end;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  if (run.godMode !== true || run.phase !== 'recruit') return null;
  const locked = godPanelLocked(run);
  const toggle = <T,>(list: readonly T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return createPortal(
    <>
      <div ref={panelRef} className={`godp${prefs.collapsed ? ' collapsed' : ''}${locked ? ' inert' : ''}`} style={{ left: pos0.x, top: pos0.y }}
        role="region" aria-label="God Mode" aria-disabled={locked || undefined}>
        <div className="godp-head" onPointerDown={onHeadDown}>
          <span className="godp-title">God Mode</span>
          <button type="button" className="godp-fold" aria-label={prefs.collapsed ? 'Expand God Mode' : 'Collapse God Mode'}
            onClick={() => update({ collapsed: !prefs.collapsed })}>{prefs.collapsed ? '▸' : '▾'}</button>
        </div>
        {!prefs.collapsed && (
          <div className="godp-body">
            {locked && <div className="godp-lock" role="status">Finish the open choice to use God Mode</div>}
            <div className="godp-chips" role="group" aria-label="Tier filter">
              {TIERS.map((t) => (
                <button key={t} type="button" className={`godp-chip godp-tier${prefs.tiers.includes(t) ? ' on' : ''}`} aria-pressed={prefs.tiers.includes(t)}
                  onClick={() => update({ tiers: toggle(prefs.tiers, t) })}>{t}</button>
              ))}
            </div>
            <div className="godp-chips" role="group" aria-label="Tribe filter (minions)">
              {tribes.map((t) => (
                <button key={t} type="button" className={`godp-chip godp-tribe${prefs.tribes.includes(t) ? ' on' : ''}`} aria-pressed={prefs.tribes.includes(t)}
                  onClick={() => update({ tribes: toggle(prefs.tribes, t) })}>{tribeLabel(t)}</button>
              ))}
            </div>
            <List label="Minions" rows={minions} query={q.minions} setQuery={setMinionQ} onPick={print}
              onHover={hoverCard} onLeave={leave} locked={locked} meta={tierMeta} />
            <List label="Spells" rows={spells} query={q.spells} setQuery={setSpellQ} onPick={print}
              onHover={hoverCard} onLeave={leave} locked={locked} meta={tierMeta} />
            <List label="Runes" rows={basic} query={q.runes} setQuery={setRuneQ} onPick={grant}
              onHover={hoverRune} onLeave={leave} locked={locked} owned={owned} meta={noMeta} />
            <List label="Epic runes" rows={epic} query={q.epic} setQuery={setEpicQ} onPick={grant}
              onHover={hoverRune} onLeave={leave} locked={locked} owned={owned} meta={noMeta} />
            {toast && <div className="godp-toast" role="status">{toast}</div>}
          </div>
        )}
      </div>
      <SceneBuilderPreview target={prefs.collapsed ? null : preview} run={run} />
    </>,
    stageHost(),
  );
}
