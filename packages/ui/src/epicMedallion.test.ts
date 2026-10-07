import { describe, expect, it } from 'vitest';
import { EPIC_MEDALLION_SRC, EPIC_UNITS, epicMedallionSrc, isEpicUnit } from './epicMedallion';

describe('isEpicUnit', () => {
  it('flags the four named units (trigger/cast multipliers)', () => {
    expect(isEpicUnit('drummer')).toBe(true); // Drakko
    expect(isEpicUnit('sylus')).toBe(true);
    expect(isEpicUnit('chronos')).toBe(true);
    expect(isEpicUnit('yazzus')).toBe(true);
  });
  it('flags the group-A trigger multipliers', () => {
    for (const id of ['uron', 'zyff', 'echowarden', 'attachmentconductor', 'b2_elderhorn', 'd2_orivax', 'dw_edward', 'ce3_constellationprime']) {
      expect(isEpicUnit(id), id).toBe(true);
    }
  });
  it('Elderhorn and Orivax wear the same default epic gem as Drakko / Sylus (owner 2026-10-07)', () => {
    for (const id of ['b2_elderhorn', 'd2_orivax', 'drummer', 'sylus']) expect(epicMedallionSrc(id), id).toBe(EPIC_MEDALLION_SRC);
  });
  it('is false for ordinary units and nonsense', () => {
    expect(isEpicUnit('taurus')).toBe(false);
    expect(isEpicUnit('nonsense')).toBe(false);
  });
  it('exposes the curated set (13) + a BASE_URL-relative art path', () => {
    expect(EPIC_UNITS.size).toBe(13);
    expect(EPIC_MEDALLION_SRC).toMatch(/medallions\/epic\.webp$/);
  });
});
