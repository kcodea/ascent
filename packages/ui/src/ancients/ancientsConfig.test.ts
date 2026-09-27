import { describe, expect, it } from 'vitest';
import { ANCIENT_ART_IDS, ANCIENTS_DEFAULTS, ART_FIELDS } from './ancientsConfig';
import { ANCIENT_HERO_THEMES } from './ancientHeroThemes';

/** The owner's ✦ Ancients tuner values, baked as the shipped defaults (owner 2026-09-26: "bake these values for now"),
 *  so prod (which ignores the tuner's localStorage) matches what the owner signed off. */
describe('the Ancients tuner defaults', () => {
  it('carry the owner-baked screen colours, cue gains and reveal style', () => {
    expect(ANCIENTS_DEFAULTS).toMatchObject({
      curtainInner: '#247067', curtainOuter: '#0a0618', seamColor: '#fff1bd', titleGlow: '#9effd5', backdropTint: '#060d0f',
      pickSealGain: 0.62,
      // the reveal's sound, a magic reveal not a slam (owner 2026-09-27)
      revealSparkClip: 'triggerglow', revealSparkGain: 0.22, revealSparkRate: 1.15, cardRevealClip: 'equipmentsheen', cardRevealGain: 0.3, cardRevealRate: 1,
      revealStyle: 'burst', // the spark reveal (owner 2026-09-27): burst | seam | bloom
      sparkMs: 280, materialiseMs: 380, sideDelayMs: 120, sideStaggerMs: 90, overexposeMs: 520, burstRing: 1.3,
      hpDustLife: 0.45, dustAmount: 1, dustSize: 1, dustLife: 1, dustOpacity: 0.85, slamSparks: 1,
      revealDelayMs: 120, handoffMs: 440, textInMs: 240, landFlash: 0.85, idleFloat: 3, idleMs: 4800, hoverDim: 0.7, // the reveal passes
      titleHoldMs: 1050, revealFadeMs: 320,
      bondsColor: '#9b5de5', // the sixth Ancient, purple (owner 2026-09-26)
    });
    expect(ANCIENT_ART_IDS).toHaveLength(6);
    // THE PICK → COLLAPSE → TRIPLE TRAIL → SLAM (owner 2026-09-27; numbers argued in
    // docs/devlog/2026-09-27-ancient-pick-research.md): the backdrop fades, the card pinches into a core (200 ms), the
    // triple's trail launches at 70% of it, lands, a 60 ms hit-stop, then the ring + shake + crack.
    expect(ANCIENTS_DEFAULTS).toMatchObject({
      pickFadeMs: 380, collapseMs: 200, trailAt: 0.7, trailTime: 0.75, trailIntensity: 0.55, coreGlow: 1, hitStopMs: 60,
      pickWooshClip: 'fx/metal-woosh', pickSealClip: 'fx/triple-impact', // the triple's own two clips
      shakeMs: 280, shakePx: 5, punchZoom: 0.012, recoil: 0.1, burstScale: 0.6, impactFlash: 0.55, impactFlashMs: 200,
      crackOpenMs: 260, splitMs: 440, shineMs: 560, // the follow-through, tightened the same day
    });
    // Retired: no circle collapse, no flying art square, no rise-and-slam, no gather column.
    for (const k of ['closeMs', 'pickLiftMs', 'pickFlightMs', 'beat1Ms', 'beatGapMs', 'beat2Ms', 'slamStrength', 'slamDust', 'gatherMs', 'cardStaggerMs', 'cardRevealMs']) expect(ANCIENTS_DEFAULTS).not.toHaveProperty(k);
    expect(ANCIENTS_DEFAULTS).toMatchObject({ tunerHero: 'indy', tunerStyle: 'auto' }); // tuner-only pickers
  });
  it('fit every Ancient’s hero-power art at the neutral offset (0) and scale (1)', () => {
    for (const id of ANCIENT_ART_IDS) {
      for (const f of ART_FIELDS) expect(ANCIENTS_DEFAULTS[`${id}${f}`], `${id}${f}`).toBe(f === 'S' ? 1 : 0);
    }
  });
  it('carry the baked hero themes: the default (today’s teal) and Indy’s gold (redone 2026-09-26)', () => {
    expect(ANCIENT_HERO_THEMES.default).toEqual({ curtainInner: '#247067', curtainOuter: '#0a0618', seamColor: '#fff1bd', titleGlow: '#9effd5', backdropTint: '#060d0f' });
    expect(ANCIENT_HERO_THEMES.indy).toEqual({
      curtainInner: '#a0620f', curtainOuter: '#0d0501', seamColor: '#fff3cf', titleGlow: '#ffcf66', backdropTint: '#0f0803',
      label: 'Indy', style: 'coinStrike', knobs: { baked: true },
    });
    expect(ANCIENTS_DEFAULTS).toMatchObject({
      indyThemeCurtainInner: '#a0620f', indyThemeCurtainOuter: '#0d0501', indyThemeSeamColor: '#fff3cf', indyThemeTitleGlow: '#ffcf66', indyThemeBackdropTint: '#0f0803',
    });
  });
  it('carry the baked Warden, Auctioneer and Risen themes and their signatures (owner 2026-09-26)', () => {
    expect(ANCIENT_HERO_THEMES.warden).toEqual({
      curtainInner: '#4a87bb', curtainOuter: '#050d1c', seamColor: '#eaf8ff', titleGlow: '#9fe0ff', backdropTint: '#050b14',
      label: 'Warden', style: 'glassShell', knobs: { baked: true, medal: 'seal' },
    });
    expect(ANCIENT_HERO_THEMES.myra).toEqual({
      curtainInner: '#7b2887', curtainOuter: '#12031a', seamColor: '#ffe6a3', titleGlow: '#ffc95c', backdropTint: '#0d0512',
      label: 'Auctioneer', style: 'strikeRings', knobs: { medal: 'thump', rhythm: 'shout', count: 3 },
    });
    expect(ANCIENT_HERO_THEMES.risen).toEqual({
      curtainInner: '#5d8f7b', curtainOuter: '#030a08', seamColor: '#eafff5', titleGlow: '#b9ffe2', backdropTint: '#060c0a',
      label: 'Lord of the Risen', style: 'spiritRise', knobs: { baked: true },
    });
    expect(ANCIENTS_DEFAULTS).toMatchObject({
      wardenThemeCurtainInner: '#4a87bb', wardenThemeCurtainOuter: '#050d1c', wardenThemeSeamColor: '#eaf8ff', wardenThemeTitleGlow: '#9fe0ff', wardenThemeBackdropTint: '#050b14',
      myraThemeCurtainInner: '#7b2887', myraThemeCurtainOuter: '#12031a', myraThemeSeamColor: '#ffe6a3', myraThemeTitleGlow: '#ffc95c', myraThemeBackdropTint: '#0d0512',
      risenThemeCurtainInner: '#5d8f7b', risenThemeCurtainOuter: '#030a08', risenThemeSeamColor: '#eafff5', risenThemeTitleGlow: '#b9ffe2', risenThemeBackdropTint: '#060c0a',
    });
  });
});
