import { CARD_INDEX } from '@game/content';
import type { CardDef, Tribe } from '@game/core';
import { poolOf } from './cardPool';
import { isTribe } from './recruit';
import type { BoardCard, RunState } from './state';

/**
 * ── WOULD THIS SPELL DO NOTHING? ───────────────────────────────────────────────────────────────────────
 *
 * A spell cast into a state it cannot affect — Deep Delve Writ with no Dwarf in the shop, Growth on an empty
 * board, Mend at full Resolve — used to be CONSUMED anyway: the card left your hand, the Gold was gone, and
 * nothing happened. That reads as a bug even when the play was the player's mistake, and there is no version
 * of it a player would choose.
 *
 * The reducer already refused a handful of these inline (Resonance on a non-Battlecry body, Displacement on a
 * golden, Layaway aimed at the board, Common Ground with no second minion, Cupcakes off-tribe). This module
 * is the same rule made GENERAL and declarative, so the answer lives in one auditable place instead of an
 * ever-growing pile of `if (…) return state;` — and so a NEW spell that can whiff is one table entry, not a
 * reducer edit.
 *
 * The contract when this returns true: the reducer returns the untouched state, so the card stays in hand and
 * no Gold is spent — a true no-op, not a partial cast.
 *
 * SCOPE, deliberately: this only catches a spell that can do *nothing at all*. A spell that does LESS than
 * you hoped (Growth on one minion instead of seven) still casts — the rule is "unusable", not "suboptimal".
 */

/** Shop offers that are real MINIONS — the thing most shop-facing spells actually operate on. */
const shopMinions = (s: RunState) =>
  s.shop.filter((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby; });

/**
 * Per-effect predicates: "given this state, would this effect accomplish nothing?"
 *
 * Keyed on the effect's `do` id so it stays in lock-step with the factories, exactly like `stepProgress` and
 * the text helpers. A spell fizzles if ANY of its effects is a no-op AND none of the others would do
 * something — see `spellFizzles`, which is deliberately conservative about multi-effect spells.
 */
const NO_OP: Record<string, (s: RunState, def: CardDef, params: Record<string, unknown>, target?: BoardCard) => boolean> = {
  // ── Board-facing: nothing to buff ────────────────────────────────────────────────────────────────────
  spellBuffAll: (s) => s.board.length === 0,                 // Growth, Waking Rift
  spellPlayRubiesAll: (s) => s.board.length === 0,           // Ruby Excavation
  spellBuffLeftmost: (s) => s.board.length === 0,            // Champion's Ale

  // ── Shop-facing: nothing in the tavern to act on ─────────────────────────────────────────────────────
  stealTavernMinion: (s) => shopMinions(s).length === 0,     // Lasso
  spellGildRandomTavern: (s) => shopMinions(s).length === 0, // Golden Touch
  spellRefreshTierUp: (s) => shopMinions(s).length === 0,    // Elevation Ritual
  // The two steal spells read their tribe from OPPOSITE sides, which is easy to get backwards:
  //   • Deep Delve Writ (`tribe`)     — steal a minion OF that tribe FROM THE SHOP → the shop must hold one.
  //   • Ironclad Requisition (`perTribe`) — one steal PER FRIENDLY minion of that tribe → YOUR BOARD must
  //     hold one (what it steals is unrestricted). An earlier draft checked the shop for both, which broke
  //     Ironclad: it would refuse to cast whenever the tavern had no Dwarf, even with three on your board.
  // Either way, an empty tavern means there is nothing to take at all.
  spellStealShop: (s, _d, p) => {
    if (shopMinions(s).length === 0) return true;
    const perTribe = p.perTribe as Tribe | undefined;
    if (perTribe) return !s.board.some((c) => isTribe(c, perTribe));
    const tribe = p.tribe as string | undefined;
    return !!tribe && !shopMinions(s).some((o) => { const d = CARD_INDEX[o.cardId]; return !!d && (d.tribe === tribe || d.tribe2 === tribe); });
  },

  // ── Conditional / stateful ───────────────────────────────────────────────────────────────────────────
  healHero: (s) => s.resolve >= s.maxResolve,                        // heal spells can't overheal
  setArmor: (s, _def, params) => s.armor >= (typeof params.amount === 'number' ? params.amount : 5), // Mend: a floor — at/above it, nothing would happen
  // Insurance Policy is DELIBERATELY absent (owner ruling 2026-08-04): "you should be able to play it, it
  // just gives 0 Gold if you did not lose." Casting into a win is a legal, informed dud — not a fizzle.
  spellScoutNextOpponent: (s) => {
    // Mirrors the factory's own sources (lobby seat first, else the course pin) — if neither can name a
    // board there is nothing to scout.
    if (s.lobby) return false; // a lobby always has a paired seat to read
    const next = s.servedBoards?.[s.wave];
    return !next || next.minions.length === 0;
  },
  spellDiscoverFromLastOpponent: (s) => {
    const last = s.servedBoards?.[s.wave - 1];
    if (!last) return true;
    return !last.minions.some((m) => { const d = CARD_INDEX[m.cardId]; return !!d && !d.spell && !d.token; });
  },
  // Undead Army in a set with no Undead (set 2) has nothing to conjure — the run's PINNED pool decides.
  conjureTribeArmy: (s, _d, p) => {
    const tribe = p.tribe as string | undefined;
    if (!tribe) return false;
    return !poolOf(s).buyable.some((c) => c.tribe === tribe || c.tribe2 === tribe);
  },

  // ── Target-facing ────────────────────────────────────────────────────────────────────────────────────
  // Ossuary Rite triggers "this minion's Echo" — a body with no Echo has none to trigger. The Resonance twin
  // (which the reducer already guards for Shouts); this is the `onDeath` half that was missing.
  spellTriggerEcho: (_s, _d, _p, target) => {
    if (!target) return false;
    const def = CARD_INDEX[target.cardId];
    const own = def?.effects.some((e) => e.on === 'onDeath') ?? false;
    return !own && !(target.copiedEcho?.length); // a Gravetwin's COPIED Echo counts
  },
  // Tribes Choice fetches "a minion of the target's type" — a NEUTRAL body has no type to fetch.
  spellGainOfTargetTribe: (s, _d, _p, target) => {
    if (!target) return false;
    const def = CARD_INDEX[target.cardId];
    const tribe = def?.tribe;
    if (!tribe || tribe === 'neutral') return true;
    return !poolOf(s).buyable.some((c) => c.tier <= s.tier && (c.tribe === tribe || c.tribe2 === tribe));
  },
  // DELIBERATELY ABSENT: Feed the Alpha / Fodder Treatment. With no recipient they still SELL the target and
  // pay its Gold — so they are a bad play, not an impossible one, and an existing ruling pins that ("Fodder
  // Treatment with no Demon still sells the minion (+Gold); the stats are wasted"). The rule here is
  // "unusable", not "unwise".
};

/**
 * Would casting `def` (optionally on `target`) accomplish nothing at all?
 *
 * Multi-effect spells are treated conservatively: the spell only fizzles when EVERY effect that has a rule is
 * a no-op AND no effect is unrecognised. An unknown effect might do something, so an unknown effect means the
 * cast goes ahead — the failure mode of a missing rule is the status quo, never a wrongly-refused cast.
 */
export function spellFizzles(state: RunState, def: CardDef, target?: BoardCard): boolean {
  if (!def.spell || def.effects.length === 0) return false;
  let sawRule = false;
  for (const e of def.effects) {
    const rule = NO_OP[e.do];
    if (!rule) return false; // an effect with no rule might still do something → allow the cast
    sawRule = true;
    if (!rule(state, def, e.params ?? {}, target)) return false; // this half would do something → allow
  }
  return sawRule;
}
