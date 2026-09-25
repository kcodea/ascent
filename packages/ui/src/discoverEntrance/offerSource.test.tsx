// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX, EQUIPMENT_INDEX } from '@game/content';
import { mount, type Mounted } from '../renderedText.mount';
import type { CardView } from '../Card';
import { chooseOneSourceName, offerSubtitle } from './offerSource';
import { OfferBanner } from './OfferBanner';
import { DiscoverDialog } from './DiscoverDialog';
import { DCE_DEFAULTS, applyDiscoverLook, discoverLookVars, resetDiscoverEntranceConfig, setDiscoverEntranceValue } from './discoverEntranceConfig';

/**
 * THE DISCOVER LOOK (owner pick 2026-09-25): the ornate title banner's "From X" subtitle names only what the run state
 * records (a Choose One's card or Equipment), never a guess; a Discover (whose state records no source) shows none.
 * And the look dials reach the CSS.
 */
const idx = { cards: CARD_INDEX, equipment: EQUIPMENT_INDEX };
let m: Mounted | null = null;
afterEach(() => { m?.unmount(); m = null; resetDiscoverEntranceConfig(); });

describe('the offer subtitle mapping', () => {
  it('a named source reads "From <name>"', () => {
    expect(offerSubtitle('Runic Beetle')).toBe('From Runic Beetle');
    expect(offerSubtitle('  Prismatic Pick ')).toBe('From Prismatic Pick');
  });

  it('nothing to name means no subtitle at all (never "From " or "From undefined")', () => {
    expect(offerSubtitle(null)).toBeNull();
    expect(offerSubtitle(undefined)).toBeNull();
    expect(offerSubtitle('')).toBeNull();
    expect(offerSubtitle('   ')).toBeNull();
  });

  it('a card Choose One is named after the card being played (Runic Beetle)', () => {
    expect(CARD_INDEX.beetle?.chooseOne?.length).toBeGreaterThan(0);
    expect(chooseOneSourceName({ cardId: 'beetle' }, idx)).toBe('Runic Beetle');
    expect(offerSubtitle(chooseOneSourceName({ cardId: 'beetle' }, idx))).toBe('From Runic Beetle');
  });

  it("an Equipment's Choose One is named after the Equipment (Prismatic Pick), not the card id it carries", () => {
    expect(chooseOneSourceName({ cardId: 'prismatic_pick', equipmentId: 'prismatic_pick' }, idx)).toBe('Prismatic Pick');
  });

  it('an id that resolves to nothing, or no prompt, yields null (a raw id never reaches the screen)', () => {
    expect(chooseOneSourceName({ cardId: 'no_such_card' }, idx)).toBeNull();
    expect(chooseOneSourceName({ cardId: 'beetle', equipmentId: 'no_such_equipment' }, idx)).toBeNull();
    expect(chooseOneSourceName(null, idx)).toBeNull();
    expect(chooseOneSourceName(undefined, idx)).toBeNull();
  });
});

describe('the ornate banner', () => {
  it('renders the title as a heading, with the subtitle only when there is a source', () => {
    m = mount(<OfferBanner title="Choose One" source="Runic Beetle" />);
    const heading = m.container.querySelector('[role="heading"]');
    expect(heading?.textContent).toBe('Choose One');
    expect(m.container.querySelector('.disc-ornate-sub')?.textContent).toBe('From Runic Beetle');
    // The flourishes are decoration: hidden from assistive tech.
    expect(m.container.querySelectorAll('.disc-ornate-flour[aria-hidden="true"]').length).toBe(2);
    m.unmount();
    m = mount(<OfferBanner title="Discover" source={null} />);
    expect(m.container.querySelector('.disc-ornate-sub')).toBeNull();
  });

  it('the Discover dialog wears the banner (no subtitle: its state records no source) and the spotlight backdrop', () => {
    const ids = Object.values(CARD_INDEX).filter((c) => !c.spell && !c.token).slice(0, 3).map((c) => c.id);
    const cards: CardView[] = ids.map((id) => {
      const c = CARD_INDEX[id]!;
      return { name: c.name, cardId: c.id, tribe: c.tribe, attack: c.attack, health: c.health, keywords: c.keywords, text: c.text, tier: c.tier };
    });
    m = mount(<DiscoverDialog ids={ids} cards={cards} onPick={() => {}} occasion={null} />);
    expect(m.container.querySelector('.discover-ov')?.classList.contains('disc-look')).toBe(true);
    expect(m.container.querySelector('.disc-ornate [role="heading"]')?.textContent).toBe('Discover');
    expect(m.container.querySelector('.disc-ornate-sub')).toBeNull();
    // The old flat box is gone from the Discover.
    expect(m.container.querySelector('.disc-banner')).toBeNull();
  });
});

describe('the look dials', () => {
  it('map to the CSS custom properties, defaulting a non-number to the shipped value', () => {
    expect(discoverLookVars(DCE_DEFAULTS)).toEqual({
      '--dcl-banner': String(DCE_DEFAULTS.lookBannerSize),
      '--dcl-tint': String(DCE_DEFAULTS.lookTint),
      '--dcl-vignette': String(DCE_DEFAULTS.lookVignette),
      '--dcl-spot-r': String(DCE_DEFAULTS.lookSpotRadius),
      '--dcl-spot': String(DCE_DEFAULTS.lookSpotStrength),
      '--dcl-peek': String(DCE_DEFAULTS.lookPeekSize),
    });
    expect(discoverLookVars({ ...DCE_DEFAULTS, lookTint: Number.NaN })['--dcl-tint']).toBe(String(DCE_DEFAULTS.lookTint));
  });

  it('a moved dial reaches the document root at once, and reset restores the default', () => {
    applyDiscoverLook();
    const root = document.documentElement.style;
    expect(root.getPropertyValue('--dcl-spot')).toBe(String(DCE_DEFAULTS.lookSpotStrength));
    setDiscoverEntranceValue('lookSpotStrength', 0.8);
    expect(root.getPropertyValue('--dcl-spot')).toBe('0.8');
    resetDiscoverEntranceConfig();
    expect(root.getPropertyValue('--dcl-spot')).toBe(String(DCE_DEFAULTS.lookSpotStrength));
  });

  it('the CSS fallbacks match the shipped defaults (the two must move together)', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'discoverEntrance.css'), 'utf8');
    const fallbacks = (name: string): string[] => [...css.matchAll(new RegExp(`var\\(${name}, ([0-9.]+)\\)`, 'g'))].map((x) => x[1]!);
    const expect1 = (name: string, v: number): void => {
      const f = fallbacks(name);
      expect(f.length, name).toBeGreaterThan(0);
      for (const x of f) expect(Number(x), name).toBe(v);
    };
    expect1('--dcl-banner', DCE_DEFAULTS.lookBannerSize);
    expect1('--dcl-tint', DCE_DEFAULTS.lookTint);
    expect1('--dcl-vignette', DCE_DEFAULTS.lookVignette);
    expect1('--dcl-spot-r', DCE_DEFAULTS.lookSpotRadius);
    expect1('--dcl-spot', DCE_DEFAULTS.lookSpotStrength);
    expect1('--dcl-peek', DCE_DEFAULTS.lookPeekSize);
  });
});
