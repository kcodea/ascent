import { useEffect, useRef } from 'react';
import { mountAtmosphere } from './atmosphereGl';
import { primeRipple } from './heroRipple';
import { standAt } from './placeAmbience';
import { locationArt, type LocationDef } from './locations';

/** WHERE THE GAME IS PLAYED, behind hero select (owner 2026-11-24): the location's painting, blurred, and alive
 *  (atmosphereGl.ts). The still picture is its ground and its fallback. Nothing here re-renders while it moves. */
export function LocationGround({ location, art, ring }: { location: LocationDef; art: string | undefined; ring: string }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => (ref.current ? mountAtmosphere(ref.current, location) : undefined), [location]);
  // The place goes on sounding (R-LOCATION-09): it ends with hero select.
  useEffect(() => standAt(), []);
  // THE RIPPLE (R-LOCATION-05): the hero being looked at, and the player's ring, ready before Select Hero is pressed.
  useEffect(() => { if (art) primeRipple([art, ring]); }, [art, ring]);
  return <div className="hs-location" ref={ref} aria-hidden="true" style={{ backgroundImage: `url(${locationArt(location.id, 'blur')})` }} />;
}
