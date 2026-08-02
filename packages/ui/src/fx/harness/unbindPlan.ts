import type { BindingEntry, FxBinding, FxRow, UnbindOp } from '../../choreo/bindings';
import type { MomentKind } from '../../choreo/kinds';
import type { CommitRef } from './commitPlan';

/**
 * What removing a binding would do — decided as pure data, before anything is written.
 *
 * The commit side has `planCommit` for the same reason: this repo has no jsdom, so anything decided inside
 * the panel cannot be tested at all. Here the stakes are higher than layout, because the two ways to remove
 * a binding produce OPPOSITE outcomes on a card row and neither is obviously the "normal" one:
 *
 * - `clear` deletes the row, so resolution falls through to the kind default and the card plays THAT.
 * - `tombstone` writes an explicit `null`, so resolution stops and the card plays NOTHING.
 *
 * A single "Remove" button would silently pick one of those. That is precisely the ambiguity that made the
 * word "unbound" meaningless in the library — one label covering three different truths — so the panel says
 * which outcome each button produces, in the sentence next to the button, computed from the real tables
 * rather than described in general terms.
 *
 * Where the two collapse (a kind row has no layer beneath it, and a card row whose kind has no default has
 * nothing to fall back TO) there is one option. The rule is uniform and derived, not special-cased per
 * scope: offer the choice exactly when removing the row leaves something behind.
 */

export interface UnbindOption {
  op: UnbindOp;
  /** The button's label. */
  label: string;
  /** What happens if it is pressed, in the panel's own words. Always concrete. */
  consequence: string;
}

export interface UnbindPlan {
  /** The row being removed — the same `(cardId, kind)` key `setBinding`/`bindingAt` take. */
  target: CommitRef;
  /** The binding on that row, or null when the row is already an explicit "plays nothing". */
  current: FxBinding | null;
  /** Which layer it came from: the committed file, or an uncommitted session override. */
  source: BindingEntry['source'];
  /** What would play if the row were cleared — null when nothing would. The panel names ONE. */
  fallback: FxBinding | null;
  /** One or two ways to remove it, most conservative first. Never empty. */
  options: UnbindOption[];
}

export interface UnbindInput {
  cardId: string | null;
  kind: MomentKind;
  /** `bindingAt(cardId, kind)` — the row itself, `undefined` when there is no row to remove. */
  entry: BindingEntry | undefined;
  /** `bindingsWithout(cardId, kind)` — the row that resolves once this one is gone. */
  fallback: FxRow;
}

/** "nothing plays here" in the words that fit the row being removed. */
function silence(cardId: string | null, kind: MomentKind): string {
  return cardId === null
    ? `nothing plays at ${kind} — for any card without its own binding`
    : `nothing plays at ${kind} for this card`;
}

/**
 * The plan, or `null` when there is no binding at this exact row.
 *
 * Returning null rather than a plan with an empty option list is what lets the panel render NOTHING here:
 * a permanently-present "Unbind" that does nothing most of the time is worse than no control, because it
 * implies a binding exists whenever the author has a card and moment selected.
 */
export function planUnbind(input: UnbindInput): UnbindPlan | null {
  const { cardId, kind, entry, fallback } = input;
  if (entry === undefined) return null;

  const target: CommitRef = { cardId, kind };
  const fallsBackTo = fallback[0]?.def ?? null;
  // The panel unbinds ONE def at a time; a row with several is addressed by its first entry, which is the one
  // the workbench is showing. Removing an entry leaves its neighbours alone (`clearBindingEntry`).
  const current = entry.bindings === null ? null : (entry.bindings[0] ?? null);

  // Already silenced. There is only one thing left to do — take the row out — and its outcome is whatever
  // lies beneath, which is exactly the `clear` consequence.
  if (current === null) {
    return {
      target,
      current: null,
      source: entry.source,
      fallback: fallback[0] ?? null,
      options: [
        {
          op: 'clear',
          label: 'Remove the silence',
          consequence: fallsBackTo === null ? silence(cardId, kind) : `${kind} plays ${fallsBackTo} again`,
        },
      ],
    };
  }

  // Nothing underneath: the two operations are the same silence, so offering both would ask the author to
  // choose between two identical outcomes — a choice that teaches them the distinction is cosmetic.
  if (fallsBackTo === null) {
    return {
      target,
      current,
      source: entry.source,
      fallback: fallback[0] ?? null,
      options: [{ op: 'clear', label: 'Unbind', consequence: silence(cardId, kind) }],
    };
  }

  return {
    target,
    current,
    source: entry.source,
    fallback: fallback[0] ?? null,
    options: [
      { op: 'clear', label: 'Unbind', consequence: `${kind} falls back to ${fallsBackTo}` },
      { op: 'tombstone', label: 'Play nothing', consequence: silence(cardId, kind) },
    ],
  };
}
