import { describe, expect, it } from 'vitest';
import { plateTextBucket, PLATE_BUCKETS, getCardPlateConfig, setCardPlateValue } from './cardPlateConfig';

describe('plateTextBucket', () => {
  it('returns the largest size for short text', () => {
    expect(plateTextBucket('Taunt.')).toBe('s');
    expect(plateTextBucket('')).toBe('s');
  });

  it('steps down as text lengthens', () => {
    const short = plateTextBucket('Taunt.');                          // 6
    const med = plateTextBucket('x'.repeat(80));                      // between s and l
    const long = plateTextBucket('x'.repeat(130));
    const xlong = plateTextBucket('x'.repeat(200));
    expect([short, med, long, xlong]).toEqual(['s', 'm', 'l', 'xl']);
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
