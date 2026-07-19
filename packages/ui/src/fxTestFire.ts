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
import { applyGustLift, getGustFxConfig } from './gustFxConfig';
import { getAuraFxConfig } from './auraFxConfig';
import { applyWeldWiggle, weldCfgFor, weldLandMs } from './weldFxConfig';
import { getInfuseFxConfig } from './infuseFxConfig';
import { getAimFxConfig } from './aimFxConfig';
import { BUFF_PRESETS, buffPreset } from './buffPresets';

const rectOf = (uid: string): DOMRect | null =>
  document.querySelector(`[data-uid="${uid}"]`)?.getBoundingClientRect() ?? null;

const center = (r: DOMRect): { x: number; y: number } => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** The shop row's offer ELEMENTS (minions + the right-hand spell slot), from the live run. */
function shopEls(): Element[] {
  const run = useGame.getState().run;
  if (!run) return [];
  return [...run.shop.map((o) => o.uid), ...(run.spell ? [run.spell.uid] : [])]
    .flatMap((uid) => { const el = document.querySelector(`[data-uid="${uid}"]`); return el ? [el] : []; });
}

/** The shop row's offer rects (minions + the right-hand spell slot), from the live run. */
function shopRects(): DOMRect[] {
  return shopEls().map((el) => el.getBoundingClientRect());
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

/** 💨 Buff Gust: the tavern rush over the current shop row (+ the lift & settle on landing). */
export function testGustFx(): void {
  const els = shopEls();
  if (els.length === 0) return;
  const rects = els.map((el) => el.getBoundingClientRect());
  pixiFx.buffGust({
    left: Math.min(...rects.map((r) => r.left)),
    right: Math.max(...rects.map((r) => r.right)),
    top: Math.min(...rects.map((r) => r.top)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  }, getGustFxConfig());
  applyGustLift(els);
}

export type AuraTestTribe = 'beast' | 'demon' | 'mech' | 'undead';

/** 🌀 Aura Wave: the tribe-colored aura wave that blooms from the board centre out to both edges (no tribe
 *  filter — the test fires over the whole board region so the look can be judged without staging a source). */
export function testAuraFx(tribe: AuraTestTribe): void {
  const zoneEl = document.querySelector('[data-zone="warband"]');
  if (!zoneEl) return;
  const z = zoneEl.getBoundingClientRect();
  if (z.width < 8 || z.height < 8) return;
  const rr = zoneEl.querySelector('.row.warband')?.getBoundingClientRect();
  const y = rr && rr.height > 4 ? rr.top : z.top;
  const h = rr && rr.height > 4 ? rr.height : z.height;
  const p = BUFF_PRESETS[buffPreset('', tribe)] ?? BUFF_PRESETS.default!;
  pixiFx.auraWave(
    { x: z.left, y, w: z.width, h },
    { ...getAuraFxConfig(), colorCore: p.colorFlash, colorGlow: p.colorGlow, colorMote: p.colorMote },
  );
}

/** 🎯 Hero Aim: the activation spark burst at the power diamond. */
export function testAimBurst(): void {
  const el = document.querySelector('.heropowerbtn');
  if (!el) return;
  const r = el.getBoundingClientRect();
  pixiFx.heroPowerBurst(r.left + r.width / 2, r.top + r.height / 2, getAimFxConfig());
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

/** 🔩 Weld FX: the full Attachment-weld effect on your LEFT-MOST board minion (no Attachment needed) —
 *  the converging ring, its landing flash + rising sparks, and the card's wiggle on impact. `play` (a
 *  hand-played Attachment, post slide-in) vs `auto` (Banksly / Beatbot / Combinator / Cling / Money Bot). */
export function testWeldFx(kind: 'play' | 'auto'): void {
  const run = useGame.getState().run;
  const uid = run?.board[0]?.uid;
  if (!uid) return;
  const el = document.querySelector(`[data-zone="warband"] [data-uid="${uid}"]`);
  if (!el) return;
  const r = (el.querySelector('.archbox') ?? el).getBoundingClientRect();
  pixiFx.weldPulse(r.left + r.width / 2, r.top + r.height / 2, weldCfgFor(kind));
  applyWeldWiggle([el], weldLandMs());
}
