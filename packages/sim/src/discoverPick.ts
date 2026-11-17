/**
 * THE DISCOVER PICK BODY: the card a Discover option becomes when it is taken, built by ONE function for both the pick
 * itself and the Discover's preview of every option.
 *
 * Owner report 2026-11-16 (Keshi × War): "this should also SHOW in the discover. if there are other effects like this
 * that trigger for a discover etc, it should SHOW on the discovered cards". Every grant that changes a Discovered card
 * at pick time (a keyword, Gilded, set stats, the creation auras) is applied here, so the option card the Discover draws
 * (`discoverOfferCard`) and the card the pick puts in hand (`takeDiscoverPick`) cannot drift. Any random part of a grant
 * is rolled when the OFFER opens (seeded), never at the pick, so what you see is what you get. A new pick-time grant goes
 * HERE (or in `ancientShapeDiscoverPick`), never in the UI.
 */
import { CARD_INDEX } from '@game/content';
import type { BoardCard, DiscoverAncientTag, RunState } from './state';
import { cardBuff, conjuredStats, gildMinion } from './recruit';
import { ancientEmpowerPickGainsRise, ancientShapeDiscoverPick } from './ancients';

/**
 * Build the hand card option `index` of the open Discover becomes. `commit` = the real pick (the caller passes the uid
 * it claimed and the Ancient origin it consumed); `!commit` = a preview (no state is touched: no uid, no gild counted).
 * Null when the option is not a card or is not a hand pick (a Ruby is minted instead).
 */
export function buildDiscoverPick(s: RunState, index: number, opts: { uid: string; tag: DiscoverAncientTag | undefined; commit: boolean }): BoardCard | null {
  const id = s.discover?.[index];
  const def = id ? CARD_INDEX[id] : undefined;
  if (!def || def.ruby) return null;
  const taken: BoardCard = {
    uid: opts.uid,
    cardId: def.id,
    tribe: def.tribe,
    // A discovered Undead carries the run-wide Undead Attack bonus too (undeadBuyAtk), like a buy; a discovered Fodder
    // carries Ritualist's run buff (`cardBuff`).
    ...conjuredStats(s, def, cardBuff(s, def.id)),
    keywords: [...def.keywords],
    golden: false,
    // Disco Dan's Setlist: this pick is locked in hand until you reach its shop tier (T2/T4/T6).
    ...(s.discoverLockTier ? { lockedUntilTier: s.discoverLockTier } : {}),
    ...(s.discoverLockGold ? { lockedUntilGoldSpent: s.discoverLockGold } : {}),
    ...(s.discoverLockWave ? { lockedUntilWave: s.discoverLockWave } : {}), // Hourglass Reserve
    ...(s.discoverBorrowed ? { borrowed: true } : {}), // Funeral on Loan
  };
  // Rune of the Second Path: the pick's stats are SET to the authored line (20/20), replacing the
  // conjured stats entirely (an override, not a buff).
  if (s.discoverSetStats) { taken.attack = s.discoverSetStats.attack; taken.health = s.discoverSetStats.health; }
  // A GILDED Discover (a golden Salvatore McKlusky) hands the pick over already gilded: the same
  // transform a triple applies, so the stats/keywords stay consistent with every other golden. A preview counts no gild.
  if (s.discoverGolden) gildMinion(taken, opts.commit ? s : undefined);
  // Rune of Rising Echoes / Grave Invitation / quest rewards: the pick arrives carrying granted keywords. Applied after
  // the gild so a gilded pick keeps them, and de-duped against what the card already has.
  for (const k of s.discoverKeywords ?? []) if (!taken.keywords.includes(k)) taken.keywords.push(k);
  // Rune of the Astral Draft: the pick casts an additional time (stamped on the instance, read by `spellCasts`).
  if (s.discoverExtraCasts) taken.extraCasts = (taken.extraCasts ?? 0) + s.discoverExtraCasts;
  // ANCIENTS (Keshi × War, Quillen × Death, Disco Dan × Death, Underdweller): the pick's grants, by its Discover's origin.
  ancientShapeDiscoverPick(s, opts.tag, taken, index, opts.commit);
  return taken;
}

/**
 * The PREVIEW of Discover option `index`: the card the pick will put in your hand, with every pick-time grant already
 * on it (keywords, Gilded, stats), for the Discover UI to draw. An Albus Empowerment pick that will REPLACE a Shop offer
 * shows the plain card plus its Empowerment Rise (the locks and riders mean nothing to a Shop offer). Null when there is
 * no such option, or it is a Ruby (minted at the run's Ruby strength instead).
 */
export function discoverOfferCard(s: RunState, index: number): BoardCard | null {
  const id = s.discover?.[index];
  const def = id ? CARD_INDEX[id] : undefined;
  if (!def || def.ruby) return null;
  const tag = s.ancients?.discoverTag;
  const intoShop = !!s.discoverIntoShopUid && s.shop.some((o) => o.uid === s.discoverIntoShopUid);
  if (intoShop) {
    const card: BoardCard = { uid: `discover-preview-${index}`, cardId: def.id, tribe: def.tribe, ...conjuredStats(s, def, cardBuff(s, def.id)), keywords: [...def.keywords], golden: false };
    if (ancientEmpowerPickGainsRise(s, def) && !card.keywords.includes('R')) card.keywords.push('R');
    return card;
  }
  const card = buildDiscoverPick(s, index, { uid: `discover-preview-${index}`, tag, commit: false });
  // An Empowerment pick whose offer was already gone lands in hand, and still gains its Rise (`ancientOnEmpowerPick`).
  if (card && s.discoverIntoShopUid && ancientEmpowerPickGainsRise(s, def) && !card.keywords.includes('R')) card.keywords.push('R');
  return card;
}
