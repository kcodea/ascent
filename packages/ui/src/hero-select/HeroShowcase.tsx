/**
 * THE HERO SELECT SHOWCASE BODY (owner 2026-11-16; DEV switch "Hero Select: showcase layout", docs/superpowers/specs/
 * 2026-11-16-hero-select-showcase-design.md). Instead of three big banners: a row of hero TILES (portrait, name, Health,
 * Armor) with one gold glow that slides to the selected tile and a re-roll button straddling each tile's top-right corner;
 * under them the Compendium's own large hero card (HeroInspectCard) for the selected hero, with prev / next arrows; then a
 * big Select Hero button.
 *
 * PRESENTATION ONLY. Clicking a tile, an arrow or Left / Right only SELECTS (`onSelect`); the pick, its guards, the re-roll
 * rules, Versus, Duos and watch mode all stay in HeroSelect. The Ancient on show is the one piece of local state: a
 * preview that survives the selection moving between heroes (seeded and remembered like the Compendium's).
 *
 * Keys live on the body itself, never on `window`: two Hero Selects can be mounted at once in Duos (my own plus the
 * teammate view), and the arrows must only move the one that has focus. The body takes focus on mount (not when watching)
 * so the arrows work without a click first.
 *
 * Loaded lazily by HeroSelect, so it (and the Compendium card's stylesheet it pulls in) never reaches the switch-off path.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import { getHero, heroTip, type AncientId } from '@game/sim';
import { HeroInspectCard } from '../HeroInspectCard';
import { lastPickedAncient, rememberAncient, stepAncient } from '../HeroAncients';
import { heroPortrait, type useLiveLoadout } from '../skins/skins';
import { SharpImg } from '../SharpImg';
import { Icon } from '../Icon';
import { ArmorMedal, HealthMedal } from '../menuIcons';
// The inspect card's paint (`.phi*`) ships in the Compendium page's chunk and is not loaded on this screen otherwise;
// the Ancients row (`.hanc*`) and the kit button come with the eager bundle, imported here so the dependency is explicit.
import '../partyHome/pages/phCompendium.css';
import '../compendium.css';
import '../partyHome/kit/kit.css';
import './heroShowcase.css';

export interface HeroShowcaseProps {
  choices: readonly string[];            // hero ids, offer order
  selected: number;
  onSelect: (index: number) => void;     // tile click, arrows, Left/Right
  onConfirm: () => void;                 // Select Hero pressed and allowed
  onDenied: () => void;                  // Select Hero pressed while blocked
  /** null = allowed; 'mate' = teammate's hero; 'pending' = Versus re-roll in flight; 'busy' = ceremony running. */
  blocked: null | 'mate' | 'pending' | 'busy';
  canReroll: boolean;
  onReroll: (slot: number) => void;
  swapping: { slot: number; from: string } | null;
  mateTaken: string | null;
  watching: boolean;                     // no Select Hero button
  showDifficulty: boolean;
  loadout: ReturnType<typeof useLiveLoadout>;
  artRef: RefObject<HTMLDivElement>;     // the card's .phi-art
  slotEls: MutableRefObject<(HTMLDivElement | null)[]>; // one .hss-slot per offer
}

/**
 * THE SLIDING GLOW. One static gold outline in the tile row, moved by `transform: translateX` and sized by `width` to the
 * selected slot's LAYOUT box (offsetLeft / offsetWidth), so a tile's hover scale never drags it. Measured when the selection
 * or the offer changes and when the row resizes; never per frame. Only a new selection glides (class `glide`); the first
 * placement and any resize snap. Mirrors `partyHome/kit/slideMarker.ts`, minus its `scaleX` (a scaled outline would stretch
 * its rounded corners and its edge).
 */
function useTileGlow(rowRef: RefObject<HTMLDivElement>, glowRef: RefObject<HTMLElement>, slotEls: MutableRefObject<(HTMLDivElement | null)[]>, selected: number, count: number): void {
  const lastIdx = useRef<number | null>(null);
  const place = useCallback((glide: boolean): void => {
    const glow = glowRef.current;
    const slot = slotEls.current[selected];
    if (!glow) return;
    // Shown by class, not an inline opacity, so the ceremony's stylesheet rule can still hide it (heroShowcase.css).
    if (!slot) { glow.classList.remove('placed'); return; }
    glow.classList.toggle('glide', glide);
    glow.style.transform = `translateX(${slot.offsetLeft}px)`;
    glow.style.width = `${slot.offsetWidth}px`;
    glow.classList.add('placed');
  }, [glowRef, slotEls, selected]);

  useLayoutEffect(() => {
    const changed = lastIdx.current !== null && lastIdx.current !== selected;
    lastIdx.current = selected;
    place(changed);
  }, [place, selected, count]);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return undefined; // (jsdom has none)
    const ro = new ResizeObserver(() => place(false));
    ro.observe(row);
    return () => ro.disconnect();
  }, [rowRef, place]);
}

/** The card's stepping and keys, and the Ancient on show. Shared by the three-hero showcase and the "All heroes" window. */
export interface ShowcaseNav {
  anc: AncientId;
  pickAncient: (a: AncientId) => void;
  /** Steps the selection by `d`, wrapping; nothing with one hero. */
  step: (d: number) => void;
  /** Left / Right step the heroes, Up / Down the Ancients. Put it on the element that holds focus, never on `window`. */
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
}

export function useShowcaseNav(count: number, selected: number, onSelect: (index: number) => void, busy: boolean): ShowcaseNav {
  // The Ancient on show: a preview only (it never chooses one for the run), kept as the selection moves.
  const [anc, setAnc] = useState<AncientId>(lastPickedAncient);
  const pickAncient = useCallback((a: AncientId): void => { rememberAncient(a); setAnc(a); }, []);
  const step = (d: number): void => { if (count > 1) onSelect((((selected + d) % count) + count) % count); };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // While the ceremony runs (focus is still on Select Hero) the keys select nothing: a change would re-key the hidden card.
    if (busy) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      step(e.key === 'ArrowLeft' ? -1 : 1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      pickAncient(stepAncient(anc, e.key === 'ArrowUp' ? -1 : 1));
    }
  };
  return { anc, pickAncient, step, onKeyDown };
}

export interface HeroShowcaseCardProps {
  heroId: string;
  count: number;                         // arrows only with more than one hero
  nav: ShowcaseNav;
  onConfirm: () => void;                 // Select Hero pressed and allowed
  onDenied: () => void;                  // Select Hero pressed while blocked
  blocked: null | 'mate' | 'pending' | 'busy';
  watching: boolean;                     // no Select Hero button
  showDifficulty: boolean;
  loadout: ReturnType<typeof useLiveLoadout>;
  artRef: RefObject<HTMLDivElement>;     // the card's .phi-art
  children?: ReactNode;                  // extra controls inside the stage (the window's X)
}

/** THE CARD STAGE (prev arrow, the Compendium's inspect card, next arrow) and the Select Hero button under it. */
export function HeroShowcaseCard({ heroId, count, nav, onConfirm, onDenied, blocked, watching, showDifficulty, loadout, artRef, children }: HeroShowcaseCardProps): JSX.Element {
  const hero = getHero(heroId);
  const tip = heroTip(heroId);
  const extraFacts = showDifficulty && tip ? [tip.difficulty] : undefined;
  return (
    <>
      <div className="hss-stage">
        {count > 1 && <button type="button" className="phi-nav is-prev" aria-label="Previous hero" onClick={() => nav.step(-1)}><Icon name="chevron" /></button>}
        <HeroInspectCard
          key={heroId}
          hero={hero}
          art={heroPortrait(heroId, loadout)}
          ancient={nav.anc}
          onAncient={nav.pickAncient}
          {...(extraFacts ? { extraFacts } : {})}
          artRef={artRef}
          className="hss-card"
        />
        {count > 1 && <button type="button" className="phi-nav is-next" aria-label="Next hero" onClick={() => nav.step(1)}><Icon name="chevron" /></button>}
        {children}
      </div>
      {!watching && (
        <button
          type="button"
          className={`hss-confirm ph-start${blocked === 'mate' ? ' is-long' : ''}`}
          aria-disabled={blocked !== null}
          onClick={() => { if (blocked !== null) onDenied(); else onConfirm(); }}
        >
          <span>{blocked === 'mate' ? 'Taken by your teammate' : 'Select Hero'}</span>
        </button>
      )}
    </>
  );
}

export function HeroShowcase(props: HeroShowcaseProps): JSX.Element {
  const { choices, selected, onSelect, onConfirm, onDenied, blocked, canReroll, onReroll, swapping, mateTaken, watching, showDifficulty, loadout, artRef, slotEls } = props;
  const n = choices.length;
  const heroId = choices[selected] ?? choices[0] ?? '';
  const nav = useShowcaseNav(n, selected, onSelect, blocked === 'busy');

  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!watching) bodyRef.current?.focus({ preventScroll: true }); }, [watching]);
  // A re-roll unmounts the focused re-roll button and focus falls to <body>, which would silence the arrows until a click.
  // Take it back, but only when focus has fallen to nothing (<body> or null): a tile or arrow the player is on keeps it,
  // and so does anything outside the body (the lobby chat input).
  useEffect(() => {
    const body = bodyRef.current;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (!watching && body && lost) body.focus({ preventScroll: true });
  }, [watching, canReroll, choices]);

  const rowRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLElement>(null);
  // Drop the refs of slots a shorter offer no longer renders (after commit, never while rendering).
  useLayoutEffect(() => { slotEls.current.length = n; }, [slotEls, n]);
  useTileGlow(rowRef, glowRef, slotEls, selected, n);

  // The re-roll has just been used (the swap is still playing) and its buttons are gone. Not once the ceremony runs.
  const rerollSpent = swapping !== null && !canReroll && blocked !== 'busy';

  return (
    <div ref={bodyRef} className="hss-body" tabIndex={-1} onKeyDown={nav.onKeyDown}>
      <div ref={rowRef} className="hss-tiles">
        <i ref={glowRef} className="hss-glow" aria-hidden="true" />
        {choices.map((id, i) => {
          const h = getHero(id);
          const art = heroPortrait(id, loadout);
          const swapHere = swapping && swapping.slot === i ? swapping : null;
          const oldArt = swapHere ? heroPortrait(swapHere.from, loadout) : null;
          const taken = mateTaken === id;
          return (
            <div
              key={`${i}:${id}`}
              ref={(el) => { slotEls.current[i] = el; }}
              className={`hss-slot${i === selected ? ' on' : ''}${taken ? ' taken' : ''}${swapHere ? ' swapping' : ''}`}
            >
              <button
                type="button"
                className="hss-tile"
                aria-pressed={i === selected}
                {...(taken ? { 'aria-label': `${h.name}, your teammate's pick` } : {})}
                onClick={() => onSelect(i)}
              >
                <span className="hss-portrait">
                  {art ? <SharpImg fade className={`hss-art${swapHere ? ' hcswap-in' : ''}`} src={art} alt="" draggable={false} /> : <Icon name="anvil" />}
                  {oldArt && <SharpImg className="hss-art hcswap-out" src={oldArt} alt="" draggable={false} aria-hidden="true" />}
                  {swapHere && <span className="rfb-shine hcswap-shine" aria-hidden="true" />}
                </span>
                {taken && <span className="hss-taken">Your teammate's pick</span>}
                <span className="hss-name" data-wkt={h.name}>{h.name}</span>
                <span className="hss-vitals">
                  <span className="hss-hp" aria-label={`${h.resolve} Health`}><HealthMedal />{h.resolve}</span>
                  {h.armor > 0 && <span className="hss-arm" aria-label={`${h.armor} Armor`}><ArmorMedal /><span className="hp-armplus">+</span>{h.armor}</span>}
                </span>
              </button>
              {canReroll && (
                <button
                  type="button"
                  className="hss-reroll gtip"
                  onClick={(e) => { e.stopPropagation(); onReroll(i); }}
                  aria-label={`Re-roll ${h.name}. Swaps this hero for a new one. One re-roll per hero select.`}
                  data-tip="Re-roll this hero. Once per hero select."
                >
                  <Icon name="refresh" />
                </button>
              )}
              {/* The re-roll was just spent: every re-roll button grows and fades away (heroShowcase.css). A ghost, not
                  the button: it takes no press and no focus, and is gone when the swap ends. */}
              {rerollSpent && <span className="hss-reroll-gone" aria-hidden="true"><Icon name="refresh" /></span>}
            </div>
          );
        })}
      </div>
      <HeroShowcaseCard
        heroId={heroId}
        count={n}
        nav={nav}
        onConfirm={onConfirm}
        onDenied={onDenied}
        blocked={blocked}
        watching={watching}
        showDifficulty={showDifficulty}
        loadout={loadout}
        artRef={artRef}
      />
    </div>
  );
}
