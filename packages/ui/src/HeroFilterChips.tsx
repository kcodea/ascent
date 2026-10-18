import { memo, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { getHero } from '@game/sim';
import { heroArt } from './art';
import { HERO_CHIP_CAP, type HeroCount } from './heroFilter';

const gamesText = (n: number): string => `${n} ${n === 1 ? 'game' : 'games'}`;

/**
 * THE HERO FILTER ROW (Recent Games; "More" dropdown owner ask 2026-10-18): "All heroes", then the most played heroes
 * of the loaded games as chips, as many as fit on ONE line, then a "More" chip that opens a list of EVERY hero in the
 * loaded games (portrait, name, game count; most played first, then by name). A hero picked from the list that has no
 * chip of its own takes the More chip's place as an active "<Hero>" chip, so the filter stays visible; "All heroes"
 * (the chip, or the top of the list) clears it.
 *
 * The list is the Esc menu's dropdown (`.escselect-list` / `.escselect-opt`, SettingSelect in EscMenu.tsx): mounted
 * only while open, a one-shot opacity + transform entry, options are buttons so the global gauntlet cursor paints them.
 * Closes on a pick, a press outside, Esc (claimed in the capture phase so it never closes the page too) or Tab.
 * Arrows / Home / End move between options.
 *
 * Perf: `counts` arrives memoised; the one-line fit is measured in a layout effect only when the counts, the selection
 * or the row's width change (a ResizeObserver, never per frame), and each pass drops one chip until the row fits.
 */
export const HeroFilterChips = memo(function HeroFilterChips({ counts, value, onChange }: {
  counts: readonly HeroCount[];
  value: string | null;
  onChange: (heroId: string | null) => void;
}): JSX.Element | null {
  const max = Math.min(HERO_CHIP_CAP, counts.length);
  const [fit, setFit] = useState(max);
  const [width, setWidth] = useState(0);
  const [open, setOpen] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const shownN = Math.min(fit, max);
  const chips = counts.slice(0, shownN);
  const hasMore = counts.length > shownN;
  const inMore = value !== null && !chips.some((c) => c.id === value);

  // The row's width: re-measure the fit only when it actually changes.
  useEffect(() => {
    const el = groupRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      setWidth((old) => (old === w ? old : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ONE LINE: start from the cap whenever the list or the width changes, then drop a chip while the last item wraps.
  const basis = useRef<{ counts: readonly HeroCount[]; width: number } | null>(null);
  useLayoutEffect(() => {
    const b = basis.current;
    if (!b || b.counts !== counts || b.width !== width) {
      basis.current = { counts, width };
      if (fit !== max) { setFit(max); return; }
    }
    const g = groupRef.current;
    const first = g?.firstElementChild as HTMLElement | null;
    const last = g?.lastElementChild as HTMLElement | null;
    if (first && last && first !== last && last.offsetTop > first.offsetTop && fit > 0) setFit(fit - 1);
  }, [counts, width, fit, max, value]);

  // While open: a press outside closes it, and Esc closes ONLY the list (capture phase, before the page's own Esc).
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent): void => {
      if (!moreRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', onKey, true);
    // Focus the chosen option (else the first) so the arrows start from it.
    const list = listRef.current;
    (list?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? list?.querySelector<HTMLButtonElement>('[role="option"]'))?.focus();
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  if (counts.length === 0) return null;

  const pick = (id: string | null): void => {
    if (open) { setOpen(false); triggerRef.current?.focus(); }
    if (id !== value) onChange(id);
  };
  const onListKey = (e: ReactKeyboardEvent): void => {
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = Math.min(items.length - 1, at + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, at - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'Tab') setOpen(false);
    if (next >= 0) { e.preventDefault(); items[next]?.focus(); }
  };

  const moreLabel = inMore ? getHero(value).name : 'More';
  return (
    <div className="rg-filters" role="group" aria-label="Filter by hero" ref={groupRef}>
      <button type="button" className={`rg-chip${value === null ? ' on' : ''}`} aria-pressed={value === null} onClick={() => pick(null)}>All heroes</button>
      {chips.map((c) => (
        <button type="button" key={c.id} className={`rg-chip${value === c.id ? ' on' : ''}`} aria-pressed={value === c.id} onClick={() => pick(c.id)}>{getHero(c.id).name}</button>
      ))}
      {(hasMore || inMore) && (
        <div className={`rg-more${open ? ' open' : ''}`} ref={moreRef}>
          <button
            ref={triggerRef}
            type="button"
            className={`rg-chip rg-more-trigger${inMore ? ' on' : ''}`}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-label={inMore ? `Filtered to ${moreLabel}. Choose another hero.` : 'More heroes'}
            onClick={() => setOpen((o) => !o)}
            onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
          >
            <span>{moreLabel}</span>
            <svg className="escchev" viewBox="0 0 16 16" aria-hidden><path d="M3.5 6l4.5 4.5L12.5 6" /></svg>
          </button>
          {open && (
            <div className="escselect-list rg-more-list" role="listbox" id={listId} aria-label="Heroes" ref={listRef} onKeyDown={onListKey}>
              <button type="button" role="option" aria-selected={value === null} className={`escselect-opt rg-more-opt${value === null ? ' on' : ''}`} onClick={() => pick(null)}>
                <span className="rg-more-name">All heroes</span>
              </button>
              {counts.map((c) => {
                const art = heroArt(c.id);
                const name = getHero(c.id).name;
                return (
                  <button type="button" key={c.id} role="option" aria-selected={value === c.id} className={`escselect-opt rg-more-opt${value === c.id ? ' on' : ''}`} onClick={() => pick(c.id)}>
                    <span className="rg-more-face" aria-hidden>{art && <img src={art} alt="" draggable={false} decoding="sync" />}</span>
                    <span className="rg-more-name">{name}</span>
                    <span className="rg-more-n">{gamesText(c.n)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
