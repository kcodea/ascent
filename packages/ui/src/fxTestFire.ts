/**
 * DEV-only test-firers for the FX tuners (owner ask 2026-07-16): fire each effect on demand — using
 * whatever cards are on screen — so the owner can iterate in the tuner without setting up the real
 * trigger (playing a Darah, a Godfodder, a Maw, …).
 *
 * Geometry mirrors the REAL firing code in Recruit (store uids → [data-uid] rects), with graceful
 * fallbacks: no board minion → the hero portrait stands in as the source/board side; no shop → no-op.
 * Dev-only (only reachable from the DEV tuners) — never imported by production paths.
 */
import { useGame } from './store';
import { pixiFx } from './pixiFx';
import { getSwapFxConfig } from './swapFxConfig';
import { getGustFxConfig } from './gustFxConfig';
import { getInfuseFxConfig } from './infuseFxConfig';

const rectOf = (uid: string): DOMRect | null =>
  document.querySelector(`[data-uid="${uid}"]`)?.getBoundingClientRect() ?? null;

const center = (r: DOMRect): { x: number; y: number } => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** The shop row's offer rects (minions + the right-hand spell slot), from the live run. */
function shopRects(): DOMRect[] {
  const run = useGame.getState().run;
  if (!run) return [];
  return [...run.shop.map((o) => o.uid), ...(run.spell ? [run.spell.uid] : [])]
    .flatMap((uid) => { const r = rectOf(uid); return r ? [r] : []; });
}

/** A "board side" anchor: the first board minion, else the hero portrait. */
function boardAnchor(): DOMRect | null {
  const run = useGame.getState().run;
  const boardEl = run?.board[0] ? rectOf(run.board[0].uid) : null;
  return boardEl ?? document.querySelector('.heroimg')?.getBoundingClientRect() ?? null;
}

/** 🔀 Swap FX: arc between the first board minion (or the hero portrait) and the first shop offer. */
export function testSwapFx(): void {
  const rects = shopRects();
  const board = boardAnchor();
  if (!board || rects.length === 0) return;
  pixiFx.swapArc(center(board), center(rects[0]!), getSwapFxConfig());
}

/** 💨 Buff Gust: the tavern rush over the current shop row. */
export function testGustFx(): void {
  const rects = shopRects();
  if (rects.length === 0) return;
  pixiFx.buffGust({
    left: Math.min(...rects.map((r) => r.left)),
    right: Math.max(...rects.map((r) => r.right)),
    top: Math.min(...rects.map((r) => r.top)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  }, getGustFxConfig());
}

/** 🍖 Fodder Infusion: tendrils from the first board minion (or the hero portrait) up to the shop line.
 *  Mirrors Recruit's `fireFodderInfusion` fan-out math 1:1. */
export function testInfuseFx(): void {
  const rects = shopRects();
  const board = boardAnchor();
  if (!board || rects.length === 0) return;
  const from = center(board);
  const left = Math.min(...rects.map((r) => r.left));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  const cfg = getInfuseFxConfig();
  const cx = (left + right) / 2;
  const span = (right - left) * cfg.spreadFrac;
  for (let i = 0; i < cfg.count; i++) {
    const f = cfg.count === 1 ? 0.5 : i / (cfg.count - 1);
    const to = { x: cx - span / 2 + span * f, y: bottom + cfg.endYOff };
    const launch = (): void => pixiFx.buffTendril(from, to, {
      blend: 'add',
      curve: cfg.curve * (i % 2 === 0 ? 1 : -1) * (1 + Math.floor(i / 2) * 0.35),
      wobbleAmp: cfg.wobbleAmp, wobbleFreq: cfg.wobbleFreq,
      travelMs: cfg.travelMs, retractMs: cfg.retractMs,
      baseWidth: cfg.baseWidth, tipWidth: cfg.tipWidth, coreAlpha: cfg.coreAlpha,
      glowWidth: cfg.glowWidth, glowAlpha: cfg.glowAlpha,
      flashSize: cfg.flashSize, flashMs: cfg.flashMs,
      moteCount: cfg.moteCount, moteSpeed: cfg.moteSpeed, moteLife: cfg.moteLife,
      pulseSize: i === 0 ? cfg.pulseSize : 0, pulseAlpha: cfg.pulseAlpha, pulseMs: i === 0 ? cfg.pulseMs : 0,
      colorCore: cfg.colorCore, colorGlow: cfg.colorGlow, colorFlash: cfg.colorCore, colorMote: cfg.colorGlow,
    });
    if (i === 0 || cfg.staggerMs === 0) launch();
    else window.setTimeout(launch, i * cfg.staggerMs);
  }
}
