import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { axisTransform } from './fx/scaleDef';
import { customPrimitive } from './fx/primitives/custom';
import { DEFAULT_AUDIO_CONFIG, effectiveGain } from './audio/config';
import { getRubyPowerFxDefaults, rubyRiseAt } from './rubyPowerFxConfig';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

/**
 * The Ruby BUFF cue ("your Rubies gain +X", owner 2026-11-10/11): the gem effect on the source card, an icon and a
 * plain number per stat floating up together, and a whoosh that leads one random pickaxe strike.
 */
describe('the Ruby buff cue', () => {
  it('anchors on the card\'s RESTING slot, not its mid-glide rect (R-RUBY-BUFF-02)', () => {
    const src = read('./Recruit.tsx');
    // Both shop sites that measure a just-played card: the seq watcher and the `rubyAura` beat presenter.
    for (const marker of ['// The RESTING centre: a card just dropped from the hand', 'rubyAura: (sourceUid, attack, health) => {']) {
      const at = src.indexOf(marker);
      expect(at, marker).toBeGreaterThan(-1);
      const body = src.slice(at, at + 1400);
      const rest = body.indexOf('restingCenterOf(el as HTMLElement)');
      expect(rest, `restingCenterOf missing after: ${marker}`).toBeGreaterThan(-1);
      expect(rest).toBeLessThan(body.indexOf('playRubyBuffFx('));
    }
  });

  it('an image layer resizes with a per-call scale, so the icon size dials work (R-FX-CUSTOM-SCALE-01)', () => {
    expect(axisTransform(customPrimitive.params, 0.6, 1)).toMatchObject({ size: 0.6 });
    expect(axisTransform(customPrimitive.params, 1, 1)).toEqual({});
    const src = read('./rubyPowerFxConfig.ts');
    expect(src).toContain('scale: cfg.atkIconScale');
    expect(src).toContain('scale: cfg.hpIconScale');
  });

  it('the icons ride the number\'s own rise curve', () => {
    const c = getRubyPowerFxDefaults();
    expect(rubyRiseAt(0)).toBe(0);
    expect(rubyRiseAt(c.numHoldMs + c.numFadeMs + 5000)).toBeCloseTo(c.numRise, 3);
  });

  it('the whoosh leads the strike, and the played card\'s Shout burst stays silent (R-RUBY-BUFF-SFX-01)', () => {
    const cue = read('./rubyPowerFxConfig.ts');
    const whoosh = cue.indexOf('sfx.rubyWhoosh();');
    expect(whoosh).toBeGreaterThan(-1);
    expect(cue.indexOf('const wait = cfg.numDelay + cfg.strikeDelay;')).toBeGreaterThan(whoosh);
    expect(cue).toContain('sfx.rubyStrike();');
    expect(getRubyPowerFxDefaults().strikeDelay).toBeGreaterThan(0);
    // The Shout moment of the card that raised Ruby strength plays muted, and the trigger chime is skipped.
    const recruit = read('./Recruit.tsx');
    expect(recruit).toContain('muteSound: uid === rubyUid,');
    expect(recruit).toContain('if (!raisedRubies || fresh.length > 1) sfx.triggerPulse();');
    const cues = read('./choreo/recruitCues.ts');
    expect(cues).toContain('...(ctx.muteSound ? { muteSound: true } : {})');
    expect(cues).toContain('if (binding.sfx !== undefined && !ctx.muteSound)');
  });

  it('the clips sit on their own mixer group at the owner\'s levels', () => {
    expect(effectiveGain(DEFAULT_AUDIO_CONFIG, 'rubypower', 'rubystrike1')).toBeCloseTo(0.3, 5);
    expect(effectiveGain(DEFAULT_AUDIO_CONFIG, 'rubypower', 'rubywhoosh')).toBeCloseTo(0.06, 5);
    expect(DEFAULT_AUDIO_CONFIG.categories.gemapply?.gain).toBeCloseTo(0.18, 5); // set by ear, owner 2026-11-11
  });
});
