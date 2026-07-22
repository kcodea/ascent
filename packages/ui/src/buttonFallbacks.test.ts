import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getEndTurnConfig } from './endTurnConfig';
import { getHeroPowerBtnConfig } from './heroPowerBtnConfig';
import { getRefreshConfig } from './refreshConfig';
import { getTavernUpConfig } from './tavernUpConfig';

/**
 * The four board buttons are positioned by PURE CSS reading `var(--<prefix>-x/-y/-s, <fallback>)`. Nothing
 * calls the config modules' `apply*Vars()` outside their DEV tuners — so in a PRODUCTION build those vars are
 * never set and **the CSS fallback is what ships**. The TS `DEFAULTS` only decide what the tuner opens showing.
 *
 * That makes the two a mirror that must be kept by hand, and every config file says so in its header. It was
 * not kept: on 2026-07-22 the owner reported the buttons "shifted" in the packaged exe, and the cause was four
 * buttons whose dialled values had been baked into `DEFAULTS` but not into the fallbacks (e.g. `--etb-x` shipped
 * 140px against a DEFAULTS of 150). Dev looked right, production did not.
 *
 * This test is the guard. It is deliberately limited to x/y/scale — the values that visibly move a button —
 * rather than every glow/dust dial, so it stays cheap to keep true.
 */
const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

/** First `var(--name, <fallback>)` occurrence in styles.css, with any unit stripped. */
function fallback(name: string): number {
  const m = new RegExp(`var\\(--${name},\\s*(-?[\\d.]+)(px|s|ms|deg|%)?\\)`).exec(CSS);
  if (!m) throw new Error(`no CSS fallback found for --${name} — did the var get renamed?`);
  return Number(m[1]);
}

const BUTTONS = [
  { label: 'hero power', prefix: 'hpb', cfg: getHeroPowerBtnConfig() },
  { label: 'refresh', prefix: 'rfb', cfg: getRefreshConfig() },
  { label: 'end turn', prefix: 'etb', cfg: getEndTurnConfig() },
  { label: 'tavern up', prefix: 'tvb', cfg: getTavernUpConfig() },
] as const;

describe('board button CSS fallbacks mirror their DEFAULTS', () => {
  for (const { label, prefix, cfg } of BUTTONS) {
    it(`${label} (--${prefix}-*) x/y/scale match`, () => {
      expect(fallback(`${prefix}-x`), `--${prefix}-x fallback vs DEFAULTS.x`).toBe(cfg.x);
      expect(fallback(`${prefix}-y`), `--${prefix}-y fallback vs DEFAULTS.y`).toBe(cfg.y);
      expect(fallback(`${prefix}-s`), `--${prefix}-s fallback vs DEFAULTS.scale`).toBe(cfg.scale);
    });
  }
});
