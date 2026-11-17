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
import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { getHero } from '@game/sim';
import { HeroShowcaseCard, useShowcaseNav } from './HeroShowcase';
import type { useLiveLoadout } from '../skins/skins';
import './heroShowcase.css';
import './heroBrowseWindow.css';

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
