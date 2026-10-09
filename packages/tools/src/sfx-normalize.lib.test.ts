import { describe, expect, it } from 'vitest';
import {
  COMPRESSOR, HERO_SELECT_LUFS, TARGET_LUFS, TRUE_PEAK, applyFilter, isSilent, measureFilter, parseLoudnorm, planNormalize, readFilter,
} from './sfx-normalize.lib';

const REPORT = `[Parsed_loudnorm_1 @ 000001] \n{\n\t"input_i" : "-42.40",\n\t"input_tp" : "-25.00",\n\t"input_lra" : "3.10",`
  + `\n\t"input_thresh" : "-52.80",\n\t"output_i" : "-20.10",\n\t"output_tp" : "-3.00",\n\t"target_offset" : "0.30"\n}\n`;

describe('sfx-normalize', () => {
  it('compresses first, then normalizes to the target with a true-peak ceiling', () => {
    expect(measureFilter()).toBe(`${COMPRESSOR},loudnorm=I=${TARGET_LUFS}:TP=${TRUE_PEAK}:LRA=11:print_format=json`);
    expect(readFilter()).not.toContain('acompressor');
  });

  it('pass 2 is ONE linear gain from the pass-1 measurement (no pumping)', () => {
    const f = applyFilter(parseLoudnorm(REPORT));
    expect(f.startsWith(`${COMPRESSOR},loudnorm=`)).toBe(true);
    expect(f).toContain('measured_I=-42.40:measured_TP=-25.00:measured_LRA=3.10:measured_thresh=-52.80:offset=0.30');
    expect(f).toContain('linear=true');
  });

  it('can normalize to another target (the Hero Select lines sit at the owner recordings’ level)', () => {
    expect(measureFilter(HERO_SELECT_LUFS)).toContain(`loudnorm=I=${HERO_SELECT_LUFS}:`);
    expect(applyFilter(parseLoudnorm(REPORT), HERO_SELECT_LUFS)).toContain(`loudnorm=I=${HERO_SELECT_LUFS}:`);
    expect(HERO_SELECT_LUFS).not.toBe(TARGET_LUFS);
  });

  it('reads the last JSON block out of ffmpeg stderr and rejects a missing report', () => {
    expect(parseLoudnorm(`noise {"x":1}\n${REPORT}`).input_i).toBe('-42.40');
    expect(() => parseLoudnorm('no report here')).toThrow();
  });

  it('leaves a silent clip alone', () => {
    expect(isSilent({ ...parseLoudnorm(REPORT), input_i: '-inf' })).toBe(true);
    expect(isSilent(parseLoudnorm(REPORT))).toBe(false);
  });

  it('is idempotent: only clips whose content is not the recorded normalized one are planned', () => {
    const files = [{ name: 'vo-a', hash: 'h1' }, { name: 'vo-b', hash: 'h2' }, { name: 'vo-c', hash: 'h3' }];
    expect(planNormalize(files, { 'vo-a': 'h1', 'vo-b': 'old' })).toEqual(['vo-b', 'vo-c']);
  });
});
