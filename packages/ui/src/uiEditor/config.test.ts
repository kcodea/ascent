import { describe, it, expect } from 'vitest';
import { parseMode, isUiEditMode, setUiEditMode, subscribeUiEditMode } from './config';

describe('parseMode', () => {
  it('is off by default (null / unknown values)', () => {
    expect(parseMode(null)).toBe(false);
    expect(parseMode('nonsense')).toBe(false);
    expect(parseMode('0')).toBe(false);
  });
  it('is on only for the exact "1" flag', () => {
    expect(parseMode('1')).toBe(true);
  });
});

describe('mode state + subscription', () => {
  it('set updates the getter and notifies subscribers', () => {
    const seen: boolean[] = [];
    const off = subscribeUiEditMode((on) => seen.push(on));
    setUiEditMode(true);
    expect(isUiEditMode()).toBe(true);
    setUiEditMode(false);
    expect(isUiEditMode()).toBe(false);
    off();
    setUiEditMode(true); // no longer observed
    expect(seen).toEqual([true, false]);
  });
});
