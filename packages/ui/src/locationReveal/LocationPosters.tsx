import type { CSSProperties } from 'react';
import type { Tribe } from '@game/core';
import { sfx } from '../sfx';
import { useGame } from '../store';
import { locationArt, POSTER_NAME, type LocationDef } from './locations';

/**
 * THE TRIBES, STILL HANGING AT HERO SELECT (owner 2026-11-24: "put the tribe parchments along the right side during hero select
 * as well ... clicking them open the compendium to that tribes list"; R-LOCATION-08). The reveal's own torn sheets (baked from
 * its shader at rest: `sheet-<tribe>.webp`), one for each tribe of this game, in its order. Static pictures; only transforms move.
 */
export function LocationPosters({ location, tribes, inert, duos }: { location: LocationDef; tribes: readonly Tribe[]; inert: boolean; duos: boolean }): JSX.Element {
  const open = (t: Tribe): void => {
    const st = useGame.getState();
    if (st.showBook) return;
    sfx.pulse();
    if (st.settingsOpen) st.closeSettings();
    st.openBookTribe(t, location.setId);
  };
  return (
    <div className={`hs-posters${duos ? ' duos' : ''}`} style={{ '--n': tribes.length } as CSSProperties}>
      {tribes.map((t, i) => {
        const name = POSTER_NAME[t] ?? t;
        return (
          <button
            key={t}
            type="button"
            className="hs-poster"
            style={{ '--i': i, '--c': `var(--t-${t})` } as CSSProperties}
            aria-label={`${name}. Open the Compendium on them.`}
            disabled={inert}
            onClick={() => open(t)}
          >
            <span className="hs-poster-hang">
              <img decoding="sync" src={locationArt(location.id, `sheet-${t}`)} alt="" draggable={false} />
              <span className="hs-poster-name">{name}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
