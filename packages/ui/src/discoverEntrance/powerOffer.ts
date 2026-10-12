import { getHero, type RunState } from '@game/sim';
import { heroPowerArt } from '../art';
import type { CardView } from '../Card';

/**
 * THE HERO-POWER DISCOVER (Mimic every turn, Void's turn-4 pair, the Power Shifter spell), drawn as a Discover
 * (owner ask 2026-10-12: "exactly like the discover screen"). The offer rides the real `DiscoverDialog`, so each
 * power has to be a card: this builds that card, and names the offer's source for the banner's "From X" line.
 */
type PowerOffer = NonNullable<RunState['powerOffer']>;

/** A hero power as a spell card: the power's own art, name and rules text in the spell frame, with the hero it
 *  belongs to on the kind line. No tier, cost or stats: a power has none. The id is namespaced so it can never
 *  resolve to a real card (no skin, no card art, no def). */
export function powerCardView(heroId: string): CardView {
  const h = getHero(heroId);
  return {
    name: h.power.name, cardId: `heropower:${heroId}`, artUrl: heroPowerArt(heroId),
    tribe: 'neutral', attack: 0, health: 0, keywords: [],
    text: h.power.text, spell: true, kindLabel: h.name,
  };
}

/** What opened this offer, for the banner ("From Power Shifter"). Void picks twice, so its line says which. */
export function powerOfferSource(slot: PowerOffer['slot']): string {
  switch (slot) {
    case 'mimic': return getHero('mimic').power.name;
    case 'shifter': return 'Power Shifter';
    case 'void1': return `${getHero('voidhero').power.name} · first pick`;
    case 'void2': return `${getHero('voidhero').power.name} · second pick`;
  }
}

/** The entrance's occasion key (see `useOfferEntrance`): a new offer flies in, a Peek / Return or a re-render of
 *  the same one does not. Void's second pick and a second Power Shifter in one turn are each their own offer (the
 *  slot and the hand size move between them). */
export function powerOccasion(run: Pick<RunState, 'seed' | 'wave' | 'hand' | 'powerOffer'>): string | null {
  const o = run.powerOffer;
  return o ? `power:${run.seed}:${run.wave}:${run.hand.length}:${o.slot}:${o.heroIds.join(',')}` : null;
}
