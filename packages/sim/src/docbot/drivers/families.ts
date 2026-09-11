/**
 * FAMILY DRIVERS — the PURE classification half (no engine imports), shared by the §10.1 planner
 * (isolatedCases.ts decides applicability from these) and the drivers (which execute what was planned).
 *
 * A contract joins a family by the SHAPE OF ITS CLAIMS, never by factory id: a const amount with only
 * attack/health(/count) keys is a stat grant; refs on a grant-shaped kind, or a count-only amount on a
 * grant/summon kind, is a card grant; a single amount/gold/count on an economy-named kind is an economy
 * claim; a keyword-named kind is a keyword grant; `grantEquipment` is equipment; no triggers and no effects
 * is a vanilla body. Each family's classifier is deliberately CONSERVATIVE — a scaler key (`every`, `step`,
 * `improve`, `per`, `pct`, `base`, …) means the first activation's magnitude is not the printed number, and
 * such shapes stay honestly `no-driver-for-shape` (the planner names the keys) until a scaler-aware driver
 * exists.
 */
import { CARD_INDEX } from '@game/content';
import type { ContentContract, EffectContract } from '@game/rules/contracts/schema';
import { CONTROL_KEY_WHITELIST } from '../playScan';

export const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf', 'spirit', 'celestial'];

// ── stageable trigger vocabularies ───────────────────────────────────────────────────────────────────────

/** Shop-phase triggers the kit can fire through the real reducer (see shared.ts `stageShop`). */
export const SHOP_STAGEABLE: ReadonlySet<string> = new Set([
  'onPlay', 'cast', 'equip', 'onSell', 'endOfTurn', 'startOfTurn', 'minionSold', 'spellCast', 'spellBought',
  'onSummon', 'onTribePlayed', 'battlecryTriggered', 'onBuy', 'goldSpent', 'cardsBought', 'onGainCard',
  'shopRefreshed', 'spellCastOnThis',
]);

/** Combat-phase triggers the kit can fire through the real `simulate()` (see shared.ts `stageCombat`). */
export const COMBAT_STAGEABLE: ReadonlySet<string> = new Set([
  'onDeath', 'onAttack', 'startOfCombat', 'onKill', 'onDamaged', 'onSummon', 'onRise', 'summonOverflow',
  'friendlyDemonDealtDamage',
]);

/** The trigger a family driver stages for this contract — shop preferred (the richer observation surface),
 *  else combat. Null = nothing stageable yet (the planner's typed skip). */
export function stageableTrigger(c: ContentContract): { event: string; phase: 'shop' | 'combat' } | null {
  const triggers = c.triggers ?? [];
  for (const t of triggers) if (t.phase !== 'combat' && SHOP_STAGEABLE.has(t.event)) return { event: t.event, phase: 'shop' };
  for (const t of triggers) if (t.phase !== 'shop' && COMBAT_STAGEABLE.has(t.event)) return { event: t.event, phase: 'combat' };
  return null;
}

// ── amount helpers ───────────────────────────────────────────────────────────────────────────────────────

/** The numeric keys of a const amount, or null when the amount is a formula / absent. */
export function constAmount(c: ContentContract, i: number): Record<string, number> | null {
  const a = c.effects?.[i]?.amount;
  if (!a || a.kind !== 'const' || !a.plain || typeof a.plain !== 'object' || Array.isArray(a.plain)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(a.plain as Record<string, unknown>)) if (typeof v === 'number') out[k] = v;
  return out;
}

export const keysWithin = (amount: Record<string, number>, allowed: ReadonlySet<string>): boolean =>
  Object.keys(amount).every((k) => allowed.has(k));

/** The declared ×factor when the contract's gild is the 'multiply' baseline on a gildable type. */
export const gildFactor = (c: ContentContract): number | null =>
  c.gildedDelta?.kind === 'multiply' && c.contentType !== 'spell' ? c.gildedDelta.factor : null;

/** The Choose One branch an extracted effect belongs to (1-based, from the extractor's branch note), or null
 *  for an unconditional effect. A driver stages each branch separately — the player picks ONE. */
export function branchOf(e: EffectContract | undefined): number | null {
  const m = /^Choose One branch (\d+)/.exec(e?.note ?? '');
  return m ? Number(m[1]) : null;
}

// ── stat grant ───────────────────────────────────────────────────────────────────────────────────────────

const STAT_KEYS: ReadonlySet<string> = new Set(['attack', 'health', 'count']);
/** Kinds whose attack/health params are NOT a grant magnitude: a stat SET, a swap, an average, a doubling. */
const NOT_A_GRANT = /SetStats|Swap|Average|Double|Pct|Unbridled|PlusReveler|PerGold|PerCard|PerAle|PerTally|PerSpell|PerDragon|PerDemon|PerTribePlayed|Escalating/;

export interface StatGrantClaim {
  index: number;
  attack: number;
  health: number;
  /** Which of attack/health the contract actually STATES (only stated keys are observed). */
  stated: Array<'attack' | 'health'>;
  count?: number;
  branch: number | null;
}

/** The stat-grant effects a contract states in the driveable shape (attack/health, optionally count). */
export function statGrantEffects(c: ContentContract): StatGrantClaim[] {
  const out: StatGrantClaim[] = [];
  (c.effects ?? []).forEach((e, index) => {
    if (e.summons) return; // a summon's rider stats belong to the summon drivers
    if (NOT_A_GRANT.test(e.kind)) return;
    const a = constAmount(c, index);
    if (!a || !keysWithin(a, STAT_KEYS)) return;
    if (a.attack === undefined && a.health === undefined) return;
    if ((a.attack ?? 0) === 0 && (a.health ?? 0) === 0) return; // a 0/0 amount states no magnitude (a doubler's base)
    const stated: Array<'attack' | 'health'> = [];
    if (a.attack !== undefined) stated.push('attack');
    if (a.health !== undefined) stated.push('health');
    out.push({ index, attack: a.attack ?? 0, health: a.health ?? 0, stated, ...(a.count !== undefined ? { count: a.count } : {}), branch: branchOf(e) });
  });
  return out;
}

// ── card grant / summon ──────────────────────────────────────────────────────────────────────────────────

const COUNT_KEYS: ReadonlySet<string> = new Set(['count', 'tier', 'tierOffset']);
/** Kinds that REFERENCE a card without handing it over. */
const NON_GRANT_KIND = /cast|transform|steal|destroy|consume|devour|recast|replay|trigger|copy|buff|damage|mark|teach|taught|arm|rearm|inherit|scout|displace|sell|layaway|decoy|weaken|contain|gild|playrub|ward|keyword|taunt|reborn|magnetic|shield/i;
const GRANT_KIND = /Grant|Get|Gain|Discover|Summon|Conjure|Add|Mint|Rubies|Ale|Reveler|Resummon|Fodder/;

export interface CardGrantClaim {
  index: number;
  refs?: string[];
  count?: number;
  summon: boolean;
  branch: number | null;
  /** A Discover: the contract states no count, but a Discover yields exactly one card by construction. */
  implicitOne?: boolean;
}

export function cardGrantEffects(c: ContentContract): CardGrantClaim[] {
  const out: CardGrantClaim[] = [];
  (c.effects ?? []).forEach((e, index) => {
    if (e.summons) return; // owned by the summon drivers
    const kind = e.kind;
    if (NON_GRANT_KIND.test(kind)) return;
    const refs = (e.refs ?? []).filter(Boolean);
    const a = constAmount(c, index);
    const countable = !!a && keysWithin(a, COUNT_KEYS) && typeof a.count === 'number';
    const summon = /Summon|Conjure|Resummon/.test(kind);
    if (refs.length) out.push({ index, refs: [...refs].sort(), ...(countable ? { count: a!.count! } : {}), summon, branch: branchOf(e) });
    else if (countable && GRANT_KIND.test(kind)) out.push({ index, count: a!.count!, summon, branch: branchOf(e) });
    else if (/Discover/.test(kind) && (!a || keysWithin(a, COUNT_KEYS))) out.push({ index, summon: false, branch: branchOf(e), implicitOne: true });
  });
  return out;
}

// ── economy ──────────────────────────────────────────────────────────────────────────────────────────────

const ECON_KIND = /gold|ember|mana|armor|roll|refresh/i;
const ECON_ONE_KEY: ReadonlySet<string> = new Set(['amount', 'gold', 'count']);

export interface EconomyClaim { index: number; key: string; value: number; branch: number | null }

export function economyEffects(c: ContentContract): EconomyClaim[] {
  const out: EconomyClaim[] = [];
  (c.effects ?? []).forEach((e, index) => {
    if (!ECON_KIND.test(e.kind) || /Buff|Stats|Spell|Minion|Rubies|Ruby|Refreshes|Shop/.test(e.kind)) return;
    const a = constAmount(c, index);
    if (!a) return;
    const keys = Object.keys(a);
    if (keys.length !== 1 || !ECON_ONE_KEY.has(keys[0]!)) return;
    out.push({ index, key: keys[0]!, value: a[keys[0]!]!, branch: branchOf(e) });
  });
  return out;
}

// ── keyword grant ────────────────────────────────────────────────────────────────────────────────────────

const KEYWORD_KIND = /Keyword|Taunt|Ward|Reborn|Magnetic|Shield|Stealth|Poison|Venom|Crit|Charge|Decoy|Engrave|Gild/;
const NOT_KEYWORD = /Strip|Lost|Break|Magnetize/;

export const keywordGrantEffects = (c: ContentContract): number[] =>
  (c.effects ?? []).flatMap((e, i) => (KEYWORD_KIND.test(e.kind) && !NOT_KEYWORD.test(e.kind) && !e.summons ? [i] : []));

// ── equipment ────────────────────────────────────────────────────────────────────────────────────────────

export const equipmentEffects = (c: ContentContract): number[] =>
  (c.effects ?? []).flatMap((e, i) => (e.kind === 'grantEquipment' ? [i] : []));

// ── vanilla body ─────────────────────────────────────────────────────────────────────────────────────────

const CARD_TYPES = new Set(['minion', 'spell', 'token', 'gift', 'henchman']);

/** Def keys that carry no behaviour beyond what a contract's identity already states. Everything else
 *  outside playScan's CONTROL_KEY_WHITELIST is a BEHAVIOUR CHANNEL the extractor does not read
 *  (`discoverOnPlay`, `attackOnSummon`, `critChance`, `manaPerTurn`, `splashAdjacent`, `ruby`, …). */
const INERT_DEF_KEYS: ReadonlySet<string> = new Set(['spell', 'cost', 'gift', 'henchman', 'imp', 'noTriple', 'art', 'flavor']);

/** The def-level behaviour keys a card carries that its contract cannot state — the vanilla family refuses
 *  such a card (its "no effects" is an extractor gap, not a claim) and the skip names the keys. */
export function defBehaviourKeys(contentId: string): string[] {
  const d = CARD_INDEX[contentId] as unknown as Record<string, unknown> | undefined;
  if (!d) return [];
  return Object.keys(d).filter((k) => d[k] !== undefined && !CONTROL_KEY_WHITELIST.has(k) && !INERT_DEF_KEYS.has(k)).sort();
}

export const isVanillaContract = (c: ContentContract): boolean =>
  CARD_TYPES.has(c.contentType) && (c.triggers ?? []).length === 0 && (c.effects ?? []).length === 0
  && !c.multiplier && !c.copyPolicy && !!CARD_INDEX[c.contentId] && defBehaviourKeys(c.contentId).length === 0;

// ── the family of a contract, in planning order ──────────────────────────────────────────────────────────

export type FamilyDriverId = 'stat-grant' | 'card-grant' | 'economy' | 'keyword-grant' | 'equipment' | 'vanilla-body' | 'activation';

export const FAMILY_DRIVERS: readonly FamilyDriverId[] = ['stat-grant', 'card-grant', 'economy', 'keyword-grant', 'equipment', 'vanilla-body', 'activation'];

/** Which family drivers apply to a contract (several can — a Shout that buffs AND grants a spell). Vanilla
 *  bodies need no trigger; every other family needs a stageable one. A card contract with effects that no
 *  MAGNITUDE family can read (a copy, a transform, a refresh, a scaler the first activation does not print)
 *  gets the ACTIVATION family: its minimum-activation case is driven as a control-body differential, and its
 *  magnitude template stays a typed skip. */
export function familiesOf(c: ContentContract): FamilyDriverId[] {
  if (isVanillaContract(c)) return ['vanilla-body'];
  const out: FamilyDriverId[] = [];
  if (equipmentEffects(c).length && (c.triggers ?? []).some((t) => t.event === 'equip')) out.push('equipment');
  if (!stageableTrigger(c)) return out;
  if (statGrantEffects(c).length) out.push('stat-grant');
  if (cardGrantEffects(c).length) out.push('card-grant');
  if (economyEffects(c).length) out.push('economy');
  if (keywordGrantEffects(c).length) out.push('keyword-grant');
  if (out.length === 0 && (c.effects ?? []).length > 0 && CARD_TYPES.has(c.contentType)) out.push('activation');
  return out;
}

/** Does the contract state ANY numeric magnitude (a const amount with numeric keys) — the activation family
 *  types its 'plain' skip by this: a scaler magnitude is 'no-driver-for-shape' (named keys), none at all is
 *  'contract-states-no-magnitude'. */
export const statesMagnitude = (c: ContentContract): boolean =>
  (c.effects ?? []).some((_, i) => Object.keys(constAmount(c, i) ?? {}).length > 0);

/** WHY a contract joined no family — printed in its typed skip so the burn-down list names what a driver
 *  would have to understand: the amount keys (a scaler), the un-stageable trigger, or a def-level behaviour
 *  field the extractor never states. */
export function undrivenDetail(c: ContentContract): string {
  const keys = new Set<string>();
  (c.effects ?? []).forEach((_, i) => { for (const k of Object.keys(constAmount(c, i) ?? {})) keys.add(k); });
  const parts: string[] = [];
  if (keys.size) parts.push(`amount keys [${[...keys].sort().join(', ')}]`);
  if ((c.triggers ?? []).length && !stageableTrigger(c)) parts.push('no stageable trigger');
  const beh = defBehaviourKeys(c.contentId);
  if ((c.effects ?? []).length === 0 && beh.length) parts.push(`def-level behaviour the contract does not state [${beh.join(', ')}] (extractor gap)`);
  return parts.join(' · ');
}
