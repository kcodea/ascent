/**
 * `screen` — a NON-DRAWING cue layer that fires SCREEN-level juice when it becomes active: a camera SHAKE, a
 * full-screen FLASH, and/or a SOUND. The screen sibling of `react.ts`: it draws nothing (its Pixi container
 * stays empty, the layer exists purely for its timing slot) and reaches OUT of Pixi the same way `react` does
 * — directly, no bridge. Shake toggles a CSS class on the app root, flash appends a fixed full-screen div, and
 * sound calls the `sfx` module. Because both the combat arena and the workbench preview live in the same DOM,
 * an authored screen cue reads the same in both with no combat-JSX or workbench wiring.
 *
 * It fires ONCE, when it first ticks (its `at` on the def timeline is its trigger). Every knob defaults to a
 * no-op (shake 0, flash alpha 0, sound none), so an untouched screen layer does nothing.
 *
 * CSS lives in `styles.css` (`.fxshake` / `@keyframes fxshake`, `.fxflash` / `@keyframes fxflash`). Both are
 * ONE-SHOT (allowed to touch paint per CLAUDE.md), self-remove on `animationend`, and are torn down on
 * `destroy()` so a scrubbed/cancelled cue leaves nothing behind.
 */
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import type { ParamsOf, FxParamSpecs } from '../params';
import { registerPrimitive } from '../registry';
import { sfx } from '../../sfx';

export const FLASH_COLORS = ['white', 'gold', 'red', 'crimson', 'blue', 'black'] as const;
const FLASH_HEX: Record<(typeof FLASH_COLORS)[number], string> = {
  white: '#ffffff', gold: '#ffd873', red: '#ff5a4d', crimson: '#c81e3c', blue: '#7fd8ff', black: '#000000',
};

// A handful of existing `sfx` cues an author can attach. 'none' is the default no-op.
export const SCREEN_SOUNDS = ['none', 'play', 'roll', 'consume', 'sell', 'castSpell', 'freeze'] as const;
type ScreenSound = (typeof SCREEN_SOUNDS)[number];

const SPECS = {
  shake: {
    kind: 'slider', label: 'Shake', group: 'Shake', min: 0, max: 40, step: 0.5, default: 0,
    help: 'Camera-kick amplitude in px — a brief screen shake when this cue fires. 0 = none. The whole view jolts, so keep it small; big values read as an earthquake.',
  },
  shakeMs: {
    kind: 'slider', label: 'Shake length', group: 'Shake', min: 60, max: 1200, step: 10, default: 300,
    help: 'How long the shake lasts, in ms. It decays to nothing over this window. Does nothing while Shake is 0.',
  },
  flashAlpha: {
    kind: 'slider', label: 'Flash', group: 'Flash', min: 0, max: 1, step: 0.01, default: 0,
    help: 'Peak opacity of a full-screen colour flash when this cue fires — 0 = none, 1 = a full whiteout. It pops to this then fades. Great for impacts and gilds.',
  },
  flashColor: {
    kind: 'enum', label: 'Flash colour', group: 'Flash', options: FLASH_COLORS, default: 'white',
    help: 'The colour of the full-screen flash. Does nothing while Flash is 0.',
  },
  flashMs: {
    kind: 'slider', label: 'Flash length', group: 'Flash', min: 60, max: 1500, step: 10, default: 250,
    help: 'How long the flash takes to pop and fade, in ms. Does nothing while Flash is 0.',
  },
  sound: {
    kind: 'enum', label: 'Sound', group: 'Sound', options: SCREEN_SOUNDS, default: 'none',
    help: 'A sound cue to play when this fires, from the shared sfx set. \'none\' is silent. (A small starter set — richer per-effect sound authoring is a later pass.)',
  },
} satisfies FxParamSpecs;

type ScreenParams = ParamsOf<typeof SPECS>;

/** True while a document/window exists — false under the headless test shim, where the cues no-op. */
const hasDom = (): boolean => typeof document !== 'undefined' && !!document.body;

function fireShake(amp: number, ms: number): (() => void) | null {
  if (amp <= 0 || !hasDom()) return null;
  const app = document.querySelector('.app') as HTMLElement | null;
  if (!app) return null;
  app.style.setProperty('--fxshake-amp', `${amp}px`);
  app.style.setProperty('--fxshake-ms', `${ms}ms`);
  app.classList.add('fxshake');
  const clear = (): void => app.classList.remove('fxshake');
  app.addEventListener('animationend', clear, { once: true });
  return clear;
}

function fireFlash(alpha: number, color: string, ms: number): (() => void) | null {
  if (alpha <= 0 || !hasDom()) return null;
  const el = document.createElement('div');
  el.className = 'fxflash';
  el.style.setProperty('--fxflash-color', color);
  el.style.setProperty('--fxflash-alpha', String(alpha));
  el.style.setProperty('--fxflash-ms', `${ms}ms`);
  document.body.appendChild(el);
  const clear = (): void => { el.remove(); };
  el.addEventListener('animationend', clear, { once: true });
  return clear;
}

function fireSound(sound: ScreenSound): void {
  if (sound === 'none') return;
  const fn = (sfx as unknown as Record<string, undefined | (() => void)>)[sound];
  if (typeof fn === 'function') fn();
}

class ScreenInstance implements FxInstance<ScreenParams> {
  private params: ScreenParams;
  private fired = false;
  private elapsed = 0;
  private clearShake: (() => void) | null = null;
  private clearFlash: (() => void) | null = null;
  private readonly oneShot: boolean;

  constructor(_ctx: FxContext, params: ScreenParams) {
    this.params = params;
    this.oneShot = _ctx.oneShot === true;
  }

  update(dtMs: number): void {
    this.elapsed += dtMs;
    if (this.fired) return;
    this.fired = true;
    const p = this.params;
    const color = FLASH_HEX[p.flashColor as (typeof FLASH_COLORS)[number]] ?? FLASH_HEX.white;
    this.clearShake = fireShake(p.shake, p.shakeMs);
    this.clearFlash = fireFlash(p.flashAlpha, color, p.flashMs);
    fireSound(p.sound as ScreenSound);
  }

  setParams(next: ScreenParams): void { this.params = next; }

  isComplete(): boolean {
    // Done once it has fired AND outlived its longest cue — so a `fireOnce` def waits for the shake/flash to
    // finish before reaping the (invisible) layer. Continuous instances never self-complete.
    if (!this.oneShot) return false;
    const p = this.params;
    return this.fired && this.elapsed >= Math.max(p.shakeMs, p.flashMs, 1);
  }

  destroy(): void {
    // Tear down any still-running cue so a scrub/cancel leaves no stuck class or orphan div.
    this.clearShake?.(); this.clearShake = null;
    this.clearFlash?.(); this.clearFlash = null;
  }
}

export const screenPrimitive: FxPrimitive<typeof SPECS> = {
  id: 'screen',
  params: SPECS,
  spawn: (ctx, params) => new ScreenInstance(ctx, params),
};

registerPrimitive(screenPrimitive as FxPrimitive);
