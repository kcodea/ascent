// @vitest-environment jsdom
/**
 * TRIBE NAME + COLOUR for the set-3 tribes (owner report 2026-09-14, with a Stardust Peddler / Chipwick
 * Prospector side-by-side: "see the tribe name/colors for kobold? celestials and spirits dont currently have
 * them").
 *
 * Two halves. (1) A Celestial / Spirit card is PLATED like every other tribe, so its tribe name sits on the
 * plate's bottom gem (`.plate-tribe`) rather than the icon+label drawer fallback (`.dtribe`). (2) Every tribe
 * — the two new ones included — has a `--t-<tribe>` hue, shipped in styles.css and mirrored in
 * `tribeColorConfig.ts` (the DEV "Tribe Colours" tuner's defaults), and the two MUST agree or the tuner's
 * Reset would paint something the exe does not.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { Card } from './Card';
import { mount } from './renderedText.mount';
import { TRIBE_COLOR_DEFAULTS } from './tribeColorConfig';

const m = mount(null);
afterAll(() => m.unmount());

const viewOf = (id: string) => {
  const d = CARD_INDEX[id]!;
  return { name: d.name, cardId: id, tribe: d.tribe, tribe2: d.tribe2, attack: d.attack, health: d.health, keywords: [], golden: false, text: d.text, tier: d.tier };
};

describe('set-3 tribe labels sit on the plate gem like every other tribe', () => {
  for (const [id, label] of [['ce3_peddler', 'Celestial'], ['sp3_kindled', 'Spirit'], ['k_chipwick', 'Kobold']] as const) {
    it(`${label}: .plate-tribe carries the name, no .dtribe fallback`, () => {
      m.render(<Card card={viewOf(id)} forceFull plated />);
      const gem = m.container.querySelector('.plate-tribe');
      expect(gem?.textContent?.trim(), 'the plate gem label').toBe(label);
      expect(m.container.querySelector('.dtribe'), 'the drawer fallback must not ALSO print it').toBeNull();
    });
  }
});

describe('every tribe has a hue, and the CSS token equals the tuner default', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'styles.css'), 'utf8');
  const TRIBES = Object.keys(TRIBE_COLOR_DEFAULTS) as Tribe[]; // Record<Tribe, …> — the type makes it exhaustive
  for (const tribe of TRIBES) {
    it(`--t-${tribe}`, () => {
      const m2 = new RegExp(`--t-${tribe}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
      expect(m2, `styles.css declares --t-${tribe}`).not.toBeNull();
      expect(m2![1]!.toLowerCase()).toBe(TRIBE_COLOR_DEFAULTS[tribe].toLowerCase());
    });
  }
});
