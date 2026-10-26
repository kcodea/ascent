/**
 * THE HERO-POWER GRANT FOLLOWS THE POWER (owner report + ruling 2026-10-26, R-HERO-GRANT-RELEASE-01).
 *
 * Runesmith's turn-5 forge and Guardian's turn-8 Epic forge are hero powers, and the rune each one sells lives in
 * the hero-power slot (`heroGrantArt`): the button wears its art, its name and its rule. Fi / Coran's turn-1 hero
 * quest does the same. Nothing ever released that grant, so after Power Shifter replaced the power the button
 * kept the old rune's art and name over the NEW power's cost (owner: "runemaster got a new hero power here but
 * the art didnt change to it"), and the rune kept working.
 *
 * Owner ruling: "this would replace whatever rune mechanic he has, so if he had a rune that was passively doing
 * something, that would not be active anymore. (the one he selected from his hero power)".
 *
 * So:
 *  · `heroGrantOf` is the ONE read of the slot's grant: it only counts while the hero's OWN power still sits in
 *    slot 0. Every surface (button art, label, tooltip, rack, quest badges) reads it, so a stale grant can never
 *    paint over a new power, even in a save written before this fix.
 *  · `captureHeroGrantRune` records what the hero's rune switched on when it was applied (a generic diff of the run
 *    state, so all ~200 rune reward shapes are covered without a per-rune table), and `releaseHeroGrant` switches
 *    exactly that back off when the power is replaced. What the rune already DELIVERED (cards, Gold, the stats it
 *    already gave, a Shop discount already taken) stays: only its ongoing effect ends. Runes bought at a
 *    Runeforge are untouched, including a second copy of the same rune.
 */
import type { HeroGrantDelta, HeroGrantRuneFootprint, RunState } from './state';
import { wieldedPowerId } from './heroes';

/** The slot's grant, while the hero's own power still holds slot 0; `undefined` once another power replaced it. */
export function heroGrantOf(
  run: Pick<RunState, 'heroGrantArt' | 'heroId' | 'adoptedPowerId' | 'mimicPowerId' | 'voidPowerIds'>,
): RunState['heroGrantArt'] {
  if (!run.heroGrantArt) return undefined;
  return wieldedPowerId(run, 0) === run.heroId ? run.heroGrantArt : undefined;
}

/**
 * Fields a rune application touches that are DELIVERED value or bookkeeping, never its ongoing effect: cards and
 * Gold it handed over, rolls and offers it opened, the stats it already baked into cards, rune accounting handled
 * by `releaseHeroGrant` itself, and per-action presentation channels.
 */
const DELIVERED = new Set<string>([
  'hand', 'board', 'shop', 'pool', 'discover', 'discoverQueue', 'questOffer', 'powerOffer', 'chooseOne', 'pendingTarget',
  'embers', 'maxEmbers', 'freeRolls', 'upgradeCost', 'goldSpent', 'goldSpentThisTurn', 'uidSeq', 'rngCursor',
  'cardBuffs', 'gainCardFiredUids', 'pendingQuestRewards', 'chooseBothCharges',
  'ownedRunes', 'runeStacks', 'runeIdByKind', 'runeProcs', 'heroGrantArt', 'heroGrantRune',
  'epicForgeWave', 'pendingEpicRuneforge', 'pendingForgeDeferred', 'epicForgeClaimed',
]);
const isDelivered = (k: string): boolean =>
  DELIVERED.has(k) || /^runeforge/.test(k) || /^discover/.test(k) || /Seq$/.test(k) || /Eaten$/.test(k) || /Fx($|[A-Z])/.test(k)
  || /Fired/.test(k) || /^last[A-Z]/.test(k) || /^beat/.test(k);

/** Records SHARED by many sources (every combat-flag rune writes into `questFlags`). When the hero's rune is the one
 *  that created such a record, only its own entries are its footprint, never the whole record: later runes write
 *  into the same record. Any other record a rune creates from nothing is that rune's own config (`runeScale`). */
const SHARED_RECORDS = new Set<string>(['questFlags', 'flagCopies', 'tavernBuyBonus', 'tavernBuyBonusSources']);

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A shallow picture of the run, enough to diff one rune application against (records copied one level down,
 *  lists copied, so an in-place push / write shows up). One-off at a forge pick, never on a hot path. */
type Picture = Map<string, unknown>;
function picture(s: RunState): Picture {
  const out: Picture = new Map();
  for (const [k, v] of Object.entries(s)) {
    if (isDelivered(k)) continue;
    out.set(k, Array.isArray(v) ? [...v] : isRecord(v) ? { ...v } : v);
  }
  return out;
}

function deltaOf(before: unknown, after: unknown, depth: number, key?: string): HeroGrantDelta | undefined {
  if (before === after) return undefined;
  if (typeof after === 'number') {
    const was = typeof before === 'number' ? before : 0;
    if (before !== undefined && before !== null && before !== false && typeof before !== 'number') return undefined;
    return after !== was ? { n: after - was } : undefined;
  }
  if (Array.isArray(after)) {
    const prev = Array.isArray(before) ? before : [];
    // A multiset difference, so a second copy of an entry already on the list (a duplicate rune) still counts.
    const left = [...prev];
    const added = after.filter((x) => { const at = left.indexOf(x); if (at >= 0) { left.splice(at, 1); return false; } return true; });
    return added.length ? { items: added } : undefined;
  }
  if (depth === 0 && isRecord(after) && before === undefined && key !== undefined && SHARED_RECORDS.has(key)) before = {};
  if (isRecord(after) && isRecord(before) && depth === 0) {
    const sub: Record<string, HeroGrantDelta> = {};
    for (const k of Object.keys(after)) {
      const d = deltaOf(before[k], after[k], depth + 1);
      if (d) sub[k] = d;
    }
    return Object.keys(sub).length ? { sub } : undefined;
  }
  // Anything switched on from nothing (a flag, a config record, a string).
  if (before === undefined || before === null || before === false) return after === undefined || after === null || after === false ? undefined : { set: true };
  return undefined;
}

/** Run `apply` (the hero rune's application) and record what it switched on into `s.heroGrantRune`. */
export function captureHeroGrantRune(s: RunState, runeId: string, apply: () => void): void {
  const before = picture(s);
  apply();
  const fields: Record<string, HeroGrantDelta> = {};
  for (const [k, v] of Object.entries(s)) {
    if (isDelivered(k)) continue;
    const d = deltaOf(before.get(k), v, 0, k);
    if (d) fields[k] = d;
  }
  // A deep copy: the footprint must not alias live entries (a threshold's tick keeps moving), and it must read the
  // same after a save round-trip as it does in memory.
  const fp: HeroGrantRuneFootprint = { runeId, fields: JSON.parse(JSON.stringify(fields)) as Record<string, HeroGrantDelta> };
  s.heroGrantRune = fp;
}

/** Does `item` (as recorded) identify `x` (as it is now)? By the rune's own `sourceId` when the entry carries one,
 *  else by value; an entry that has ticked since (a countdown) still matches on its unchanged string fields. */
function sameItem(x: unknown, item: unknown): boolean {
  if (x === item) return true;
  if (!isRecord(item) || !isRecord(x)) return false;
  if (typeof item.sourceId === 'string') {
    return x.sourceId === item.sourceId && x.cardId === item.cardId && x.meter === item.meter && x.tribe === item.tribe;
  }
  if (JSON.stringify(x) === JSON.stringify(item)) return true;
  const keys = Object.keys(item);
  if (keys.length !== Object.keys(x).length || !keys.every((k) => k in x)) return false;
  return keys.every((k) => typeof item[k] !== 'string' || item[k] === x[k]);
}

function undo(host: Record<string, unknown>, key: string, d: HeroGrantDelta, stillHeld: boolean): void {
  const cur = host[key];
  if ('n' in d) {
    if (typeof cur !== 'number') return;
    const left = cur - d.n;
    if (left <= 0 && !stillHeld) delete host[key];
    else host[key] = Math.max(0, left);
    return;
  }
  if ('set' in d) {
    if (!stillHeld) delete host[key];
    return;
  }
  if ('items' in d) {
    if (!Array.isArray(cur)) return;
    const list = [...cur];
    for (const item of d.items) {
      const at = list.findIndex((x) => sameItem(x, item));
      if (at >= 0) list.splice(at, 1);
    }
    host[key] = list;
    return;
  }
  if (!isRecord(cur)) return;
  const copy: Record<string, unknown> = { ...cur };
  for (const [k, sd] of Object.entries(d.sub)) undo(copy, k, sd, stillHeld);
  host[key] = copy;
}

/**
 * The hero's own power just left slot 0: release what it granted. The slot's grant is cleared (the button now
 * shows the new power), and a granted RUNE stops working — one copy leaves `ownedRunes` and its stack count, and
 * the footprint recorded at the pick is switched back off. When the run still holds another copy of that rune
 * (bought at a Runeforge, or a Duplication copy), only the counted share goes and its switches stay on.
 * A granted QUEST keeps running as an ordinary quest badge; only the slot is released.
 */
export function releaseHeroGrant(s: RunState): void {
  const grant = s.heroGrantArt;
  if (!grant) return;
  s.heroGrantArt = undefined;
  if (grant.kind !== 'rune') return;
  const id = grant.id;
  const owned = [...(s.ownedRunes ?? [])];
  const at = owned.lastIndexOf(id);
  if (at >= 0) owned.splice(at, 1);
  s.ownedRunes = owned;
  const stillHeld = owned.includes(id);
  if (s.runeStacks?.[id] !== undefined) {
    const stacks = { ...s.runeStacks };
    const left = (stacks[id] ?? 0) - 1;
    if (left > 0) stacks[id] = left; else delete stacks[id];
    s.runeStacks = stacks;
  }
  const fp = s.heroGrantRune;
  s.heroGrantRune = undefined;
  if (fp?.runeId === id) {
    const host = s as unknown as Record<string, unknown>;
    for (const [k, d] of Object.entries(fp.fields)) undo(host, k, d, stillHeld);
  }
  if (!stillHeld && s.runeIdByKind) {
    s.runeIdByKind = Object.fromEntries(Object.entries(s.runeIdByKind).filter(([, v]) => v !== id));
  }
}
