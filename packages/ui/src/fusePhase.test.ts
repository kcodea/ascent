import { describe, it, expect } from 'vitest';
import { fuseExitKind, fusePhaseOnLight } from './fusePhase';

describe('crystal fuse phases', () => {
  it('a light with time left charges; a light on a dead clock (Continue at 0:00) is already charged, with no burst', () => {
    expect(fusePhaseOnLight(7)).toBe('charging');
    expect(fusePhaseOnLight(0)).toBe('charged');
  });

  it('unlighting before 0:00 flashes and fades the fuse; at or after 0:00 (even the same frame) the strike releases it', () => {
    expect(fuseExitKind(3)).toBe('flashFade');
    expect(fuseExitKind(0)).toBe('release');
    expect(fuseExitKind(-1)).toBe('release');
  });
});
