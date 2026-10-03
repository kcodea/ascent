import { useLayoutEffect, useRef } from 'react';
import { nameFitScale, type EqLook } from './equipLookConfig';

/**
 * The Equipment's NAME PLATE (owner ask 2026-10-03: "it needs to be able to fit all names etc for the equipment").
 *
 * In the CSS housings the plate is a fixed width, so a long name auto-shrinks (`--eqn-fit`, a multiplier on the
 * plate's font size) down to `NAME_FIT_MIN`, and never clips. Classic keeps its old grow-with-the-text pill, so the
 * measure there always comes back 1.
 *
 * PERF: one layout read per NAME / LOOK change (and once more when the web font lands), never per frame. The ratio is
 * resolution-free (the plate and the text both scale with `--u`), so a window resize needs no re-measure.
 */
export function EquipNamePlate({ name, look }: { name: string; look: EqLook }): JSX.Element {
  const plateRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const fit = (): void => {
      const plate = plateRef.current;
      const text = textRef.current;
      if (!plate || !text) return;
      plate.style.setProperty('--eqn-fit', '1');
      if (look === 'classic') return; // the Classic pill grows with its text, so there is nothing to fit
      const cs = getComputedStyle(plate);
      const avail = plate.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      plate.style.setProperty('--eqn-fit', String(nameFitScale(text.offsetWidth, avail)));
    };
    fit();
    let live = true;
    // The first paint can measure the fallback font; re-fit once Outfit is in.
    void document.fonts?.ready.then(() => { if (live) fit(); });
    return () => { live = false; };
  }, [name, look]);
  return (
    <div className="hplabel eqname" ref={plateRef}>
      <span className="eqname-t" ref={textRef}>{name}</span>
    </div>
  );
}
