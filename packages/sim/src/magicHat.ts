/**
 * MAGICIAN'S MAGIC HAT (Duos only; owner 2026-11-10, R-DUOS-MAGICIAN-01; three buys and a random copy: owner 2026-11-12).
 *
 *   "Change magician to be 3 buys, and it passes a random minion from those 3 buys, so the pass will come from his hat
 *   hero power instead of the minion bought area"
 *   "The hat can send spells too, it's whatever 3 cards were 'put in his hat' so to speak"
 *   "Add a twice per turn max to magician" (2026-11-10, unchanged)
 *
 * The rules as built:
 *  - Every card BOUGHT FROM THE SHOP goes into the hat (a minion, a spell from the slot or the row, a re-bought displaced
 *    minion; a Starform counts as a buy but leaves no card to put in). Nothing else does: a Discover, a gift, a pass, a
 *    token, a conjured copy.
 *  - The hat keeps each card AS IT WAS BOUGHT (`magicHatCards`, a clone taken at the buy: the stats and buffs it carried
 *    out of the Shop, Golden only if the bought card was). The Magician keeps the cards themselves; playing, selling,
 *    buffing or tripling them afterwards changes nothing in the hat.
 *  - The count carries across turns and stops at `MAGIC_HAT_BUYS`. The buy that FILLS the hat fires it at once: the
 *    teammate gets a COPY of one card in it, picked at random off the run cursor (uniform over the cards in the hat,
 *    minions and spells alike), and the hat is emptied.
 *  - At most `MAGIC_HAT_PER_TURN` copies a turn. Past the cap buys still go in up to full and then stop (the hat keeps
 *    the first cards that filled it). A hat that is full and capped fires on the FIRST BUY OF A LATER TURN, from the cards
 *    it already holds; that buy then goes into the new hat as its first card. Nothing has to run at the turn flip: the
 *    per-turn count is stamped with its turn, so it simply reads 0 again.
 *  - A hat that is full but holds no card (every buy was a Starform) waits: the next buy that leaves a card goes in and
 *    fires it.
 *
 * THE COPY'S ROUTE. It rides the Duos pass channel as an effect pass that expects nothing back (`via: 'sale'`, marked
 * `hat`): free, never refused for a full hand (it waits on the teammate's run, `duos.waiting`), and a room refusal (the
 * teammate is away or out) returns nothing, because the Magician keeps the card they bought. It is NOT a pass for the
 * "when you pass" / "when your team passes" watchers on either run: the sender records it without `effectPassCard`, and
 * the receiver's `receivePass` skips the watchers for a `passHat` wire card. The entry's `card` IS the copy (the as-bought
 * card under its own uid), so the screen can show which card came out of the hat.
 *
 * Outside a Duos run (a dev scene, a headless fixture) there is no teammate: the hat still counts, fires and resets, and
 * the copy is dropped.
 *
 * ANCIENTS (R-ANCDUOS-01; a run with Ancients on and a Magician pairing picked, never otherwise). The hat's SHAPE comes
 * from `ancientHatShape`, folded into `magicHatView`, so the buy, the text, the counter and the ready glow all follow it:
 * Genesis needs 8 buys (the hat then holds up to 8 cards and picks among them), Bonds has no per-turn cap. What a fired
 * hat DOES beyond the copy is `ancientOnHatFired` (Death's keyword on the copy, Genesis' Gilded minion / three spells,
 * Fortune's cheaper Shop upgrade).
 */
import { ancientHatShape, ancientOnHatFired, ancientOnHatTrigger } from './ancients';
import { hasPower } from './heroes';
import { recordSpellPass } from './duosPass';
import { makeRng } from '@game/core';
import type { BoardCard, RunState } from './state';

/** Shop buys that fill the hat (owner 2026-11-12: "Change magician to be 3 buys"). */
export const MAGIC_HAT_BUYS = 3;
/** Copies the hat may send each turn (owner 2026-11-10: "twice per turn max"). */
export const MAGIC_HAT_PER_TURN = 2;

type HatRun = Pick<RunState, 'wave' | 'magicHatBuys' | 'magicHatSent' | 'magicHatSentWave'> & Partial<Pick<RunState, 'heroId' | 'adoptedPowerId' | 'mimicPowerId' | 'voidPowerIds' | 'ancientsEnabled' | 'ancients'>>;

/** Copies the hat already sent THIS turn (a stamp from an earlier turn reads 0). */
export function magicHatSentThisTurn(run: HatRun): number {
  return run.magicHatSentWave === run.wave ? Math.max(0, run.magicHatSent ?? 0) : 0;
}

/**
 * THE HAT'S LIVE STATE: the one read the reducer, the power's text, its counter badge and its ready glow all share.
 *  - `count` / `need`: buys toward the hat (0..3; Ancient of Genesis: 0..8);
 *  - `left`: copies it may still send this turn (`noCap`, Ancient of Bonds: no limit, `left` and `perTurn` are then
 *    not meaningful and read as the base cap);
 *  - `full`: the hat holds all its buys (only ever seen past the turn's cap, or as a later turn opens on such a hat);
 *  - `active`: THE NEXT CARD BOUGHT SENDS A COPY: the hat is one buy short of full (or already full) and a copy is
 *    left this turn;
 *  - `capped`: full, but this turn's copies are spent (it fires on the first buy of a later turn).
 */
export interface MagicHatView { count: number; need: number; left: number; perTurn: number; full: boolean; active: boolean; capped: boolean; /** Ancient of Bonds: no per-turn cap. */ noCap?: true }
export function magicHatView(run: HatRun): MagicHatView {
  const shape = ancientHatShape(run);
  const need = shape.need ?? MAGIC_HAT_BUYS;
  const count = Math.min(need, Math.max(0, Math.floor(run.magicHatBuys ?? 0)));
  const left = Math.max(0, MAGIC_HAT_PER_TURN - magicHatSentThisTurn(run));
  const full = count >= need;
  const next = count >= need - 1;
  if (shape.noCap) return { count, need, left: MAGIC_HAT_PER_TURN, perTurn: MAGIC_HAT_PER_TURN, full, active: next, capped: false, noCap: true };
  return { count, need, left, perTurn: MAGIC_HAT_PER_TURN, full, active: next && left > 0, capped: full && left === 0 };
}

/** Count one of the turn's copies as sent (the buy that fired it, or a reload's replay of a copy the server holds). */
function noteHatSent(s: RunState): void {
  const sent = magicHatSentThisTurn(s);
  s.magicHatSentWave = s.wave;
  s.magicHatSent = sent + 1;
}

/** The cards in the hat (each as it was bought), never more than the hat holds. */
function hatCards(s: RunState, need: number): BoardCard[] {
  return (s.magicHatCards ?? []).slice(0, need);
}

/**
 * THE HAT FIRES: one of the cards in it, picked at random, is copied to the teammate, and the hat is emptied. The pick
 * is uniform over the cards the hat holds and comes off the RUN CURSOR (the reducer's one seeded stream), so the same
 * run replays the same pick; a hat holding one card draws nothing.
 */
function fireHat(s: RunState, cards: readonly BoardCard[]): void {
  let i = 0;
  if (cards.length > 1) {
    const rng = makeRng(s.rngCursor);
    i = rng.int(cards.length);
    s.rngCursor = rng.state();
  }
  const picked = cards[i]!;
  s.magicHatBuys = 0;
  s.magicHatCards = undefined;
  noteHatSent(s);
  // The copy: the card as it was bought, under its own uid (never the uid of the card the Magician keeps).
  const copy: BoardCard = { ...structuredClone(picked), uid: `hat${s.uidSeq++}` };
  const copies = ancientOnHatFired(s, copy); // ANCIENTS: Death's keyword, Genesis' Gild / spell count (1 without them)
  if (recordSpellPass(s, copy, 'hand', -1, 'sale')) {
    const e = s.duos!.outbox[s.duos!.outbox.length - 1]!;
    e.hat = true;
    if (copies > 1) e.copies = copies;
  }
  ancientOnHatTrigger(s); // ANCIENTS: Fortune's cheaper Shop upgrade (a trigger with or without a teammate)
}

/**
 * A CARD WAS BOUGHT FROM THE SHOP. Called from every `buy` branch, on the reducer's draft, once the bought card is in
 * the hand as it will stay (after the buy's own buffs, before the triple check can fold it away). `bought` is null for a
 * buy that leaves no card (a Starform): it counts, and puts nothing in the hat.
 */
export function magicHatBuy(s: RunState, bought: BoardCard | null): void {
  if (!hasPower(s, 'magicHat')) return;
  let hat = magicHatView(s);
  let cards = hatCards(s, hat.need);
  const canSend = (): boolean => hat.noCap === true || hat.left > 0;
  // A hat that filled while the turn's copies were spent: this buy (the first one that may send again) fires it from
  // the cards it already holds, and then goes into the new hat itself.
  if (hat.full && cards.length > 0 && canSend()) {
    fireHat(s, cards);
    hat = magicHatView(s);
    cards = [];
  }
  const snap = bought ? structuredClone(bought) : null;
  if (!hat.full) {
    s.magicHatBuys = hat.count + 1;
    if (snap) cards = [...cards, snap];
  } else if (snap && cards.length === 0) {
    cards = [snap]; // a full hat that holds no card (every buy was a Starform) takes the first card that comes
  }
  s.magicHatCards = cards.length ? cards : undefined;
  hat = magicHatView(s);
  if (hat.full && cards.length > 0 && canSend()) fireHat(s, cards);
}

/**
 * A RELOAD'S REPLAY of a hat copy the server already holds (the buys that made it were dropped with the rest of the
 * turn's unlocked actions): the copy counts against this turn's cap again and the hat starts over EMPTY (count and
 * cards), so a reload can never send the teammate more than the turn's two copies. Returns whether anything changed.
 */
export function restoreMagicHatSend(s: RunState): boolean {
  if (!hasPower(s, 'magicHat') || (!magicHatView(s).noCap && magicHatSentThisTurn(s) >= MAGIC_HAT_PER_TURN)) return false;
  s.magicHatBuys = 0;
  s.magicHatCards = undefined;
  noteHatSent(s);
  ancientOnHatTrigger(s); // the replayed trigger pays Fortune's upgrade cut again (the turn's own was dropped with it)
  return true;
}
