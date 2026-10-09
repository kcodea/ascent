import { describe, expect, it } from 'vitest';
import { CARD_NAME_COLOURS, CARD_NAME_RINGS, cardNameBucket, cardNameFilterId, cardNameFilterMarkup, cardNameFit } from './cardNameFilter';

describe('gilded card-name filter (owner spec 2026-10-09)', () => {
  it('paints, bottom to top: shadow, #775a33 outer, #c7ad88 inner 1, #f4e9d4 inner 2, gradient core', () => {
    const m = cardNameFilterMarkup('t', 20);
    const merge = m.slice(m.indexOf('<feMerge>'));
    expect([...merge.matchAll(/in="(\w+)"/g)].map((x) => x[1])).toEqual(['sh2', 'sh1', 'L0', 'L1', 'L2', 'L3']);
    expect(m).toContain(`flood-color="${CARD_NAME_COLOURS.outer}"/><feComposite in2="grown"`);
    expect(m).toContain(`flood-color="${CARD_NAME_COLOURS.inner1}"/><feComposite in2="SourceAlpha"`);
    expect(m).toContain(`flood-color="${CARD_NAME_COLOURS.inner2}"/><feComposite in2="in1"`);
    expect(m).toContain('<feComposite in="SourceGraphic" in2="in2"');
  });

  it('the inner strokes sit INSIDE the letter (erode) and only the outer one outside it (dilate)', () => {
    const m = cardNameFilterMarkup('t', 20);
    expect(m).toContain(`operator="dilate" radius="${CARD_NAME_RINGS.outer * 20}" result="grown"`);
    expect(m).toContain(`operator="erode" radius="${CARD_NAME_RINGS.inner1 * 20}" result="in1"`);
    expect(m).toContain(`operator="erode" radius="${(CARD_NAME_RINGS.inner1 + CARD_NAME_RINGS.inner2) * 20}" result="in2"`);
  });

  it('ring widths are em: they scale with the font size', () => {
    const at = (px: number): number => Number(cardNameFilterMarkup('t', px).match(/erode" radius="([\d.]+)" result="in2"/)![1]);
    expect(at(40)).toBeCloseTo(at(20) * 2, 6);
  });

  it('buckets sizes to 0.5px and gives each bucket a stable id', () => {
    expect(cardNameBucket(19.3)).toBe(19.5);
    expect(cardNameBucket(19.2)).toBe(19);
    expect(cardNameFilterId(19.5)).toBe('cn-gild-19_5');
    expect(cardNameFilterId(22)).toBe('cn-gild-22');
  });

  it('one line, always: a name that fits keeps full size, an over-long one shrinks just enough to fit', () => {
    expect(cardNameFit(180, 200)).toBe(1);
    expect(cardNameFit(200, 200)).toBe(1);
    const fit = cardNameFit(250, 200);
    expect(fit).toBeLessThan(1);
    expect(250 * fit).toBeLessThanOrEqual(200);
    expect(250 * fit).toBeGreaterThan(199);
    expect(cardNameFit(0, 200)).toBe(1);   // nothing measured yet (detached / not laid out): leave it alone
  });
});
