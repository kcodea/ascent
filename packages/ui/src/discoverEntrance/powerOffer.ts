import { activePowers, getHero, heroPowerCostOf, heroPowerLockTurns, heroPowerText, reduce, type HeroPower, type RunState } from '@game/sim';
import { heroPowerArt } from '../art';
import type { CardView } from '../Card';

/**
 * THE HERO-POWER DISCOVER (Mimic every turn, Void's turn-4 pair, the Power Shifter spell), drawn as a Discover
 * (owner ask 2026-10-12: "exactly like the discover screen"). The offer rides the real `DiscoverDialog`, so each
 * power has to be a card: this builds that card, and names the offer's source for the banner's "From X" line.
 */
type PowerOffer = NonNullable<RunState['powerOffer']>;

/** The star plaque every power card wears: Power Shifter's own tier. */
export const POWER_CARD_TIER = 5;

/** What a power will be ONCE PICKED, read off the run the pick would produce (owner report 2026-11-03: Mimic's
 *  Discover gave no way to tell whether a power cost Gold, or whether it was active or passive). */
export interface PowerPickPreview {
  /** The power as it lands (an Ancient's reshape included). */
  power: HeroPower;
  /** Live rules text, as the hero panel will print it right after the pick. */
  text: string;
  /** Gold to activate on the pick turn (the adopted price clock re-bases on the pick). 0 for a passive. */
  cost: number;
  /** "Passive" / "Active · once per turn" / "Active · once per game" / "Active · already used" / … */
  usage: string;
}

function usesPerGame(n: number): string {
  return `${n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`} per game`;
}

/** The pick's slot: Void's second pick lands beside the first, every other pick takes slot 0. */
function slotOf(offer: PowerOffer): 0 | 1 {
  return offer.slot === 'void2' ? 1 : 0;
}

/** The usage tag: passive or active, and how often an active one may fire (or why it cannot this turn). */
export function powerUsage(power: HeroPower, run: RunState, slot: 0 | 1): string {
  if (power.passive) return 'Passive';
  const ready = slot === 0 ? run.heroReady : (run.heroReady2 ?? true);
  const spent = slot === 0 ? !!run.heroPowerSpent : !!run.heroPowerSpent2;
  const uses = (slot === 0 ? run.heroPowerUses : run.heroPowerUses2) ?? 0;
  const unlock = power.unlockWave ?? 1;
  const lock = heroPowerLockTurns(run, power.kind);
  let rule: string;
  if (run.wave < unlock) rule = `unlocks turn ${unlock}`;
  else if (lock > 0) rule = `locked ${lock} ${lock === 1 ? 'turn' : 'turns'}`;
  else if (power.oncePerGame) rule = spent ? 'already used' : 'once per game';
  else if (power.maxUses) rule = uses >= power.maxUses ? 'already used' : uses > 0 ? `${power.maxUses - uses} of ${power.maxUses} uses left` : usesPerGame(power.maxUses);
  else if (power.usesPerTurn && power.usesPerTurn > 1) rule = `${power.usesPerTurn} times per turn`;
  else rule = ready === false ? 'used this turn' : 'once per turn';
  return `Active · ${rule}`;
}

/** Preview picking option `index`: run the real `pickPower` on a copy and read the slot it fills, so the cost,
 *  usage and text are exactly what the hero panel shows a moment later. Undefined when the pick is rejected.
 *  `reduce` writes its per-action scratch onto its input, so it gets a shallow copy, never the store's run. */
export function previewPowerPick(run: RunState, index: number): PowerPickPreview | undefined {
  const offer = run.powerOffer;
  if (!offer) return undefined;
  const next = reduce({ ...run }, { type: 'pickPower', index });
  if (next === run || next.powerOffer === offer) return undefined;
  const slot = slotOf(offer);
  const power = activePowers(next)[slot];
  if (!power) return undefined;
  const uses = (slot === 0 ? next.heroPowerUses : next.heroPowerUses2) ?? 0;
  return {
    power,
    text: heroPowerText(next, slot),
    cost: heroPowerCostOf(power, next, uses),
    usage: powerUsage(power, next, slot),
  };
}

/** A hero power as a spell card: the power's own art, name and rules text in the spell frame, with the hero it
 *  belongs to on the kind line (green, under the emerald-helm medallion). No stats: a power has none. The id is
 *  namespaced so it can never resolve to a real card (no skin, no card art, no def).
 *
 *  With a `preview` (the live offer), the card also says what the pick COSTS and how it is USED: the Gold coin
 *  carries an active power's price (no coin on a passive, which is never activated), and the rules text leads
 *  with the usage tag ("**Passive.**", "**Active · once per game.**") — read off the run the pick produces, so
 *  the text is the live one the hero panel will print. Without one (tests, previews) it is the printed power. */
export function powerCardView(heroId: string, preview?: PowerPickPreview): CardView {
  const h = getHero(heroId);
  const power = preview?.power ?? h.power;
  return {
    name: power.name, cardId: `heropower:${heroId}`, artUrl: heroPowerArt(heroId),
    tribe: 'neutral', attack: 0, health: 0, keywords: [],
    text: preview ? `**${preview.usage}.** ${preview.text}` : h.power.text,
    spell: true, heroPowerOf: h.name,
    ...(preview && !power.passive ? { cost: preview.cost } : {}),
    // The five-star plaque the Power Shifter spell itself wears (owner ask 2026-10-12: "the same tier badge with 5
    // stars up top ... just like how it is in the power shifter spell"). A look, not a rule: a power has no tier.
    tier: POWER_CARD_TIER,
  };
}

/** Every option of the live offer as a card, each previewed against the run. */
export function powerOfferCards(run: RunState): CardView[] {
  return (run.powerOffer?.heroIds ?? []).map((id, i) => powerCardView(id, previewPowerPick(run, i)));
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
