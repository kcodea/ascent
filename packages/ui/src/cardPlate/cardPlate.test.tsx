// @vitest-environment jsdom
/**
 * CARD PLATES (owner 2026-10-14: "Turn Aquarium Rocks into a real equippable card plate cosmetic, with its own darkening
 * settings, and leave the standard plates untouched"). A card inside a skin scope that wears a plate shows that plate
 * whatever its tribe ("replace all plates") with the plate's own darkening; a GILDED card never changes ("nothing should
 * ever changed for gilded cards"); a Whisper keeps its Set 4 plate; no plate equipped = the standard plates exactly.
 */
import { existsSync } from 'node:fs';
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

  it('no plate equipped: the standard tribe plate and the shared darkening, no inline darkening vars', () => {
    const el = render('k_pouchpincher', 'neutral');
    expect(plateOf(el)).toContain('frames/cardplate-neutral.webp');
    expect(backboxOf(el)).toContain('frames/desc-backbox.webp');
    expect(el.style.getPropertyValue('--ctx-box-a')).toBe('');
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

  it('a GILDED card never changes: the standard plate and darkening, even with a plate equipped', () => {
    const el = render('k_pouchpincher', 'neutral', { golden: true, snapshot: AQUARIUM });
    expect(plateOf(el)).toContain('frames/cardplate-neutral.webp');
    expect(backboxOf(el)).toContain('frames/desc-backbox.webp');
    expect(el.style.getPropertyValue('--ctx-box-a')).toBe('');
  });

  it('a Whisper keeps its own plate', () => {
    const el = render('w4_tome', 'neutral', { snapshot: AQUARIUM });
    expect(plateOf(el)).toContain('frames/cardplate-whisper.webp');
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
      expect(cardPlateLookOf({ cardPlate: c.id })).toBe(look);
      for (const url of [look!.plate, look!.backbox]) expect(existsSync(join(pub, url.replace(/^.*?frames\//, 'frames/'))), url).toBe(true);
    }
    expect(cardPlateLookOf(null)).toBeNull();
    expect(cardPlateLookOf({ cardPlate: 'frame_fire' })).toBeNull();
  });
});
