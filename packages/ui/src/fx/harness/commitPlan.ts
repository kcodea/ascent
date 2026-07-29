import { DRAFT_DEF_ID, type BindingTable, type FxBinding } from '../../choreo/bindings';
import type { MomentKind } from '../../choreo/kinds';

/**
 * What a "commit animation" would write — decided as pure data, before anything is written.
 *
 * Every decision lives here so every decision is testable: this repo has no jsdom, so anything left in the
 * panel is untestable by construction. The blast radius especially — "which other cards inherit this
 * change" is not a question to answer by eye, and getting it wrong means silently restyling effects the
 * author never looked at.
 */

/** The write endpoint enforces `^[a-z0-9][a-z0-9-]{0,63}$`; a forked id is truncated to fit. */
export const MAX_SLUG = 64;

/** One place a binding lives: a kind row (`cardId: null`) or a card's row. */
export interface CommitRef {
  cardId: string | null;
  kind: MomentKind;
}

export interface CommitInput {
  scope: 'card' | 'global';
  /** The editor's name field, slugified. The def id for a global commit; the fork's stem for a card one. */
  baseId: string;
  cardId: string;
  kind: MomentKind;
  fanOut: FxBinding['fanOut'];
  /** Ids already in the registry — decides `overwritesExisting`. */
  knownDefIds: readonly string[];
  /** The live tables (`effectiveTables()`), for the blast radius. */
  tables: BindingTable;
}

export interface CommitPlan {
  scope: 'card' | 'global';
  /** What gets written: the forked id under card scope, `baseId` under global. */
  defId: string;
  /** The def this forked from, or null for a plain write. */
  forkedFrom: string | null;
  /** True when `defId` already exists — a re-tune, not a new def. */
  overwritesExisting: boolean;
  binding: FxBinding;
  bindingTarget: CommitRef;
  /** Every OTHER place `defId` is referenced. Empty for a fresh fork — which is the point of forking. */
  alsoAffects: CommitRef[];
  /**
   * Why this plan must not be executed, or null when it may be. Rendered by the panel, which also disables
   * the button on it — a plan that cannot be written is still worth SHOWING, so the author can see which id
   * the name produced and why it was refused.
   */
  blocked: string | null;
}

/**
 * `DRAFT_DEF_ID` is reserved and cannot be committed, refused HERE rather than only stripped downstream.
 *
 * `slugify('Fx Draft')` is `fx-draft`, and nothing in the slug rules, the write endpoint or the binding
 * layer objects to it — so without this the commit writes a real `fx-draft.json`, `bindingsJson()` silently
 * drops the binding to it, and `listDefs()` hides the file forever: a def on disk that the library cannot
 * show and nothing plays, reported to the author as a success. The invariant is "this id cannot persist";
 * the honest expression of that is a refusal at the door, not a strip the author never sees.
 */
function blockedReason(defId: string): string | null {
  return defId === DRAFT_DEF_ID
    ? `'${DRAFT_DEF_ID}' is reserved for the live preview — give the effect a different name.`
    : null;
}

/**
 * `<base>-<card>`, truncated to the slug limit.
 *
 * Truncating here rather than letting the endpoint reject it means an over-long pair becomes a predictable
 * id, shown in the panel before the author presses anything, instead of a 400 afterwards.
 */
export function forkId(baseId: string, cardId: string): string {
  return `${baseId}-${cardId}`.slice(0, MAX_SLUG);
}

/** Every binding row pointing at `defId`, kind rows first then card rows. */
export function referencesTo(tables: BindingTable, defId: string): CommitRef[] {
  const out: CommitRef[] = [];
  for (const [kind, b] of Object.entries(tables.kinds)) {
    if (b?.def === defId) out.push({ cardId: null, kind: kind as MomentKind });
  }
  for (const [cardId, byKind] of Object.entries(tables.cards)) {
    for (const [kind, b] of Object.entries(byKind)) {
      if (b?.def === defId) out.push({ cardId, kind: kind as MomentKind });
    }
  }
  return out;
}

export function planCommit(input: CommitInput): CommitPlan {
  const card = input.scope === 'card';
  const defId = card ? forkId(input.baseId, input.cardId) : input.baseId;
  const bindingTarget: CommitRef = { cardId: card ? input.cardId : null, kind: input.kind };
  // `primary` is the default, so it serialises as an ABSENT key — matching every non-fanning entry already
  // in bindings.json rather than making the committed file noisier than the ones beside it.
  const binding: FxBinding =
    input.fanOut === undefined || input.fanOut === 'primary' ? { def: defId } : { def: defId, fanOut: input.fanOut };
  return {
    scope: input.scope,
    defId,
    forkedFrom: card ? input.baseId : null,
    overwritesExisting: input.knownDefIds.includes(defId),
    binding,
    bindingTarget,
    // The row being written is excluded: "also affects" has to mean OTHER places, or the count would
    // always be at least one and would tell the author nothing.
    alsoAffects: referencesTo(input.tables, defId).filter(
      (r) => !(r.cardId === bindingTarget.cardId && r.kind === bindingTarget.kind),
    ),
    blocked: blockedReason(defId),
  };
}
