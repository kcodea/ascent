// @vitest-environment jsdom
/**
 * THE COLLECTION PREVIEW CARD LIFTS ITS PLATE WITH ITS SIZE (owner report 2026-10-15: "when previewing a card, the
 * darkening section is too high"). The plate's lift (`--plate-top`, -37px) is plain px tuned against the game's own
 * compact card, so the bigger preview card scales it by preview width / game width (`--plate-k`), keeping the plate,
 * its text and its darkening seated exactly as on a hand card. Oracle R-PROG-PLATE-04.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';
import { PREVIEW_CCW, SkinCardPreview, previewPlateK } from './SkinCardPreview';

const root = document.documentElement.style;
let ui: Mounted | null = null;
afterEach(() => {
  ui?.unmount(); ui = null;
  for (const v of ['--scale', '--mobile-boost', '--card-scale']) root.removeProperty(v);
});

describe('the preview plate lift', () => {
  it('is preview width / the game card width, at every stage scale and card size', () => {
    const gameCcw = (scale: number, boost: number, cardScale: number): number => 384 * scale * boost * cardScale * 0.752 * 0.85;
    expect(previewPlateK()).toBeCloseTo(PREVIEW_CCW / gameCcw(1, 1, 0.75), 6); // the defaults
    root.setProperty('--scale', '0.745');
    expect(previewPlateK()).toBeCloseTo(PREVIEW_CCW / gameCcw(0.745, 1, 0.75), 6);
    root.setProperty('--mobile-boost', '1.15');
    root.setProperty('--card-scale', '0.8');
    expect(previewPlateK()).toBeCloseTo(PREVIEW_CCW / gameCcw(0.745, 1.15, 0.8), 6);
    expect(previewPlateK()).toBeGreaterThan(1); // the preview card is bigger than a game card
  });

  it('the floating preview carries it as --plate-k', () => {
    root.setProperty('--scale', '0.745');
    ui = mount(<div />);
    act(() => ui!.render(<SkinCardPreview cardId="k_pouchpincher" art={undefined} anchor={{ left: 10, right: 60, top: 10, bottom: 60, width: 50, height: 50, x: 10, y: 10 }} plate={null} />));
    const box = document.querySelector('.colls-cardpreview') as HTMLElement;
    expect(Number(box.style.getPropertyValue('--plate-k'))).toBeCloseTo(previewPlateK(), 6);
  });
});
