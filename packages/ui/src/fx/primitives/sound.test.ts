import { describe, expect, it } from 'vitest';
import { defaultsOf, validateSpecs } from '../params';
import { soundPrimitive } from './sound';
import { PRIMITIVE_COPY } from '../ui/copy';
import { BUS_NAMES } from '../../audio/config';

/**
 * `SoundInstance` plays through the Web Audio graph (a real AudioContext), so — like `beam`/`targeting` — the
 * behaviour is verified by ear in the workshop and these headless tests cover what CAN be: the specs are
 * well-formed, the shipped defaults are the approved starting point, and the primitive is discoverable
 * (registered id + workshop copy). The play path itself (`playFxSound`) is exercised live.
 */
describe('sound primitive', () => {
  it('registers with valid specs under the id "sound"', () => {
    expect(soundPrimitive.id).toBe('sound');
    expect(validateSpecs(soundPrimitive.params)).toEqual([]);
  });

  it('ships the approved playback defaults (a changed default must be a deliberate, reviewed edit)', () => {
    const d = defaultsOf(soundPrimitive.params);
    expect(d).toMatchObject({
      clip: '', gain: 1, pitch: 1, reverse: false, loop: false,
      startOffset: 0, delay: 0, fadeIn: 0, fadeOut: 0,
      gainVar: 0, pitchVar: 0, bus: 'combat',
    });
  });

  it('routes to a real mixing-desk bus', () => {
    const d = defaultsOf(soundPrimitive.params);
    expect(BUS_NAMES).toContain(d.bus);
  });

  it('has a workshop copy label so it shows in the primitive picker', () => {
    expect(PRIMITIVE_COPY.sound?.label).toBe('Sound');
    expect(PRIMITIVE_COPY.sound.blurb.length).toBeGreaterThan(20);
  });
});
