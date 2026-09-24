// @vitest-environment jsdom
/**
 * THE CAST PREVIEW TUNER's config (owner 2026-09-23: *"this is far too large. can you build a tuner for me to
 * adjust size, positioning, and linger duration? … make sure to add all of the details to the tuner so i can
 * tune both. add an alpha/opacity lever as well."*) — defaults, persistence, live apply, and the panel schema.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAST_PREVIEW_CONTROLS, CAST_PREVIEW_DEFAULTS, CAST_PREVIEW_KEYS, CAST_PREVIEW_RANGES, CAST_PREVIEW_SOURCES, SPEC, castPreviewControlsFor,
  castPreviewCombatOncePerFight, castPreviewLook, castPreviewTimings, getCastPreviewConfig, runeCastFlourishLook,
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
  // Owner-baked 2026-09-24 from the panel: "use the values below for the rune triggering one". The combat set is
  // baked too, so switching combat back on starts from the owner's numbers.
  it('ships the owner\x27s baked values (rune/shop and combat)', () => {
    expect(CAST_PREVIEW_DEFAULTS).toEqual({
      shopScale: 0.6, shopSide: 0, shopOffsetX: 0, shopOffsetY: -32, shopFadeIn: 150, shopLinger: 500, shopFadeOut: 190, shopAlpha: 1,
      combatScale: 0.6, combatSide: 3, combatOffsetX: -74, combatOffsetY: 28, combatFadeIn: 150, combatLinger: 500, combatFadeOut: 190, combatAlpha: 1,
      combatOncePerFight: 1,
      // The rune cast flourish (2026-09-24 concept values, not yet owner-tuned).
      runeFlourishOn: 1, runeFlourishPulse: 0.14, runeFlourishPulseMs: 360, runeFlourishFlashSize: 1,
      runeFlourishMoteMs: 280, runeFlourishMoteSize: 1, runeFlourishLeadMs: 110, runeFlourishRepeatMs: 110,
    });
    expect(castPreviewLook('shop')).toEqual({ scale: 0.6, side: 'above', offsetX: 0, offsetY: -32, alpha: 1 });
    expect(castPreviewLook('combat').side).toBe('right');
    expect(castPreviewTimings('shop')).toEqual({ fadeIn: 150, linger: 500, fadeOut: 190 });
    expect(castPreviewCombatOncePerFight()).toBe(true); // the Fatecarver / Warflame ruling, kept for re-enable
  });
  it('the source gate: runes on, minions + combat OFF for now (owner 2026-09-24)', () => {
    expect(CAST_PREVIEW_SOURCES).toEqual({ rune: true, minion: false, combat: false });
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
  const SUFFIXES = ['Scale', 'Side', 'OffsetX', 'OffsetY', 'FadeIn', 'Linger', 'FadeOut', 'Alpha'];
  const FLOURISH = ['runeFlourishOn', 'runeFlourishPulse', 'runeFlourishPulseMs', 'runeFlourishFlashSize', 'runeFlourishMoteMs', 'runeFlourishMoteSize', 'runeFlourishLeadMs', 'runeFlourishRepeatMs'];
  it('while combat is off the panel shows ONLY the rune knobs, under "Rune casts", then the flourish group', () => {
    expect(CAST_PREVIEW_CONTROLS.map((c) => c.key)).toEqual([...SUFFIXES.map((s) => `shop${s}`), ...FLOURISH]);
    expect(new Set(CAST_PREVIEW_CONTROLS.map((c) => c.group))).toEqual(new Set(['Rune casts', 'Rune cast flourish']));
  });
  // Owner ask 2026-09-24: "can we do anything to add a bit of flair to this? … nothing crazy" — the flourish's knobs
  // (on/off, badge pulse intensity + length, mote travel + size) live in this panel and round-trip like the rest.
  it('the rune cast flourish knobs round-trip: write, persist, reload, reset', () => {
    const on = CAST_PREVIEW_CONTROLS.find((c) => c.key === 'runeFlourishOn');
    expect(on?.kind).toBe('toggle');
    setCastPreviewValue('runeFlourishOn', 0);
    setCastPreviewValue('runeFlourishPulse', 0.3);
    setCastPreviewValue('runeFlourishPulseMs', 500);
    setCastPreviewValue('runeFlourishMoteMs', 420);
    setCastPreviewValue('runeFlourishMoteSize', 99); // clamped to the range
    expect(runeCastFlourishLook()).toMatchObject({ on: false, pulse: 0.3, pulseMs: 500, moteMs: 420, moteSize: CAST_PREVIEW_RANGES.runeFlourishMoteSize[1] });
    reloadCastPreviewConfigForTest();
    expect(runeCastFlourishLook()).toMatchObject({ on: false, pulse: 0.3, pulseMs: 500, moteMs: 420 });
    resetCastPreviewConfig();
    expect(runeCastFlourishLook()).toMatchObject({ on: true, pulse: 0.14, pulseMs: 360, moteMs: 280, moteSize: 1 });
  });
  it('flipping the gate back on restores every knob exactly once, shop and combat each carrying the full set', () => {
    const keys = castPreviewControlsFor({ rune: true, minion: true, combat: true }).map((c) => c.key);
    expect([...keys].sort()).toEqual([...CAST_PREVIEW_KEYS].sort());
    expect(new Set(keys).size).toBe(keys.length);
    for (const suffix of SUFFIXES) {
      expect(keys, suffix).toContain(`shop${suffix}`);
      expect(keys, suffix).toContain(`combat${suffix}`);
    }
  });
  it('carries no hints (the shared panel would render them as native tooltips)', () => {
    for (const c of castPreviewControlsFor({ rune: true, minion: true, combat: true })) expect(c.hint, c.key).toBeUndefined();
  });
  // Read as source: importing `tunerAll` pulls every panel (and Pixi) into jsdom.
  it('is registered with "Reset all tuners" and the dev menu, under its frozen id', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    expect(SPEC.id).toBe('castpreview');
    expect(readFileSync(join(here, 'tunerAll.ts'), 'utf8')).toMatch(/SPEC as CastPreviewSpec[\s\S]*CastPreviewSpec,/);
    expect(readFileSync(join(here, 'DevMenu.tsx'), 'utf8')).toContain("key: 'castpreview'");
  });
});
