import { useRef } from 'react';
import { playDef } from './fx/playDef';
import { Icon } from './Icon';

// Public-folder assets must carry the BASE_URL — itch serves the game from a CDN sub-path, where a
// root-absolute '/frames/…' 404s and the button renders as a broken image (owner report 2026-07-27). Vite
// rewrites CSS `url(/…)` to relative at build time but CANNOT rewrite JS string literals, so every one of
// these has to prefix the base itself ('/' in dev, './' in the build). Same rule as Card.tsx's frame srcs.
const F = `${import.meta.env.BASE_URL}frames/`;

// Per-tier pip width as a % of the BASE width — each tier's arc art is a different width (91,177,305,454,564,
// 629 px over the 795-wide base; tier 7 = tier 6's placeholder), so each renders at its own native scale with
// height auto (aspect exact). The 🍺 tuner's `--tvb-pip-s` scales them all together.
const PIP_W = [11.45, 22.26, 38.36, 57.11, 70.94, 79.12, 79.12] as const;

/**
 * The standalone TAVERN UP stone button — the carved rock medallion that replaces the plain "Upgrade
 * Tavern" plaque in the shop tray (same playbook as the End Turn diamond, handoff 2026-07-16). Stage-pinned
 * to the board's left; shop-phase only. Same reducer wiring as the old plaque (a re-skin, not a behavior
 * change): the caller passes the dispatch + the same disabled conditions + the live cost.
 *
 * Layered so every effect follows the art and stays cheap (see styles.css "TAVERN UP STONE"):
 *   - `.tvb-gembox` (z0, UNDER the base) — the blue arrow gem seated through the base's transparent hole, so
 *     the gold ring overlaps its rim (the forgiving seat — same trick as card art under the frame). Holds the
 *     lit gem, the BROKEN gem (the max-tier "complete" state; CSS flips them, both stay mounted so there's no
 *     src-swap flash), and the sheen sweep clipped to the gem's circle.
 *   - `.tvb-base` (z1) — the stone housing; `.tvb-pips` (z2) — the CURRENT tavern tier as 1–7 lit slot pips
 *     (all seven variants mounted, CSS shows one; they share one centroid-aligned canvas so a single seat
 *     positions every tier; tier 7 is Summit-only and currently a placeholder copy of tier 6).
 *   - `.tvb-glow` (z3) — the gem-silhouette hover halo (stacked drop-shadow of the gem art, source pixels
 *     masked back out so ONLY the halo paints); breathing animates opacity only.
 *
 * Press = dirt billow + shockwave ring at the button's live centre (the "heavy investment" recipe), then the
 * existing `upgrade` dispatch. (The old warm gem-pop flash was dropped — owner 2026-08-14: it painted the
 * previous round orb.) All effect magnitudes come from the 🍺 tuner (`TavernUpTuner.tsx`).
 */
export function TavernUpButton({ tier, maxTier, cost, disabled, combat, onUpgrade }: {
  /** Current tavern tier (1-based) — drives the lit slot pips + the broken "complete" gem at max. */
  tier: number;
  maxTier: number;
  /** Live upgrade cost (upgradeCostOf(run) — includes surcharges), shown on the coin badge. */
  cost: number;
  /** Everything EXCEPT the max-tier condition (the component derives that from tier itself). */
  disabled: boolean;
  /** Combat phase — the stone stays mounted as a passive TIER INDICATOR (owner note 2026-07-16): inert,
   *  cost coin hidden, no gem dim (it's board furniture showing your tier, not a locked action). */
  combat?: boolean;
  onUpgrade: () => void;
}) {
  const wrapRef = useRef<HTMLButtonElement>(null);
  const maxed = tier >= maxTier;

  const click = (): void => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      // The authored `shop-tier-up` def (owner, 2026-08-15) — a bespoke tier-up detonation, replacing the old
      // borrowed `impact-dust` + shockwave press effect. Fires at the button's live centre (all its layers
      // anchor to `source`).
      playDef('shop-tier-up', { source: { x: cx, y: cy }, target: { x: cx, y: cy } });
    }
    onUpgrade();
  };

  const pipTier = Math.max(1, Math.min(maxTier, tier));
  return (
    <button
      ref={wrapRef}
      className={`tvbwrap${maxed ? ' maxed' : ''}${combat ? ' combat' : ''}`}
      disabled={disabled || maxed || combat}
      onClick={click}
      aria-label={combat ? `Shop tier ${tier}` : maxed ? 'Shop at max tier' : `Upgrade Shop to tier ${tier + 1} for ${cost} Gold`}
    >
      {/* The orb, seated over the base's baked orb as the effect layer. At MAX tier it DIMS (owner ask
          2026-08-14 — the old "broken orb" swap was dropped). */}
      <span className="tvb-gembox" aria-hidden="true">
        <img decoding="sync" className="tvb-gem lit" src={`${F}tavernup_gem.webp`} alt="" draggable={false} />
        {/* Ambient SHEEN — a glare bar sweeping the gem's face, clipped to its circle; transform-only loop. */}
        <span className="tvb-sheen"><span className="tvb-sheen-bar" /></span>
      </span>
      <img decoding="sync" className="tvb-base" src={`${F}tavernup_base.webp`} alt="" draggable={false} />
      {/* Tier pips — the current tavern tier lit as an arc of segments around the orb. Each tier's art is a
          DIFFERENT width (the arc grows with the tier), exported at the base's scale — so each is sized by its
          OWN native width relative to the base (`PIP_W`; height auto keeps the aspect EXACT, never stretched)
          and top-anchored so the arc's apex lines up across tiers. tier7 is a placeholder copy of tier6. */}
      {[1, 2, 3, 4, 5, 6, 7].map((n) => (
        <img decoding="sync"
          key={n}
          className={`tvb-pips${n === pipTier ? ' on' : ''}`}
          src={`${F}tavernup_tier${n}.webp`}
          style={{
            width: `calc(${PIP_W[n - 1]}% * var(--tvb-pip-s, 1) * var(--tvb-pip${Math.min(n, 6)}-s, 1))`,
            left: `calc(50% + (var(--tvb-pip-x, 0) + var(--tvb-pip${Math.min(n, 6)}-x, 0)) * var(--u))`,
            top: `calc(14% + (var(--tvb-pip-y, 0) + var(--tvb-pip${Math.min(n, 6)}-y, 0)) * var(--u))`,
          }}
          alt="" draggable={false} aria-hidden="true"
        />
      ))}
      {/* Hover glow — a circular halo hugging the gem. NOT the diamond's drop-shadow-of-the-art trick: a
          drop-shadow halo is clipped at its element box (any real blur floods the box and reads SQUARE).
          The gem is a circle, so a stacked BOX-SHADOW on a border-radius:50% span is exact, paints outside
          the element, and can never clip. */}
      <img decoding="sync" className="tvb-glow" src={`${F}tavernup_gem.webp`} alt="" draggable={false} aria-hidden="true" />
      {/* Cost coin — the live upgrade cost (hidden at max tier — the broken gem tells that story — and
          during combat, where the stone is a passive tier indicator). */}
      {!maxed && !combat && (
        <span className="tvb-cost" aria-hidden="true">
          <Icon name="mana" />
          <b>{cost}</b>
        </span>
      )}
      {/* Current-tier pill (owner ask 2026-08-11) — the Tier readout moved off the top bar onto the stone, so
          the tier lives with the button that changes it. Purely a label; pointer-events off so it never eats a
          click meant for the upgrade. */}
      <span className="tvb-tierpill" aria-hidden="true">Tier {tier}</span>
      <span className="tvb-tip">{combat ? `Shop tier ${tier}` : maxed ? 'Shop at max tier' : `Upgrade Shop — to tier ${tier + 1}`}</span>
    </button>
  );
}
