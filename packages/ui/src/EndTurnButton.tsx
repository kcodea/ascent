import { useEffect, useRef } from 'react';
import { getEndTurnConfig, rgba } from './endTurnConfig';

/**
 * The standalone END TURN / START COMBAT diamond — the gem-in-bronze button pinned to the board's
 * middle-right (de-coupled from the shop tray, owner direction 2026-07-16). Art: frames/end_button.webp
 * (lit gem) until pressed; frames/end_button_pressed.webp (dulled gem) while the end-of-turn beats play.
 *
 * Layered so every effect follows the DIAMOND silhouette and stays cheap:
 *   - `.etb-glow` — a duplicate of the art with a STATIC stacked drop-shadow filter (`--etb-glow-filter`);
 *     drop-shadow follows the image alpha, so the glow is exactly the diamond shape. Its breathing animates
 *     the layer's OPACITY only (compositor-only loop — the paint-property perf rule holds).
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
  const pressedRef = useRef(pressed);
  pressedRef.current = pressed;

  // Lightning arcs — spawn along a random diamond edge, jitter midpoints, fade over boltLife ms.
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
    interface Arc { seg: number; t0: number; t1: number; born: number; seed: number; }
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
      if (spawning && now - lastSpawn > 1000 / cfg.boltRate) {
        lastSpawn = now;
        const t0 = Math.random() * (1 - cfg.boltScale);
        arcs.push({ seg: Math.floor(Math.random() * 4), t0, t1: t0 + cfg.boltScale, born: now, seed: Math.random() * 1e4 });
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
        const [x0, y0] = pts[a.seg]!;
        const [x1, y1] = pts[(a.seg + 1) % 4]!;
        const ax = x0 + (x1 - x0) * a.t0, ay = y0 + (y1 - y0) * a.t0;
        const bx = x0 + (x1 - x0) * a.t1, by = y0 + (y1 - y0) * a.t1;
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
      className={`etbwrap${pressed ? ' pressed' : ''}${urgent && !pressed ? ' urgent' : ''}`}
      disabled={disabled}
      onClick={onEndTurn}
      aria-label="End your turn and start combat"
    >
      <canvas ref={canvasRef} className="etb-bolts" aria-hidden="true" />
      <img className="etb-glow" src="/frames/end_button.webp" alt="" draggable={false} aria-hidden="true" />
      {/* Both arts stay mounted; CSS flips them on `.pressed` (or the tuner's body-class preview) — no
          src-swap flash, and the pressed art is already decoded when the click lands. */}
      <img className="etb-art lit" src="/frames/end_button.webp" alt="" draggable={false} />
      <img className="etb-art dim" src="/frames/end_button_pressed.webp" alt="" draggable={false} />
      <span className="etb-tip">End your turn and start combat</span>
    </button>
  );
}
