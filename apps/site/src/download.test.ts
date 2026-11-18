import { describe, expect, it } from 'vitest';
import { INSTALLER_URL } from './download';

describe('download', () => {
  it('points at the stable installer link Ship Ascent maintains', () => {
    expect(INSTALLER_URL).toBe('https://github.com/kcodea/ascent/releases/latest/download/ASCENT-Setup.exe');
  });
});
