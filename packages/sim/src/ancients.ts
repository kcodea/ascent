/**
 * ANCIENTS (proof of concept, owner rulings 2026-09-25) — a run-defining transformation of the HERO POWER.
 *
 * ── Scope ─────────────────────────────────────────────────────────────────────────────────────────────────────
 * Scene Builder, Set 3 only, behind `RunState.ancientsEnabled`. Nothing here runs unless that flag is on AND the
 * run carries an `ancients` block, so a lobby / practice / normal run (and every replay and golden) is untouched:
 * every hook below returns before reading or writing anything when `state.ancients` is absent.
 *
 * ── The loop ──────────────────────────────────────────────────────────────────────────────────────────────────
 *  1. THE METER FILLS (owner ruling 2, re-worded on the first playable: "it should fill the meter not deplete it"):
 *     it starts empty, every Shop refresh ADDS `refresh` (1, paid or free, no distinction), every combat fought ADDS
 *     `combat` (2), and it awakens when it reaches `cost` (16). All three are tuner values stamped on the run at
 *     creation, and `ANCIENT_METER_BY_HERO` is the per-hero override seam.
 *  2. AT FULL the Ancient awakens ONCE: the Shop pauses behind a Discover of 3 of the 5 Ancients, a seeded pick off a
 *     salted stream (never the run cursor, so the rest of the run's RNG is unaffected by when it awakens).
 *  3. THE PICK locks it for the run. Its effect is the PAIRING for the current hero: DATA in `ANCIENT_PAIRINGS`
 *     (Ancient × hero → text + effect primitives). A hero with no written pairing shows "Not written yet" and
 *     does nothing.
 *
 * ── Where each primitive fires ────────────────────────────────────────────────────────────────────────────────
 *  · `powerTargetGainsKeywords`   the reducer's `gild` hero-power branch, after the gild (Death).
 *  · `powerGivesCopiesInstead`    the same branch, INSTEAD of the gild (Genesis); the branch's `checkTriples`.
 *  · `sellGildedGetsPlainCopy`    `settleMinionSale`, the one chokepoint every sale walks (Fortune).
 *  · `friendlyDeathBuffsGilded`   SHOP: `afterShopDestroy`, the one chokepoint both shop-destroy paths walk;
 *                                 COMBAT: `QuestCombatMods.ancientWar`, an `onDeath` listener in `simulate`, with
 *                                 the gain recorded as `permaGain` so it carries back (War, cross-phase).
 *  · `socGildRightmost`           COMBAT only: `QuestCombatMods.ancientTimeGild`, at Start of Combat (Time). The
 *                                 gild lives on the combat body only, so it reverts after the fight.
 *
 * Serialisable plain data throughout, so saves / snapshots / replays can carry it cheaply later (not in the MVP).
 */
import { makeRng, type Keyword, type QuestCombatMods } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { mixSeed, type BoardCard, type RunState } from './state';
import { addBuff, captureBuffFx, grantMinionToHandOrBoard } from './recruit';
import { INDY_GILD_RECHARGE_GOLD } from './config';

export type AncientId = 'death' | 'fortune' | 'war' | 'genesis' | 'time';
export const ANCIENT_IDS: readonly AncientId[] = ['death', 'fortune', 'war', 'genesis', 'time'];

export interface AncientDef {
  id: AncientId;
  name: string;
  /** The one-line mechanical thesis (the handoff's identity), shown under the name. */
  thesis: string;
  /** PLACEHOLDER face: the emblem glyph + its colour (the UI draws a flat emblem from these; `color2` is spare). */
  glyph: string;
  color: string;
  color2: string;
}

export const ANCIENTS: Record<AncientId, AncientDef> = {
  death: { id: 'death', name: 'Ancient of Death', thesis: 'What you can afford to lose.', glyph: '☠', color: '#8c7ae0', color2: '#2a1f45' },
  fortune: { id: 'fortune', name: 'Ancient of Fortune', thesis: 'Take value now, or bank it.', glyph: '⚜', color: '#e9b43a', color2: '#5a3f0c' },
  war: { id: 'war', name: 'Ancient of War', thesis: 'Who fights, and where they stand.', glyph: '⚔', color: '#e45a4a', color2: '#4a1410' },
  genesis: { id: 'genesis', name: 'Ancient of Genesis', thesis: 'Create, copy and circulate.', glyph: '✺', color: '#3fb97a', color2: '#12402a' },
  time: { id: 'time', name: 'Ancient of Time', thesis: 'Now, later, or both.', glyph: '⧗', color: '#3fa3de', color2: '#10334a' },
};

// ── Effect primitives ────────────────────────────────────────────────────────────────────────────────────────
/** The Ancient effect vocabulary. A new pairing is data built from these; a genuinely new behaviour adds ONE
 *  primitive here plus its single hook (the card-effect contract, applied to Ancients). */
export type AncientEffect =
  /** The hero power's TARGET also gains these keywords, permanently. */
  | { do: 'powerTargetGainsKeywords'; keywords: Keyword[] }
  /** The hero power no longer does its own thing: it gives `count` PLAIN copies of the target instead (triples checked). */
  | { do: 'powerGivesCopiesInstead'; count: number }
  /** Selling a GILDED minion (any source) gets a plain copy of it. */
  | { do: 'sellGildedGetsPlainCopy'; count: number }
  /** Whenever a friendly minion dies (Shop AND combat), your gilded minions gain +a/+h, permanently. */
  | { do: 'friendlyDeathBuffsGilded'; attack: number; health: number }
  /** Start of Combat: your right-most minion becomes Gilded for that combat (reverts after). */
  | { do: 'socGildRightmost' };

export interface AncientPairing {
  /** The Ancient's text for this hero, as shown on the offer and the preview (the owner's words). */
  offerText: string;
  /** The RESOLVED hero-power text (owner ruling 5: "shows the combined power"). `{base}` = the base power's live
   *  text; `{recharge}` = Indy's live recharge Gold. */
  powerText: string;
  effects: AncientEffect[];
}

/** Shown for a hero × Ancient with no written pairing. Has no effect. */
export const ANCIENT_NOT_WRITTEN = 'Not written yet.';

/** The pairing registry: hero id → Ancient → pairing. Indy is the MVP hero (owner ruling 5). */
export const ANCIENT_PAIRINGS: Record<string, Partial<Record<AncientId, AncientPairing>>> = {
  indy: {
    death: {
      offerText: 'Masterwork targets gain **Rise** and **Taunt**.',
      powerText: 'Make a friendly minion **Gilded**. It also gains **Rise** and **Taunt**. Recharges after you spend {recharge} Gold.',
      effects: [{ do: 'powerTargetGainsKeywords', keywords: ['R', 'T'] }],
    },
    fortune: {
      offerText: 'Selling a **Gilded** minion gets you a plain copy of it.',
      powerText: '{base} Selling a **Gilded** minion gets you a plain copy of it.',
      effects: [{ do: 'sellGildedGetsPlainCopy', count: 1 }],
    },
    war: {
      offerText: '**Gilded** minions gain **+8/+8** when a friendly minion dies, permanently.',
      powerText: '{base} Whenever a friendly minion dies, your **Gilded** minions gain **+8/+8** permanently.',
      effects: [{ do: 'friendlyDeathBuffsGilded', attack: 8, health: 8 }],
    },
    genesis: {
      offerText: 'Masterwork gets **2** copies of a chosen minion instead. This checks for triples.',
      powerText: 'Get **2** plain copies of a friendly minion. This checks for triples. Recharges after you spend {recharge} Gold.',
      effects: [{ do: 'powerGivesCopiesInstead', count: 2 }],
    },
    time: {
      offerText: '**Start of Combat:** your right-most minion becomes **Gilded** for that combat.',
      powerText: '{base} **Start of Combat:** your right-most minion becomes **Gilded** for that combat.',
      effects: [{ do: 'socGildRightmost' }],
    },
  },
};

export function ancientPairingFor(heroId: string, id: AncientId): AncientPairing | undefined {
  return ANCIENT_PAIRINGS[heroId]?.[id];
}

/** The text an Ancient shows for a hero (the offer card / the hover preview). */
export function ancientOfferText(heroId: string, id: AncientId): string {
  return ancientPairingFor(heroId, id)?.offerText ?? ANCIENT_NOT_WRITTEN;
}

// ── The meter ────────────────────────────────────────────────────────────────────────────────────────────────
export interface AncientMeterTuning {
  /** Points the meter needs to awaken (full). */
  cost: number;
  /** Points one Shop refresh adds. */
  refresh: number;
  /** Points one combat adds. */
  combat: number;
}
export const ANCIENT_METER_DEFAULTS: AncientMeterTuning = { cost: 16, refresh: 1, combat: 2 };
/** PER-HERO overrides (owner: "per-hero balance later"). Empty today; a hero entry wins over the defaults, and a
 *  tuner override wins over both. */
export const ANCIENT_METER_BY_HERO: Record<string, Partial<AncientMeterTuning>> = {};

export function ancientMeterFor(heroId: string, override?: Partial<AncientMeterTuning>): AncientMeterTuning {
  return { ...ANCIENT_METER_DEFAULTS, ...(ANCIENT_METER_BY_HERO[heroId] ?? {}), ...(override ?? {}) };
}

/** The run's Ancient state. Present only when `ancientsEnabled`. */
export interface AncientsState {
  /** Points FILLED so far (counts up to `cost`, which awakens it). */
  points: number;
  cost: number;
  refresh: number;
  combat: number;
  /** The open offer (3 distinct Ancients) — the Shop is paused while set. */
  offer?: AncientId[];
  /** The Ancient locked in for the run. */
  picked?: AncientId;
  /** The wave it awakened (the offer opened). */
  awakenedWave?: number;
  /** Monotonic UI cues: a gain (with its size + why), the offer opening, the pick. */
  gainSeq?: number;
  lastGain?: { amount: number; why: 'refresh' | 'combat' | 'set' };
  offerSeq?: number;
  pickSeq?: number;
}

/** Turn Ancients on for a run (the Scene Builder's Set 3 flag). Pure: returns a new run. */
export function enableAncients(run: RunState, override?: Partial<AncientMeterTuning>): RunState {
  const t = ancientMeterFor(run.heroId, override);
  return { ...run, ancientsEnabled: true, ancients: { points: 0, cost: t.cost, refresh: t.refresh, combat: t.combat } };
}

/** The Ancient state when this run plays with Ancients, else undefined (the single gate every hook reads). */
function live(state: RunState): AncientsState | undefined {
  return state.ancientsEnabled ? state.ancients : undefined;
}

/** Salt for the offer's own seeded stream (distinct from the TAG table in state.ts). */
const ANCIENT_SALT = 0x41;

/** Open the awakening offer: 3 distinct Ancients, seeded off the run seed + wave (never the run cursor). */
function awaken(state: RunState, a: AncientsState): void {
  if (a.picked || a.offer) return;
  const rng = makeRng(mixSeed(state.seed, ANCIENT_SALT, state.wave));
  const pool = [...ANCIENT_IDS];
  const offer: AncientId[] = [];
  while (offer.length < 3 && pool.length > 0) offer.push(pool.splice(rng.int(pool.length), 1)[0]!);
  a.offer = offer;
  a.awakenedWave = state.wave;
  a.offerSeq = (a.offerSeq ?? 0) + 1;
}

/** Add `amount` points (capped at full); awakens EXACTLY once, the moment it first fills. */
function fill(state: RunState, amount: number, why: 'refresh' | 'combat'): void {
  const a = live(state);
  if (!a || a.picked || a.offer || a.points >= a.cost || amount <= 0) return;
  const before = a.points;
  a.points = Math.min(a.cost, a.points + amount);
  a.lastGain = { amount: a.points - before, why };
  a.gainSeq = (a.gainSeq ?? 0) + 1;
  if (a.points >= a.cost) awaken(state, a);
}

/** A Shop refresh happened (any refresh, paid or free): the meter fills by `refresh`. */
export function ancientsRefreshTick(state: RunState): void {
  const a = live(state);
  if (a) fill(state, a.refresh, 'refresh');
}

/** A combat was fought (called as the next Shop opens): the meter fills by `combat`. */
export function ancientsCombatTick(state: RunState): void {
  const a = live(state);
  if (a) fill(state, a.combat, 'combat');
}

/** DEV (Scene Builder "Fill meter" / set-meter): set the points filled. Full awakens it. */
export function ancientsSetMeter(state: RunState, points: number): void {
  const a = live(state);
  if (!a || a.picked || a.offer) return;
  a.points = Math.max(0, Math.min(a.cost, Math.floor(points)));
  a.lastGain = { amount: 0, why: 'set' };
  a.gainSeq = (a.gainSeq ?? 0) + 1;
  if (a.points >= a.cost) awaken(state, a);
}

/** Lock an offered Ancient in. Returns false (a refused action) when `id` was not offered. */
export function pickAncient(state: RunState, id: AncientId): boolean {
  const a = live(state);
  if (!a?.offer?.includes(id)) return false;
  a.picked = id;
  a.offer = undefined;
  a.pickSeq = (a.pickSeq ?? 0) + 1;
  return true;
}

/** The Shop is paused behind the awakening offer. */
export function ancientOfferOpen(state: RunState): boolean {
  return !!live(state)?.offer?.length;
}

/** The picked Ancient's pairing for the current hero (undefined = none picked, or "Not written yet"). */
export function activeAncientPairing(state: RunState): AncientPairing | undefined {
  const a = live(state);
  return a?.picked ? ancientPairingFor(state.heroId, a.picked) : undefined;
}

function effectOf<K extends AncientEffect['do']>(state: RunState, kind: K): Extract<AncientEffect, { do: K }> | undefined {
  return activeAncientPairing(state)?.effects.find((e): e is Extract<AncientEffect, { do: K }> => e.do === kind);
}

/** The resolved hero-power text, or undefined when no pairing is active (the caller keeps its base text). */
export function ancientPowerText(state: RunState, base: string): string | undefined {
  const p = activeAncientPairing(state);
  if (!p) return undefined;
  return p.powerText.replace('{base}', base).replace('{recharge}', String(INDY_GILD_RECHARGE_GOLD));
}

// ── Hooks ────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The `gild` hero power resolving on `card`. Returns true when the Ancient REPLACED the gild (Genesis), so the
 * caller skips its own gild; false = gild as normal (and `ancientAfterPowerGild` runs after).
 */
export function ancientReplacesPowerGild(state: RunState, card: BoardCard): boolean {
  const e = effectOf(state, 'powerGivesCopiesInstead');
  if (!e) return false;
  const def = CARD_INDEX[card.cardId];
  if (!def) return true;
  // Plain copies (printed card, never gilded) — the same grant the Rune of Last Rites uses: hand first, the
  // board when the hand is full. The reducer's `checkTriples` after the power completes a triple with the original.
  for (let i = 0; i < e.count; i++) grantMinionToHandOrBoard(state, def, false);
  return true;
}

/** After the `gild` hero power gilded `card` (Death: it also gains Rise + Taunt, permanently). */
export function ancientAfterPowerGild(state: RunState, card: BoardCard): void {
  const e = effectOf(state, 'powerTargetGainsKeywords');
  if (!e) return;
  for (const k of e.keywords) if (!card.keywords.includes(k)) card.keywords.push(k);
}

/** A minion was sold (Fortune: a gilded one gets a plain copy to hand). */
export function ancientOnSale(state: RunState, sold: BoardCard): void {
  const e = effectOf(state, 'sellGildedGetsPlainCopy');
  if (!e || !sold.golden) return;
  const def = CARD_INDEX[sold.cardId];
  if (!def || def.spell) return;
  for (let i = 0; i < e.count; i++) grantMinionToHandOrBoard(state, def, false);
}

/** A friendly minion died in the Shop (War: every OTHER gilded board minion gains, permanently). */
export function ancientOnShopDeath(state: RunState, died: BoardCard): void {
  const e = effectOf(state, 'friendlyDeathBuffsGilded');
  if (!e) return;
  const gilded = state.board.filter((c) => c.golden && c.uid !== died.uid);
  if (gilded.length === 0) return;
  captureBuffFx(state, undefined, 'spell', () => {
    for (const c of gilded) addBuff(c, ANCIENTS.war.name, e.attack, e.health);
  });
}

/** The combat modifiers the picked Ancient threads into the player's fight (War / Time). Player-only: never part
 *  of a snapshot (opponents' Ancients are out of the MVP). */
export function ancientCombatMods(state: RunState): Partial<QuestCombatMods> {
  const out: Partial<QuestCombatMods> = {};
  const war = effectOf(state, 'friendlyDeathBuffsGilded');
  if (war) out.ancientWar = { attack: war.attack, health: war.health, label: ANCIENTS.war.name };
  if (effectOf(state, 'socGildRightmost')) out.ancientTimeGild = { label: ANCIENTS.time.name };
  return out;
}
