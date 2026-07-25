import type { CardDef, Tribe } from '@game/core';
import { NEUTRAL } from './cards/set1/neutral';
import { BEASTS } from './cards/set1/beasts';
import { DRAGONS } from './cards/set1/dragons';
import { UNDEAD } from './cards/set1/undead';
import { MECHS } from './cards/set1/mechs';
import { DEMONS } from './cards/set1/demons';
import { SPELLS } from './cards/set1/spells';
import { TIER7 } from './cards/set1/tier7';
import { SET2_KOBOLDS } from './cards/set2/kobolds';
import { SET2_DRAGONS } from './cards/set2/dragons';
import { SET2_BEASTS } from './cards/set2/beasts';
import { SET2_SPELLS } from './cards/set2/spells';

/**
 * Set 2 reuses Set 1's whole neutral spell toolkit — the same drawable spells (Discover, buffs, economy,
 * tempo) that made Set 1's shop interesting — MINUS the handful whose payoff is tied to a tribe Set 2 doesn't
 * field. Every Discover / get-a-minion spell resolves its candidates through `poolOf(state)` filtered by the
 * run's pinned tribes, so in a Set 2 run they automatically pull ONLY Set 2's Kobolds (+ neutral) — no extra
 * wiring. Reward-only spells (`token: true`, e.g. Ossuary Rite) are omitted here: they arrive through their
 * quests, are never drawable, and already resolve globally via `CARD_INDEX`.
 */
const SET2_DROPPED_SPELLS = new Set<string>([
  'lanternofsouls', // "Your Undead get +3 Attack" — no Undead in Set 2
  'undeadarmy', //     "Get 2 copies of a random Undead" — no Undead in Set 2
  'consume', //        "A Demon consumes a Fodder" — no Demon payoff line in Set 2
  'foddertreatment', //"Give a minion's stats to your left-most Demon" — no Demons in Set 2
]);
/** Set 1 Dragons that carry into Set 2. Just Karwind for now — the owner's Set-2 Dragon roster lists it, and
 *  it was re-spec'd in place (Tier 6 4/12) rather than forked, so BOTH sets draw the same card. Filtered out of
 *  `DRAGONS` by id for the same reason the spells are: the set manifest opts cards IN, one list per source. */
const SET1_DRAGONS_IN_SET2: readonly CardDef[] = DRAGONS.filter((d) => d.id === 'karwind');
/** Set 1 Beasts that carry into Set 2 unchanged — the ones whose owner-table spec matches their set-1 card
 *  (2026-07-24). The re-spec'd ones (Kennelmaster, Runic Beetle) and the 15 new Beasts land as their stats /
 *  rulings are confirmed. Same opt-in-by-id pattern as Karwind + the neutral spells. */
const SET1_BEASTS_IN_SET2: readonly CardDef[] = BEASTS.filter((b) =>
  ['badgington', 'seaurchin', 'sporebat', 'manasaber', 'kennel', 'beetle'].includes(b.id),
);
/**
 * Set 1 NEUTRAL minions that carry into Set 2 (owner roster 2026-07-25), plus the Tier-7 neutrals from the same
 * list. Opted in AT THEIR CURRENT STATS — the owner's table listed different tier/stats for seven of them
 * (Buddy Buddy 3/3, Nimbus T4 5/4, Rope Wrangler T5 5/6, Yazzus T7 9/9, Lazarus T7 8/8, Zyff 12/10, and
 * "Jenkins" vs the card's "Jensen & Fi"), and the owner's call was to carry them UNCHANGED rather than re-spec
 * (owner decision 2026-07-25). These are shared definitions, so re-speccing would have rebalanced Set 1 too;
 * the deltas are recorded in the devlog to be applied deliberately if wanted.
 *
 * Same opt-in-by-id pattern as Karwind and the Beasts: the manifest names what it takes, so a new Set-1 neutral
 * never leaks into Set 2 by being added to `NEUTRAL`.
 */
const SET1_NEUTRALS_IN_SET2: readonly CardDef[] = NEUTRAL.filter((c) =>
  [
    'buddy', 'venom', 'arenaheckler', 'blaster', 'nimbus', 'tauntbreaker', 'wayfinder', 'blackbelt',
    'chronos', 'drummer', 'ropewrangler', 'stewardofspells', 'sylus', 'joker', 'taurus', 'yazzus', 'lazarus',
    'jenkins',
  ].includes(c.id),
);
/** The Tier-7 neutrals on the same owner roster. Kept separate so they can stay APPENDED last, matching set 1's
 *  ordering rule (declaration order drives seeded pool picks). */
const SET1_TIER7_IN_SET2: readonly CardDef[] = TIER7.filter((c) => ['uron', 'salvatore', 'zyff'].includes(c.id));
/** Set 1's drawable neutral spells that carry over into Set 2 (drops the tribe-locked ones + reward tokens). */
const SET1_SPELLS_IN_SET2: readonly CardDef[] = SPELLS.filter((s) => !s.token && !SET2_DROPPED_SPELLS.has(s.id));

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
  /** The playable tribes a run pinned to this set draws from (`selectRunTribes` picks the run's active tribes
   *  from this roster; neutral glue is always available on top). This is the per-set tribe scoping: set 1's
   *  five founding tribes, set 2's Kobolds. Keeping it on the set is what stops a set-2 tribe (`kobold`) from
   *  ever appearing in a set-1 run — the run's `tribes` are chosen from the PINNED set's roster only. */
  tribes: readonly Tribe[];
}

export const SETS: Record<SetId, SetDef> = {
  set1: {
    id: 'set1',
    name: 'Set 1',
    blurb: 'The founding collection.',
    enabled: true,
    tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'], // the five founding playable tribes
    // Declaration order is preserved EXACTLY as the pre-sets flat pool was assembled (neutral, beasts,
    // dragons, undead, mechs, demons, spells), so every existing seed replays identically.
    // TIER7 is APPENDED last on purpose: declaration order drives seeded pool picks, and every Tier 7 card
    // filters out of any `tier <= state.tier` pool below 7, so appending leaves existing seeds identical.
    own: [...NEUTRAL, ...BEASTS, ...DRAGONS, ...UNDEAD, ...MECHS, ...DEMONS, ...SPELLS, ...TIER7],
  },
  set2: {
    id: 'set2',
    name: 'Set 2',
    blurb: 'In development.',
    enabled: false,
    tribes: ['kobold', 'dragon', 'beast'], // WIP — Kobolds (Ruby) + Dragons (spell recursion) + Beasts; more as set 2 grows
    // Starts EMPTY and opts cards IN (owner call 2026-07-19) — set 2 is being authored externally and
    // dropped in, so an explicit `own` list is the manifest. Add `inherits: 'set1'` (+ `excludes`) instead
    // if you'd rather start from set 1 and trim; both compose, and `own` always appends last.
    // Kobolds (this set's minions) + Set 1's carried-over neutral spell toolkit + Set 2's own Ruby spells.
    own: [...SET2_KOBOLDS, ...SET2_DRAGONS, ...SET1_DRAGONS_IN_SET2, ...SET2_BEASTS, ...SET1_BEASTS_IN_SET2, ...SET1_NEUTRALS_IN_SET2, ...SET1_SPELLS_IN_SET2, ...SET2_SPELLS, ...SET1_TIER7_IN_SET2], // → packages/content/src/cards/set2/*.ts (WIP)
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
