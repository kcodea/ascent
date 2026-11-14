/**
 * CINDY'S GOLDEN GRATITUDE (Duos only; owner 2026-11-14, R-DUOS-CINDY-01).
 *
 *   "Cindy, 30 resolve, 10 Armor. Golden Gratitude: cost 0, once per game. The next minion your teammate buys gives you
 *   a Gilded copy of it."
 *
 * The rules as built:
 *  - Pressing the power ARMS it (0 Gold, once per GAME: `oncePerGame`, the press spends `heroPowerSpent`). It needs a
 *    teammate: outside a Duos run the press is refused and nothing is spent.
 *  - The arm travels to the TEAMMATE's run as a `gratitude` team effect (the pass channel, the same one Gild Pact's
 *    `listen` rides). Their run remembers it (`duos.gratitude`) until it pays, across turns.
 *  - Their NEXT MINION BUY pays it, once: every minion that leaves their Shop through the `buy` action, whatever put it
 *    there (a normal roll, a rune reward, a Discover into the Shop, Contraband, a Golden Monkey, a held Swap re-buy).
 *    `gratitudeBuy` is called from both minion buy branches of the reducer, like Magician's `magicHatBuy`. A SPELL
 *    bought from the slot or the row does not count and does not spend it; neither does a STARFORM (it is a buy, but
 *    no minion leaves the Shop: there is nothing to copy).
 *  - What Cindy gets: a plain GILDED copy of the minion's card (`gildMinion` on its base def: double base stats, the
 *    Gold flag). The bought card's own buffs, offer stats and enchantments do not ride along, the Golden-copy
 *    convention (a triple's Discover and Indy's Gild double the BASE, never the buffs). A Gilded copy of an already
 *    Gilded minion is the same Gilded card. The teammate keeps the minion they bought.
 *  - The copy rides the effect-pass channel from the teammate's run to Cindy's (`via: 'sale'`, marked `gratitude`):
 *    free, may be Golden, never refused for a full hand (it waits for room, `duos.waiting`), dropped on a room refusal.
 *    It is not a pass for the "when you pass" / "when your team passes" watchers on either run. When it lands, Cindy's
 *    run marks the power PAID (`cindyGratitude: 'paid'`) and remembers which card came.
 *
 * THE STATES (`gratitudeView`, the one read the text, the button and the glow share): `ready` (not used), `armed`
 * (pressed, waiting on the teammate's buy), `paid` (the copy came).
 *
 * A RELOAD (Versus): the restore replay puts the server's rows back through `restoreEffectPass` (`gratitude: 'arm'` on
 * Cindy's run for her arm row, `gratitude: 'pay'` on the teammate's run for the copy row), so a reload can never arm
 * twice or pay twice.
 */
import { CARD_INDEX } from '@game/content';
import { gildMinion } from './recruit';
import { queueTeamEffect, recordSpellPass, duosTeamCard } from './duosPass';
import { hasPower } from './heroes';
import type { BoardCard, RunState } from './state';

export type GratitudeState = 'ready' | 'armed' | 'paid';
export interface GratitudeView { state: GratitudeState; /** The card the Gilded copy was (paid only). */ cardId?: string }

export function gratitudeView(run: Pick<RunState, 'cindyGratitude' | 'cindyGratitudeCard'>): GratitudeView {
  if (run.cindyGratitude === 'paid') return { state: 'paid', ...(run.cindyGratitudeCard ? { cardId: run.cindyGratitudeCard } : {}) };
  return { state: run.cindyGratitude === 'armed' ? 'armed' : 'ready' };
}

/** THE PRESS (Cindy's run, the reducer's draft): arm it and tell the teammate's run. False = refused (no teammate, or
 *  already used), and the caller changes nothing. */
export function armGratitude(s: RunState): boolean {
  if (!s.duos || s.cindyGratitude) return false;
  s.cindyGratitude = 'armed';
  queueTeamEffect(s, { kind: 'gratitude' });
  return true;
}

/** THE TEAMMATE'S RUN hears the arm (its `gratitude` team effect). */
export function gratitudeMateArmed(s: RunState): void {
  if (s.duos) s.duos.gratitude = true;
}

/** Is this card a minion Golden Gratitude copies? (A spell, a Ruby, an unknown id: no.) */
function isMinionCard(cardId: string): boolean {
  const def = CARD_INDEX[cardId];
  return !!def && !def.spell && !def.ruby;
}

/** Cindy's Gilded copy of `cardId`: the plain base card, Gilded (no buffs), under its own uid. */
export function gratitudeCopyOf(s: RunState, cardId: string): BoardCard | null {
  const def = CARD_INDEX[cardId];
  if (!def) return null;
  const copy: BoardCard = { uid: `grat${s.uidSeq++}`, cardId: def.id, tribe: def.tribe, attack: def.attack, health: def.health, keywords: [...def.keywords], golden: false };
  gildMinion(copy); // no run: this is not a Gild of the teammate's (no Gild count, no Gild Pact)
  return copy;
}

/**
 * A MINION WAS BOUGHT (the teammate's run, the reducer's draft). Called from both minion branches of the `buy` action,
 * once the bought card is in the hand, before the triple check. Pays the armed Golden Gratitude once.
 */
export function gratitudeBuy(s: RunState, bought: BoardCard | null): void {
  if (!s.duos?.gratitude || !bought || !isMinionCard(bought.cardId)) return;
  const copy = gratitudeCopyOf(s, bought.cardId);
  if (!copy) return;
  s.duos.gratitude = undefined;
  // The stream leaves the minion that was bought (it stays: a copy of its face rises off it).
  if (recordSpellPass(s, copy, 'hand', -1, 'sale', { uid: bought.uid })) s.duos.outbox[s.duos.outbox.length - 1]!.gratitude = true;
}

/** CINDY'S RUN: the Gilded copy landed (or waits for hand room). The power is spent for good. */
export function gratitudeLanded(s: RunState, card: { cardId?: unknown }): void {
  s.cindyGratitude = 'paid';
  if (typeof card.cardId === 'string') s.cindyGratitudeCard = card.cardId;
}

/** A RELOAD's replay of Cindy's own arm row (the press was dropped with the turn's unlocked actions): armed again, the
 *  once-per-game charge spent, the team entry put back as delivered. False when there is nothing to restore. */
export function restoreGratitudeArm(s: RunState): boolean {
  if (!s.duos || !hasPower(s, 'gratitude') || s.cindyGratitude) return false;
  s.cindyGratitude = 'armed';
  s.heroPowerSpent = true;
  const seq = s.duos.outbox.length;
  s.duos.outbox.push({ seq, wave: s.wave, card: duosTeamCard(seq), from: 'hand', index: -1, paid: 0, team: { kind: 'gratitude' }, restored: true });
  return true;
}

/** A RELOAD's replay of the copy the teammate's run already sent (the buy was dropped): the arm is spent, nothing
 *  leaves, the entry is put back as delivered. */
export function restoreGratitudePay(s: RunState, cardId: string, uid: string): boolean {
  if (!s.duos || !isMinionCard(cardId)) return false;
  const def = CARD_INDEX[cardId]!;
  s.duos.gratitude = undefined;
  const card: BoardCard = { uid, cardId: def.id, tribe: def.tribe, attack: def.attack, health: def.health, keywords: [...def.keywords], golden: false };
  gildMinion(card);
  s.duos.outbox.push({ seq: s.duos.outbox.length, wave: s.wave, card, from: 'hand', index: -1, paid: 0, via: 'sale', gratitude: true, restored: true });
  return true;
}
