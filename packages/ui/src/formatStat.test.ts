import { describe, expect, it } from 'vitest';
import { formatStat, formatStatCompact } from './formatStat';

describe('stat-pill abbreviation (owner spec 2026-08-27)', () => {
  it('full digits through 99,999', () => {
    expect(formatStat(0)).toBe('0');
    expect(formatStat(7)).toBe('7');
    expect(formatStat(4321)).toBe('4321');
    expect(formatStat(99_999)).toBe('99999');
  });
  it("abbreviates from 100k with one trimmed decimal — the owner's examples verbatim", () => {
    expect(formatStat(100_000)).toBe('100k');
    expect(formatStat(101_100)).toBe('101.1k');
    expect(formatStat(10_600_000)).toBe('10.6m');
    expect(formatStat(105_600_000)).toBe('105.6m');
    expect(formatStat(10_000_000_000)).toBe('10b');
    expect(formatStat(405_100_000_000)).toBe('405.1b');
  });
  it('rounding carries across a unit boundary instead of printing 1000k', () => {
    expect(formatStat(999_950)).toBe('1m');
    expect(formatStat(999_949)).toBe('999.9k');
    expect(formatStat(999_950_000_000)).toBe('1t');
  });
  it('negatives keep the sign (defensive — pills should never show one, but the roll math might)', () => {
    expect(formatStat(-101_100)).toBe('-101.1k');
    expect(formatStat(-42)).toBe('-42');
  });
});

describe('formatStatCompact (menu boards, WS-4 2026-10-16): never more than four glyphs', () => {
  it('abbreviates from 1,000 so a stored board badge never overruns its neighbour', () => {
    expect(formatStatCompact(999)).toBe('999');
    expect(formatStatCompact(1000)).toBe('1k');
    expect(formatStatCompact(1469)).toBe('1.5k');
    expect(formatStatCompact(1977)).toBe('2k');
    expect(formatStatCompact(9960)).toBe('10k');
    expect(formatStatCompact(103_700)).toBe('104k');
    expect(formatStatCompact(209_000)).toBe('209k');
    expect(formatStatCompact(999_600)).toBe('1m');
    expect(formatStatCompact(1_240_000)).toBe('1.2m');
    expect(formatStatCompact(-1500)).toBe('-1.5k');
    for (const n of [5, 1469, 3206, 99_999, 103_700, 999_999, 45_000_000, 7.2e9]) expect(formatStatCompact(n).length).toBeLessThanOrEqual(4);
  });
});
