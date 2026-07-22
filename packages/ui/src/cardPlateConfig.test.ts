import { describe, expect, it } from 'vitest';
import { plateTextBucket, PLATE_BUCKETS, getCardPlateConfig, setCardPlateValue } from './cardPlateConfig';

describe('plateTextBucket', () => {
  it('returns the largest size for short text', () => {
    expect(plateTextBucket('Taunt.')).toBe('s');
    expect(plateTextBucket('')).toBe('s');
  });

  // Derived from the live thresholds, not hardcoded lengths. The owner bakes tuned values into DEFAULTS
  // periodically, and fixed magic lengths break on every bake without saying anything useful — what actually
  // needs guarding is that each threshold is the first length landing in its bucket.
  it('steps down as text lengthens — each threshold is its bucket floor', () => {
    const c = getCardPlateConfig();
    const at = (n: number): string => plateTextBucket('x'.repeat(n));
    expect(at(0)).toBe('s');
    expect(at(c.bucketM - 1)).toBe('s');
    expect(at(c.bucketM)).toBe('m');
    expect(at(c.bucketL)).toBe('l');
    expect(at(c.bucketXl)).toBe('xl');
  });

  it('is monotonic — longer text never gets a LARGER font bucket', () => {
    const order = PLATE_BUCKETS.map((b) => b.id);
    let prev = 0;
    for (let n = 0; n <= 300; n += 1) {
      const idx = order.indexOf(plateTextBucket('x'.repeat(n)));
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
  });

  it('treats undefined/null text as empty', () => {
    expect(plateTextBucket(undefined)).toBe('s');
  });

  it('clamps anything past the last threshold to the smallest bucket', () => {
    expect(plateTextBucket('x'.repeat(5000))).toBe('xl');
  });

  it('honours tuned thresholds from the config', () => {
    const cfg = getCardPlateConfig();
    expect(cfg.bucketM).toBeGreaterThan(0);
    expect(cfg.bucketL).toBeGreaterThan(cfg.bucketM);
    expect(cfg.bucketXl).toBeGreaterThan(cfg.bucketL);
  });

  it('reacts to a tuned threshold', () => {
    const original = getCardPlateConfig().bucketM;
    try {
      // 'Taunt.' is 6 chars — 's' under the default bucketM of 70.
      expect(plateTextBucket('Taunt.')).toBe('s');
      setCardPlateValue('bucketM', 5); // now 6 chars exceeds the threshold
      expect(plateTextBucket('Taunt.')).toBe('m');
    } finally {
      setCardPlateValue('bucketM', original);
    }
  });
});
