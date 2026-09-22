import { CARD_INDEX } from '@game/content';
import type { BindingKind } from '../../choreo/bindings';
import type { FxCardRow } from './catalogView';

/** True when the card carries keyword `kw` (e.g. `'RL'` = Rally). Keywords are a typed enum; compare as strings. */
const hasKeyword = (card: FxCardRow, kw: string): boolean =>
  (CARD_INDEX[card.cardId]?.keywords as readonly string[] | undefined)?.includes(kw) ?? false;

/** True when the card has an effect triggered by `on` (e.g. `'onAttack'`, `'startOfCombat'`). */
const hasEffectOn = (card: FxCardRow, on: string): boolean =>
  CARD_INDEX[card.cardId]?.effects?.some((e) => e.on === on) ?? false;

/** True when the card OFFERS a Choose One (a `chooseOne` branch array), minion or spell. */
const hasChooseOne = (card: FxCardRow): boolean => (CARD_INDEX[card.cardId]?.chooseOne?.length ?? 0) > 0;

/**
 * The BINDABLE CARD EVENTS the "By card" library lens exposes — one assignable effect/sound slot per event.
 *
 * This registry is the extension point (owner ask 2026-09-21: "be sure we can add other potential effects
 * other than just 'played from hand' in the future"). Today it holds a single slot, "Played". Adding a new
 * card event later — a death cue, a sold cue, an on-buff cue — is one entry here plus its runtime trigger:
 * every card row in the lens then auto-renders the new slot, and the assign/clear plumbing is unchanged.
 *
 * A slot maps to a `BindingKind` PER CARD, because the same author-facing event can ride different internal
 * kinds by card type — "Played" is `minionPlayed` for a minion but `spellCast` for a spell. `kindFor` returns
 * `null` when the event does not apply to that card, and the row simply omits the slot.
 */
export interface CardEventSlot {
  /** Stable id for React keys and future config. */
  id: string;
  /** The author-facing event name shown on the row. */
  label: string;
  /** One line explaining when it fires (the slot's `title`). */
  blurb: string;
  /** The binding kind this event uses for the given card, or `null` when it does not apply. */
  kindFor(card: FxCardRow): BindingKind | null;
}

export const CARD_EVENT_SLOTS: readonly CardEventSlot[] = [
  {
    id: 'played',
    label: 'On Play',
    blurb: 'Plays when you play this card from hand — a minion summoned to the board, or a spell cast.',
    // A minion played from hand rides the `minionPlayed` cue; a spell cast rides the existing `spellCast` cue.
    kindFor: (card) => (card.spell ? 'spellCast' : 'minionPlayed'),
  },
  {
    id: 'died',
    label: 'On Death',
    blurb: 'Plays when this minion dies in combat, layered over the general death sound. Minions only — spells do not die.',
    // Only minions die; a spell has no death moment, so the slot is omitted for spells (kindFor → null).
    kindFor: (card) => (card.spell ? null : 'death'),
  },
  // ── Card-SPECIFIC mechanics: a row appears only when the card actually has the mechanic. Each maps to the
  //    combat MomentKind the mechanic produces, and the combat SCORE already fires `bindingFor(cardId, kind)`
  //    for it (fxDef / rallyFx), so no per-mechanic wiring is needed — just the derivation below. ─────────────
  {
    id: 'rally',
    label: 'On Rally',
    blurb: 'Plays each time this minion’s Rally fires in combat (when it attacks). Rally minions only.',
    // The Rally keyword is `'RL'` (e.g. Packstrider). Its combat proc is the `rally` moment, played by the
    // score’s `rallyFx` channel per Rally event, keyed by the rallier’s card.
    kindFor: (card) => (hasKeyword(card, 'RL') ? 'rally' : null),
  },
  {
    id: 'watcher',
    label: 'On Watcher',
    blurb: 'Plays when this minion reacts to a FRIENDLY attacking (a Watcher, e.g. Raptor). Fires on the reacting card.',
    // A Watcher answers ANOTHER unit’s attack: an `onAttack` effect WITHOUT the Rally keyword (`RL` = fires on
    // its OWN attack). The combat `watcher-pulse` detection (`useCombatReplay`) fires `bindingFor(cardId,
    // 'watcher')` on each reacting unit, so the row is keyed to that.
    kindFor: (card) => (!card.spell && hasEffectOn(card, 'onAttack') && !hasKeyword(card, 'RL') ? 'watcher' : null),
  },
  {
    id: 'startOfCombat',
    label: 'On Start of Combat',
    blurb: 'Plays when this minion’s Start of Combat effect fires, at the start of a fight. Start-of-Combat minions only.',
    // A `startOfCombat` effect. The combat score’s `startOfCombatFx` channel scans the fight for this card’s
    // Start-of-Combat events and plays `bindingFor(cardId, 'startOfCombat')` on it, whatever the effect does.
    kindFor: (card) => (hasEffectOn(card, 'startOfCombat') ? 'startOfCombat' : null),
  },
  {
    id: 'endOfTurn',
    label: 'On End of Turn',
    blurb: 'Plays when this minion’s End of Turn effect fires in the shop. End-of-Turn minions only.',
    // An `endOfTurn` effect. Fired in the recruit phase from the End-of-Turn beat player, keyed by this card
    // (see `endOfTurnMoment`). It is the TRIGGER flourish; a buff it hands other minions rides its own cue.
    kindFor: (card) => (hasEffectOn(card, 'endOfTurn') ? 'endOfTurn' : null),
  },
  {
    id: 'avenge',
    label: 'On Avenge',
    blurb: 'Plays when this minion’s Avenge triggers in combat — only when it completes (Avenge 3 fires on the 3rd friendly death). Avenge minions only.',
    // An `avenge` effect. The combat score’s `avengeFx` channel scans for this card’s Avenge payoff events —
    // which the simulator emits only when the Avenge count is met — and plays `bindingFor(cardId, 'avenge')`.
    kindFor: (card) => (hasEffectOn(card, 'avenge') ? 'avenge' : null),
  },
  {
    id: 'chooseOne',
    label: 'On Choose One',
    blurb: 'Plays when you pick a branch of this Choose One card. Choose One cards only.',
    // A `chooseOne` card. Fired in the recruit phase as the branch is picked, keyed by this card (see
    // `chooseOneMoment`). Distinct from On Play, which also fires as the card lands.
    kindFor: (card) => (hasChooseOne(card) ? 'chooseOne' : null),
  },
];
