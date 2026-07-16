import { useEffect, useRef, useState } from 'react';
import { getEndTurnConfig, rgba } from './endTurnConfig';
import { pixiFx } from './pixiFx';

/**
 * The standalone END TURN / START COMBAT diamond — the gem-in-bronze button pinned to the board's
 * middle-right (de-coupled from the shop tray, owner direction 2026-07-16). Art: frames/end_button.webp
 * (lit gem) until pressed; frames/end_button_pressed2.webp (dim gem) from the click through the WHOLE
 * combat screen — it relights when the next shop phase opens. The hit also kicks up a dirt/smoke billow
 * (pixiFx.impactDust) at the gem.
 *
 * Layered so every effect follows the DIAMOND silhouette and stays cheap:
 *   - `.etb-glow` — the GEM-ONLY cut of the art (end_button_gem.webp) with a STATIC stacked drop-shadow
 *     filter (`--etb-glow-filter`); drop-shadow follows the image alpha, so the halo hugs the blue diamond
 *     itself — not the bronze housing (owner note 2026-07-16). Hover-only; its breathing animates the
 *     layer's OPACITY only (compositor-only loop — the paint-property perf rule holds).
 *   - `.etb-bolts` — a small canvas crackling lightning arcs along the diamond's four edges. The rAF loop
 *     reads `getEndTurnConfig()` live each frame (tuner slider moves apply instantly) and self-gates: it
 *     draws nothing (and skips clearing) while there are no live arcs and spawning is off/pressed.
 *
 * Position/scale come from `--etb-*` vars (stage-pinned like the hero power); the DEV tuner
 * (`EndTurnTuner.tsx`) dials everything live.
 */
export function EndTurnButton({ onEndTurn, disabled, pressed, urgent }: {
  onEndTurn: () => void;
  disabled: boolean;
  /** The button has been hit — the end-of-turn beats are playing; show the dulled gem + stop the effects. */
  pressed: boolean;
  /** Turn timer expired — everything else is locked; draw attention. */
  urgent: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLButtonElement>(null);
  const pressedRef = useRef(pressed);
  pressedRef.current = pressed;
  const burstRef = useRef(0); // timestamp of a pending strike burst — the rAF loop consumes it
  const [striking, setStriking] = useState(false); // the one-shot strike flash is playing

  // The STRIKE (owner notes 2026-07-16): the art swaps to the dim gem immediately, and the swap is masked
  // by a white-hot gem flash + a burst of lightning arcs + a dirt/smoke billow + an outward shockwave
  // RIPPLE (pixiFx.impactPulse — the combat clack's expanding energy rings), all at the gem's live centre.
  const click = (): void => {
    const cfg = getEndTurnConfig();
    const r = wrapRef.current?.getBoundingClientRect();
    if (r && cfg.strikeRipple > 0) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      pixiFx.impactDust(cx, cy, cfg.strikeRipple);
      pixiFx.impactPulse(cx, cy, cfg.strikeRipple);
    }
    burstRef.current = performance.now();
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
    let lastSpawn = 0;
    let dirty = false; // the canvas has strokes on it — lets an idle frame skip the clearRect entirely
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop);
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
        return;
      }
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
        const segs = 6;
        ctx.globalAlpha = cfg.boltAlpha * life;
        ctx.lineWidth = cfg.boltWidth;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        for (let i = 1; i < segs; i++) {
          const t = i / segs;
          // Deterministic-ish jitter per arc+joint that shimmers over time (seeded sin — no per-frame allocs).
          const j = Math.sin(a.seed + i * 12.9898 + now * 0.02) * cfg.boltMag * (1 - Math.abs(t - 0.5) * 0.6);
          ctx.lineTo(ax + dx * t + nx * j, ay + dy * t + ny * j);
        }
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <button
      ref={wrapRef}
      className={`etbwrap${pressed ? ' pressed' : ''}${urgent && !pressed ? ' urgent' : ''}`}
      disabled={disabled}
      onClick={click}
      aria-label="End your turn and start combat"
    >
      <canvas ref={canvasRef} className="etb-bolts" aria-hidden="true" />
      {/* Hover glow — the GEM-ONLY cut of the art (end_button_gem, owner note 2026-07-16), so the stacked
          drop-shadow halo hugs the blue diamond itself, not the bronze housing. Sits ABOVE the art: the
          gem's light spills over the housing instead of hiding behind it. */}
      <img className="etb-glow" src="/frames/end_button_gem.webp" alt="" draggable={false} aria-hidden="true" />
      {/* Both arts stay mounted; CSS flips them on `.pressed` (or the tuner's body-class preview) — no
          src-swap flash, and the pressed art is already decoded when the click lands. The pressed gem
          (end_button_pressed2) holds through the whole combat screen; the lit gem returns with the shop. */}
      <img className="etb-art lit" src="/frames/end_button.webp" alt="" draggable={false} />
      <img className="etb-art dim" src="/frames/end_button_pressed2.webp" alt="" draggable={false} />
      {/* The strike FLASH — a white-hot pop of the gem that masks the lit→dim swap. Mounted only for the
          one-shot (its animation runs on mount and it unmounts right after — never a loop). */}
      {striking && <img className="etb-flash" src="/frames/end_button_gem.webp" alt="" draggable={false} aria-hidden="true" />}
      <span className="etb-tip">End your turn and start combat</span>
    </button>
  );
}
