import type { Action } from '../state';

/**
 * EVERY reducer action, and what the bot does with it.
 *
 * `satisfies Record<Action['type'], ActionDescriptor>` is the whole point: adding an action to the reducer
 * without deciding its bot treatment fails COMPILATION here. Without that, a new action is simply never
 * generated, the bot quietly never uses it, and nothing tells you — the failure mode is a bot that plays a
 * slightly older version of the game forever.
 */
export interface ActionDescriptor {
  /** How candidates for this action are produced. */
  generation:
    | 'recruit'      // an ordinary shop-phase choice the search may expand
    | 'mandatory'    // only legal while the run is blocked on it; answered before anything else
    | 'terminal'     // ends the shop phase — expanded only after final positioning
    | 'automatic'    // the controller drives it; never a strategic candidate
    | 'never';       // out of scope for a bot (dev tooling)
  /** True when taking it hands the bot information it does not already hold. Search must stop and score with an
   *  expectation model rather than expanding the seeded result. */
  reveal: boolean;
  /** Why, in one line — this doubles as the reviewer's checklist when a new action is added. */
  note: string;
}

export const ACTION_CATALOG = {
  buy: { generation: 'recruit', reveal: false, note: 'affordable offers with board/hand room' },
  sell: { generation: 'recruit', reveal: false, note: 'board minions; frees gold and a slot' },
  play: { generation: 'recruit', reveal: false, note: 'hand cards at strategically distinct indices/targets' },
  roll: { generation: 'recruit', reveal: true, note: 'draws a shop the bot has not seen' },
  freeze: { generation: 'recruit', reveal: false, note: 'toggle; only when the kept/unkept state has value' },
  upgrade: { generation: 'recruit', reveal: false, note: 'tavern tier when affordable' },
  reposition: { generation: 'recruit', reveal: false, note: 'board order; final-arrangement only' },
  heroPower: { generation: 'recruit', reveal: false, note: 'every legal activation and target' },
  reorderHand: { generation: 'recruit', reveal: false, note: 'only when an effect reads hand position (Re-Pete)' },
  // Shop order is COSMETIC: the one effect that reads it (Market Tormentor) stamps at refresh, and the owner
  // ruled that moving cards afterwards does not change the buff. Generating these would be pure search waste.
  reorderShop: { generation: 'never', reveal: false, note: 'shop position is cosmetic — nothing reads it live' },
  discover: { generation: 'mandatory', reveal: false, note: 'options are already visible; the PICK is not a reveal' },
  chooseOne: { generation: 'mandatory', reveal: false, note: 'both modes are printed on the card' },
  // Backing out of a Choose One is a pure no-op (the card returns to hand untouched), so it can never improve
  // a line — generating it would only widen the search with a branch that returns to where it started. A bot
  // answers the prompt instead; the action exists for the player and for recordings.
  cancelChoice: { generation: 'never', reveal: false, note: 'abandoning a Choose One returns to the same state — never worth searching' },
  battlecryTarget: { generation: 'mandatory', reveal: false, note: 'legal targets are all on the board' },
  buyQuest: { generation: 'mandatory', reveal: true, note: 'the reward can generate cards the bot has not seen' },
  pickPower: { generation: 'mandatory', reveal: false, note: 'adopting a hero power changes rules, not cards — nothing hidden is revealed' },
  buyHenchman: { generation: 'recruit', reveal: false, note: 'a known hero-bound minion at a known decayed cost' },
  buyRune: { generation: 'mandatory', reveal: true, note: 'forging can grant randomly and re-opens the offer' },
  skipRuneforge: { generation: 'mandatory', reveal: false, note: 'declining is deterministic' },
  rerollRuneforge: { generation: 'mandatory', reveal: true, note: 'draws runes the bot has not seen' },
  closeScout: { generation: 'mandatory', reveal: false, note: 'dismissal after the intel is already stored' },
  faceOmen: { generation: 'terminal', reveal: false, note: 'ends the turn — only after final arrangement' },
  settleCombat: { generation: 'automatic', reveal: false, note: 'controller transition, never a strategic choice' },
  combatEscalationPreview: { generation: 'never', reveal: false, note: 'display-only replay bookkeeping — not a choice' },
  combatSpellCastPreview: { generation: 'never', reveal: false, note: 'display-only replay bookkeeping — not a choice' },
  combatFriendlyDeathPreview: { generation: 'never', reveal: false, note: 'display-only replay bookkeeping — not a choice' },
  combatBladeAttackPreview: { generation: 'never', reveal: false, note: 'display-only replay bookkeeping — not a choice' },
  resolveCombat: { generation: 'automatic', reveal: false, note: 'controller transition, never a strategic choice' },
  // The shop's two-step death: the landing is on screen, this ends it. A bot never needs to dispatch it —
  // every other action settles the same pending death first, so the outcome is identical either way.
  resolveShopDeath: { generation: 'automatic', reveal: false, note: 'settles a landed body that is dying; implicit in every other action' },
  // EQUIPMENT (owner handoff 2026-08-28). Not generated yet: the bot has no Equipment policy, and inventing
  // one before the mechanic is proven would bury real Equipment bugs under bot noise. `never` rather than
  // `automatic` because a bot COULD meaningfully choose these once it knows how to value them.
  selectEquipment: { generation: 'never', reveal: false, note: 'free swap of the shown Equipment; no bot policy yet' },
  activateEquipment: { generation: 'never', reveal: false, note: 'spends Gold + the shared allowance; no bot policy yet' },
  devGrant: { generation: 'never', reveal: false, note: 'development tooling — not available to a bot' },
} satisfies Record<Action['type'], ActionDescriptor>;

export type CatalogedAction = keyof typeof ACTION_CATALOG;

export const descriptorFor = (type: Action['type']): ActionDescriptor => ACTION_CATALOG[type];

/** Action types the search may expand during a shop phase. */
export const RECRUIT_ACTIONS = (Object.keys(ACTION_CATALOG) as CatalogedAction[])
  .filter((k) => ACTION_CATALOG[k].generation === 'recruit');
