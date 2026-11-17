/**
 * THE "ALL HEROES" WINDOW (owner 2026-11-17; docs/superpowers/specs/2026-11-17-hero-select-all-heroes-design.md). On the
 * whole-roster Hero Select grid (Practice "All heroes", Gauntlet) a card click opens THIS over the dimmed grid: the
 * showcase's own inspect card with its arrows and the Select Hero button (HeroShowcaseCard, shared with the three-hero
 * showcase so they cannot drift), plus an X on the card's top-right corner. The X, a press on the scrim (anywhere
 * outside the card, its arrows and the button) and Escape close it.
 *
 * PRESENTATION ONLY. Stepping, closing and Select Hero are callbacks; HeroSelect owns the pick and its guards. While the
 * ceremony runs (`busy`) nothing closes or steps: the ceremony has cloned and hidden this card's splash art.
 *
 * Keys live on the window, never on `window` (the showcase's rule). It takes focus on mount so they work at once.
 * Loaded lazily by HeroSelect, behind the showcase DEV switch.
 */
import { useEffect, useRef, type KeyboardEvent, type MutableRefObject, type RefObject } from 'react';
import { getHero } from '@game/sim';
import { HeroShowcaseCard, HeroTile, useShowcaseNav } from './HeroShowcase';
import type { useLiveLoadout } from '../skins/skins';
import './heroShowcase.css';
import './heroBrowseWindow.css';

export interface HeroBrowseGridProps {
  heroes: readonly string[];             // the roster, in display (alphabetical) order
  lit: number | null;                    // the hero on show in the window, or the one last shown; null before any
  onOpen: (index: number) => void;       // a tile press: opens the window (it never picks)
  disabled: boolean;                     // the ceremony is running
  loadout: ReturnType<typeof useLiveLoadout>;
  gridRef: RefObject<HTMLDivElement>;    // the scroll box (HeroSelect makes it inert while the window is up)
  slotEls: MutableRefObject<(HTMLDivElement | null)[]>; // one .hss-slot per hero: the ceremony's exit set
}

/**
 * THE "ALL HEROES" GRID (owner 2026-11-17: "i want the grid to be like this", the three-hero showcase's tiles): the whole
 * roster as the showcase's own tiles (HeroTile: portrait, name, Health, Armor), wrapping in rows inside ONE inner scroll
 * box, so the screen itself never scrolls. A press opens the window. The tile whose hero is on show (or was last shown)
 * wears the showcase's gold glow, as static paint in its own slot: nothing slides here.
 */
export function HeroBrowseGrid({ heroes, lit, onOpen, disabled, loadout, gridRef, slotEls }: HeroBrowseGridProps): JSX.Element {
  useEffect(() => { slotEls.current.length = heroes.length; }, [slotEls, heroes.length]);
  return (
    <div ref={gridRef} className="hsb-grid">
      {heroes.map((id, i) => (
        <div key={id} ref={(el) => { slotEls.current[i] = el; }} className={`hss-slot${i === lit ? ' on' : ''}`}>
          {i === lit && <i className="hss-glow" aria-hidden="true" />}
          <HeroTile id={id} loadout={loadout} pressed={i === lit} disabled={disabled} onClick={() => onOpen(i)} />
        </div>
      ))}
    </div>
  );
}

export interface HeroBrowseWindowProps {
  heroes: readonly string[];           // the grid's ids, in the grid's (alphabetical) order
  index: number;                       // the hero on show
  onStep: (index: number) => void;     // arrows, Left / Right
  onClose: () => void;                 // X, scrim press, Escape
  onConfirm: () => void;               // Select Hero
  busy: boolean;                       // the ceremony is running
  showDifficulty: boolean;
  loadout: ReturnType<typeof useLiveLoadout>;
  artRef: RefObject<HTMLDivElement>;   // the card's .phi-art: the ceremony's source
}

export function HeroBrowseWindow({ heroes, index, onStep, onClose, onConfirm, busy, showDifficulty, loadout, artRef }: HeroBrowseWindowProps): JSX.Element {
  const heroId = heroes[index] ?? heroes[0] ?? '';
  const hero = getHero(heroId);
  const nav = useShowcaseNav(heroes.length, index, onStep, busy);

  const winRef = useRef<HTMLDivElement>(null);
  useEffect(() => { winRef.current?.focus({ preventScroll: true }); }, []);

  const close = (): void => { if (!busy) onClose(); };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    nav.onKeyDown(e);
  };

  return (
    <div ref={winRef} className="hsb-win" role="dialog" aria-modal="true" aria-label={hero.name} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="hsb-scrim" onClick={close} />
      <div className="hsb-panel hss-body">
        <HeroShowcaseCard
          heroId={heroId}
          count={heroes.length}
          nav={nav}
          onConfirm={onConfirm}
          onDenied={() => {}}
          blocked={busy ? 'busy' : null}
          watching={false}
          showDifficulty={showDifficulty}
          loadout={loadout}
          artRef={artRef}
        >
          <button type="button" className="hsb-x" aria-label="Close" onClick={close}>
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M6 6 18 18M18 6 6 18" />
            </svg>
          </button>
          {hero.practiceOnly && <span className="hsb-note">Not currently enabled in Play</span>}
        </HeroShowcaseCard>
      </div>
    </div>
  );
}

export default HeroBrowseWindow;
