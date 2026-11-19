import { CARD_INDEX } from '@game/content';
import { getDef } from '../fx/fxDefs';
import { bindingAt, bindingFor, type BindingKind, type FxBinding } from './bindings';

/**
 * THE STOCK TRIGGER EFFECTS (R-FX-TRIGGER-STOCK-01, owner 2026-11-19: "i want to start creating effects to replace
 * [the medallion pulse]" / "yes, wire them and tell me what i should save each as in the workbench").
 *
 * Six triggers still showed only the medallion's trigger pulse. Each has ONE stock effect, found BY NAME: the def
 * with the id below is the effect every card of that trigger plays, with no binding step. A card's own
 * binding at the same kind (the By-card slot) outranks the stock one, and a card tombstone ("plays nothing here")
 * silences both. A stock def that has not been saved yet resolves to nothing, so the pulse stays as the fallback.
 *
 * By name rather than a `bindings.json` kind row because a kind row is read by every `bindingFor` caller, and
 * several of those ask a NARROWER question than "does this trigger have an effect": `bindingFor(card, 'watcher')`
 * also decides the Beast bite, the Ale watcher and the epic-fire cue, and `ownRallyBindingFor` is asked about every
 * attacker, Rally or not. A global row would have switched all of those on for every card in the game.
 */
export const STOCK_TRIGGER_DEFS = {
  // Owner 2026-11-19: "i just created and saved "medallion" - use that as the effect for start of combat, avenge,
  // end of turn, and rally. lets ignore the others for now". One def, four triggers.
  startOfCombat: 'medallion',
  avenge: 'medallion',
  endOfTurn: 'medallion',
  rally: 'medallion',
  // Not authored yet: these resolve to nothing until a def is saved under the name, so both still pulse.
  echo: 'echo-stock',
  watcher: 'watcher-stock',
} as const;

export type StockTriggerKind = keyof typeof STOCK_TRIGGER_DEFS;

const isStockKind = (kind: BindingKind): kind is StockTriggerKind => kind in STOCK_TRIGGER_DEFS;

/** Does this card carry an Echo of its own (an `onDeath` effect)? The gate on the `echo` slot. */
export function cardHasEcho(cardId: string | null | undefined): boolean {
  return !!cardId && !!CARD_INDEX[cardId]?.effects.some((e) => e.on === 'onDeath');
}

/** The stock Rally belongs to a card that RALLIES. `ownRallyBindingFor` is asked about every attacker, so without
 *  this gate the stock effect would play on every swing in the fight. */
const cardRallies = (cardId: string): boolean => !!(CARD_INDEX[cardId]?.keywords as readonly string[] | undefined)?.includes('RL');

/**
 * The effect a card's TRIGGER plays: its own binding at `kind`, else the stock effect for that trigger when one has
 * been saved. For a kind with no stock effect this is exactly `bindingFor`. `defExists` is injected for tests.
 */
export function triggerFxFor(
  cardId: string | null,
  kind: BindingKind,
  defExists: (id: string) => boolean = (id) => getDef(id) !== undefined,
): FxBinding | null {
  const own = bindingFor(cardId, kind);
  if (own) return own;
  if (cardId === null || !isStockKind(kind)) return null;
  if (bindingAt(cardId, kind)?.binding === null) return null; // the card says "play nothing here"
  if (kind === 'rally' && !cardRallies(cardId)) return null;
  const def = STOCK_TRIGGER_DEFS[kind];
  return defExists(def) ? { def } : null;
}
