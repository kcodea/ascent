// @vitest-environment jsdom
/**
 * CARD PLATES (owner 2026-10-14: "Turn Aquarium Rocks into a real equippable card plate cosmetic, with its own darkening
 * settings, and leave the standard plates untouched"). A card inside a skin scope that wears a plate shows that plate
 * whatever its tribe ("replace all plates") with the plate's own darkening; a GILDED card never changes ("nothing should
 * ever changed for gilded cards"); a Whisper keeps its Set 4 plate; no plate equipped = the standard plates exactly.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { COSMETICS } from '@game/progression';
import type { BoardCard } from '@game/sim';
import { Card } from '../Card';
import { instView } from '../instView';
import { mount } from '../renderedText.mount';
import { MinionSkins } from '../skins/skins';
import { CARD_PLATE_LOOKS, cardPlateLookOf } from './cardPlateLook';

const handCard = (cardId: string, uid: string, tribe: string, golden = false): BoardCard =>
  ({ uid, cardId, tribe, attack: 1, health: 1, keywords: [], golden, grantedTier: 3 }) as unknown as BoardCard;

const AQUARIUM = { cardPlate: 'plate_aquarium_rocks' };

describe('the card plate a card wears', () => {
  const m = mount(<div />);
  afterAll(() => m.unmount());

  const render = (cardId: string, tribe: string, opts: { golden?: boolean; snapshot?: typeof AQUARIUM | null } = {}): HTMLElement => {
    const uid = `u-${cardId}`;
    const view = instView(handCard(cardId, uid, tribe, opts.golden), 3, undefined, 0, 0, 0, 0, 0, 0, 0, 1, 0, undefined, undefined, { inHand: true });
    m.render(<MinionSkins snapshot={opts.snapshot ?? null}><Card card={view} uid={uid} plated forceFull /></MinionSkins>);
    return m.container.querySelector('.card') as HTMLElement;
  };
  const plateOf = (el: Element): string => el.querySelector('img.cardplate')!.getAttribute('src')!;
  const backboxOf = (el: Element): string => el.querySelector('img.descbox')!.getAttribute('src')!;

  it('no plate equipped: the new STANDARD plate for every tribe, with its socketless darkening (owner 2026-10-15)', () => {
    for (const tribe of ['neutral', 'beast', 'demon']) {
      const el = render('k_pouchpincher', tribe);
      expect(plateOf(el), tribe).toContain('frames/cardplate-standard.webp');
      expect(backboxOf(el)).toContain('frames/desc-backbox-standard.webp');
      expect(el.style.getPropertyValue('--ctx-box-a')).toBe('');
    }
  });

  it('Aquarium Rocks replaces every tribe plate and brings its own darkening (shape, opacity, blend, seat)', () => {
    for (const [cardId, tribe] of [['k_pouchpincher', 'neutral'], ['k_pouchpincher', 'beast'], ['k_pouchpincher', 'demon']] as const) {
      const el = render(cardId, tribe, { snapshot: AQUARIUM });
      expect(plateOf(el), tribe).toContain('frames/plates/plate_aquarium_rocks.webp');
      expect(el.querySelector('img.plateglow')!.getAttribute('src')).toContain('frames/plates/plate_aquarium_rocks.webp');
      expect(backboxOf(el)).toContain('frames/plates/plate_aquarium_rocks-backbox.webp');
      expect(el.style.getPropertyValue('--ctx-box-a')).toBe('0.63');
      expect(el.style.getPropertyValue('--ctx-box-blend')).toBe('multiply');
      expect(el.style.getPropertyValue('--ctx-box-y')).toBe('-1.22595');
    }
  });

  it('a GILDED card always wears the gilded plate, with no darkening and no gold filter, plate equipped or not', () => {
    for (const snapshot of [null, AQUARIUM]) {
      const el = render('k_pouchpincher', 'beast', { golden: true, snapshot });
      expect(plateOf(el)).toContain('frames/cardplate-gilded.webp');
      expect(el.querySelector('img.descbox')).toBeNull();
      expect(el.style.getPropertyValue('--ctx-box-a')).toBe('');
      expect(getComputedStyle(el.querySelector('img.cardplate')!).filter || 'none').toBe('none');
    }
  });

  it('no stylesheet rule recolours a gilded plate (owner 2026-10-15: "the gilded card does not need the gold hue filter")', () => {
    const css = readFileSync(join(__dirname, '../styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/([^{}]*\.golden[^{}]*\.cardplate[^{}]*)\{([^}]*)\}/g)];
    for (const [, sel, body] of rules) expect(body, sel!.trim()).not.toMatch(/filter\s*:/);
  });

  it('a LAYERED plate paints interior, then darkening, then frame, then the text (owner 2026-10-15)', () => {
    // Magma: a layered plate that keeps a darkening, so all three layers are there to order.
    const el = render('k_pouchpincher', 'neutral', { snapshot: { cardPlate: 'plate_magma' } as unknown as typeof AQUARIUM });
    const interior = el.querySelector('img.cardplate')!;
    expect(interior.getAttribute('src')).toContain('frames/plates/interiors/magma.webp');
    expect(interior.classList.contains('plate-interior')).toBe(true);
    expect(el.querySelector('img.plateglow')!.getAttribute('src')).toContain('plate_magma-frame.webp');
    const drawer = [...el.querySelector('.drawer')!.children].map((c) => c.className.split(' ')[0]);
    expect(drawer.indexOf('descbox')).toBeGreaterThanOrEqual(0);
    expect(drawer.indexOf('descbox')).toBeLessThan(drawer.indexOf('plate-frame'));
    expect(drawer.indexOf('plate-frame')).toBeLessThan(drawer.findIndex((c) => c === 'cn'));
  });

  it('Simple Glass has a FROSTED interior: a live blur of what is behind, masked to its shape, no pixels of its own (owner 2026-10-19)', () => {
    // "create a card interior for the blown glass card frame that would actually just be clear and blurs all imagery
    // behind it"; "slightly darkened too to help readability".
    const el = render('k_pouchpincher', 'neutral', { snapshot: { cardPlate: 'plate_simple_glass' } as unknown as typeof AQUARIUM });
    const interior = el.querySelector('img.cardplate')!;
    expect(interior.classList.contains('plate-frosted')).toBe(true);
    expect(interior.getAttribute('src')).toContain('frames/plates/interiors/frosted.webp');
    expect(el.style.getPropertyValue('--plate-frost-mask')).toContain('frames/plates/interiors/frosted.webp');
    expect(el.querySelector('img.descbox')).toBeNull();
    // No other plate is frosted.
    for (const look of Object.values(CARD_PLATE_LOOKS)) expect(!!look.frosted, look.id).toBe(look.id === 'plate_simple_glass');
    // The stylesheet blurs and tints it, hides the image's own pixels, and drops the blur on a dragged card.
    const css = readFileSync(join(__dirname, '../styles.css'), 'utf8');
    const rule = css.slice(css.indexOf('.card.plated .cardplate.plate-interior.plate-frosted {'));
    expect(rule.slice(0, rule.indexOf('}'))).toMatch(/backdrop-filter: blur\(\d+px\)[\s\S]*mask: var\(--plate-frost-mask\)/);
    expect(css).toMatch(/\.dragcard \.card\.plated \.cardplate\.plate-interior\.plate-frosted \{[^}]*backdrop-filter: none/);
  });

  it('every plate that sat on Brown wears Dark Brown with no darkening (owner 2026-10-18)', () => {
    // "replace all cards' brown interior (except the standard card plate) with the dark brown interior and remove
    // darkening from them"
    for (const cardPlate of ['plate_topaz', 'plate_blossom', 'plate_spirit_carving', 'plate_iridescent', 'plate_porcelain', 'plate_smooth_iridescent', 'plate_honey', 'plate_goop']) {
      const el = render('k_pouchpincher', 'neutral', { snapshot: { cardPlate } as unknown as typeof AQUARIUM });
      expect(el.querySelector('img.cardplate')!.getAttribute('src'), cardPlate).toContain('frames/plates/interiors/darkbrown.webp');
      expect(el.querySelector('img.descbox'), cardPlate).toBeNull();
    }
    // No plate cosmetic is left on Brown, and the standard plate is untouched.
    for (const look of Object.values(CARD_PLATE_LOOKS)) expect(look.plate, look.id).not.toContain('interiors/brown.webp');
    expect(plateOf(render('k_pouchpincher', 'neutral'))).toContain('frames/cardplate-standard.webp');
  });

  it('a plate can drop the darkening: Beach, Moonstone, Mooncloud, Galaxy and Amethyst have none (owner 2026-10-15)', () => {
    for (const cardPlate of ['plate_beach', 'plate_moonstone', 'plate_mooncloud', 'plate_galaxy', 'plate_amethyst', 'plate_crackling_gemstone', 'plate_hand_drawn', 'plate_blue_hand_drawn', 'plate_green_hand_drawn', 'plate_simple_black', 'plate_simple_white', 'plate_smooth_aqua', 'plate_smooth_blue', 'plate_smooth_red']) {
      const el = render('k_pouchpincher', 'neutral', { snapshot: { cardPlate } as unknown as typeof AQUARIUM });
      expect(el.querySelector('img.descbox'), cardPlate).toBeNull();
    }
    for (const cardPlate of ['plate_beach', 'plate_magma', 'plate_moonstone']) {
      const el = render('k_pouchpincher', 'neutral', { snapshot: { cardPlate } as unknown as typeof AQUARIUM });
      expect(el.querySelector('.drawer .plate-frame'), cardPlate).not.toBeNull();
    }
  });

  it('Magma keeps its darkening at half opacity (owner 2026-10-15)', () => {
    const el = render('k_pouchpincher', 'neutral', { snapshot: { cardPlate: 'plate_magma' } as unknown as typeof AQUARIUM });
    expect(el.querySelector('img.descbox')!.getAttribute('src')).toContain('frames/plates/plate_magma-backbox.webp');
    expect(el.style.getPropertyValue('--ctx-box-a')).toBe('0.315');
  });

  it('a layered interior carries its fit (stretch + nudge) as inline vars', () => {
    const el = render('k_pouchpincher', 'neutral', { snapshot: { cardPlate: 'plate_magma' } as unknown as typeof AQUARIUM });
    expect(el.style.getPropertyValue('--plate-interior-sx')).toBe('1.059');
    expect(el.style.getPropertyValue('--plate-interior-sy')).toBe('1.035');
    expect(el.style.getPropertyValue('--plate-interior-y')).toBe('0.0075');
  });

  it('a Whisper keeps its own plate and its socketed darkening', () => {
    const el = render('w4_tome', 'neutral', { snapshot: AQUARIUM });
    expect(plateOf(el)).toContain('frames/cardplate-whisper.webp');
    expect(backboxOf(el)).toContain('frames/desc-backbox.webp');
  });
});

describe('the plate looks', () => {
  it('every card plate in the catalog has a look, and both of its images ship in apps/web/public', () => {
    const plates = COSMETICS.filter((c) => c.category === 'card_plate');
    expect(plates.length).toBeGreaterThan(0);
    const pub = join(__dirname, '../../../../apps/web/public');
    for (const c of plates) {
      const look = CARD_PLATE_LOOKS[c.assets.art!];
      expect(look, c.id).toBeTruthy();
      // A RETIRED plate (Phoenix Plate, 2026-10-18) keeps its look and files for when it returns, but is never worn.
      expect(cardPlateLookOf({ cardPlate: c.id }), c.id).toBe(c.active === false ? null : look);
      for (const url of [look!.plate, look!.thumb, ...(look!.backbox ? [look!.backbox] : []), ...(look!.frame ? [look!.frame] : [])]) expect(existsSync(join(pub, url.replace(/^.*?frames\//, 'frames/'))), url).toBe(true);
    }
    expect(cardPlateLookOf(null)).toBeNull();
    expect(cardPlateLookOf({ cardPlate: 'frame_fire' })).toBeNull();
  });
});
