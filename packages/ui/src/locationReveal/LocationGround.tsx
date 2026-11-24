import { useEffect, useRef } from 'react';
import { mountAtmosphere } from './atmosphereGl';
import { locationArt, type LocationDef } from './locations';

/** WHERE THE GAME IS PLAYED, behind hero select (owner 2026-11-24): the location's painting, blurred, and alive
 *  (atmosphereGl.ts). The still picture is its ground and its fallback. Nothing here re-renders while it moves. */
export function LocationGround({ location }: { location: LocationDef }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => (ref.current ? mountAtmosphere(ref.current, location) : undefined), [location]);
  return <div className="hs-location" ref={ref} aria-hidden="true" style={{ backgroundImage: `url(${locationArt(location.id, 'blur')})` }} />;
}
