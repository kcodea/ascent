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
import { getSpellPowerFxConfig, floatSpellPowerNumber } from './spellPowerFxConfig';
import { tendrilCfgFor } from './questTendrilConfig';
import { pixiFx } from './pixiFx';
import { getSwapFxConfig } from './swapFxConfig';
import { applyGustLift, getGustFxConfig } from './gustFxConfig';
import { getAuraFxConfig } from './auraFxConfig';
import { applyWeldWiggle, weldCfgFor, weldLandMs } from './weldFxConfig';
import { waveGapFor } from './buffFxConfig';
import { fireBuffFx } from './buffFxRender';
import { getInfuseFxConfig } from './infuseFxConfig';
import { getAimFxConfig } from './aimFxConfig';
import { buffPreset, wavePalette } from './buffPresets';

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

/** ✨ Spell Power: the rising arrow fan + blast + floating number, fired over the shop row's centre so the
 *  look can be judged without staging a real spell-power gain. Uses a sample +2/+1. */
export function testSpellPowerFx(): void {
  const els = shopEls();
  if (els.length === 0) return;
  const rects = els.map((el) => el.getBoundingClientRect());
  const left = Math.min(...rects.map((r) => r.left));
  const right = Math.max(...rects.map((r) => r.right));
  const top = Math.min(...rects.map((r) => r.top));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  const x = (left + right) / 2;
  const y = (top + bottom) / 2;
  pixiFx.spellPower(x, y, getSpellPowerFxConfig());
  floatSpellPowerNumber(x, y - (bottom - top) * 0.15, 2, 1);
}

/** 🏆 Quest Tendril: fire one gold ribbon from the first quest node to the first board minion, so the look
 *  can be judged without staging an Echoing Roar proc. No-op if either end isn't on screen. */
export function testQuestTendril(): void {
  // Pick a node that's actually ON SCREEN. The row is stage-pinned with a large negative offset, so the
  // first `.questbadge` can be outside the viewport on a tall layout — testing from it drew a ribbon flying
  // in from off-screen, which read as a bug in the FX rather than in the pick (owner report 2026-07-21).
  const onScreen = (r: DOMRect): boolean =>
    r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight;
  // `.questbadges` scopes this to the PLAYER's row — OpponentFrame renders `.questbadge` too.
  const node = [...document.querySelectorAll('.questbadges .questbadge')].find((n) => onScreen(n.getBoundingClientRect()));
  const unit = [...document.querySelectorAll('[data-zone="warband"] .card')].find((n) => onScreen(n.getBoundingClientRect()));
  if (!node || !unit) return;
  const nr = node.getBoundingClientRect();
  const ur = unit.getBoundingClientRect();
  pixiFx.buffTendril(
    { x: nr.left + nr.width / 2, y: nr.top + nr.height / 2 },
    { x: ur.left + ur.width / 2, y: ur.top + ur.height / 2 },
    tendrilCfgFor(1),
  );
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
  pixiFx.auraWave({ x: z.left, y, w: z.width, h }, { ...getAuraFxConfig(), ...wavePalette(buffPreset('', tribe)) });
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

/** ✨ Buff FX: fire an ITEMIZED buff run across the whole board — `waves` waves, each hitting every board
 *  minion at once, spaced by the tuner's minimum wave gap. This is the exact shape Blueprint Cache
 *  produces ("+2/+2 per Attachment"), so the pacing can be judged without staging Mechs + Attachments. */
export function testBuffFx(waves = 3): void {
  const run = useGame.getState().run;
  const uids = (run?.board ?? []).map((c) => c.uid);
  if (uids.length === 0) return;
  const gap = waveGapFor(waves);
  for (let w = 0; w < waves; w++) {
    const go = (): void => {
      for (const uid of uids) {
        const el = document.querySelector(`[data-zone="warband"] [data-uid="${uid}"]`);
        if (!el) continue;
        const r = (el.querySelector('.archbox') ?? el).getBoundingClientRect();
        fireBuffFx({ target: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, cardId: '', tribe: 'neutral', sourceless: true });
      }
    };
    if (w === 0 || gap === 0) go();
    else window.setTimeout(go, w * gap);
  }
}
