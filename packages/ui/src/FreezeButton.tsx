import { useRef } from 'react';
import { playDef } from './fx/playDef';

// Public-folder assets must carry the BASE_URL — itch serves the game from a CDN sub-path, where a
// root-absolute '/frames/…' 404s and the button renders as a broken image. Vite rewrites CSS `url(/…)` to
// relative at build time but CANNOT rewrite JS string literals, so each has to prefix the base itself.
const F = `${import.meta.env.BASE_URL}frames/`;

/**
 * The standalone FREEZE toggle — pinned to the board's top-centre (position/scale from the ❄️ dev tuner,
 * `freezeConfig.ts` → `--frz-*`). Layered like the Tavern Up stone so effects can target the GEM alone:
 *   - `.frz-base` (z1) — the full bronze-diamond art (gem baked in) — the button's body.
 *   - `.frz-gembox` / `.frz-gem` (z2) — the gem art again as its OWN layer, seated exactly over the baked
 *     gem, so any effect (frozen glow, pulse, tint) hangs on the gem without touching the housing.
 * `--frz-gem-x/y/s` nudge the overlay onto the baked gem if the art trims shift.
 *
 * Reducer wiring is unchanged (`{type:'freeze'}` — a toggle); `frozen` just adds `.on` for the frozen tint.
 *
 * Mounted through BOTH phases (owner ask 2026-08-17), like the Tavern Up stone: in combat it's a passive
 * FROZEN INDICATOR — inert, art at full strength, and the tip reads the state instead of offering the action.
 * Leaving it on screen keeps the board's furniture from popping in and out at the phase change, and the frozen
 * state is worth seeing while the fight plays out, since it's what the next shop will open with.
 */
export function FreezeButton({
  frozen,
  disabled,
  combat,
  onFreeze,
}: {
  frozen: boolean;
  disabled: boolean;
  /** Combat phase — renders the button inert (a state readout), not a control. */
  combat?: boolean;
  onFreeze: () => void;
}) {
  const wrapRef = useRef<HTMLButtonElement>(null);
  const click = (): void => {
    // Fire the authored 'freeze-blast' FX (built in the FX workbench) from the gem's centre on press (owner
    // ask 2026-08-14 — replaces the earlier impactPulse ring). The gem sits at the button's centre, so the
    // wrap rect gives the origin; both layers anchor to `source`.
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      playDef('freeze-blast', { source: { x: cx, y: cy }, target: { x: cx, y: cy } });
    }
    onFreeze();
  };
  return (
    <button
      ref={wrapRef}
      className={`frzwrap${frozen ? ' on' : ''}${combat ? ' combat' : ''}`}
      disabled={disabled || combat}
      onClick={click}
      aria-label={combat
        ? (frozen ? 'Tavern frozen' : 'Tavern not frozen')
        : (frozen ? 'Unfreeze the tavern' : 'Freeze the tavern')}
    >
      <img decoding="sync" className="frz-base" src={`${F}freeze_base.webp`} alt="" draggable={false} />
      <span className="frz-gembox" aria-hidden="true">
        <img decoding="sync" className="frz-gem lit" src={`${F}freeze_gem.webp`} alt="" draggable={false} />
        <img decoding="sync" className="frz-gem cracked" src={`${F}freeze_gem_cracked.webp`} alt="" draggable={false} />
      </span>
      {/* "Freeze" label pill (owner ask 2026-08-14) — same cream/gold plaque as the Tavern Up tier pill,
          seated near the gem; position/size from the ❄️ tuner via --frz-pill-x/y/s. */}
      <span className="frz-pill" aria-hidden="true">Freeze</span>
      <span className="sbtip frz-tip">
        {combat ? (frozen ? 'Tavern frozen' : 'Tavern not frozen')
          : frozen ? 'Frozen — click to unfreeze' : 'Freeze the tavern'}
      </span>
    </button>
  );
}
