// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { getHero } from '@game/sim';
import { mount, type Mounted } from '../renderedText.mount';
import { DiscoverDialog } from './DiscoverDialog';
import { powerCardView, powerOccasion, powerOfferSource } from './powerOffer';
import { resetOfferEntranceMemoForTests } from './useOfferEntrance';

/**
 * THE HERO-POWER DISCOVER wears the Discover screen (owner ask 2026-10-12: "exactly like the discover screen"): the
 * same dialog, banner and backdrop, with each power drawn as a full spell card that names its hero. Mimic, Void and
 * the Power Shifter spell all open it; the banner's "From X" line says which.
 */
const HEROES = ['xerox', 'risen', 'rayse'] as const;
let m: Mounted | null = null;
afterEach(() => { m?.unmount(); m = null; resetOfferEntranceMemoForTests(); });

describe('a hero power as a Discover card', () => {
  it('is a spell card carrying the power name and rules text, with the hero on the kind line', () => {
    for (const id of HEROES) {
      const h = getHero(id);
      const v = powerCardView(id);
      expect(v.name).toBe(h.power.name);
      expect(v.text).toBe(h.power.text);
      expect(v.heroPowerOf).toBe(h.name);
      expect(v.spell).toBe(true);
      // No tier plaque, no cost coin: a power has neither.
      expect(v.tier).toBeUndefined();
      expect(v.cost).toBeUndefined();
    }
  });

  it('never borrows a real card id (no skin, card art or def can attach to it)', () => {
    expect(powerCardView('xerox').cardId).toBe('heropower:xerox');
  });

  it('the three powers of the owner\'s report resolve to their own hero, not the default one', () => {
    expect(HEROES.map((id) => powerCardView(id).name)).toEqual(['Copy Machine', 'Undying', 'Empowering Vines']);
    expect(HEROES.map((id) => powerCardView(id).heroPowerOf)).toEqual(['Xerox', 'Lord of the Risen', 'Rayse']);
  });
});

describe('the banner source', () => {
  it('names what opened the offer, and which of Void\'s two picks this is', () => {
    // Literal names on purpose: `getHero` falls back to the default hero on an unknown id, so comparing against
    // another `getHero` call would pass with the wrong id on both sides (it read "From Aegis" once).
    expect(powerOfferSource('shifter')).toBe('Power Shifter');
    expect(powerOfferSource('mimic')).toBe('Mimicry');
    expect(powerOfferSource('void1')).toBe('Twin Voids · first pick');
    expect(powerOfferSource('void2')).toBe('Twin Voids · second pick');
  });
});

describe('the entrance occasion', () => {
  const run = (over: Partial<Parameters<typeof powerOccasion>[0]>): Parameters<typeof powerOccasion>[0] => ({
    seed: 7, wave: 4, hand: [], powerOffer: { heroIds: ['warden', 'mimic'], slot: 'void1' }, ...over,
  } as Parameters<typeof powerOccasion>[0]);

  it('is null with no offer open', () => {
    expect(powerOccasion(run({ powerOffer: undefined }))).toBeNull();
  });

  it('holds across a re-render of the same offer, and moves for the next pick, the next turn and the next cast', () => {
    const a = powerOccasion(run({}));
    expect(powerOccasion(run({}))).toBe(a);
    expect(powerOccasion(run({ powerOffer: { heroIds: ['warden', 'mimic'], slot: 'void2' } }))).not.toBe(a);
    expect(powerOccasion(run({ wave: 5 }))).not.toBe(a);
    expect(powerOccasion(run({ hand: [{}] as never }))).not.toBe(a);
  });
});

describe('the dialog', () => {
  it('is the Discover dialog: spotlight backdrop, gold banner with the source, one full card per power', () => {
    vi.useFakeTimers();
    const onPick = vi.fn();
    m = mount(
      <DiscoverDialog
        ids={[...HEROES]} cards={HEROES.map(powerCardView)} onPick={onPick} occasion={null}
        source={powerOfferSource('shifter')} label="Discover a hero power" full
      />,
    );
    const root = m.container.querySelector('.discover-ov') as HTMLElement;
    expect(root.classList.contains('disc-look')).toBe(true);
    expect(root.getAttribute('aria-label')).toBe('Discover a hero power');
    expect(m.container.querySelector('[role="heading"]')?.textContent).toBe('Discover');
    expect(m.container.querySelector('.disc-ornate-sub')?.textContent).toBe('From Power Shifter');

    const cards = [...m.container.querySelectorAll<HTMLElement>('.disc-slot .card')];
    expect(cards.length).toBe(HEROES.length);
    cards.forEach((card, i) => {
      const h = getHero(HEROES[i]!);
      // The text is the decision, so the card is full whatever the compact-cards setting.
      expect(card.classList.contains('showtext')).toBe(true);
      expect(card.classList.contains('spellcard')).toBe(true);
      expect(card.textContent).toContain(h.power.name);
      // The kind line names the hero, never "Shop Spell", and is its own kind (`power`: the green line).
      const kind = card.querySelector('.spellkind')!;
      expect(kind.textContent).toBe(h.name);
      expect(kind.getAttribute('data-kind')).toBe('power');
      expect(card.textContent).not.toContain('Shop Spell');
      // ...under the hero-power medallion (the emerald helm), not the Shop Spell star.
      const medallion = card.querySelector('.ctype.spell.spellmed')!;
      expect(medallion.getAttribute('data-med')).toBe('power');
      expect(medallion.querySelector('img')?.getAttribute('src')).toContain('medallions/power.webp');
    });

    // Settle the entrance, then a click picks that power.
    act(() => { vi.advanceTimersByTime(5000); });
    act(() => { cards[1]!.click(); });
    expect(onPick).toHaveBeenCalledWith(1);
    vi.useRealTimers();
  });
});
