import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CARD_INDEX } from '@game/content';
import {
  ANCIENT_IDS, ANCIENT_PAIRINGS, HEROES, createRun, enableAncients, getHero, heroPowerText, reduce,
  type AncientId, type BoardCard, type RunState,
} from '@game/sim';
import { powerOfferCards } from './powerOffer';
import { heldPowerHeroId } from '../ancients/FoeAncientLine';
import { SeatPower } from '../matchDetails/SeatPower';
import { RailScoutShowcase } from '../RailScoutShowcase';

/**
 * R-POWER-OFFER-ANCIENT-01 (owner 2026-11-20: "when using power shifter, the hero powers need to show the ancient-ified
 * text so that the player knows what the new hero power will be fully"). Each offered power is shown as the picked
 * Ancient rewrites it once it lands: the "(Death)" tag the hero panel prints, and the pairing's live text. With no
 * Ancient, or no pairing for that power, the card is the base power.
 *
 * R-SEAT-POWER-HELD-01 (same day): a finished game / a foe shows the power the seat HELD (the adopted one its Ancient
 * pairs with), never the starting hero's power beside an Ancient line about a different power.
 */
const card = (uid: string, cardId: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};
const base = (heroId: string, over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, heroId, 'lobby', undefined, 'set3'), phase: 'recruit', embers: 60, hand: [], wave: 6, tier: 4, ...over } as RunState);
const clear = (s0: RunState): RunState => {
  let s = s0;
  for (let g = 0; g < 12 && (s.discover || s.powerOffer || s.questOffer); g++) {
    s = reduce(s, s.discover ? { type: 'discover', index: 0 } : s.powerOffer ? { type: 'pickPower', index: 0 } : { type: 'buyQuest', index: 0 });
  }
  return s;
};
const picked = (heroId: string, id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = clear(enableAncients(base(heroId, over)));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const shifterOffer = (s: RunState, heroIds: string[]): RunState => ({ ...s, powerOffer: { heroIds, slot: 'shifter' } });

describe('the hero-power Discover shows each power as the picked Ancient rewrites it', () => {
  it('Power Shifter with the Ancient of Death offers "Aegis (Death)" with its Death text', () => {
    const run = shifterOffer(picked('indy', 'death'), ['warden']);
    const [aegis] = powerOfferCards(run);
    expect(aegis!.name).toBe(`${getHero('warden').power.name} (Death)`);
    expect(aegis!.text).toContain('Destroy a friendly minion. Give its Attack and **Ward** to another random friendly minion');
    expect(aegis!.text).not.toContain(getHero('warden').power.text);
    // Exactly what the hero panel prints the moment the power lands.
    const after = reduce({ ...run }, { type: 'pickPower', index: 0 });
    expect(aegis!.text.endsWith(heroPowerText(after, 0))).toBe(true);
  });

  it('a different Ancient gives that Ancient\'s tag and text', () => {
    const [aegis] = powerOfferCards(shifterOffer(picked('indy', 'fortune'), ['warden']));
    expect(aegis!.name).toBe(`${getHero('warden').power.name} (Fortune)`);
    expect(aegis!.text).toContain('When one of your **Wards** breaks in combat, gain **2 Gold** next turn.');
  });

  it('with no Ancient picked the offer is the base power', () => {
    const [aegis] = powerOfferCards(shifterOffer(base('indy'), ['warden']));
    expect(aegis!.name).toBe(getHero('warden').power.name);
    expect(aegis!.text).toBe(`**Active · once per turn.** ${getHero('warden').power.text}`);
  });

  it('a power with no pairing for the picked Ancient stays the base power, untagged', () => {
    const anc: AncientId = 'death';
    const unpaired = HEROES.map((h) => h.id).find((h) => h !== 'indy' && h !== 'mimic' && h !== 'voidhero' && !ANCIENT_PAIRINGS[h]?.[anc]);
    if (!unpaired) return; // every power has a Death pairing: nothing unpaired to offer
    const [c] = powerOfferCards(shifterOffer(picked('indy', anc), [unpaired]));
    const [plain] = powerOfferCards(shifterOffer(base('indy'), [unpaired]));
    expect(c!.name).toBe(getHero(unpaired).power.name);
    expect(c!.text).toBe(plain!.text);
  });

  it('the adopted power does what the offer said: Aegis (Death) destroys the target and gives its Attack and Ward', () => {
    const board = [card('a', 'sandbag'), card('b', 'sandbag')];
    const after = reduce(shifterOffer(picked('indy', 'death', { board }), ['warden']), { type: 'pickPower', index: 0 });
    const victim = after.board.find((m) => m.uid === 'a')!;
    const used = reduce(after, { type: 'heroPower', uid: 'a' });
    expect(used.board.some((m) => m.uid === 'a')).toBe(false);
    const other = used.board.find((m) => m.uid === 'b')!;
    expect(other.attack).toBe(after.board.find((m) => m.uid === 'b')!.attack + victim.attack);
    expect(other.keywords).toContain('DS');
  });
});

describe('a seat shows the power it HELD, with the Ancient that pairs with it', () => {
  it('a Lucky Seat who Power Shifted into Aegis shows Aegis, not Lucky Seat', () => {
    const ancient = { id: 'death' as const, heroId: 'warden' };
    expect(heldPowerHeroId('cia', ancient)).toBe('warden');
    const html = renderToStaticMarkup(<SeatPower heroId="cia" ancient={ancient} who="Me" />);
    expect(html).toContain(getHero('warden').power.name);
    expect(html).not.toContain(getHero('cia').power.name);
  });

  it('no Ancient (or an unknown id) keeps the starting hero\'s power', () => {
    expect(heldPowerHeroId('cia', undefined)).toBe('cia');
    expect(heldPowerHeroId('cia', { id: 'death', heroId: 'nobody' })).toBe('cia');
    expect(heldPowerHeroId('cia', { id: 'nope' as never, heroId: 'warden' })).toBe('cia');
  });

  it('the rail scout card shows the held power too', () => {
    const html = renderToStaticMarkup(<RailScoutShowcase name="R" heroId="cia" portrait={undefined} ancient={{ id: 'death', heroId: 'warden' }} />);
    expect(html).toContain(getHero('warden').power.name);
    expect(html).toContain(getHero('cia').name); // the hero's own name stays
  });
});
