import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ANCIENT_IDS, ANCIENTS } from '@game/sim';
import { heroArt } from './art';
import { stageHost, stageViewport, toStage } from './stage';
import { HERO_PICK_INDEX, ancientTally, heroPickerSections, type HeroPick } from './sceneBuilderHeroes';

/**
 * THE SCENE BUILDER'S VISUAL HERO PICKER (owner ask 2026-10-03: "expand the panel out to the left or something with
 * all the hero portraits to simply click"). Replaces the long native hero <select>.
 *
 *  · The TRIGGER (`HeroPickerTrigger`) sits in Setup: the current hero's portrait + name.
 *  · The FLYOUT (`HeroPicker`) slides out beside the panel (LEFT when there is room, else right), portalled into the
 *    stage host like the Library preview: a search box, current heroes A to Z, then the ARCHIVED block at the bottom
 *    (dimmed, still clickable). In Set 3 every hero with Ancients pairings wears a badge (all six = check, some =
 *    half disc), derived from `ANCIENT_PAIRINGS` (sceneBuilderHeroes.ts), with a legend + tally + "needs work" filter.
 *  · Keyboard: typing filters; ↓ walks into the grid; arrows move; ↵ picks; Esc closes (focus back to the trigger).
 *    Closes on a pick and on any pointerdown outside it. A readout line under the grid names the hovered hero and, in
 *    Set 3, which Ancients it still lacks (a line, not a tooltip: a bubble would clip inside the scrolling grid).
 *
 * PERFORMANCE: the grid only exists while open; portraits are `loading="lazy"` + `decoding="async"` plain <img>s (the
 * full `HeroPortraitRing` subscribes each tile to the portrait-frame tuner and decodes synchronously: wrong for a grid
 * of 59). Placement reads the panel's rect ONCE per open. The slide-in is a one-shot transform/opacity animation.
 */

/** Grid columns. Fixed (the CSS grid uses the same count) so ↑/↓ know a row's length without reading layout. */
export const HERO_PICKER_COLS = 5;

/** Where an arrow / Home / End key moves the cursor in the sectioned grid. `sizes` are the sections' tile counts
 *  (current, archived), laid out one after the other, each starting a fresh row. 'search' = ↑ off the top row. */
export function heroGridMove(i: number, key: string, sizes: readonly number[], cols = HERO_PICKER_COLS): number | 'search' {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total === 0) return 'search';
  // flat index -> (section, local index)
  let s = 0;
  let j = i;
  while (s < sizes.length - 1 && j >= sizes[s]!) { j -= sizes[s]!; s++; }
  const start = i - j;
  const col = j % cols;
  switch (key) {
    case 'ArrowRight': return Math.min(total - 1, i + 1);
    case 'ArrowLeft': return Math.max(0, i - 1);
    case 'Home': return 0;
    case 'End': return total - 1;
    case 'ArrowDown': {
      if (j + cols < sizes[s]!) return i + cols;
      // the section's last row may be short: drop to its last tile when there is a row below this one
      const lastRow = Math.floor((sizes[s]! - 1) / cols);
      if (Math.floor(j / cols) < lastRow) return start + sizes[s]! - 1;
      let ns = s + 1;
      let nStart = start + sizes[s]!;
      while (ns < sizes.length && sizes[ns] === 0) ns++;
      if (ns >= sizes.length) return i;
      for (let k = s + 1; k < ns; k++) nStart += sizes[k]!;
      return nStart + Math.min(col, sizes[ns]! - 1);
    }
    case 'ArrowUp': {
      if (j - cols >= 0) return i - cols;
      let ps = s - 1;
      let pEnd = start;
      while (ps >= 0 && sizes[ps] === 0) ps--;
      if (ps < 0) return 'search';
      for (let k = s - 1; k > ps; k--) pEnd -= sizes[k]!;
      const pStart = pEnd - sizes[ps]!;
      const lastRowStart = Math.floor((sizes[ps]! - 1) / cols) * cols;
      return pStart + Math.min(lastRowStart + col, sizes[ps]! - 1);
    }
    default: return i;
  }
}

const ancientNames = (ids: readonly string[]): string => ids.map((id) => ANCIENTS[id as keyof typeof ANCIENTS]?.name ?? id).join(', ');

/** The Ancients badge for a tile / the trigger (Set 3 only). */
function AncientBadge({ h }: { h: HeroPick }): JSX.Element | null {
  if (h.coverage === 'none') return null;
  if (h.coverage === 'full') return <span className="sbhp-anc full" aria-hidden>✓</span>;
  return <span className="sbhp-anc partial" aria-hidden>◐ {h.ancients.length}/{ANCIENT_IDS.length}</span>;
}

function ancientsLine(h: HeroPick): string {
  if (h.coverage === 'full') return 'All 6 Ancients written.';
  if (h.coverage === 'none') return 'No Ancients written yet.';
  const missing = ANCIENT_IDS.filter((id) => !h.ancients.includes(id));
  return `${h.ancients.length} of 6 Ancients written. Missing: ${ancientNames(missing)}.`;
}

/** The small round portrait (lazy). A missing art file shows the hero's initial instead of a broken image. */
const Portrait = memo(function Portrait({ id, name, eager }: { id: string; name: string; eager?: boolean }) {
  const src = heroArt(id);
  return (
    <span className="sbhp-face" aria-hidden>
      {src ? <img src={src} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" draggable={false} /> : <b>{name.slice(0, 1)}</b>}
    </span>
  );
});

/** Setup's hero button: the current hero's portrait + name; opens the flyout. */
export function HeroPickerTrigger({ heroId, showAncients, open, onToggle, btnRef }: {
  heroId: string; showAncients: boolean; open: boolean; onToggle: () => void; btnRef: React.RefObject<HTMLButtonElement>;
}): JSX.Element {
  const h = HERO_PICK_INDEX[heroId];
  const name = h?.name ?? heroId;
  return (
    <button ref={btnRef} type="button" className={`sbhp-trigger${open ? ' open' : ''}`} onClick={onToggle}
      aria-haspopup="dialog" aria-expanded={open}
      aria-label={`Hero: ${name}. Choose a hero (restarts the sandbox so the hero's opener runs)`}>
      <Portrait id={heroId} name={name} eager />
      <span className="sbhp-trigger-txt">
        <span className="sbhp-trigger-name">{name}</span>
        <span className="sbhp-trigger-sub">
          {h?.archived ? 'archived · ' : ''}
          {showAncients && h ? (h.coverage === 'full' ? '✓ Ancients' : h.coverage === 'partial' ? `◐ Ancients ${h.ancients.length}/6` : 'no Ancients') : 'change hero'}
        </span>
      </span>
      <span className="sbhp-trigger-caret" aria-hidden>{open ? '▸' : '◂'}</span>
    </button>
  );
}

/** One portrait tile. Memoized: typing re-filters the list, and unchanged tiles must not re-render. */
const Tile = memo(function Tile({ h, idx, current, cursor, showAncients, onPick, onKey, onHover }: {
  h: HeroPick; idx: number; current: boolean; cursor: boolean; showAncients: boolean;
  onPick: (id: string) => void; onKey: (e: React.KeyboardEvent<HTMLButtonElement>, idx: number, id: string) => void;
  onHover: (h: HeroPick | null) => void;
}) {
  return (
    <button type="button" role="option" aria-selected={current} data-idx={idx} data-hero={h.id}
      tabIndex={cursor ? 0 : -1}
      className={`sbhp-tile${current ? ' cur' : ''}${h.archived ? ' arch' : ''}`}
      onClick={() => onPick(h.id)} onKeyDown={(e) => onKey(e, idx, h.id)}
      onMouseEnter={() => onHover(h)} onFocus={() => onHover(h)}
      aria-label={`${h.name}${h.archived ? ' (archived)' : ''}${current ? ', current hero' : ''}${showAncients ? `. ${ancientsLine(h)}` : ''}`}>
      <span className="sbhp-tile-face">
        <Portrait id={h.id} name={h.name} />
        {showAncients && <AncientBadge h={h} />}
      </span>
      <span className="sbhp-tile-name">{h.name}</span>
    </button>
  );
});

export function HeroPicker({ heroId, showAncients, anchor, triggerRef, onPick, onClose }: {
  heroId: string;
  /** Set 3 only: the Ancients badges, legend, tally and the "needs Ancients" filter. */
  showAncients: boolean;
  /** The Scene Builder panel: read ONCE on open to seat the flyout beside it. */
  anchor: () => HTMLElement | null;
  /** The trigger button: a pointerdown on it is not an "outside" click (it toggles instead). */
  triggerRef: React.RefObject<HTMLElement>;
  onPick: (id: string) => void;
  onClose: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const { active, archived } = useMemo(() => heroPickerSections(query, showAncients && missingOnly), [query, missingOnly, showAncients]);
  const shown = useMemo(() => [...active, ...archived], [active, archived]);
  const sizes = useMemo(() => [active.length, archived.length] as const, [active, archived]);
  const tally = useMemo(() => ancientTally(), []);
  const curIdx = shown.findIndex((h) => h.id === heroId);
  const [cursor, setCursor] = useState(() => Math.max(0, curIdx));
  // Re-filtering moves the cursor to the top match (so ↵ / ↓ from the box land on what you typed).
  useEffect(() => { setCursor(query.trim() === '' ? Math.max(0, curIdx) : 0); }, [query, missingOnly]);

  // PLACEMENT — once per open. Left of the panel when it fits, else right; clamped to the stage vertically.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vp = stageViewport();
    const gap = 10;
    const w = el.offsetWidth;
    const r = anchor()?.getBoundingClientRect();
    const pl = r ? toStage(r.left) : vp.w / 2;
    const pr = r ? toStage(r.right) : vp.w / 2;
    const pt = r ? toStage(r.top) : 16;
    const left = pl - gap - w >= 8 ? pl - gap - w : Math.min(pr + gap, vp.w - w - 8);
    const top = Math.max(8, Math.min(pt, vp.h - 320));
    el.dataset.side = left < pl ? 'left' : 'right';
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.maxHeight = `${Math.round(vp.h - top - 8)}px`;
    el.style.visibility = 'visible';
    searchRef.current?.focus();
    // keep the current hero in view when the list is long
    gridRef.current?.querySelector<HTMLElement>('.sbhp-tile.cur')?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  // OUTSIDE CLICK closes (the trigger toggles on its own, so it is excluded).
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node | null;
      if (!t || ref.current?.contains(t) || triggerRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [onClose, triggerRef]);

  const focusIdx = (i: number): void => {
    setCursor(i);
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-idx="${i}"]`);
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest' });
  };
  const close = (): void => { onClose(); triggerRef.current?.focus(); };
  const pick = (id: string): void => { if (id !== heroId) onPick(id); onClose(); };

  // The tiles' handlers go through a ref so their identities never change: a memoized tile then re-renders only
  // when ITS props (current / cursor / badge) change, not on every keystroke in the search box.
  const live = useRef({ pick, sizes, focusIdx, close });
  live.current = { pick, sizes, focusIdx, close };
  const onTilePick = useCallback((id: string): void => live.current.pick(id), []);
  const onTileKey = useCallback((e: React.KeyboardEvent<HTMLButtonElement>, idx: number, id: string): void => {
    const L = live.current;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); L.pick(id); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); L.close(); return; }
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = heroGridMove(idx, e.key, L.sizes);
    if (next === 'search') searchRef.current?.focus();
    else L.focusIdx(next);
  }, []);
  // The readout line under the grid names the hovered / focused hero (and, in Set 3, which Ancients it lacks). It is
  // written straight to the DOM: hovering across the grid must not re-render the picker.
  const readoutRef = useRef<HTMLDivElement | null>(null);
  const onTileHover = useCallback((h: HeroPick | null): void => {
    const el = readoutRef.current;
    if (!el) return;
    el.textContent = h ? `${h.name}${h.archived ? ' (archived)' : ''}${showAncients ? `: ${ancientsLine(h)}` : ''}` : '';
  }, [showAncients]);

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const h = shown[Math.min(cursor, shown.length - 1)];
      if (h) pick(h.id);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (shown.length > 0) focusIdx(Math.min(cursor, shown.length - 1));
    }
  };

  const tiles = (list: HeroPick[], offset: number): JSX.Element[] => list.map((h, k) => (
    <Tile key={h.id} h={h} idx={offset + k} current={h.id === heroId} cursor={offset + k === cursor}
      showAncients={showAncients} onPick={onTilePick} onKey={onTileKey} onHover={onTileHover} />
  ));

  return createPortal(
    <div ref={ref} className="sbhp" role="dialog" aria-label="Choose a hero" style={{ visibility: 'hidden' }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } }}>
      <div className="sbhp-head">
        <span className="sbhp-title">Choose hero</span>
        <span className="sbhp-count">{shown.length}</span>
        <button type="button" className="sbhp-x" onClick={close} aria-label="Close the hero picker">✕</button>
      </div>
      <input ref={searchRef} className="sbhp-search" value={query} placeholder="Search heroes… ↵ picks the top match"
        onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey}
        aria-label="Filter heroes by name or id. Enter picks the top match, Down arrow walks the grid, Escape closes." />
      {showAncients && (
        <div className="sbhp-legend">
          <span><span className="sbhp-anc full" aria-hidden>✓</span> has Ancients</span>
          <span><span className="sbhp-anc partial" aria-hidden>◐</span> partial</span>
          <span className="sbhp-tally">{tally.full} / {tally.current} heroes{tally.partial > 0 ? ` (+${tally.partial} partial)` : ''}</span>
          <button type="button" className={`sbhp-filter${missingOnly ? ' on' : ''}`} aria-pressed={missingOnly}
            onClick={() => setMissingOnly((m) => !m)}
            aria-label="Show only heroes whose Ancients are not all written">needs Ancients</button>
        </div>
      )}
      <div className="sbhp-scroll" ref={gridRef} role="listbox" aria-label="Heroes">
        {active.length > 0 && <div className="sbhp-grid">{tiles(active, 0)}</div>}
        {archived.length > 0 && (
          <>
            <div className="sbhp-sec">Archived <em>{archived.length}</em></div>
            <div className="sbhp-grid">{tiles(archived, active.length)}</div>
          </>
        )}
        {shown.length === 0 && <div className="sbhp-empty">no heroes match</div>}
      </div>
      <div className="sbhp-readout" ref={readoutRef} aria-live="polite" />
    </div>,
    stageHost(),
  );
}
