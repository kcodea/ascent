import { useEffect, useRef, useState } from 'react';
import { getEndTurnConfig, rgba } from './endTurnConfig';
import { pixiFx } from './pixiFx';
import { playDef } from './fx/playDef';
import { sfx } from './sfx';

// Public-folder assets must carry the BASE_URL — itch serves the game from a CDN sub-path, where a
// root-absolute '/frames/…' 404s and the button renders as a broken image (owner report 2026-07-27). Vite
// rewrites CSS `url(/…)` to relative at build time but CANNOT rewrite JS string literals, so every one of
// these has to prefix the base itself ('/' in dev, './' in the build). Same rule as Card.tsx's frame srcs.
const F = `${import.meta.env.BASE_URL}frames/`;

/**
 * The standalone END TURN / START COMBAT diamond — the gem-in-bronze button pinned to the board's
 * middle-right (de-coupled from the shop tray, owner direction 2026-07-16). Art: frames/end_button.webp
 * (lit gem) until pressed; frames/end_button_pressed2.webp (dim gem) from the click through the WHOLE
 * combat screen — it relights when the next shop phase opens. The hit also kicks up a dirt/smoke billow
 * (pixiFx.impactDust) at the gem.
 *
 * Layered so every effect follows the DIAMOND silhouette and stays cheap:
 *   - Hover glow — a stacked ice-blue drop-shadow applied DIRECTLY on `.etb-gem` (styles.css → `--etb-gemglow`),
 *     copied from the Freeze gem (owner ask 2026-08-19). Because the gem overlay sits above the base housing,
 *     the shadow radiates from behind the gem, over the housing — below the gem, above the base — the way
 *     Freeze does it. Hover-only, static filter with a cheap `filter` transition. (This replaced an earlier
 *     separate `.etb-glow` halo layer that floated above everything.)
 *   - `.etb-bolts` — a small canvas crackling lightning arcs along the diamond's four edges. The rAF loop
 *     reads `getEndTurnConfig()` live each frame (tuner slider moves apply instantly) and self-gates: it
 *     draws nothing (and skips clearing) while there are no live arcs and spawning is off/pressed.
 *
 * Position/scale come from `--etb-*` vars (stage-pinned like the hero power); the DEV tuner
 * (`EndTurnTuner.tsx`) dials everything live.
 */
export function EndTurnButton({ onEndTurn, disabled, pressed, urgent, combatReady, onEndCombat }: {
  onEndTurn: () => void;
  disabled: boolean;
  /** The button has been hit — the end-of-turn beats are playing; show the dulled gem + stop the effects. */
  pressed: boolean;
  /** Turn timer expired — everything else is locked; draw attention. */
  urgent: boolean;
  /** The combat replay has finished — the pressed diamond doubles as the END COMBAT button (owner note
   *  2026-07-16): clicking relights it with a clean shine (no strike sfx/vfx) and returns to the shop. */
  combatReady?: boolean;
  onEndCombat?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLButtonElement>(null);
  const pressedRef = useRef(pressed);
  pressedRef.current = pressed;
  const burstRef = useRef(0); // timestamp of a pending strike burst — the rAF loop consumes it
  const wakeRef = useRef<() => void>(() => {}); // re-arms the (idling) bolt loop — see the arc effect
  const [striking, setStriking] = useState(false); // the one-shot strike flash is playing
  const [relighting, setRelighting] = useState(false); // the one-shot END-COMBAT shine is playing

  // The STRIKE (owner notes 2026-07-16): the art swaps to the dim gem immediately, and the swap is masked
  // by a white-hot gem flash + a burst of lightning arcs + a dirt/smoke billow + an outward shockwave
  // RIPPLE (pixiFx.impactPulse — the combat clack's expanding energy rings), all at the gem's live centre.
  const click = (): void => {
    // END COMBAT mode (replay done): no strike sfx/vfx — a clean one-shot SHINE covers the dim→lit
    // relight while the shop fades back in.
    if (combatReady) {
      sfx.pulse();
      setRelighting(true);
      window.setTimeout(() => setRelighting(false), 700);
      onEndCombat?.();
      return;
    }
    const cfg = getEndTurnConfig();
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      // The authored `impact-dust` def, on all three per-call dials: count → `intensity`, puff size →
      // `scale`, lifetime → `time`. `time` is the axis that keeps the billow hanging LONGER without slowing
      // it down (`speed` would do that instead) — exactly what the hand-written `life` multiplier meant.
      if (cfg.strikeDustCount > 0) {
        playDef('impact-dust', { source: { x: cx, y: cy }, target: { x: cx, y: cy } },
          { intensity: cfg.strikeDustCount, scale: cfg.strikeDustSize, time: cfg.strikeDustLife });
      }
      if (cfg.strikeRings > 0) pixiFx.impactPulse(cx, cy, 1, { radius: cfg.strikeRingRadius, life: cfg.strikeRingLife, rings: cfg.strikeRings });
    }
    burstRef.current = performance.now();
    wakeRef.current(); // the bolt loop idles when nothing is live — wake it to consume the burst
    if (cfg.strikeFlash > 0) {
      setStriking(true);
      window.setTimeout(() => setStriking(false), cfg.strikeFlash + 60);
    }
    onEndTurn();
  };

  // Lightning arcs — half ride a diamond edge, half CROSS the face between two edges (owner note
  // 2026-07-16: across the button as well as around it); jittered midpoints, fading over boltLife ms.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // The canvas covers the button box + margin for jitter/blur; the art box inside is BASE_W×BASE_H
    // (the trimmed diamond's aspect). Edge geometry is derived from the four diamond points.
    const PAD = 24;
    const BASE_W = 128, BASE_H = 140; // matches .etbwrap's un-scaled art box (468×512 trim ≈ 0.914 aspect)
    canvas.width = BASE_W + PAD * 2;
    canvas.height = BASE_H + PAD * 2;
    const cx = PAD + BASE_W / 2, cy = PAD + BASE_H / 2;
    // Diamond points (top, right, bottom, left) pulled slightly inward so arcs ride the bronze frame.
    const inset = 0.03;
    const pts = [
      [cx, PAD + BASE_H * inset], [PAD + BASE_W * (1 - inset), cy],
      [cx, PAD + BASE_H * (1 - inset)], [PAD + BASE_W * inset, cy],
    ] as const;
    interface Arc { ax: number; ay: number; bx: number; by: number; born: number; seed: number; }
    const edgePoint = (seg: number, t: number): [number, number] => {
      const [x0, y0] = pts[seg]!;
      const [x1, y1] = pts[(seg + 1) % 4]!;
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    };
    let arcs: Arc[] = [];
    let raf = 0;
    let idleTimer = 0;
    let running = false;
    let lastSpawn = 0;
    let dirty = false; // the canvas has strokes on it — lets an idle frame skip the clearRect entirely
    // IDLE CONTRACT (perf audit 2026-08-06): this loop used to re-arm its rAF unconditionally, so the shop
    // paid a per-frame config read + body-class query + (usually) a canvas clear/stroke pass for the whole
    // session — the one uncancelled rAF in the always-mounted UI, undoing pixiFx's own auto-idle. It now
    // runs ONLY while arcs are alive; between spawns it sleeps on a timeout sized to the spawn cadence, and
    // with spawning off (pressed — i.e. all of combat — or rate 0) it stops entirely. Wake sources: the
    // spawn timeout, a strike burst (click), and the pressed-prop flip (the relight effect below).
    const loop = (now: number): void => {
      raf = 0;
      const cfg = getEndTurnConfig();
      const previewPressed = document.body.classList.contains('etb-pressed-preview'); // dev tuner's pressed preview
      const spawning = !pressedRef.current && !previewPressed && cfg.boltRate > 0 && cfg.boltAlpha > 0;
      arcs = arcs.filter((a) => now - a.born < cfg.boltLife);
      const spawnArc = (): void => {
        if (Math.random() < 0.5) {
          // EDGE arc — a spark riding one of the diamond's four edges (length = boltScale of the edge).
          const seg = Math.floor(Math.random() * 4);
          const t0 = Math.random() * (1 - cfg.boltScale);
          const [ax, ay] = edgePoint(seg, t0);
          const [bx, by] = edgePoint(seg, t0 + cfg.boltScale);
          arcs.push({ ax, ay, bx, by, born: now, seed: Math.random() * 1e4 });
        } else {
          // CROSS arc — a bolt spanning the gem's FACE between two different edges, shrunk about its
          // midpoint so the length slider still bites (×1.6 keeps crossings long by default).
          const s0 = Math.floor(Math.random() * 4);
          const s1 = (s0 + 1 + Math.floor(Math.random() * 3)) % 4;
          const [px, py] = edgePoint(s0, 0.2 + Math.random() * 0.6);
          const [qx, qy] = edgePoint(s1, 0.2 + Math.random() * 0.6);
          const span = Math.min(1, cfg.boltScale * 1.6);
          const lo = (1 - span) / 2, hi = (1 + span) / 2;
          arcs.push({
            ax: px + (qx - px) * lo, ay: py + (qy - py) * lo,
            bx: px + (qx - px) * hi, by: py + (qy - py) * hi,
            born: now, seed: Math.random() * 1e4,
          });
        }
      };
      // A pending STRIKE burst — a whole volley at once, bypassing the pressed/rate gates so the crackle
      // that masks the lit→dim art swap always fires (stale requests older than 500ms are dropped).
      if (burstRef.current) {
        if (now - burstRef.current < 500) for (let i = 0; i < cfg.strikeBolts; i++) spawnArc();
        burstRef.current = 0;
      }
      if (spawning && now - lastSpawn > 1000 / cfg.boltRate) {
        lastSpawn = now;
        spawnArc();
      }
      if (arcs.length === 0) {
        if (dirty) { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; }
        running = false;
        // Nothing on screen. If the crackle is on, sleep until the next bolt is due (a timeout, not a
        // per-frame rAF); if it's off (pressed / rate 0), stop dead — wake() restarts us.
        if (spawning) {
          const wait = Math.max(16, 1000 / cfg.boltRate - (now - lastSpawn));
          idleTimer = window.setTimeout(() => { idleTimer = 0; wake(); }, wait);
        }
        return;
      }
      raf = requestAnimationFrame(loop);
      running = true;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      dirty = true;
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba(cfg.boltColor, 1);
      for (const a of arcs) {
        const life = 1 - (now - a.born) / cfg.boltLife; // 1 → 0
        const { ax, ay, bx, by } = a;
        // Perpendicular for the jitter direction.
        const dx = bx - ax, dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const segs = 9;
        ctx.globalAlpha = cfg.boltAlpha * life;
        ctx.lineWidth = cfg.boltWidth;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        for (let i = 1; i < segs; i++) {
          const t = i / segs;
          // ZIGZAG (owner note 2026-07-16): a forced alternating sign flips direction at EVERY joint, with a
          // shimmering pseudo-random magnitude per joint (seeded sin — deterministic per arc, no allocs),
          // tapered toward the endpoints. More joints + hard flips = jagged bolts, not smooth waves.
          const r = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(a.seed + i * 12.9898 + now * 0.02));
          const j = (i % 2 ? 1 : -1) * r * cfg.boltMag * (1 - Math.abs(t - 0.5) * 0.6);
          ctx.lineTo(ax + dx * t + nx * j, ay + dy * t + ny * j);
        }
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    const wake = (): void => {
      if (running || raf) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    wakeRef.current = wake;
    wake();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (idleTimer) window.clearTimeout(idleTimer);
      wakeRef.current = () => {};
    };
  }, []);

  // Relight: when the shop reopens (pressed flips false) the ambient crackle resumes — the loop stopped
  // itself the moment the pressed gem's last arc faded, so it needs this nudge to start spawning again.
  useEffect(() => {
    if (!pressed) wakeRef.current();
  }, [pressed]);

  return (
    <button
      ref={wrapRef}
      className={`etbwrap${pressed ? ' pressed' : ''}${urgent && !pressed ? ' urgent' : ''}${combatReady ? ' ready' : ''}`}
      disabled={disabled}
      onClick={click}
      aria-label={combatReady ? 'End combat and go back to shop' : 'End your turn and start combat'}
    >
      <canvas ref={canvasRef} className="etb-bolts" aria-hidden="true" />
      {/* Hover glow is now a drop-shadow ON the gem itself (styles.css `.etb-gem` hover → `--etb-gemglow`),
          copied from the Freeze gem so it sits below the gem and above the base — the old separate `.etb-glow`
          halo layer was retired (owner ask 2026-08-19). */}
      {/* All arts stay mounted; CSS flips them on `.pressed` (or the tuner's body-class preview) — no
          src-swap flash, and the pressed art is already decoded when the click lands. The pressed gem
          (pressed2 by default; pressed3 — the cracked gem — via the tuner's variant switch) holds through
          the whole combat screen; the lit gem returns with the shop. */}
      {/* Base housing (owner's new art, gem baked in) — always shown; the bronze never dims (board furniture). */}
      <img decoding="sync" className="etb-base" src={`${F}end_button_base.webp`} alt="" draggable={false} />
      {/* The gem as its OWN layer, seated over the baked gem — the target for any gem effect. It dims to the
          "spent" look on press (CSS), so no whole-art src swap is needed. `--etb-gem-*` seat it. */}
      <span className="etb-gembox" aria-hidden="true">
        <img decoding="sync" className="etb-gem lit" src={`${F}end_button_gem.webp`} alt="" draggable={false} />
        <img decoding="sync" className="etb-gem cracked" src={`${F}end_button_gem_cracked.webp`} alt="" draggable={false} />
      </span>
      {/* Ambient SHEEN — a periodic glare sweeping the gem's face (lit AND pressed), clipped to the gem's
          diamond. The bar animates TRANSFORM only inside a static clip-path (compositor-cheap loop). */}
      <span className="etb-sheen" aria-hidden="true"><span className="etb-sheen-bar" /></span>
      {/* The strike FLASH — a white-hot pop of the gem that masks the lit→dim swap. Mounted only for the
          one-shot (its animation runs on mount and it unmounts right after — never a loop). */}
      {striking && <img decoding="sync" className="etb-flash" src={`${F}end_button_gem.webp`} alt="" draggable={false} aria-hidden="true" />}
      {/* The END-COMBAT relight — the LIT art shines through as the dim gem hands back to the shop. */}
      {relighting && <img decoding="sync" className="etb-flash relight" src={`${F}end_button_base.webp`} alt="" draggable={false} aria-hidden="true" />}
      <span className="etb-tip">{combatReady ? 'End combat and go back to shop' : 'End your turn and start combat'}</span>
    </button>
  );
}
