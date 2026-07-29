import type { MomentKind } from './kinds';
import rawBindings from './bindings.json';

/**
 * WHICH authored FX def plays at a moment — the single answer to that question, for the cue runner, the FX
 * library browser, and the workbench's commit path.
 *
 * It used to be two answers: a `def` literal on an `fxDef` cue in `score.ts` (keyed by moment kind) and the
 * frozen `CARD_FX` table in `cardFx.ts` (keyed by card, then kind). Two shapes, two resolution orders, no
 * override layer on either — so retargeting a card's effect meant editing TypeScript, and the two could
 * disagree about what would play.
 *
 * WHAT plays lives here; WHEN it plays stays on the cue in `score.ts` (`at`/`offset`/`scaled`/`enabled`).
 * That split is deliberate: it keeps this file small enough to review as a diff and keeps timing next to the
 * scheduling code that consumes it.
 *
 * `bindings.json` is a STATIC import, which is what makes the obvious failure mode impossible: a missing or
 * syntactically invalid file is a build error, not a runtime silent-nothing. The only failure left is
 * "parseable but structurally wrong", which `parseTable` handles loudly and per-entry below.
 */

export interface FxBinding {
  /** The def id to play — a file stem under `packages/ui/src/fx/defs/`. */
  def: string;
  /**
   * Which anchor pairs the def plays at. Merges what used to be two separate unions (`Cue.fanOut` and
   * `CardFxBinding.fanOut`) that asked the same question.
   *
   * - `primary` (default): once, at the moment's own source→target pair.
   * - `damaged`: once per distinct unit damaged in the same resolution step. A cast's own event frequently
   *   carries NO target (Bloodbinder emits one targetless `sc`, then a `dmg` per marked enemy), so a
   *   travelling effect bound to it would have nowhere to go and would collapse onto the source.
   * - `selfBuffed`: once per unit that buffed ITSELF in this moment. A self-buff has no pair to travel
   *   between and a moment can carry several at once.
   */
  fanOut?: 'primary' | 'damaged' | 'selfBuffed';
}

const FAN_OUTS: readonly string[] = ['primary', 'damaged', 'selfBuffed'];

/**
 * A reserved def id for LIVE PREVIEWS. A binding to it applies in memory — that is what makes the authoring
 * draft visible on the real card — but it is stripped on the way to `localStorage` and on the way to
 * `bindings.json`, so it can never outlive the session that made it and can never be committed.
 *
 * Without that, the authoring loop writes a binding to a def that exists only in memory: a dangling
 * reference in a git-tracked file, which resolves to nothing and looks exactly like the tool being broken.
 * Reachable on the ordinary happy path, because writing bindings.json triggers a full reload and a React
 * cleanup does not run on unload. It was also reachable at commit time: `bindingsJson()` serialises the
 * WHOLE patch, and a global-scope commit writes the kind row without touching the card row the draft sits
 * on — so the draft went to disk beside it, shadowing the binding just committed for the card being tuned.
 *
 * Enforced HERE rather than in the workbench on purpose: a UI that tidies up before writing is correct only
 * for as long as every future caller remembers to, and neither of those two routes is one a reviewer would
 * think to check.
 *
 * NB: the workbench's draft stops being live the moment a commit succeeds — `commit` overwrites that patch
 * entry with the real def id and the bind effect's deps don't change, so it never re-binds the draft. In
 * practice the full reload follows immediately, but the coupling is real and undocumented elsewhere.
 */
export const DRAFT_DEF_ID = 'fx-draft';

/** Keys that must never be used as a table key: assigning to `__proto__` on a plain object invokes the
 *  inherited setter and rewrites the table's prototype, so a malformed entry would silently corrupt the table
 *  instead of being dropped like every other one. `constructor`/`prototype` are refused alongside it because
 *  the same class of confusion is not worth reasoning about per-call-site. */
const UNSAFE_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/** DEV-only: bindings.json is a static import, so unlike fxDefs.ts's DEV-gated glob, this module ships in the
 *  production bundle. A malformed entry that slipped past CI would otherwise log to every player's console on
 *  load — and there is nothing a production consumer could do about it anyway, since `canPlayDefs()` is false
 *  in production and authored defs never play there. Matches the gating pattern in `fxDefs.ts`. */
function devError(msg: string): void {
  if (import.meta.env.DEV) console.error(msg);
}

/** kind → binding, and card → kind → binding. Both sparse. */
export interface BindingTable {
  kinds: Partial<Record<MomentKind, FxBinding>>;
  cards: Record<string, Partial<Record<MomentKind, FxBinding>>>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** One binding, or null with `devError` naming `where`. Never throws: this is fed untrusted JSON. */
function coerceBinding(v: unknown, where: string): FxBinding | null {
  if (!isRecord(v)) {
    devError(`[fx] bindings.json: ${where} is not an object — dropped.`);
    return null;
  }
  if (typeof v.def !== 'string' || v.def === '') {
    devError(`[fx] bindings.json: ${where}.def must be a non-empty string — dropped.`);
    return null;
  }
  if (v.fanOut !== undefined && (typeof v.fanOut !== 'string' || !FAN_OUTS.includes(v.fanOut))) {
    devError(`[fx] bindings.json: ${where}.fanOut must be one of ${FAN_OUTS.join(', ')} — dropped.`);
    return null;
  }
  return v.fanOut === undefined ? { def: v.def } : { def: v.def, fanOut: v.fanOut as FxBinding['fanOut'] };
}

/**
 * Validate a raw table. LOUD PER ENTRY rather than all-or-nothing: a bad entry is dropped with the exact key
 * named, and every other entry still loads. Losing one binding should not cost the other thirteen — and a
 * binding that silently fails to load is indistinguishable from one nobody wired, which is the single most
 * expensive ambiguity in this subsystem.
 *
 * Exported for the tests, which are the only place a malformed table can be constructed on purpose.
 */
export function parseTable(raw: unknown): BindingTable {
  const out: BindingTable = { kinds: {}, cards: {} };
  if (!isRecord(raw)) {
    devError('[fx] bindings.json is not an object — no authored FX will be bound.');
    return out;
  }
  if (isRecord(raw.kinds)) {
    for (const [kind, v] of Object.entries(raw.kinds)) {
      if (UNSAFE_KEYS.includes(kind)) {
        devError(`[fx] bindings.json: kinds.${kind} is an unsafe key — dropped.`);
        continue;
      }
      const b = coerceBinding(v, `kinds.${kind}`);
      if (b) out.kinds[kind as MomentKind] = b;
    }
  } else {
    devError('[fx] bindings.json: `kinds` is missing or not an object.');
  }
  if (isRecord(raw.cards)) {
    for (const [cardId, byKind] of Object.entries(raw.cards)) {
      if (UNSAFE_KEYS.includes(cardId)) {
        devError(`[fx] bindings.json: cards.${cardId} is an unsafe key — dropped.`);
        continue;
      }
      if (!isRecord(byKind)) {
        devError(`[fx] bindings.json: cards.${cardId} is not an object — dropped.`);
        continue;
      }
      const table: Partial<Record<MomentKind, FxBinding>> = {};
      for (const [kind, v] of Object.entries(byKind)) {
        if (UNSAFE_KEYS.includes(kind)) {
          devError(`[fx] bindings.json: cards.${cardId}.${kind} is an unsafe key — dropped.`);
          continue;
        }
        const b = coerceBinding(v, `cards.${cardId}.${kind}`);
        if (b) table[kind as MomentKind] = b;
      }
      if (Object.keys(table).length > 0) out.cards[cardId] = table;
    }
  } else {
    devError('[fx] bindings.json: `cards` is missing or not an object.');
  }
  return out;
}

/** The committed baseline, validated once at module load. */
const COMMITTED: BindingTable = parseTable(rawBindings);

/**
 * Session overrides, layered over the file.
 *
 * Deliberately the same two-tier shape defs already have (session autosave vs. Save), so there is ONE mental
 * model for both: a change is live the instant you make it and survives a reload, and a separate explicit
 * commit writes the git-tracked file.
 *
 * `null` is a TOMBSTONE, not an absence. Against a file baseline an absent key means "inherit", so without an
 * explicit null there would be no way to express "this card plays nothing here" as a live change.
 */
type PatchTable = {
  kinds: Partial<Record<MomentKind, FxBinding | null>>;
  cards: Record<string, Partial<Record<MomentKind, FxBinding | null>>>;
};

const PATCH_KEY = 'ascent.fxBindings';

/**
 * Validate a raw patch blob the same way `parseTable` validates the file, plus preserving tombstones (an
 * explicit `null` survives as `null`; anything else that isn't a valid `FxBinding` is dropped as if absent,
 * never promoted to a tombstone). Reuses `UNSAFE_KEYS` for the same reason `parseTable` needs it: the blob
 * comes from `Object.entries` over `JSON.parse` output, which is the same untrusted-key surface — a
 * hand-edited `__proto__` key in localStorage must be dropped here exactly like it is for the file.
 */
function parsePatchTable(raw: unknown): PatchTable {
  const out: PatchTable = { kinds: {}, cards: {} };
  if (!isRecord(raw)) return out;
  if (isRecord(raw.kinds)) {
    for (const [kind, v] of Object.entries(raw.kinds)) {
      if (UNSAFE_KEYS.includes(kind)) continue;
      if (v === null) {
        out.kinds[kind as MomentKind] = null;
        continue;
      }
      const b = coerceBinding(v, `session patch: kinds.${kind}`);
      if (b) out.kinds[kind as MomentKind] = b;
    }
  }
  if (isRecord(raw.cards)) {
    for (const [cardId, byKind] of Object.entries(raw.cards)) {
      if (UNSAFE_KEYS.includes(cardId) || !isRecord(byKind)) continue;
      const table: Partial<Record<MomentKind, FxBinding | null>> = {};
      for (const [kind, v] of Object.entries(byKind)) {
        if (UNSAFE_KEYS.includes(kind)) continue;
        if (v === null) {
          table[kind as MomentKind] = null;
          continue;
        }
        const b = coerceBinding(v, `session patch: cards.${cardId}.${kind}`);
        if (b) table[kind as MomentKind] = b;
      }
      if (Object.keys(table).length > 0) out.cards[cardId] = table;
    }
  }
  return out;
}

/** The in-memory patch is the source of truth (this works with no localStorage at all); storage is
 *  persistence only, read once at module load. A corrupt blob degrades to no overrides. */
let patch: PatchTable = (() => {
  try {
    return parsePatchTable(JSON.parse(localStorage.getItem(PATCH_KEY) ?? '{}'));
  } catch {
    return { kinds: {}, cards: {} };
  }
})();

/**
 * The patch as it is allowed to PERSIST: every `DRAFT_DEF_ID` entry removed, and a card left with nothing
 * pruned entirely (the same tidy-up `clearBinding` does, for the same reason — an accumulating pile of empty
 * card objects). The in-memory `patch` is untouched: the preview has to keep working.
 */
function persistablePatch(): PatchTable {
  const out: PatchTable = { kinds: {}, cards: {} };
  for (const [kind, b] of Object.entries(patch.kinds)) {
    if (b?.def !== DRAFT_DEF_ID) out.kinds[kind as MomentKind] = b;
  }
  for (const [cardId, byKind] of Object.entries(patch.cards)) {
    const table: Partial<Record<MomentKind, FxBinding | null>> = {};
    for (const [kind, b] of Object.entries(byKind)) {
      if (b?.def !== DRAFT_DEF_ID) table[kind as MomentKind] = b;
    }
    if (Object.keys(table).length > 0) out.cards[cardId] = table;
  }
  return out;
}

function savePatch(): void {
  try {
    // A DRAFT never reaches storage — see `DRAFT_DEF_ID`. A React cleanup does not run on unload, and the
    // commit path RELOADS the page, so anything persisted here would come back next session pointing at a
    // def that no longer exists and silence that card at that moment forever.
    localStorage.setItem(PATCH_KEY, JSON.stringify(persistablePatch()));
  } catch {
    /* ignore — the in-memory patch still works */
  }
}

/**
 * Bind (or, with `null`, explicitly unbind) a def.
 *
 * Takes the SAME `(cardId, kind)` key `bindingFor` reads, so the write and the read cannot disagree about
 * what a scope is: `cardId === null` addresses the kind layer, a string addresses that card's layer.
 */
export function setBinding(cardId: string | null, kind: MomentKind, binding: FxBinding | null): void {
  if (cardId === null) patch = { ...patch, kinds: { ...patch.kinds, [kind]: binding } };
  else patch = { ...patch, cards: { ...patch.cards, [cardId]: { ...patch.cards[cardId], [kind]: binding } } };
  savePatch();
}

/**
 * Drop a session override so the committed file applies again.
 *
 * NOT the same as `setBinding(cardId, kind, null)`. That writes a TOMBSTONE — an explicit "this plays
 * nothing here" that stops resolution falling through to the file. This removes the entry entirely, which
 * is what tearing down a preview needs: the author's draft should leave no trace, and the card should go
 * back to whatever it played before, not go silent.
 */
export function clearBinding(cardId: string | null, kind: MomentKind): void {
  if (cardId === null) {
    const kinds = { ...patch.kinds };
    delete kinds[kind];
    patch = { ...patch, kinds };
  } else {
    const byKind = { ...patch.cards[cardId] };
    delete byKind[kind];
    const cards = { ...patch.cards };
    // Drop the card entirely once it has no overrides left, so the persisted patch doesn't accumulate
    // empty objects across a long session.
    if (Object.keys(byKind).length > 0) cards[cardId] = byKind;
    else delete cards[cardId];
    patch = { ...patch, cards };
  }
  savePatch();
}

/** Drop every session override, back to the committed file. */
export function resetBindings(): void {
  patch = { kinds: {}, cards: {} };
  try {
    localStorage.removeItem(PATCH_KEY);
  } catch {
    /* ignore */
  }
}

/** A copy deep enough that NOTHING returned from `effectiveTables()` shares a mutable object with the
 *  module's own tables — every leaf `FxBinding` is spread too, not just the outer kind/card maps, so a caller
 *  that edits a returned binding's `def` in place (an editor UI does exactly this) cannot corrupt `COMMITTED`. */
function cloneTable(t: BindingTable): BindingTable {
  const kinds: BindingTable['kinds'] = {};
  for (const [kind, b] of Object.entries(t.kinds)) kinds[kind as MomentKind] = { ...b };
  const cards: BindingTable['cards'] = {};
  for (const [id, byKind] of Object.entries(t.cards)) {
    const table: Partial<Record<MomentKind, FxBinding>> = {};
    for (const [kind, b] of Object.entries(byKind)) if (b) table[kind as MomentKind] = { ...b };
    cards[id] = table;
  }
  return { kinds, cards };
}

/**
 * The binding for a card at a kind, or null.
 *
 * Card layer first — the kind is the right key for "a Ward was gained", but every spell cast shares `scCast`,
 * so a card with its own look needs the narrower key. A `cardId` of null (no unit on screen, or the moment's
 * source is unknown) skips straight to the kind layer.
 */
export function bindingFor(cardId: string | null, kind: MomentKind): FxBinding | null {
  if (cardId !== null) {
    // `undefined` means "no opinion, keep looking"; an explicit `null` is a tombstone that STOPS here —
    // falling through to the kind layer would make "play nothing" impossible to express.
    const overridden = patch.cards[cardId]?.[kind];
    if (overridden !== undefined) return overridden;
    const fromFile = COMMITTED.cards[cardId]?.[kind];
    if (fromFile !== undefined) return fromFile;
  }
  const overriddenKind = patch.kinds[kind];
  if (overriddenKind !== undefined) return overriddenKind;
  return COMMITTED.kinds[kind] ?? null;
}

/**
 * What would play at `(cardId, kind)` if the live preview draft weren't in the way.
 *
 * The same resolution order as `bindingFor`, with a `DRAFT_DEF_ID` entry treated as "no opinion" so lookup
 * falls through to whatever is underneath it.
 *
 * The workbench's fanOut prefill asks exactly this question — "what is already working here" — and
 * `bindingFor` stops being able to answer it the moment the draft is bound, because the draft IS the card's
 * binding by then and carries whatever fanOut the prefill itself last produced. Reading that back would make
 * the value self-perpetuating: switching scope card → global → card would return the global-derived value
 * instead of restoring the card's own.
 */
export function bindingBeneathDraft(cardId: string | null, kind: MomentKind): FxBinding | null {
  const notDraft = (b: FxBinding | null | undefined): boolean => b === undefined || b?.def !== DRAFT_DEF_ID;
  if (cardId !== null) {
    // A tombstone (`null`) still STOPS here, exactly as in `bindingFor` — only the draft is see-through.
    const overridden = patch.cards[cardId]?.[kind];
    if (overridden !== undefined && notDraft(overridden)) return overridden;
    const fromFile = COMMITTED.cards[cardId]?.[kind];
    if (fromFile !== undefined) return fromFile;
  }
  const overriddenKind = patch.kinds[kind];
  if (overriddenKind !== undefined && notDraft(overriddenKind)) return overriddenKind;
  return COMMITTED.kinds[kind] ?? null;
}

/**
 * `COMMITTED` with an arbitrary patch layered over it, tombstones REMOVED.
 *
 * Parameterised by the patch on purpose: WHICH overlay gets merged is the whole difference between the live
 * view and the committable one, and doing that as a choice of overlay is the only correct place to make it.
 * Filtering after a merge cannot work — an overlay entry OVERWRITES the row beneath it, so removing the
 * merged result deletes the committed value rather than falling back to it.
 */
function mergedTable(overlay: PatchTable): BindingTable {
  const out = cloneTable(COMMITTED);
  for (const [kind, b] of Object.entries(overlay.kinds)) {
    if (b) out.kinds[kind as MomentKind] = b;
    else delete out.kinds[kind as MomentKind];
  }
  for (const [cardId, byKind] of Object.entries(overlay.cards)) {
    const table = { ...out.cards[cardId] };
    for (const [kind, b] of Object.entries(byKind)) {
      if (b) table[kind as MomentKind] = b;
      else delete table[kind as MomentKind];
    }
    if (Object.keys(table).length > 0) out.cards[cardId] = table;
    else delete out.cards[cardId];
  }
  return out;
}

/**
 * The whole effective table: the file with the session patch applied and tombstones REMOVED. This is what
 * the library browser enumerates and what `commitPlan` computes its blast radius against — in both cases
 * "unbound" is expressed by absence, so tombstones (which only exist to stop resolution falling through)
 * have done their job by here.
 *
 * Deliberately the LIVE view, drafts included: both callers are showing the author what is playing right
 * now. `bindingsJson` is the one that must not see drafts, and it says so by merging a different overlay.
 */
export function effectiveTables(): BindingTable {
  return mergedTable(patch);
}

/**
 * The merged file + patch as the exact text to write to `bindings.json`.
 *
 * Keys are sorted so a commit produces a minimal, readable diff rather than reordering the whole file
 * whenever an object's insertion order happens to change.
 *
 * Merges `persistablePatch()` — the session overlay with every `DRAFT_DEF_ID` entry REMOVED — rather than
 * the live one, so a draft is never in the overlay in the first place. This is the second of the two routes
 * a draft could reach disk, and the one the commit button walks: a global-scope commit writes the kind row
 * and leaves the card row the draft sits on alone, so a live-view serialisation would put a binding to a
 * memory-only def in the file, shadowing the kind binding just committed for that very card.
 *
 * Stripping the draft AFTER the merge instead is a data-loss bug, not a stylistic difference: the draft
 * overwrote the committed row, so removing the merged entry deletes the committed value underneath and the
 * empty-card prune then deletes the card outright. Tuning Bloodbinder and committing "Everywhere" wrote a
 * file with Bloodbinder's own `ruby-lance` binding silently gone — reported success, no `fx-draft` in the
 * file, and only visible sessions later. Overlay choice, never post-filtering.
 */
export function bindingsJson(): string {
  const t = mergedTable(persistablePatch());
  const kinds: Record<string, FxBinding> = {};
  for (const kind of Object.keys(t.kinds).sort()) kinds[kind] = t.kinds[kind as MomentKind] as FxBinding;
  const cards: Record<string, Record<string, FxBinding>> = {};
  for (const cardId of Object.keys(t.cards).sort()) {
    const byKind = t.cards[cardId] ?? {};
    const inner: Record<string, FxBinding> = {};
    for (const kind of Object.keys(byKind).sort()) inner[kind] = byKind[kind as MomentKind] as FxBinding;
    cards[cardId] = inner;
  }
  return `${JSON.stringify({ version: 1, kinds, cards }, null, 2)}\n`;
}
