import { useRef, useState } from 'react';
import { Icon } from './Icon';
import { pixiFx } from './pixiFx';
import { playDef } from './fx/playDef';
import { getRefreshConfig } from './refreshConfig';

// Public-folder assets must carry the BASE_URL — itch serves the game from a CDN sub-path, where a
// root-absolute '/frames/…' 404s and the button renders as a broken image (owner report 2026-07-27). Vite
// rewrites CSS `url(/…)` to relative at build time but CANNOT rewrite JS string literals, so every one of
// these has to prefix the base itself ('/' in dev, './' in the build). Same rule as Card.tsx's frame srcs.
const F = `${import.meta.env.BASE_URL}frames/`;

/**
 * The standalone REFRESH button — the blue crystal (frames/refresh_button.webp) pinned TOP-CENTRE of the
 * board, replacing the old "Reroll" tray plaque. Same reducer wiring (`{type:'roll'}`), stage-pinned like
 * the End Turn diamond and the Tavern stone, and tuned live from the 🔄 dev tuner (`refreshConfig.ts`).
 *
 * Layers, cheapest-first (see styles.css "REFRESH CRYSTAL"):
 *   - `.rfb-art` (z1) — the crystal itself. It does NOT move on press (owner 2026-07-21): clicking emits
 *     dust and a shine flare, nothing more.
 *   - `.rfb-glow` (z0, behind) — the hover halo. A stacked BOX-SHADOW on a rounded span so it paints
 *     outside the element and never clips square the way a filter drop-shadow would. Per
 *     `docs/performance.md` the breathing animates OPACITY only — the shadow itself is static.
 *   - `.rfb-sheen` (z2) — the ambient glare sweep, clipped to the crystal, transform-only.
 *   - `.rfb-shine` (z3) — the one-shot CLICK flare; mounts → animates → unmounts.
 *   - `.rfb-cost` (z4) — the live Gold cost coin.
 *   - `.rfb-label` — the glass "Refresh" pill floating ABOVE the crystal (owner request).
 *
 * The click dust + sprite blast come from Pixi helpers, read from `cfg` at click time (no CSS vars needed):
 * `impactDust` is the Tavern stone's billow, `refreshBlast` is this button's own jittered shard burst.
 *
 * Mounted through BOTH phases (owner ask 2026-08-17), like the Tavern Up stone: in combat it's inert and shown
 * at FULL art strength — the `off` dim is a "you can't afford this roll" cue, and during combat there is no roll
 * to afford, so dimming it would state something false. The cost coin comes off in combat for the same reason
 * (owner ask 2026-08-18) — a price with nothing to buy is just noise — leaving a clean crystal, exactly the
 * shape the Tavern stone takes there.
 */
export function RefreshButton({
  cost,
  freeRolls = 0,
  disabled,
  combat,
  onRefresh,
}: {
  /** Live roll cost (`refreshCostOf(run)` — free rolls make this 0), shown on the coin badge. */
  cost: number;
  /** Free rolls BANKED (`run.freeRolls`). Shown as a `x2` beside the green 0 so the player can see how many
   *  are left rather than only that the next one is free (owner ask 2026-08-02). */
  freeRolls?: number;
  disabled: boolean;
  /** Combat phase — renders the crystal inert but undimmed (a passive readout), not a control. */
  combat?: boolean;
  onRefresh: () => void;
}) {
  const wrapRef = useRef<HTMLButtonElement>(null);
  const [shining, setShining] = useState(false); // the one-shot click shine is playing

  const click = (): void => {
    const cfg = getRefreshConfig();
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      // The authored `impact-dust` def — count → `intensity`, size → `scale`, lifetime → `time`.
      if (cfg.dustCount > 0) {
        playDef('impact-dust', { source: { x: cx, y: cy }, target: { x: cx, y: cy } },
          { intensity: cfg.dustCount, scale: cfg.dustSize, time: cfg.dustLife });
      }
      // Sprite blast — every shard's angle/speed/life/size/spin is jittered inside `refreshBlast`, so no
      // two presses look alike (owner request). Fired from the button's centre, like the dust.
      if (cfg.blastCount > 0) {
        pixiFx.refreshBlast(cx, cy, {
          count: cfg.blastCount, speed: cfg.blastSpeed, spread: cfg.blastSpread,
          life: cfg.blastLife, size: cfg.blastSize, color: cfg.blastColor,
        });
      }
    }
    if (cfg.shineMs > 0) {
      setShining(true);
      window.setTimeout(() => setShining(false), cfg.shineMs + 60);
    }
    onRefresh();
  };

  return (
    <button
      ref={wrapRef}
      className={`rfbwrap${disabled && !combat ? ' off' : ''}${combat ? ' combat' : ''}`}
      disabled={disabled || combat}
      onClick={click}
      aria-label={combat
        ? 'Refresh the shop — unavailable during combat'
        : cost > 0
          ? `Refresh the shop for ${cost} Gold`
          : `Refresh the shop (free${freeRolls > 1 ? ` — ${freeRolls} free rolls left` : ''})`}
    >
      {/* Hover halo — BEHIND the art so the button reads clean. */}
      <span className="rfb-glow" aria-hidden="true" />
      <span className="rfb-artbox" aria-hidden="true">
        {/* The "Refresh" wordmark is baked into this art (RefreshButton1), so the old floating glass label
            is gone — it would print "Refresh" twice. */}
        <img decoding="sync" className="rfb-art" src={`${F}refresh_button1.webp`} alt="" draggable={false} />
        {/* Ambient SHEEN — a glare bar sweeping the crystal's face, clipped to it; transform-only loop. */}
        <span className="rfb-sheen"><span className="rfb-sheen-bar" /></span>
      </span>
      {/* The click SHINE — a one-shot radial flare blooming out of the crystal. Mounts, animates, unmounts,
          so nothing animates at rest. Replaced the press spin + shockwave rings (owner 2026-07-21). */}
      {shining && <span className="rfb-shine" aria-hidden="true" />}
      {/* Cost coin — always shown IN THE SHOP. A free roll keeps the coin and turns it GREEN with a 0, rather
          than removing it (owner 2026-07-21): a vanishing badge made the button's shape shift and left the
          player reading absence, where a green 0 states the free roll outright. That reasoning is about
          telling one shop state from another, so it doesn't carry into COMBAT — there the crystal is a
          passive prop with no roll to price, and the coin comes off entirely (owner 2026-08-18), matching the
          Tavern stone, which drops its cost coin in combat for the same reason. */}
      {!combat && (
        <span className={`rfb-cost${cost > 0 ? '' : ' free'}`} aria-hidden="true">
          <Icon name="mana" />
          <b>{cost}</b>
          {/* The BANKED count, only past the first: at exactly one free roll the green 0 already says "this
              one is free", so a `x1` would be noise. From two up, the number is what you can't otherwise see. */}
          {cost === 0 && freeRolls > 1 && <i className="rfb-freen">{`×${freeRolls}`}</i>}
        </span>
      )}
      <span className="rfb-tip">
        {cost > 0 ? `Refresh — ${cost} Gold` : `Refresh — free${freeRolls > 1 ? ` (${freeRolls} left)` : ''}`}
      </span>
    </button>
  );
}
