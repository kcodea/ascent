/**
 * TIERED CHEST OPENINGS: the tier axis of the crate-opening config. A chest's tier (its guaranteed floor) picks an
 * escalating effects-and-sound LAYER on top of the reward's own dials; Standard is today's opening, no layer.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  CRATE_CUE_CATEGORY, CRATE_FX_DEFAULTS, CRATE_FX_RANGES, SPEC, chestTierPresetFor, crateCue, previewChest,
  resetCrateFxConfig, sanitizeCrateFxConfig, setCrateFxValue, setPreviewChest,
} from './crateFxConfig';
import { CHEST_TIERS, CHEST_TIER_LABEL, LAYERED_TIERS, NO_TIER_LAYER, TIER_NUM_SUFFIXES, chestTierOf } from './chestTiers';
import { CATEGORY_BUS, CATEGORY_LABEL, CATEGORY_GAINS } from '../../audio/config';

afterEach(() => { resetCrateFxConfig(); setPreviewChest('standard'); });

describe('tier from floor', () => {
  it('a missing or common floor is Standard; any other floor is its own tier', () => {
    expect(chestTierOf(undefined)).toBe('standard');
    expect(chestTierOf(null)).toBe('standard');
    expect(chestTierOf('common')).toBe('standard');
    expect(chestTierOf('rare')).toBe('rare');
    expect(chestTierOf('epic')).toBe('epic');
    expect(chestTierOf('legendary')).toBe('legendary');
    expect(chestTierOf('ancient')).toBe('ancient');
  });

  it('lists the tiers in escalating order, with player-facing labels', () => {
    expect(CHEST_TIERS).toEqual(['standard', 'rare', 'epic', 'legendary', 'ancient']);
    expect(LAYERED_TIERS).toEqual(['rare', 'epic', 'legendary', 'ancient']);
    expect(CHEST_TIER_LABEL).toEqual({ standard: 'Standard', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', ancient: 'Ancient' });
  });
});

describe('the tier preset', () => {
  it('standard has no layer', () => {
    expect(chestTierPresetFor('standard')).toEqual(NO_TIER_LAYER);
    expect(NO_TIER_LAYER.tier).toBe('standard');
    expect(NO_TIER_LAYER.multichrome).toBe(false);
    for (const [k, v] of Object.entries(NO_TIER_LAYER)) if (typeof v === 'number') expect(v, k).toBe(0);
  });

  it('the defaults escalate rare < epic < legendary < ancient', () => {
    const p = LAYERED_TIERS.map((t) => chestTierPresetFor(t, CRATE_FX_DEFAULTS));
    for (const key of ['auraGlow', 'motes', 'extraGlow', 'burstSparkles'] as const) {
      for (let i = 1; i < p.length; i++) expect(p[i]![key], `${key} ${p[i]!.tier}`).toBeGreaterThan(p[i - 1]![key]);
    }
    expect(p.map((x) => x.bands > 0)).toEqual([false, false, true, true]);
    expect(p.map((x) => x.bandSpeed > 0)).toEqual([false, false, true, true]);
    expect(p.map((x) => x.multichrome)).toEqual([false, false, false, true]);
    expect(p.map((x) => x.hueSpeed > 0)).toEqual([false, false, false, true]);
  });

  it('carries the shipped tier colours, as a Pixi number and as CSS', () => {
    expect(chestTierPresetFor('rare', CRATE_FX_DEFAULTS)).toMatchObject({ tier: 'rare', color: 0x5aa8ff, colorCss: '#5aa8ff' });
    expect(chestTierPresetFor('epic', CRATE_FX_DEFAULTS)).toMatchObject({ color: 0xc07bff, colorCss: '#c07bff' });
    expect(chestTierPresetFor('legendary', CRATE_FX_DEFAULTS)).toMatchObject({ color: 0xffb938, colorCss: '#ffb938' });
    expect(chestTierPresetFor('ancient', CRATE_FX_DEFAULTS)).toMatchObject({ color: 0xf4eeff, colorCss: '#f4eeff', multichrome: true });
  });

  it('takes the verbatim default dials', () => {
    expect(chestTierPresetFor('epic', CRATE_FX_DEFAULTS)).toMatchObject({
      auraGlow: 0.4, motes: 6, wisps: 6, wispPull: 0.5, bands: 0, bandSpeed: 0, extraShake: 0.4, extraGlow: 0.2,
      burstFlash: 0.2, burstSparkles: 22, burstWisps: 6, hueSpeed: 0, shimmerGain: 0.3, swirlGain: 0.35, burstGain: 0,
    });
    expect(chestTierPresetFor('ancient', CRATE_FX_DEFAULTS)).toMatchObject({
      auraGlow: 0.7, motes: 10, wisps: 10, wispPull: 0.7, bands: 4, bandSpeed: 0.5, extraShake: 1.6, extraGlow: 0.45,
      burstFlash: 0.9, burstSparkles: 48, burstWisps: 16, hueSpeed: 0.35, shimmerGain: 0.5, swirlGain: 0.55, burstGain: 0.6,
    });
  });

  it('a tuned value survives, and a broken one falls back to the default for that key only', () => {
    setCrateFxValue('epicWisps', 9);
    expect(chestTierPresetFor('epic').wisps).toBe(9);
    const broken = { ...CRATE_FX_DEFAULTS, epicMotes: Number.NaN, epicTierColor: 'nope' };
    expect(chestTierPresetFor('epic', broken)).toMatchObject({ motes: 6, color: 0xc07bff, colorCss: '#c07bff', wisps: 6 });
  });
});

describe('the config', () => {
  it('has every tier key, in range', () => {
    for (const t of LAYERED_TIERS) {
      for (const s of TIER_NUM_SUFFIXES) expect(`${t}${s}` in CRATE_FX_RANGES, `${t}${s}`).toBe(true);
      expect(`${t}TierColor` in CRATE_FX_DEFAULTS).toBe(true);
    }
    expect('standardMotes' in CRATE_FX_DEFAULTS).toBe(false);
  });

  it('the defaults are in range (sanitising them changes nothing)', () => {
    expect(sanitizeCrateFxConfig(CRATE_FX_DEFAULTS)).toEqual(CRATE_FX_DEFAULTS);
  });

  it('the ranges follow the brief: counts 0..80, shake 0..6, speeds 0..2, the rest 0..1', () => {
    for (const t of LAYERED_TIERS) {
      for (const s of ['Wisps', 'Motes', 'BurstSparkles', 'BurstWisps', 'Bands'] as const) expect(CRATE_FX_RANGES[`${t}${s}`].slice(0, 2), s).toEqual([0, 80]);
      expect(CRATE_FX_RANGES[`${t}ExtraShake`].slice(0, 2)).toEqual([0, 6]);
      expect(CRATE_FX_RANGES[`${t}BandSpeed`].slice(0, 2)).toEqual([0, 2]);
      expect(CRATE_FX_RANGES[`${t}HueSpeed`].slice(0, 2)).toEqual([0, 2]);
      for (const s of ['AuraGlow', 'WispPull', 'ExtraGlow', 'BurstFlash', 'ShimmerGain', 'SwirlGain', 'BurstGain'] as const) expect(CRATE_FX_RANGES[`${t}${s}`].slice(0, 2), s).toEqual([0, 1]);
    }
  });

  // Owner ruling at the final review (2026-10-19): the Ancient REWARD keeps the approved "Prismatic Aurora" cyan
  // (R-PROG-RARITY-01); only the Ancient CHEST's layer is opal. An Ancient reward's sparks still shimmer through the hues.
  it('the Ancient reward stays Prismatic Aurora cyan; the Ancient chest tier is the opal one', () => {
    expect(CRATE_FX_DEFAULTS.ancientColor).toBe('#8af5ff');
    expect(CRATE_FX_DEFAULTS.ancientTierColor).toBe('#f4eeff');
  });
});

describe('the tier sound cues', () => {
  it('default clips: the sparkle slice, the swish and the cinematic impact', () => {
    expect(CRATE_FX_DEFAULTS.sfxTierShimmerClip).toBe('fx/djartmusic-christmas-sparkle-whoosh-1-275404');
    expect(CRATE_FX_DEFAULTS.sfxTierSwirlClip).toBe('fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3');
    expect(CRATE_FX_DEFAULTS.sfxTierBurstClip).toBe('fx/universfield-cinematic-swoosh-impact-454392');
  });

  it('the cues read the tier clips; the shimmer plays the reveal slice', () => {
    expect(crateCue(CRATE_FX_DEFAULTS, 'tierSwirl').clip).toBe(CRATE_FX_DEFAULTS.sfxTierSwirlClip);
    expect(crateCue(CRATE_FX_DEFAULTS, 'tierBurst').clip).toBe(CRATE_FX_DEFAULTS.sfxTierBurstClip);
    const c = { ...CRATE_FX_DEFAULTS, sfxRevealStartMs: 500, sfxRevealLenMs: 700 };
    expect(crateCue(c, 'tierShimmer')).toMatchObject({ clip: c.sfxTierShimmerClip, startMs: 500, lenMs: 700 });
  });

  it('each cue has its own mixer category, labelled and routed to ui', () => {
    expect(CRATE_CUE_CATEGORY).toMatchObject({ tierShimmer: 'crateTierShimmer', tierSwirl: 'crateTierSwirl', tierBurst: 'crateTierBurst' });
    for (const cat of ['crateTierShimmer', 'crateTierSwirl', 'crateTierBurst']) {
      expect(CATEGORY_GAINS[cat], cat).toBeGreaterThan(0);
      expect(CATEGORY_BUS[cat], cat).toBe('ui');
      expect(CATEGORY_LABEL[cat], cat).toBeTruthy();
    }
  });
});

describe('the tuner', () => {
  it('has a group per tier, and the sound sub-controls for the tier cues', () => {
    const groups = new Set(SPEC.controls.map((c) => c.group));
    for (const g of ['Rare chest', 'Epic chest', 'Legendary chest', 'Ancient chest']) expect(groups.has(g), g).toBe(true);
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of ['sfxTierShimmerClip', 'sfxTierSwirlClip', 'sfxTierBurstClip', 'epicTierColor', 'ancientHueSpeed']) expect(keys.has(k as never), k).toBe(true);
    expect(SPEC.title).toBe('Chest opening');
    expect(SPEC.id).toBe('cratefx');
  });

  it('the Chest: actions set the preview chest, and the note names it', () => {
    const acts = SPEC.actions!.filter((a) => a.label.startsWith('Chest: '));
    expect(acts.map((a) => a.label)).toEqual(['Chest: Standard', 'Chest: Rare', 'Chest: Epic', 'Chest: Legendary', 'Chest: Ancient']);
    expect(previewChest()).toBe('standard');
    acts[3]!.run(null);
    expect(previewChest()).toBe('legendary');
    const note = typeof SPEC.note === 'function' ? SPEC.note() : SPEC.note;
    expect(note).toContain('Legendary');
  });
});
