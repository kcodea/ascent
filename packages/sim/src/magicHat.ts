/**
 * MAGICIAN'S MAGIC HAT (Duos only; owner 2026-11-10, R-DUOS-MAGICIAN-01).
 *
 *   "magician - 8 armor, magic hat - when you buy 5 cards, your hat is activated. The next card you buy, your teammate
 *   gets a copy of it."
 *   "Add a twice per turn max to magician"
 *
 * The rules as built:
 *  - Every card BOUGHT FROM THE SHOP counts (a minion, a spell from the slot or the row, a re-bought displaced minion, a
 *    Starform). Nothing else does: a Discover, a gift, a pass, a token, a conjured copy.
 *  - The count carries across turns and stops at `MAGIC_HAT_BUYS`. At 5 the hat is ACTIVE.
 *  - The next card bought while it is active sends a COPY to the teammate: the card exactly as it was bought (the stats
 *    and buffs it carried out of the Shop, Golden only if the bought card was). The count goes back to 0. That buy does
 *    not count toward the next 5.
 *  - At most `MAGIC_HAT_PER_TURN` copies a turn. Past the cap buys still count up to 5, but the hat is not active: a
 *    full hat turns active at the start of the next turn (the per-turn count is stamped with its turn, so it simply
 *    reads 0 again; nothing has to run at the turn flip).
 *  - A Starform buy counts, but leaves no body to copy: bought while the hat is active, the hat stays active.
 *
 * THE COPY'S ROUTE. It rides the Duos pass channel as an effect pass that expects nothing back (`via: 'sale'`, marked
 * `hat`): free, never refused for a full hand (it waits on the teammate's run, `duos.waiting`), and a room refusal (the
 * teammate is away or out) returns nothing, because the Magician keeps the card they bought. It is NOT a pass for the
 * "when you pass" / "when your team passes" watchers on either run: the sender records it without `effectPassCard`, and
 * the receiver's `receivePass` skips the watchers for a `passHat` wire card.
 *
 * Outside a Duos run (a dev scene, a headless fixture) there is no teammate: the hat still counts, fires and resets, and
 * the copy is dropped.
 *
 * ANCIENTS (R-ANCDUOS-01; a run with Ancients on and a Magician pairing picked, never otherwise). The hat's SHAPE comes
 * from `ancientHatShape`, folded into `magicHatView`, so the buy, the text, the counter and the ready glow all follow it:
 * Genesis needs 8 buys, Bonds has no per-turn cap. What a fired hat DOES beyond the copy is `ancientOnHatFired` (Death's
 * keyword on the copy, Genesis' Gilded minion / three spells, Fortune's cheaper Shop upgrade).
 */
import { ancientHatShape, ancientOnHatFired, ancientOnHatTrigger } from './ancients';
import { hasPower } from './heroes';
import { recordSpellPass } from './duosPass';
import type { BoardCard, RunState } from './state';

/** Shop buys that activate the hat. */
export const MAGIC_HAT_BUYS = 5;
/** Copies the hat may send each turn (owner 2026-11-10: "twice per turn max"). */
export const MAGIC_HAT_PER_TURN = 2;

type HatRun = Pick<RunState, 'wave' | 'magicHatBuys' | 'magicHatSent' | 'magicHatSentWave'> & Partial<Pick<RunState, 'heroId' | 'adoptedPowerId' | 'mimicPowerId' | 'voidPowerIds' | 'ancientsEnabled' | 'ancients'>>;

/** Copies the hat already sent THIS turn (a stamp from an earlier turn reads 0). */
export function magicHatSentThisTurn(run: HatRun): number {
  return run.magicHatSentWave === run.wave ? Math.max(0, run.magicHatSent ?? 0) : 0;
}

/**
 * THE HAT'S LIVE STATE: the one read the reducer, the power's text, its counter badge and its ready glow all share.
 *  - `count` / `need`: buys toward the hat (0..5; Ancient of Genesis: 0..8);
 *  - `left`: copies it may still send this turn (`noCap`, Ancient of Bonds: no limit, `left` and `perTurn` are then
 *    not meaningful and read as the base cap);
 *  - `active`: the next card bought is copied (full, and under the turn's cap);
 *  - `capped`: full, but this turn's copies are spent (it turns active next turn).
 */
export interface MagicHatView { count: number; need: number; left: number; perTurn: number; active: boolean; capped: boolean; /** Ancient of Bonds: no per-turn cap. */ noCap?: true }
export function magicHatView(run: HatRun): MagicHatView {
  const shape = ancientHatShape(run);
  const need = shape.need ?? MAGIC_HAT_BUYS;
  const count = Math.min(need, Math.max(0, Math.floor(run.magicHatBuys ?? 0)));
  const left = Math.max(0, MAGIC_HAT_PER_TURN - magicHatSentThisTurn(run));
  const full = count >= need;
  if (shape.noCap) return { count, need, left: MAGIC_HAT_PER_TURN, perTurn: MAGIC_HAT_PER_TURN, active: full, capped: false, noCap: true };
  return { count, need, left, perTurn: MAGIC_HAT_PER_TURN, active: full && left > 0, capped: full && left === 0 };
}

/** Count one of the turn's copies as sent (the buy that fired it, or a reload's replay of a copy the server holds). */
function noteHatSent(s: RunState): void {
  const sent = magicHatSentThisTurn(s);
  s.magicHatSentWave = s.wave;
  s.magicHatSent = sent + 1;
}

/**
 * A CARD WAS BOUGHT FROM THE SHOP. Called from every `buy` branch, on the reducer's draft, once the bought card is in
 * the hand as it will stay (after the buy's own buffs, before the triple check can fold it away). `bought` is null for a
 * buy that leaves no card (a Starform). `srcUid` is the Shop offer that was bought, still on screen while the action
 * commits: the copy's stream starts there (presentation only).
 */
export function magicHatBuy(s: RunState, bought: BoardCard | null, srcUid?: string): void {
  if (!hasPower(s, 'magicHat')) return;
  const hat = magicHatView(s);
  if (hat.active && bought) {
    s.magicHatBuys = 0;
    noteHatSent(s);
    // The copy: the card as it was bought, under its own uid (never the uid of the card the Magician keeps).
    const copy: BoardCard = { ...structuredClone(bought), uid: `hat${s.uidSeq++}` };
    const copies = ancientOnHatFired(s, copy); // ANCIENTS: Death's keyword, Genesis' Gild / spell count (1 without them)
    if (recordSpellPass(s, copy, 'hand', -1, 'sale', srcUid ? { uid: srcUid } : undefined)) {
      const e = s.duos!.outbox[s.duos!.outbox.length - 1]!;
      e.hat = true;
      if (copies > 1) e.copies = copies;
    }
    ancientOnHatTrigger(s); // ANCIENTS: Fortune's cheaper Shop upgrade (a trigger with or without a teammate)
    return;
  }
  if (!hat.active && hat.count < hat.need) s.magicHatBuys = hat.count + 1;
}

/**
 * A RELOAD'S REPLAY of a hat copy the server already holds (the buys that made it were dropped with the rest of the
 * turn's unlocked actions): the copy counts against this turn's cap again and the hat starts over, so a reload can
 * never send the teammate more than the turn's two copies. Returns whether anything changed.
 */
export function restoreMagicHatSend(s: RunState): boolean {
  if (!hasPower(s, 'magicHat') || (!magicHatView(s).noCap && magicHatSentThisTurn(s) >= MAGIC_HAT_PER_TURN)) return false;
  s.magicHatBuys = 0;
  noteHatSent(s);
  ancientOnHatTrigger(s); // the replayed trigger pays Fortune's upgrade cut again (the turn's own was dropped with it)
  return true;
}
