import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { sfx } from '../sfx';
import { useGame } from '../store';
import type { Tribe } from '@game/core';
import { isTribePoster, locationArt, POSTER_NAME, type LocationDef, type Poster } from './locations';

/** One parchment, hanging, pressable: hero select's and the quick Compendium's (QuickBook.tsx) are the same thing. */
export function PosterSheet({ location, tribe, index, label, onPress, disabled, on }: { location: LocationDef; tribe: Poster; index: number; label: string; onPress: () => void; disabled?: boolean; on?: boolean }): JSX.Element {
  // One clock for every column of them: the quick Compendium's takes over from hero select's in mid sway, and nothing jumps.
  const hang = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => { for (const a of hang.current?.getAnimations?.() ?? []) a.startTime = 0; }, []);
  return (
    <button type="button" className={`hs-poster${on ? ' on' : ''}`} style={{ '--i': index, '--c': `var(--t-${tribe})` } as CSSProperties} aria-label={label} {...(on !== undefined ? { 'aria-pressed': on } : {})} disabled={disabled} onClick={onPress}>
      <span className="hs-poster-hang" ref={hang}>
        <img decoding="sync" src={locationArt(location.id, `sheet-${tribe}`)} alt="" draggable={false} />
        <span className="hs-poster-name">{POSTER_NAME[tribe] ?? tribe}</span>
      </span>
    </button>
  );
}

/**
 * THE TRIBES, STILL HANGING AT HERO SELECT (owner 2026-11-24: "put the tribe parchments along the right side during hero select
 * as well ... clicking them open the compendium to that tribes list"; R-LOCATION-08). The reveal's own torn sheets (baked from
 * its shader at rest: `sheet-<tribe>.webp`), one for each tribe of this game, in its order. Static pictures; only transforms move.
 */
export function LocationPosters({ location, tribes, inert, duos }: { location: LocationDef; tribes: readonly Poster[]; inert: boolean; duos: boolean }): JSX.Element {
  // The page they open, fetched before it is asked for.
  useEffect(() => {
    const id = window.setTimeout(() => {
      void import('../quickBook/QuickBook');
      void document.fonts?.load?.("900 54px 'Cinzel'"); // its title's
    }, 1200);
    return () => window.clearTimeout(id);
  }, []);
  const open = (t: Tribe): void => {
    const st = useGame.getState();
    if (st.showBook) return;
    sfx.pulse();
    if (st.settingsOpen) st.closeSettings();
    st.openBookTribe(t, location.setId);
  };
  return (
    <div className={`hs-posters${duos ? ' duos' : ''}`} style={{ '--n': tribes.length } as CSSProperties}>
      {tribes.map((t, i) => (
        <PosterSheet key={t} location={location} tribe={t} index={i} disabled={inert || !isTribePoster(t)} label={isTribePoster(t) ? `${POSTER_NAME[t] ?? t}. Open the Compendium on them.` : POSTER_NAME[t] ?? t} onPress={() => { if (isTribePoster(t)) open(t); }} />
      ))}
    </div>
  );
}
