import type { CardDef } from '@game/core';
import { NEUTRAL } from './cards/set1/neutral';
import { BEASTS } from './cards/set1/beasts';
import { DRAGONS } from './cards/set1/dragons';
import { UNDEAD } from './cards/set1/undead';
import { MECHS } from './cards/set1/mechs';
import { DEMONS } from './cards/set1/demons';
import { SPELLS } from './cards/set1/spells';

/**
 * ── Card sets ──────────────────────────────────────────────────────────────────────────────────────────
 *
 * A **set** is the pool of cards a run can draw from. Sets are built in parallel and switched live, exactly
 * like `RIFTS` in `sim/config.ts`: add an entry, flip `enabled`, ship. **At most one set is active at a
 * time** (the first `enabled` entry, in declaration order), and — the load-bearing part — the active set is
 * **snapshotted onto each run at creation** (`RunState.setId`), so a saved or replayed run keeps the pool it
 * was played under even after the global switch flips. Runtime code reads `RunState.setId` via `poolOf()`,
 * **never the live registry**. Same "pin what actually happened" philosophy as rifts and pinned opponents.
 *
 * ## What a set contains
 *
 * Only the **drawable** cards: buyable minions and tavern spells. Tokens and enemy filler stay global
 * (`ALL_CARDS` / `CARD_INDEX` remain the union of every card that has ever existed) because they are never
 * drawn — they are only reachable *through* a card that names them. A set-2 token can't leak into set 1
 * because no set-1 card references it. This keeps manifests small and means adding a token is never a
 * set-membership decision.
 *
 * `CARD_INDEX` staying global is also what makes this affordable: ~500 id→def lookups across the codebase
 * need no set awareness at all. Only the ~20 *pool* sites do.
 *
 * ## Composition — how overlap works
 *
 * A set is `inherits` (another set's pool) − `excludes` + `own` (its new cards), resolved **in that order**.
 * That order is deliberate: `own` appends at the END, so a set adding cards never disturbs the inherited
 * prefix. Overlap costs nothing — set 2 inherits set 1 and drops what it doesn't want.
 *
 * ## Determinism — read this before editing a set
 *
 * Shop draws are `rng.int(pool.length)` over a filtered view of the resolved list, so **a set's pool ORDER
 * AND SIZE are load-bearing**. Changing a set's own cards changes that set's seeds — which was already true
 * of the flat pool before sets existed, and is unavoidable while content is in flux.
 *
 * What sets DO buy you is **isolation**: because set 2's cards live in its own `own` list appended after
 * set 1's, **building set 2 cannot perturb set 1's seeds**. That is the whole point of the split, and it is
 * why set 2's cards must go in `cards/set2/` rather than being appended to the set-1 tribe files.
 *
 * ## Adding a set
 *
 * 1. `packages/content/src/cards/set2/*.ts` — the new cards (own files, so parallel work never collides).
 * 2. An entry here: `inherits` what you want to keep, `excludes` what you don't, `own` the new cards.
 * 3. Flip `enabled` when it goes live (and `false` on the old one — first-enabled-wins, so leaving both on
 *    silently keeps the earlier one).
 *
 * Quests, runes and heroes are NOT set-scoped yet — they have their own toggles. `SetDef` has room to grow
 * those fields when a set needs its own.
 */
export type SetId = 'set1' | 'set2';

export interface SetDef {
  id: SetId;
  /** Display name — shown wherever the active set is surfaced. */
  name: string;
  /** One-line blurb for banners / tooltips. */
  blurb: string;
  /** The on/off switch. `false` retires the set for NEW runs; in-flight runs keep their pinned copy. */
  enabled: boolean;
  /** Inherit another set's resolved drawable pool as this set's prefix (the overlap). */
  inherits?: SetId;
  /** Card ids to drop from the inherited pool. Ignored for ids this set doesn't inherit. */
  excludes?: readonly string[];
  /** This set's OWN cards, in declaration order, appended after the inherited pool. */
  own: readonly CardDef[];
}

export const SETS: Record<SetId, SetDef> = {
  set1: {
    id: 'set1',
    name: 'Set 1',
    blurb: 'The founding collection.',
    enabled: true,
    // Declaration order is preserved EXACTLY as the pre-sets flat pool was assembled (neutral, beasts,
    // dragons, undead, mechs, demons, spells), so every existing seed replays identically.
    own: [...NEUTRAL, ...BEASTS, ...DRAGONS, ...UNDEAD, ...MECHS, ...DEMONS, ...SPELLS],
  },
  set2: {
    id: 'set2',
    name: 'Set 2',
    blurb: 'In development.',
    enabled: false,
    inherits: 'set1', // start from everything in set 1; trim with `excludes` as the design firms up
    excludes: [],
    own: [], // → packages/content/src/cards/set2/*.ts
  },
};

/** The set a NEW run should adopt — the first enabled entry, or `set1` if somebody disabled them all.
 *  Deterministic (depends only on the registry's `enabled` flags), so it's safe to call from `createRun`. */
export function activeSet(): SetDef {
  for (const s of Object.values(SETS)) if (s.enabled) return s;
  return SETS.set1;
}

/** A set's resolved, ORDERED drawable pool, split the way the draw sites want it. */
export interface CardPool {
  setId: SetId;
  /** Every drawable card in the set, in resolution order. */
  all: readonly CardDef[];
  /** Shop-offerable minions (excludes tokens + spells). */
  buyable: readonly CardDef[];
  /** Tavern spells (excludes reward-only `token` spells), matching the old SPELL_CARDS rule. */
  spells: readonly CardDef[];
}

const resolved = new Map<SetId, CardPool>();

/** Resolve (and memoize) a set's pool. Pure + deterministic: same registry → same order, every time. */
export function poolFor(setId: SetId): CardPool {
  const hit = resolved.get(setId);
  if (hit) return hit;
  const def = SETS[setId] ?? SETS.set1;
  const seen = new Set<string>();
  const all: CardDef[] = [];
  const push = (c: CardDef): void => {
    if (seen.has(c.id)) return; // a set can inherit AND redeclare an id; first wins, order stays stable
    seen.add(c.id);
    all.push(c);
  };
  if (def.inherits && def.inherits !== def.id) {
    const drop = new Set(def.excludes ?? []);
    for (const c of poolFor(def.inherits).all) if (!drop.has(c.id)) push(c);
  }
  for (const c of def.own) push(c);
  const pool: CardPool = {
    setId: def.id,
    all,
    buyable: all.filter((c) => !c.token && !c.spell),
    spells: all.filter((c) => c.spell && !c.token),
  };
  resolved.set(setId, pool);
  return pool;
}
