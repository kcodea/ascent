// @vitest-environment jsdom
/**
 * THE PAINTED CHEST PICTURE (Chest Shop screen, 2026-10-20): the body and the lid composed in DOM the way the theatre
 * composes them (`artChestModel`): the lid's attach point on the spike line at the rim (overlapping it by `lidOverlap`),
 * and, for Epic and Ancient, the spike's apex drawn again over the lid (`spikeFront`). Every number is a percent of the
 * BODY's width, so CSS padding/margin percentages place it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../renderedText.mount';
import { ChestPicture, chestLayout } from './ChestPicture';
import { CHEST_ART, CHEST_TIER_ART } from './crateFx/chestModel';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

describe('chestLayout', () => {
  it('places the lid as the theatre does (Standard)', () => {
    const l = chestLayout(CHEST_ART);
    expect(l.lidWidthPct).toBeCloseTo((1158 / 1187) * 100, 6);
    expect(l.lidLeftPct).toBeCloseTo(((594 - 578.5) / 1187) * 100, 6);
    expect(l.padTopPct).toBeCloseTo(((336 - 41 - 3) / 1187) * 100, 6);
    expect(l.spike).toBeNull();
  });

  it('only Epic and Ancient draw the spike front over the lid', () => {
    expect(chestLayout(CHEST_TIER_ART.rare).spike).toBeNull();
    expect(chestLayout(CHEST_TIER_ART.legendary).spike).toBeNull();
    const epic = chestLayout(CHEST_TIER_ART.epic).spike;
    const ancient = chestLayout(CHEST_TIER_ART.ancient).spike;
    expect(epic).not.toBeNull();
    expect(ancient).not.toBeNull();
    // Epic's spike front: x 778..898, y 0..74 of a 1676-wide body; the crop shows the whole body at its own scale.
    const pad = ((476 - 71 - 3) / 1676) * 100;
    expect(epic!.leftPct).toBeCloseTo((778 / 1676) * 100, 6);
    expect(epic!.widthPct).toBeCloseTo((120 / 1676) * 100, 6);
    expect(epic!.topPct).toBeCloseTo(pad, 6);
    expect(epic!.aspect).toBeCloseTo(120 / 74, 6);
    expect(epic!.imgWidthPct).toBeCloseTo((1676 / 120) * 100, 6);
    expect(epic!.imgLeftPct).toBeCloseTo((-778 / 120) * 100, 6);
    expect(epic!.imgTopPct).toBeCloseTo(0, 6);
  });
});

describe('<ChestPicture>', () => {
  it('draws the Epic body and lid, plus the spike crop of the body, as plain decorative images', () => {
    ui = mount(<ChestPicture tier="epic" className="extra" />);
    const root = ui.container.firstElementChild as HTMLElement;
    expect(root.className).toContain('extra');
    const imgs = [...ui.container.querySelectorAll('img')];
    const srcs = imgs.map((i) => i.getAttribute('src'));
    expect(srcs.filter((s) => s?.endsWith('collection/chest_epic_body.webp'))).toHaveLength(2); // the body + the spike crop
    expect(srcs.filter((s) => s?.endsWith('collection/chest_epic_lid.webp'))).toHaveLength(1);
    expect(imgs).toHaveLength(3);
    for (const i of imgs) {
      expect(i.getAttribute('alt')).toBe('');
      expect(i.getAttribute('draggable')).toBe('false');
      expect(i.getAttribute('decoding')).toBe('sync');
    }
    expect(ui.container.querySelector('[title]')).toBeNull();
  });

  it('Standard is two images (no spike crop)', () => {
    ui = mount(<ChestPicture tier="standard" />);
    const srcs = [...ui.container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(srcs).toHaveLength(2);
    expect(srcs[0]).toMatch(/collection\/crate_body\.webp$/);
    expect(srcs[1]).toMatch(/collection\/crate_lid\.webp$/);
  });
});
