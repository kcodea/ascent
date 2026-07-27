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

/** kind → binding, and card → kind → binding. Both sparse. */
export interface BindingTable {
  kinds: Partial<Record<MomentKind, FxBinding>>;
  cards: Record<string, Partial<Record<MomentKind, FxBinding>>>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** One binding, or null with a console.error naming `where`. Never throws: this is fed untrusted JSON. */
function coerceBinding(v: unknown, where: string): FxBinding | null {
  if (!isRecord(v)) {
    console.error(`[fx] bindings.json: ${where} is not an object — dropped.`);
    return null;
  }
  if (typeof v.def !== 'string' || v.def === '') {
    console.error(`[fx] bindings.json: ${where}.def must be a non-empty string — dropped.`);
    return null;
  }
  if (v.fanOut !== undefined && (typeof v.fanOut !== 'string' || !FAN_OUTS.includes(v.fanOut))) {
    console.error(`[fx] bindings.json: ${where}.fanOut must be one of ${FAN_OUTS.join(', ')} — dropped.`);
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
    console.error('[fx] bindings.json is not an object — no authored FX will be bound.');
    return out;
  }
  if (isRecord(raw.kinds)) {
    for (const [kind, v] of Object.entries(raw.kinds)) {
      const b = coerceBinding(v, `kinds.${kind}`);
      if (b) out.kinds[kind as MomentKind] = b;
    }
  } else {
    console.error('[fx] bindings.json: `kinds` is missing or not an object.');
  }
  if (isRecord(raw.cards)) {
    for (const [cardId, byKind] of Object.entries(raw.cards)) {
      if (!isRecord(byKind)) {
        console.error(`[fx] bindings.json: cards.${cardId} is not an object — dropped.`);
        continue;
      }
      const table: Partial<Record<MomentKind, FxBinding>> = {};
      for (const [kind, v] of Object.entries(byKind)) {
        const b = coerceBinding(v, `cards.${cardId}.${kind}`);
        if (b) table[kind as MomentKind] = b;
      }
      if (Object.keys(table).length > 0) out.cards[cardId] = table;
    }
  } else {
    console.error('[fx] bindings.json: `cards` is missing or not an object.');
  }
  return out;
}

/** The committed baseline, validated once at module load. */
const FILE: BindingTable = parseTable(rawBindings);

/** A deep-ish copy so a caller cannot mutate the module's own tables (the browser iterates these freely). */
function cloneTable(t: BindingTable): BindingTable {
  const cards: BindingTable['cards'] = {};
  for (const [id, byKind] of Object.entries(t.cards)) cards[id] = { ...byKind };
  return { kinds: { ...t.kinds }, cards };
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
    const card = FILE.cards[cardId]?.[kind];
    if (card !== undefined) return card;
  }
  return FILE.kinds[kind] ?? null;
}

/** The whole effective table — what the FX library browser enumerates. Always a fresh copy. */
export function effectiveTables(): BindingTable {
  return cloneTable(FILE);
}
