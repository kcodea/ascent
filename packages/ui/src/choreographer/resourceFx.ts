/**
 * END OF TURN ECONOMY FX (owner 2026-10-02, R-EOT-ECON-01): "make sure when we have end of turn things that they have
 * beats ... use the self buff burst fx on the shop tier button when this effect triggers".
 *
 * A `resourceChanged` consequence names WHICH Shop number moved; this table names the HUD control that number lives
 * on and the authored def that plays there when the beat lands. One table, so the presenter, its test and any future
 * surface agree on the target. The def is used as-is (`fx/defs/self-buff-burst.json`), never a copy.
 *
 *   upgradeCost  → the Tier (Tavern Up) stone: Rune of Shopkeep, Tradesman × Ancient of Time, any future cut.
 *   freeRefresh  → the Refresh crystal: a free Refresh banked at End of Turn.
 *   nextTurnGold → the Gold pill: Gold banked for next turn (Xerox × Fortune, a card's End-of-Turn bank).
 *   maxGold      → the Gold pill: Rune of the Coffers, Robin × Ancient of Time.
 *   gold         → the Gold pill.
 */
export const RESOURCE_FX_DEF = 'self-buff-burst';

export const RESOURCE_FX_TARGET: Readonly<Record<string, string>> = {
  upgradeCost: '.tvbwrap',
  freeRefresh: '.rfbwrap',
  nextTurnGold: '.goldpill',
  maxGold: '.goldpill',
  gold: '.goldpill',
};

/** The def + the HUD selector a resource change plays on, or null when it has no HUD home (or did not move). */
export function resourceFxFor(resource: string, amount: number): { def: string; selector: string } | null {
  if (amount === 0) return null;
  const selector = RESOURCE_FX_TARGET[resource];
  return selector ? { def: RESOURCE_FX_DEF, selector } : null;
}
