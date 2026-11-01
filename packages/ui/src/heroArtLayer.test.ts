import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getHeroPanelConfig } from './heroPanelConfig';
import { getHeroDuelConfig } from './heroDuelConfig';

/**
 * R-PHONE-HERO-LAYER-01 (owner 2026-11-01: "Still seeing blurry hero art on mobile"). Your portrait (~73 stage px laid
 * out, magnified 3.1 x 1.17 by the tray's transforms) and the combat foe's (magnified 2.4) sit in composited layers on a
 * phone, and WebKit rasterises a layer at its LAYOUT size, then stretches it. On a phone (`html.lite-art`) both images are
 * laid out F times bigger and scaled back by 1/F in their own layer, so their raster is F times the old one. This pins the
 * rule's shape and that F covers the shipped magnifications.
 */
const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');
const rule = /html\.lite-art :is\(\.statusbar \.hero \.f \.heroimg, \.combatopp-img\) \{([^}]*)\}/.exec(css)?.[1] ?? '';
const num = (re: RegExp): number => Number(re.exec(rule)?.[1] ?? NaN);

describe('sharp big hero portraits on a phone (R-PHONE-HERO-LAYER-01)', () => {
  it('the phone rule exists for your portrait and the combat foe portrait', () => {
    expect(rule).not.toBe('');
  });

  const width = num(/width:\s*(\d+)%/) / 100;
  const height = num(/height:\s*(\d+)%/) / 100;
  const scale = num(/transform:\s*scale\(([\d.]+)\)/);
  const factor = width;

  it('lays the image out F times bigger and scales it back by exactly 1/F (net drawn size unchanged)', () => {
    expect(width).toBeGreaterThan(1);
    expect(height).toBe(width);
    expect(scale * factor).toBeCloseTo(1, 6);
    expect(rule).toMatch(/transform-origin:\s*0 0/);
    // The negative margins hand the (F-1) extra back to the flow, so the pills and the frame do not move.
    expect(num(/margin-right:\s*-(\d+)%/) / 100).toBeCloseTo(factor - 1, 6);
    expect(num(/margin-bottom:\s*-(\d+)%/) / 100).toBeCloseTo(factor - 1, 6);
  });

  it('gives the image its own layer (its raster is then sized by its laid-out box, not the small tray)', () => {
    expect(rule).toMatch(/will-change:\s*transform/);
  });

  it('F covers the shipped magnifications: the tray (panelScale x portraitScale) and the combat foe (oppScale)', () => {
    const p = getHeroPanelConfig();
    expect(factor).toBeGreaterThanOrEqual(p.panelScale * p.portraitScale);
    expect(factor).toBeGreaterThanOrEqual(getHeroDuelConfig().oppScale);
  });

  it('is phone-only: desktop keeps the plain image', () => {
    expect(css).not.toMatch(/(?<!html\.lite-art )\.statusbar \.hero \.f \.heroimg \{[^}]*will-change/);
    expect(css).not.toMatch(/(?<!html\.lite-art :is\()\.combatopp-img \{[^}]*will-change/);
  });
});
