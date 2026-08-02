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
   * - `rubied`: once per unit a RUBY landed on in this moment, staggered down the list. Rubies reach the log
   *   as ordinary `buff` events carrying the `ruby` flag, and one card routinely plays them across the whole
   *   board, so this both filters to Rubies and spreads them in time.
   */
  fanOut?: 'primary' | 'damaged' | 'selfBuffed' | 'rubied';
  /** Milliseconds between successive fires for a fan-out that plays on several units. Ignored by `primary`.
   *  Scaled by `combatSpeed` at play time like every other offset in the score. Defaults per fan-out. */
  stagger?: number;
}

const FAN_OUTS: readonly string[] = ['primary', 'damaged', 'selfBuffed', 'rubied'];

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

/** DEV-only: this module ships (bindings.json is a static import, and since the un-gate the defs it names ship
 *  too), so a malformed entry that slipped past CI would log to every player's console on load — and a player
 *  can do nothing about a bad binding. A dropped entry costs one missing effect, never a broken combat, so
 *  failing quietly for players and loudly for the author is the right split. `bindings.test.ts` is the real
 *  guard: it asserts every bound def id resolves in the registry. */
function devError(msg: string): void {
  if (import.meta.env.DEV) console.error(msg);
}

/**
 * kind → binding, and card → kind → binding. Both sparse. The "what plays" view: every leaf is a real
 * binding, because a row that plays nothing is expressed by ABSENCE here.
 */
/**
 * A ROW — every binding at one `(cardId | null, kind)` address, in play order.
 *
 * A list rather than a single binding because a moment kind is a shared address: `buffWave` is where the
 * self-buff cue lives AND where a Ruby landing surfaces, and with one slot the first arrival claimed it and
 * the second had to be hand-written as code (see `docs/fx-workbench-friction.md`).
 *
 * Order is file order, and a new entry appends. Within a row an entry is identified by its `def`: the same
 * def twice at one moment is meaningless, so `parseTable` de-duplicates.
 */
export type FxRow = FxBinding[];

export interface BindingTable {
  kinds: Partial<Record<MomentKind, FxRow>>;
  cards: Record<string, Partial<Record<MomentKind, FxRow>>>;
}

/**
 * The same shape as `BindingTable`, but a leaf may be `null` — a TOMBSTONE, meaning "resolution stops here
 * and nothing plays", as distinct from an absent key meaning "no opinion, keep looking".
 *
 * This is the shape of the two RESOLUTION LAYERS (the committed file and the session patch), and it is not
 * the same question as "what plays": `BindingTable` is the answer, `LayerTable` is the input. Keeping them
 * as separate types is what lets every consumer of `effectiveTables()` stay free of a null check for a case
 * that view can never produce.
 */
export interface LayerTable {
  kinds: Partial<Record<MomentKind, FxRow | null>>;
  cards: Record<string, Partial<Record<MomentKind, FxRow | null>>>;
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
  if (v.stagger !== undefined && (typeof v.stagger !== 'number' || !Number.isFinite(v.stagger) || v.stagger < 0)) {
    devError(`[fx] bindings.json: ${where}.stagger must be a non-negative number — dropped.`);
    return null;
  }
  const out: FxBinding = { def: v.def };
  if (v.fanOut !== undefined) out.fanOut = v.fanOut as FxBinding['fanOut'];
  if (v.stagger !== undefined) out.stagger = v.stagger;
  return out;
}

/**
 * One ROW from raw JSON: a bare object (the legacy single-binding shape), an array, or `null` (a tombstone).
 *
 * Returns `undefined` for "drop this row entirely" — which is also what an EMPTY array becomes. That is
 * deliberate and load-bearing: absence means "no opinion, keep resolving" and `null` means "plays nothing,
 * stop". `[]` is neither, so admitting it would be a third state with no defined resolution behaviour.
 *
 * Bad entries inside a row are dropped INDIVIDUALLY, matching `parseTable`'s loud-per-entry rule: one
 * malformed binding must not cost the others in the same row.
 */
function coerceRow(v: unknown, where: string): FxRow | null | undefined {
  if (v === null) return null;
  const raw = Array.isArray(v) ? v : [v];
  const out: FxRow = [];
  raw.forEach((entry, i) => {
    // Name the index only for a real array, so a legacy single-object row's error reads as it always did.
    const b = coerceBinding(entry, Array.isArray(v) ? `${where}[${String(i)}]` : where);
    if (!b) return;
    const dup = out.findIndex((e) => e.def === b.def);
    if (dup >= 0) {
      devError(`[fx] bindings.json: ${where} binds '${b.def}' twice — the later one wins.`);
      out[dup] = b;
      return;
    }
    out.push(b);
  });
  return out.length > 0 ? out : undefined;
}

/**
 * Validate a raw table. LOUD PER ENTRY rather than all-or-nothing: a bad entry is dropped with the exact key
 * named, and every other entry still loads. Losing one binding should not cost the other thirteen — and a
 * binding that silently fails to load is indistinguishable from one nobody wired, which is the single most
 * expensive ambiguity in this subsystem.
 *
 * Exported for the tests, which are the only place a malformed table can be constructed on purpose.
 */
export function parseTable(raw: unknown): LayerTable {
  const out: LayerTable = { kinds: {}, cards: {} };
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
      // An explicit `null` is a COMMITTED TOMBSTONE — "this row plays nothing, stop resolving" — and is the
      // only way the file can express a deliberate silence rather than an omission. Preserved rather than
      // dropped, or the workbench's "play nothing" unbind would write a file that re-read as "no opinion"
      // and the silence would last exactly until the next reload.
      const row = coerceRow(v, `kinds.${kind}`);
      if (row !== undefined) out.kinds[kind as MomentKind] = row;
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
      const table: Partial<Record<MomentKind, FxRow | null>> = {};
      for (const [kind, v] of Object.entries(byKind)) {
        if (UNSAFE_KEYS.includes(kind)) {
          devError(`[fx] bindings.json: cards.${cardId}.${kind} is an unsafe key — dropped.`);
          continue;
        }
        const row = coerceRow(v, `cards.${cardId}.${kind}`);
        if (row !== undefined) table[kind as MomentKind] = row;
      }
      if (Object.keys(table).length > 0) out.cards[cardId] = table;
    }
  } else {
    devError('[fx] bindings.json: `cards` is missing or not an object.');
  }
  return out;
}

/** The committed baseline, validated once at module load. */
const COMMITTED: LayerTable = parseTable(rawBindings);

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
type PatchTable = LayerTable;

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
      const row = coerceRow(v, `session patch: kinds.${kind}`);
      if (row !== undefined) out.kinds[kind as MomentKind] = row;
    }
  }
  if (isRecord(raw.cards)) {
    for (const [cardId, byKind] of Object.entries(raw.cards)) {
      if (UNSAFE_KEYS.includes(cardId) || !isRecord(byKind)) continue;
      const table: Partial<Record<MomentKind, FxRow | null>> = {};
      for (const [kind, v] of Object.entries(byKind)) {
        if (UNSAFE_KEYS.includes(kind)) continue;
        const row = coerceRow(v, `session patch: cards.${cardId}.${kind}`);
        if (row !== undefined) table[kind as MomentKind] = row;
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
  // A draft is now an ENTRY inside a row, not a row of its own, so this strips entries and only then decides
  // whether the row survives. Dropping the whole row because it CONTAINS a draft would discard the author's
  // real bindings alongside the preview — the same data-loss shape as post-filtering a merge.
  //
  // A row left empty by the strip is OMITTED rather than written as `[]`: an empty override must read as
  // "no opinion here" so resolution falls through to the file, exactly as it did when the draft was the row.
  const strip = (row: FxRow | null): FxRow | null | undefined => {
    if (row === null) return null; // a tombstone is the author's, not the preview's
    const kept = row.filter((b) => b.def !== DRAFT_DEF_ID);
    return kept.length > 0 ? kept : undefined;
  };
  const out: PatchTable = { kinds: {}, cards: {} };
  for (const [kind, row] of Object.entries(patch.kinds)) {
    if (row === undefined) continue;
    const kept = strip(row);
    if (kept !== undefined) out.kinds[kind as MomentKind] = kept;
  }
  for (const [cardId, byKind] of Object.entries(patch.cards)) {
    const table: Partial<Record<MomentKind, FxRow | null>> = {};
    for (const [kind, row] of Object.entries(byKind)) {
      if (row === undefined) continue;
      const kept = strip(row);
      if (kept !== undefined) table[kind as MomentKind] = kept;
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
  // A row is a LIST, so a non-null write ADDS to whatever is already at this address rather than replacing it
  // — that is the whole point of the change. Replacing by `def` (rather than always appending) keeps a
  // re-commit of the same def idempotent, and keeps a live preview from stacking a new draft every keystroke.
  const row = binding === null ? null : upsert(rowAt(cardId, kind) ?? [], binding);
  writeRow(cardId, kind, row);
}

/** A row with `binding` replacing the entry that shares its `def`, or appended when there is none. */
function upsert(row: FxRow, binding: FxBinding): FxRow {
  const i = row.findIndex((b) => b.def === binding.def);
  if (i < 0) return [...row, binding];
  const next = [...row];
  next[i] = binding;
  return next;
}

/** The row stored AT this address — patch first, then the file. No fall-through between layers. */
function rowAt(cardId: string | null, kind: MomentKind): FxRow | null | undefined {
  const fromPatch = cardId === null ? patch.kinds[kind] : patch.cards[cardId]?.[kind];
  if (fromPatch !== undefined) return fromPatch;
  return cardId === null ? COMMITTED.kinds[kind] : COMMITTED.cards[cardId]?.[kind];
}

/** Put a row (or a tombstone) into the session patch at this address. */
function writeRow(cardId: string | null, kind: MomentKind, row: FxRow | null): void {
  if (cardId === null) patch = { ...patch, kinds: { ...patch.kinds, [kind]: row } };
  else patch = { ...patch, cards: { ...patch.cards, [cardId]: { ...patch.cards[cardId], [kind]: row } } };
  savePatch();
}

/**
 * Remove ONE def from a row, leaving its neighbours alone.
 *
 * This is what tearing down a live preview needs now that a draft is an entry rather than a row: dropping the
 * whole row would take the author's real bindings with it, and the card would go silent instead of going back
 * to what it played before. A row emptied by the removal is written as an empty patch row, which resolves as
 * "nothing at this layer" — NOT a tombstone, which would stop the fall-through.
 */
export function clearBindingEntry(cardId: string | null, kind: MomentKind, defId: string): void {
  const row = rowAt(cardId, kind);
  if (row == null) return; // absent or a tombstone: no entry to take out
  const next = row.filter((b) => b.def !== defId);
  if (next.length === row.length) return; // it wasn't here — leave the patch untouched
  if (next.length > 0) writeRow(cardId, kind, next);
  else clearBinding(cardId, kind);
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
function cloneTable(t: LayerTable): LayerTable {
  const cloneRow = (r: FxRow | null): FxRow | null => (r === null ? null : r.map((b) => ({ ...b })));
  const kinds: LayerTable['kinds'] = {};
  for (const [kind, r] of Object.entries(t.kinds)) {
    if (r !== undefined) kinds[kind as MomentKind] = cloneRow(r);
  }
  const cards: LayerTable['cards'] = {};
  for (const [id, byKind] of Object.entries(t.cards)) {
    const table: Partial<Record<MomentKind, FxRow | null>> = {};
    for (const [kind, r] of Object.entries(byKind)) {
      if (r !== undefined) table[kind as MomentKind] = cloneRow(r);
    }
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
export function bindingsFor(cardId: string | null, kind: MomentKind): FxRow {
  if (cardId !== null) {
    // `undefined` means "no opinion, keep looking"; an explicit `null` is a tombstone that STOPS here —
    // falling through to the kind layer would make "play nothing" impossible to express. A row resolves
    // WHOLE: the card layer replaces the kind layer's list rather than adding to it, which is what keeps
    // "this card looks different here" expressible.
    const overridden = patch.cards[cardId]?.[kind];
    if (overridden !== undefined) return overridden ?? [];
    const fromFile = COMMITTED.cards[cardId]?.[kind];
    if (fromFile !== undefined) return fromFile ?? [];
  }
  const overriddenKind = patch.kinds[kind];
  if (overriddenKind !== undefined) return overriddenKind ?? [];
  return COMMITTED.kinds[kind] ?? [];
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
export function bindingsBeneathDraft(cardId: string | null, kind: MomentKind): FxRow {
  // The draft is filtered ENTRY-wise, not row-wise: a row of `[real, draft]` must answer `[real]`, because
  // the real binding IS what is playing underneath the preview. A row that was ONLY the draft has nothing of
  // the author's in it, so it reads as no opinion and resolution falls through, as it always did.
  const seen = (row: FxRow | null | undefined): FxRow | null | undefined => {
    if (row === undefined || row === null) return row; // absent stays absent; a tombstone still STOPS here
    const kept = row.filter((b) => b.def !== DRAFT_DEF_ID);
    return kept.length > 0 ? kept : undefined;
  };
  if (cardId !== null) {
    const overridden = seen(patch.cards[cardId]?.[kind]);
    if (overridden !== undefined) return overridden ?? [];
    const fromFile = COMMITTED.cards[cardId]?.[kind];
    if (fromFile !== undefined) return fromFile ?? [];
  }
  const overriddenKind = seen(patch.kinds[kind]);
  if (overriddenKind !== undefined) return overriddenKind ?? [];
  return COMMITTED.kinds[kind] ?? [];
}

/**
 * `COMMITTED` with an arbitrary patch layered over it, tombstones KEPT.
 *
 * Parameterised by the patch on purpose: WHICH overlay gets merged is the whole difference between the live
 * view and the committable one, and doing that as a choice of overlay is the only correct place to make it.
 * Filtering after a merge cannot work — an overlay entry OVERWRITES the row beneath it, so removing the
 * merged result deletes the committed value rather than falling back to it.
 *
 * Tombstones survive the merge because the two consumers want opposite things from them: `bindingsJson`
 * must WRITE them (a committed "plays nothing" is a row, not an omission) and `effectiveTables` must DROP
 * them. Dropping after this merge is safe in a way that dropping a draft after it is not: the overlay
 * tombstone has already overwritten whatever the file said, so there is nothing underneath left to lose.
 */
function mergedTable(overlay: PatchTable): LayerTable {
  const out = cloneTable(COMMITTED);
  for (const [kind, b] of Object.entries(overlay.kinds)) {
    if (b !== undefined) out.kinds[kind as MomentKind] = b;
  }
  for (const [cardId, byKind] of Object.entries(overlay.cards)) {
    const table = { ...out.cards[cardId] };
    for (const [kind, b] of Object.entries(byKind)) {
      if (b !== undefined) table[kind as MomentKind] = b;
    }
    if (Object.keys(table).length > 0) out.cards[cardId] = table;
    else delete out.cards[cardId];
  }
  return out;
}

/** A layer table as the "what plays" view: every tombstone dropped, and any card left with nothing pruned. */
function withoutTombstones(t: LayerTable): BindingTable {
  const kinds: BindingTable['kinds'] = {};
  for (const [kind, r] of Object.entries(t.kinds)) if (r && r.length > 0) kinds[kind as MomentKind] = r;
  const cards: BindingTable['cards'] = {};
  for (const [cardId, byKind] of Object.entries(t.cards)) {
    const table: Partial<Record<MomentKind, FxRow>> = {};
    for (const [kind, r] of Object.entries(byKind)) if (r && r.length > 0) table[kind as MomentKind] = r;
    if (Object.keys(table).length > 0) cards[cardId] = table;
  }
  return { kinds, cards };
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
  return withoutTombstones(mergedTable(patch));
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
  return serialise(mergedTable(persistablePatch()));
}

/** A layer table as `bindings.json` text: sorted keys, tombstones written as an explicit `null`. */
function serialise(t: LayerTable): string {
  // A ONE-ENTRY row is written as a bare object, not a 1-element array. Purely so the committed file
  // round-trips byte-identically through this change: fourteen untouched rows would otherwise all churn into
  // arrays in the first diff that touched any binding. `coerceRow` reads both, so the two shapes are the same
  // data — this only decides which one is written.
  const flat = (r: FxRow | null | undefined): FxBinding | FxRow | null =>
    r == null ? null : r.length === 1 ? r[0]! : r;
  const kinds: Record<string, FxBinding | FxRow | null> = {};
  for (const kind of Object.keys(t.kinds).sort()) kinds[kind] = flat(t.kinds[kind as MomentKind]);
  const cards: Record<string, Record<string, FxBinding | FxRow | null>> = {};
  for (const cardId of Object.keys(t.cards).sort()) {
    const byKind = t.cards[cardId] ?? {};
    const inner: Record<string, FxBinding | FxRow | null> = {};
    for (const kind of Object.keys(byKind).sort()) inner[kind] = flat(byKind[kind as MomentKind]);
    cards[cardId] = inner;
  }
  return `${JSON.stringify({ version: 1, kinds, cards }, null, 2)}\n`;
}

// ─── unbinding ────────────────────────────────────────────────────────────────────────────────────────
//
// Removing a binding is TWO operations with opposite intents, and the difference is only visible on a card
// row. `clear` deletes the row, so resolution falls through to the kind default; `tombstone` writes an
// explicit `null`, so resolution STOPS and the card plays nothing. On a kind row there is no layer beneath,
// so the two produce the same silence — which is why the panel offers one button there and two here.
//
// The pair `bindingAt` + `bindingWithout` is what lets the panel state the outcome BEFORE the click instead
// of describing it in general terms. `bindingBeneathDraft` cannot answer either question: it resolves
// through the layers, so it cannot say whether the row you are looking at exists at all (its answer may
// have come from the kind beneath), and it cannot say what would be left if that row went away.

/** How a binding is being removed. See the block comment above. */
export type UnbindOp = 'clear' | 'tombstone';

/** An entry AT one layer: `binding: null` is a tombstone, and `source` says which layer it came from. */
export interface BindingEntry {
  /** The whole row at this layer, or `null` for a tombstone. */
  bindings: FxRow | null;
  source: 'session' | 'file';
}

/**
 * The entry at EXACTLY this layer — no fall-through — or `undefined` when this row is empty.
 *
 * `cardId === null` addresses the kind layer, a string that card's layer: the same key `setBinding` and
 * `bindingFor` take, so "which row am I about to delete" cannot disagree with "which row did I write".
 *
 * The live draft is see-through, for the same reason it is in `bindingBeneathDraft`: while rail mode is
 * previewing, the draft IS the row, and an unbind panel that offered to remove it would be offering to
 * delete the preview rather than the author's real binding.
 */
export function bindingAt(cardId: string | null, kind: MomentKind): BindingEntry | undefined {
  const fromPatch = cardId === null ? patch.kinds[kind] : patch.cards[cardId]?.[kind];
  if (fromPatch !== undefined) {
    // Draft entries are see-through, but the REST of the row is the author's and still counts as a session
    // row. Only a row that is nothing but draft falls through to the file.
    const real = fromPatch === null ? null : fromPatch.filter((b) => b.def !== DRAFT_DEF_ID);
    if (real === null || real.length > 0) return { bindings: real, source: 'session' };
  }
  const fromFile = cardId === null ? COMMITTED.kinds[kind] : COMMITTED.cards[cardId]?.[kind];
  return fromFile === undefined ? undefined : { bindings: fromFile, source: 'file' };
}

/**
 * What would play at `(cardId, kind)` if the row AT that layer were removed — the consequence of a `clear`,
 * computed rather than assumed.
 *
 * For a card row that means resolving the kind layer alone (a card tombstone underneath is irrelevant: it
 * is the row being removed). For a kind row it is always null — there is no layer beneath the kind, which
 * is exactly why `clear` and `tombstone` collapse there.
 */
export function bindingsWithout(cardId: string | null, kind: MomentKind): FxRow {
  if (cardId === null) return [];
  const overriddenKind = patch.kinds[kind];
  if (overriddenKind !== undefined) {
    const real = overriddenKind === null ? null : overriddenKind.filter((b) => b.def !== DRAFT_DEF_ID);
    if (real === null || real.length > 0) return real ?? [];
  }
  return COMMITTED.kinds[kind] ?? [];
}

/**
 * `bindings.json` as it would read after unbinding `(cardId, kind)` — WITHOUT touching the live tables.
 *
 * Computing the text instead of mutating-then-serialising is what makes the write safe against the reload
 * it triggers. The mutate-first alternative has a real failure: a `clear` has to be expressed in the patch
 * as a tombstone (only a tombstone deletes the merged row), and if the reload lands inside the `await` that
 * tombstone is still in `localStorage` afterwards — so the file says "fall through to the default" while
 * the session says "play nothing", and the card is silent for reasons nothing on screen explains. Here the
 * live tables are only updated once the write has come back ok.
 */
export function unbindJson(cardId: string | null, kind: MomentKind, op: UnbindOp, defId?: string): string {
  const t = mergedTable(persistablePatch());
  // With a `defId` this removes ONE entry and leaves the rest of the row in place — the row is shared now, so
  // unbinding your effect must not silence whatever else is bound at the same moment. The row-level ops below
  // still apply when the row is emptied by the removal, or when no def is named.
  const drop = (row: FxRow | null | undefined): FxRow | undefined => {
    if (defId === undefined || row == null) return undefined;
    const kept = row.filter((b) => b.def !== defId);
    return kept.length > 0 ? kept : undefined;
  };
  if (cardId === null) {
    const kept = drop(t.kinds[kind]);
    if (kept) t.kinds[kind] = kept;
    else if (op === 'tombstone') t.kinds[kind] = null;
    else delete t.kinds[kind];
  } else {
    const byKind = { ...t.cards[cardId] };
    const kept = drop(byKind[kind]);
    if (kept) byKind[kind] = kept;
    else if (op === 'tombstone') byKind[kind] = null;
    else delete byKind[kind];
    // A card with nothing left is dropped rather than written as an empty object — same tidy-up the merge
    // does, so an unbind cannot leave `"bloodbinder": {}` behind in the committed file.
    if (Object.keys(byKind).length > 0) t.cards[cardId] = byKind;
    else delete t.cards[cardId];
  }
  return serialise(t);
}
