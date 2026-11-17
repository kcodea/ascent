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
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MutableRefObject, type RefObject } from 'react';
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

export function HeroShowcase(props: HeroShowcaseProps): JSX.Element {
  const { choices, selected, onSelect, onConfirm, onDenied, blocked, canReroll, onReroll, swapping, mateTaken, watching, showDifficulty, loadout, artRef, slotEls } = props;
  const n = choices.length;
  const heroId = choices[selected] ?? choices[0] ?? '';
  const hero = getHero(heroId);

  // The Ancient on show: a preview only (it never chooses one for the run), kept as the selection moves.
  const [anc, setAnc] = useState<AncientId>(lastPickedAncient);
  const pickAncient = useCallback((a: AncientId): void => { rememberAncient(a); setAnc(a); }, []);

  const step = (d: number): void => { if (n > 1) onSelect((((selected + d) % n) + n) % n); };

  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!watching) bodyRef.current?.focus({ preventScroll: true }); }, [watching]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      step(e.key === 'ArrowLeft' ? -1 : 1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      pickAncient(stepAncient(anc, e.key === 'ArrowUp' ? -1 : 1));
    }
  };

  const rowRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLElement>(null);
  slotEls.current.length = n;
  useTileGlow(rowRef, glowRef, slotEls, selected, n);

  const tip = heroTip(heroId);
  const extraFacts = showDifficulty && tip ? [tip.difficulty] : undefined;

  return (
    <div ref={bodyRef} className="hss-body" tabIndex={-1} onKeyDown={onKeyDown}>
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
            </div>
          );
        })}
      </div>
      <div className="hss-stage">
        {n > 1 && <button type="button" className="phi-nav is-prev" aria-label="Previous hero" onClick={() => step(-1)}><Icon name="chevron" /></button>}
        <HeroInspectCard
          key={heroId}
          hero={hero}
          art={heroPortrait(heroId, loadout)}
          ancient={anc}
          onAncient={pickAncient}
          {...(extraFacts ? { extraFacts } : {})}
          artRef={artRef}
          className="hss-card"
        />
        {n > 1 && <button type="button" className="phi-nav is-next" aria-label="Next hero" onClick={() => step(1)}><Icon name="chevron" /></button>}
      </div>
      {!watching && (
        <button
          type="button"
          className="hss-confirm phk-btn v-primary"
          aria-disabled={blocked !== null}
          onClick={() => { if (blocked !== null) onDenied(); else onConfirm(); }}
        >
          {blocked === 'mate' ? 'Taken by your teammate' : 'Select Hero'}
        </button>
      )}
    </div>
  );
}
