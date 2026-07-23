import type { CardView } from './Card';

/**
 * Value-equality for `CardView`, used to keep the per-card view objects REFERENTIALLY STABLE across dispatches.
 *
 * Why this exists: every accepted reducer action `structuredClone`s the run (reducer.ts), which replaces the
 * identities of `board`/`hand`/`shop` and their cards. The view-map memos in `Recruit` are keyed on those
 * identities, so they rebuild and emit fresh `CardView` objects EVERY dispatch — even for a card whose
 * displayed content didn't change. `Card` is `React.memo`'d with a shallow prop compare, so a new `card`
 * object defeats the bailout and every card re-renders on every buy/play/sell/roll. Comparing the new view to
 * the previous one and REUSING the previous object when they're equal restores the bailout (see
 * `stabilizeViewMap`). This never touches the sim or the reducer's clone — it's a pure UI-side stabilization.
 *
 * The comparison MUST cover every displayed field or a card could show stale data. The `_MissingKey` guard
 * below makes that compile-time exhaustive: add a field to `CardView` and this file stops compiling until the
 * field is either listed in `SCALAR_KEYS` or handled as one of the explicit non-scalar cases.
 */

/** Every scalar (primitive-comparable) `CardView` field. */
const SCALAR_KEYS = [
  'name', 'cardId', 'tribe', 'tribe2', 'universalTribe', 'attack', 'health', 'text', 'goldenText',
  'stepEphemeral', 'cost', 'costChanged', 'castMult', 'golden', 'tier', 'spell', 'ruby', 'target',
  'baseAttack', 'baseHealth', 'floorAttack', 'floorHealth', 'flashAtk', 'flashHp',
] as const satisfies readonly (keyof CardView)[];

/** Compile-time exhaustiveness: any `CardView` key not covered here (scalar or an explicit non-scalar below)
 *  leaves `_MissingKey` non-never, and the `_exhaustive` assignment fails to compile — the guard Codex asked
 *  for, so a new displayed field can't silently slip past the comparison and cause a stale card. */
type _MissingKey = Exclude<keyof CardView, (typeof SCALAR_KEYS)[number] | 'keywords' | 'buffs' | 'stepProgress'>;
const _exhaustive: [_MissingKey] extends [never] ? true : ['CardView field not covered by cardViewEqual:', _MissingKey] = true;
void _exhaustive;

function keywordsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function buffsEqual(a: CardView['buffs'], b: CardView['buffs']): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!;
    if (x.source !== y.source || x.attack !== y.attack || x.health !== y.health || x.count !== y.count) return false;
  }
  return true;
}

function stepEqual(a: CardView['stepProgress'], b: CardView['stepProgress']): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return a.current === b.current && a.total === b.total && a.label === b.label;
}

/** True when two views would render identically. */
export function cardViewEqual(a: CardView, b: CardView): boolean {
  if (a === b) return true;
  for (const k of SCALAR_KEYS) if (a[k] !== b[k]) return false;
  return keywordsEqual(a.keywords, b.keywords) && buffsEqual(a.buffs, b.buffs) && stepEqual(a.stepProgress, b.stepProgress);
}

/**
 * Return a view map whose VALUES are reused from `cache` whenever the freshly-built view is equal — so an
 * unchanged card yields the SAME object reference across dispatches and `Card`'s memo bails. The returned map
 * is itself the new cache (only current uids, so it can't leak): pass it back in next render.
 */
export function stabilizeViewMap(fresh: Map<string, CardView>, cache: Map<string, CardView>): Map<string, CardView> {
  const out = new Map<string, CardView>();
  for (const [uid, v] of fresh) {
    const prev = cache.get(uid);
    out.set(uid, prev && cardViewEqual(prev, v) ? prev : v);
  }
  return out;
}

/** Same idea for the referenced-card popups (uid → CardView[]): reuse the cached ARRAY reference when every
 *  element is unchanged, so `Card`'s `refCards` prop stays reference-stable and doesn't defeat the memo. */
export function stabilizeRefMap(fresh: Map<string, CardView[]>, cache: Map<string, CardView[]>): Map<string, CardView[]> {
  const out = new Map<string, CardView[]>();
  for (const [uid, arr] of fresh) {
    const prev = cache.get(uid);
    out.set(uid, prev && prev.length === arr.length && arr.every((v, i) => cardViewEqual(prev[i]!, v)) ? prev : arr);
  }
  return out;
}

/** Single-view stabilization (the pinned spell slot): reuse `prev` when equal. */
export function stabilizeView(fresh: CardView | null, prev: CardView | null): CardView | null {
  if (!fresh || !prev) return fresh;
  return cardViewEqual(prev, fresh) ? prev : fresh;
}
