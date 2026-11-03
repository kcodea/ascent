import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { activePowers, createRun, getHero, heroPowerCostOf, heroPowerText, reduce, type RunState } from '@game/sim';
import { powerCardView, powerOfferCards, previewPowerPick } from './powerOffer';

/**
 * R-POWER-PICK-INFO-01 (owner report 2026-11-03: "for the hero, Mimic, there's currently no way to know how much
 * the hero power that you are selecting either costs money or not, whether the hero power is active or passive").
 * Each option of the hero-power Discover says what the pick costs and how it is used, read off the run the pick
 * produces, so the card matches the hero panel the moment the power lands.
 */
const spell = CARD_INDEX['spiritfire']!;

function mimicOffer(heroIds: string[], over: Partial<RunState> = {}): RunState {
  return {
    ...createRun(9, 'mimic'), phase: 'recruit', wave: 6, embers: 20, maxEmbers: 20, board: [], hand: [],
    lastSpellCastId: spell.id, powerOffer: { heroIds, slot: 'mimic' }, discover: undefined, ...over,
  } as RunState;
}

describe('the hero-power Discover card says cost and usage', () => {
  it('an active power with a Gold cost shows that cost on its coin and an Active tag', () => {
    const run = mimicOffer(['nadja', 'robin']);
    const [nadja] = powerOfferCards(run);
    expect(nadja!.cost).toBe(getHero('nadja').power.cost);
    expect(nadja!.text.startsWith('**Active · once per turn.** ')).toBe(true);
  });

  it('a passive power has no coin and leads with Passive', () => {
    const run = mimicOffer(['nadja', 'robin']);
    const robin = powerOfferCards(run)[1]!;
    expect(getHero('robin').power.passive).toBe(true);
    expect(robin.cost).toBeUndefined();
    expect(robin.text.startsWith('**Passive.** ')).toBe(true);
  });

  it('a free active power shows a 0 coin, so free and passive read apart', () => {
    const card = powerOfferCards(mimicOffer(['myra', 'robin']))[0]!;
    expect(getHero('myra').power.passive).toBeFalsy();
    expect(card.cost).toBe(0);
  });

  it('a dynamic price is the price on the pick turn, the same number the reducer charges', () => {
    // Rounded Spellbook's clock re-bases on adoption: 3 Gold on the pick turn, even on wave 6.
    const run = mimicOffer(['hunch', 'warden']);
    const card = powerOfferCards(run)[0]!;
    expect(card.cost).toBe(3);
    const picked = reduce({ ...run }, { type: 'pickPower', index: 0 });
    expect(heroPowerCostOf(activePowers(picked)[0]!, picked, 0)).toBe(3);
    expect(20 - reduce(picked, { type: 'heroPower' }).embers).toBe(3);
  });

  it('a once-per-game power says so, and the text is the live one the hero panel prints after the pick', () => {
    const run = mimicOffer(['xerox', 'warden']);
    const preview = previewPowerPick(run, 0)!;
    expect(preview.usage).toBe('Active · once per game');
    const picked = reduce({ ...run }, { type: 'pickPower', index: 0 });
    expect(preview.text).toBe(heroPowerText(picked, 0));
  });

  it('previewing never touches the store run', () => {
    const run = mimicOffer(['hunch', 'warden']);
    const before = JSON.stringify(run);
    powerOfferCards(run);
    expect(JSON.stringify(run)).toBe(before);
    expect(run.powerOffer?.heroIds).toEqual(['hunch', 'warden']);
  });

  it('without a preview the card is the printed power, unchanged', () => {
    const v = powerCardView('nadja');
    expect(v.text).toBe(getHero('nadja').power.text);
    expect(v.cost).toBeUndefined();
  });
});
