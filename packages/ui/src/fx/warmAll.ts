/**
 * FIRE EVERYTHING ONCE — the boot warm-up that exercises every effect the way play does, under the splash.
 *
 * Owner ask 2026-09-03: *"I don't want these running cold on first use."* Linking the four core programs and
 * uploading the textures (`warmFx`) is necessary but not sufficient: a glow or blur FILTER compiles its own
 * program the first time it renders, a Graphics path builds its geometry on first draw, a text texture
 * rasterises on first use, and a separate canvas (Discover) creates its own GL context on first open. The only
 * way to pay ALL of that up front — including whatever nobody has thought of — is to actually play every
 * committed def and fire every hand-written effect once while the opaque boot splash (z-index 99999) hides the
 * FX canvas. Then fire everything a SECOND time under a long-task observer: if the second pass stalls the
 * main thread, something is still cold, and the report says how badly.
 *
 * Everything here is best-effort: a fire that throws is caught and counted, never fatal; no renderer → no-op.
 */
import { pixiFx, discoverFx } from '../pixiFx';
import { PULSE_PRESETS } from '../pulsePresets';
import { DESCEND_PRESETS } from '../descendPresets';
import { weldCfgFor } from '../weldFxConfig';
import { getSwapFxConfig } from '../swapFxConfig';
import { getAuraFxConfig } from '../auraFxConfig';
import { getAimFxConfig } from '../aimFxConfig';
import { getSpellPowerFxConfig } from '../spellPowerFxConfig';
import { getRubyPowerFxConfig } from '../rubyPowerFxConfig';
import { getStepProcFxConfig } from '../stepProcFxConfig';
import { tendrilCfgFor } from '../questTendrilConfig';
import { buffPreset, wavePalette } from '../buffPresets';
import { fireBuffFx } from '../buffFxRender';
import { listDefs } from './fxDefs';
import { awaitOverRenderer, canPlayDefs, playDef, withCamera } from './playDef';
import type { FxAnchors } from './anchors';

export interface FirePass {
  /** Committed defs that returned a live player. */
  defs: number;
  /** Hand-written pixiFx effects fired. */
  handWritten: number;
  /** Fires that threw (caught) or returned null. */
  failed: string[];
}

export interface WarmAllReport {
  first: FirePass;
  second: FirePass;
  /** Long tasks (ms) observed during the SECOND pass — the measured residue of anything still cold. */
  secondPassLongTasks: number[];
  ms: number;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Where everything fires: a card-sized stage at the viewport centre. Hidden under the splash regardless. */
function stage(): { cx: number; cy: number; w: number; h: number; anchors: FxAnchors } {
  const cx = Math.round(window.innerWidth / 2);
  const cy = Math.round(window.innerHeight / 2);
  const w = 150;
  const h = 210;
  const anchors = withCamera({
    source: { x: cx - 160, y: cy },
    target: { x: cx + 160, y: cy },
    cursor: { x: cx, y: cy - 120 },
  });
  return { cx, cy, w, h, anchors };
}

/** Play every committed def once. Returns the ids that could not play. */
function fireAllDefs(anchors: FxAnchors): { ok: number; failed: string[] } {
  const failed: string[] = [];
  let ok = 0;
  if (!canPlayDefs()) return { ok, failed: ['(defs not ready)'] };
  for (const def of listDefs()) {
    try {
      if (playDef(def.id, anchors)) ok += 1;
      else failed.push(`def:${def.id}`);
    } catch {
      failed.push(`def:${def.id}`);
    }
  }
  return { ok, failed };
}

/** Fire every hand-written pixiFx effect once with the same configs play uses. */
function fireAllHandWritten(): { ok: number; failed: string[] } {
  const { cx, cy, w, h } = stage();
  const rect = { x: cx - w / 2, y: cy - h / 2, w, h };
  const from = { x: cx - 160, y: cy };
  const to = { x: cx + 160, y: cy };
  const aim = getAimFxConfig();
  const pulseCfgs = Object.values(PULSE_PRESETS);
  const descend = DESCEND_PRESETS.default;
  const fires: Array<[string, () => void]> = [
    ['critText', () => { pixiFx.procCritText(cx, cy - h * 0.45, '2x'); pixiFx.procCritText(cx, cy - h * 0.45, '3x'); }],
    ['critImpact', () => pixiFx.critImpact(cx, cy, 1, 0, rect)],
    ['windSlash', () => pixiFx.windSlash(cx, cy, 1, 0)],
    ['executeStrike', () => pixiFx.executeStrike(cx, cy)],
    ['weldPulse', () => { pixiFx.weldPulse(cx, cy, weldCfgFor('play')); pixiFx.weldPulse(cx, cy, weldCfgFor('auto')); }],
    ['pulse', () => { for (const c of pulseCfgs) pixiFx.pulse(cx, cy, c); }],
    ['flashBloom', () => pixiFx.flashBloom(cx, cy, { flashSize: 120, flashMs: 320, flashAlpha: 0.8, colorGlow: '#ffd24a', blend: 'add' })],
    ['descend', () => { if (descend && pulseCfgs[0]) pixiFx.descend(cx, cy, { ...descend, pulse: pulseCfgs[0] }); }],
    ['trail', () => { for (const v of ['wind', 'gold', 'blue'] as const) pixiFx.trail(cx, cy, 1, 0, v); }],
    ['blastBolt', () => pixiFx.blastBolt(from.x, from.y, to.x, to.y)],
    ['shatter', () => { pixiFx.shatterAt(cx, cy, w, h, 'shield'); pixiFx.shatterAt(cx, cy, w, h, 'reborn'); }],
    ['rebornSummon', () => pixiFx.rebornSummon(cx, cy, w, h)],
    ['deathrattle', () => pixiFx.deathrattle(cx, cy, w)],
    ['buffTendril', () => pixiFx.buffTendril(from, to, tendrilCfgFor(1))],
    ['swapArc', () => pixiFx.swapArc(from, to, getSwapFxConfig())],
    ['auraWave', () => pixiFx.auraWave({ x: cx - 400, y: cy - h / 2, w: 800, h }, { ...getAuraFxConfig(), ...wavePalette(buffPreset('', 'beast')) })],
    ['cleaveSlash', () => pixiFx.cleaveSlash(cx, cy)],
    ['aimLine', () => { pixiFx.setAimLine(from, to, true, aim); setTimeout(() => pixiFx.clearAimLine(), 400); }],
    ['heroPowerBurst', () => pixiFx.heroPowerBurst(cx, cy, aim)],
    ['spellPower', () => { pixiFx.spellPower(cx, cy, getSpellPowerFxConfig()); pixiFx.spellPower(cx, cy, getStepProcFxConfig()); }],
    ['rubyPower', () => pixiFx.rubyPower(cx, cy, getRubyPowerFxConfig())],
    ['buffFx', () => {
      fireBuffFx({ target: to, cardId: '', tribe: 'neutral', sourceless: true });
      fireBuffFx({ source: from, target: to, cardId: '', tribe: 'neutral', sourceless: false });
    }],
    ['discoverBurst', () => discoverFx.discoverBurst(cx, cy)],
  ];
  const failed: string[] = [];
  let ok = 0;
  for (const [name, fire] of fires) {
    try { fire(); ok += 1; } catch { failed.push(`fx:${name}`); }
  }
  return { ok, failed };
}

function firePass(): FirePass {
  const { anchors } = stage();
  const d = fireAllDefs(anchors);
  const hw = fireAllHandWritten();
  return { defs: d.ok, handWritten: hw.ok, failed: [...d.failed, ...hw.failed] };
}

/** The longest committed def, so a pass is given time to finish before the next one starts. */
function settleMs(): number {
  let max = 0;
  for (const d of listDefs()) max = Math.max(max, d.duration || 0);
  return Math.min(3500, Math.max(1200, max + 300));
}

/** Bring up the Discover overlay's own canvas (its own GL context) on an offscreen host, so its first open
 *  never creates one mid-shop. `attach()` re-parents the existing canvas when the overlay later claims it. */
async function attachDiscoverCanvas(): Promise<void> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;pointer-events:none;';
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);
  await discoverFx.attach(host);
}

/**
 * Fire everything twice: once to warm, once to MEASURE. Resolves with the report (never rejects). Bounded by
 * `timeoutMs`. No renderer (no WebGL) → resolves at once with empty passes.
 */
export async function warmEverything(timeoutMs = 25000): Promise<WarmAllReport> {
  const t0 = performance.now();
  const empty: FirePass = { defs: 0, handWritten: 0, failed: [] };
  if (typeof window === 'undefined') return { first: empty, second: empty, secondPassLongTasks: [], ms: 0 };
  if (!(await awaitOverRenderer(timeoutMs))) return { first: empty, second: empty, secondPassLongTasks: [], ms: Math.round(performance.now() - t0) };

  const deadline = wait(timeoutMs).then(() => 'timeout' as const);
  const work = (async (): Promise<WarmAllReport> => {
    try { await Promise.race([attachDiscoverCanvas(), wait(8000)]); } catch { /* best-effort */ }
    const first = firePass();
    await wait(settleMs());

    // Second pass under a long-task observer: what is STILL cold shows up here.
    const longTasks: number[] = [];
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) longTasks.push(Math.round(e.duration)); });
      observer.observe({ entryTypes: ['longtask'] });
    } catch { observer = null; }
    const second = firePass();
    await wait(settleMs());
    observer?.disconnect();
    return { first, second, secondPassLongTasks: longTasks, ms: Math.round(performance.now() - t0) };
  })();

  const result = await Promise.race([work, deadline]);
  if (result === 'timeout') return { first: empty, second: empty, secondPassLongTasks: [], ms: Math.round(performance.now() - t0) };
  return result;
}
