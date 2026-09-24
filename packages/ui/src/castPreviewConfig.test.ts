// @vitest-environment jsdom
/**
 * THE CAST PREVIEW TUNER's config (owner 2026-09-23: *"this is far too large. can you build a tuner for me to
 * adjust size, positioning, and linger duration? … make sure to add all of the details to the tuner so i can
 * tune both. add an alpha/opacity lever as well."*) — defaults, persistence, live apply, and the panel schema.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAST_PREVIEW_CONTROLS, CAST_PREVIEW_DEFAULTS, CAST_PREVIEW_KEYS, CAST_PREVIEW_RANGES, SPEC,
  castPreviewCombatOncePerFight, castPreviewLook, castPreviewTimings, getCastPreviewConfig,
  reloadCastPreviewConfigForTest, resetCastPreviewConfig, setCastPreviewValue, subscribeCastPreviewConfig,
} from './castPreviewConfig';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = 'ascent.castpreview';
beforeEach(() => { localStorage.clear(); resetCastPreviewConfig(); });
afterEach(() => { localStorage.clear(); resetCastPreviewConfig(); });

describe('defaults', () => {
  it('every default sits inside its own slider range', () => {
    for (const k of CAST_PREVIEW_KEYS) {
      const [min, max] = CAST_PREVIEW_RANGES[k];
      expect(CAST_PREVIEW_DEFAULTS[k], k).toBeGreaterThanOrEqual(min);
      expect(CAST_PREVIEW_DEFAULTS[k], k).toBeLessThanOrEqual(max);
    }
  });
  it('ships SMALL — well under the old full plated card (scale 1), sitting above its source, fully opaque', () => {
    for (const ctx of ['shop', 'combat'] as const) {
      const look = castPreviewLook(ctx);
      expect(look.scale, ctx).toBeLessThanOrEqual(0.5);
      expect(look.side, ctx).toBe('above');
      expect([look.offsetX, look.offsetY], ctx).toEqual([0, 0]);
      expect(look.alpha, ctx).toBe(1);
    }
    expect(castPreviewTimings('shop').linger).toBe(2000); // the owner's "about 2 seconds"
    expect(castPreviewCombatOncePerFight()).toBe(true);   // the Fatecarver / Warflame ruling
  });
});

describe('persistence + live apply', () => {
  it('a write clamps to the range, notifies subscribers, and persists under its own key', () => {
    const seen = vi.fn();
    const off = subscribeCastPreviewConfig(seen);
    setCastPreviewValue('shopScale', 9);
    expect(getCastPreviewConfig().shopScale).toBe(CAST_PREVIEW_RANGES.shopScale[1]);
    setCastPreviewValue('combatAlpha', 0.4);
    expect(seen).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toMatchObject({ shopScale: 1.5, combatAlpha: 0.4 });
    off();
  });
  it('a reload reads the saved values back (and ignores junk)', () => {
    localStorage.setItem(KEY, JSON.stringify({ shopLinger: 3500, combatSide: 2, bogus: 1, shopAlpha: 'x' }));
    reloadCastPreviewConfigForTest();
    expect(castPreviewTimings('shop').linger).toBe(3500);
    expect(castPreviewLook('combat').side).toBe('left');
    expect(getCastPreviewConfig().shopAlpha).toBe(CAST_PREVIEW_DEFAULTS.shopAlpha);
    expect(getCastPreviewConfig()).not.toHaveProperty('bogus');
  });
  it('reset restores the defaults and clears the stored key', () => {
    setCastPreviewValue('combatOffsetY', -40);
    resetCastPreviewConfig();
    expect(getCastPreviewConfig()).toEqual(CAST_PREVIEW_DEFAULTS);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
  it('shop and combat knobs are independent', () => {
    setCastPreviewValue('shopScale', 0.25);
    setCastPreviewValue('combatLinger', 900);
    expect(castPreviewLook('shop').scale).toBe(0.25);
    expect(castPreviewLook('combat').scale).toBe(CAST_PREVIEW_DEFAULTS.combatScale);
    expect(castPreviewTimings('combat').linger).toBe(900);
    expect(castPreviewTimings('shop').linger).toBe(CAST_PREVIEW_DEFAULTS.shopLinger);
  });
});

describe('the panel', () => {
  it('every knob is reachable exactly once, shop and combat each carrying the full set', () => {
    const keys = CAST_PREVIEW_CONTROLS.map((c) => c.key);
    expect([...keys].sort()).toEqual([...CAST_PREVIEW_KEYS].sort());
    expect(new Set(keys).size).toBe(keys.length);
    for (const suffix of ['Scale', 'Side', 'OffsetX', 'OffsetY', 'FadeIn', 'Linger', 'FadeOut', 'Alpha']) {
      expect(keys, suffix).toContain(`shop${suffix}`);
      expect(keys, suffix).toContain(`combat${suffix}`);
    }
  });
  it('carries no hints (the shared panel would render them as native tooltips)', () => {
    for (const c of CAST_PREVIEW_CONTROLS) expect(c.hint, c.key).toBeUndefined();
  });
  // Read as source: importing `tunerAll` pulls every panel (and Pixi) into jsdom.
  it('is registered with "Reset all tuners" and the dev menu, under its frozen id', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    expect(SPEC.id).toBe('castpreview');
    expect(readFileSync(join(here, 'tunerAll.ts'), 'utf8')).toMatch(/SPEC as CastPreviewSpec[\s\S]*CastPreviewSpec,/);
    expect(readFileSync(join(here, 'DevMenu.tsx'), 'utf8')).toContain("key: 'castpreview'");
  });
});
