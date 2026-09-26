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
 *  · `powerTargetGainsKeywords`   the reducer's `gild` hero-power branch, after the gild (Death: Rebirth + Taunt).
 *  · `powerGivesCopiesInstead`    the same branch, INSTEAD of the gild (Genesis); the branch's `checkTriples`.
 *  · `sellGildedGetsPlainCopy`    `settleMinionSale`, the one chokepoint every sale walks (Fortune).
 *  · `friendlyDeathBuffsGilded`   SHOP: `afterShopDestroy`, the one chokepoint both shop-destroy paths walk;
 *                                 COMBAT: `QuestCombatMods.ancientWar`, an `onDeath` listener in `simulate`, with
 *                                 the gain recorded as `permaGain` so it carries back (War, cross-phase).
 *  · `socGildRightmost`           COMBAT only: `QuestCombatMods.ancientTimeGild`, at Start of Combat (Time). The
 *                                 gild lives on the combat body only, so it reverts after the fight.
 *  · `powerTargetsGilded`         the reducer's `gild` branch: an already-Gilded target is legal (Bonds).
 *  · `powerBuffPerGild`           the same branch, after the gild: the target gains +a/+h × the run's gild count
 *                                 (`AncientsState.gilds`, ticked by `noteGilded` in `gildMinion` + the triple).
 *
 *  WARDEN (Aegis, `grantWard`; owner pairings 2026-09-26):
 *  · `aegisDestroyGivesAttackAndWard`  the reducer's `grantWard` branch: the Aegis target is destroyed (a real
 *                                 shop death) and a RANDOM other friendly minion gains its Attack and Ward, preferring
 *                                 one without Ward. REPLACES the power (no +5 Attack to Warded minions). (Death)
 *  · `wardBreakGold`              `ancientAfterCombat` (settle): +gold next turn per FRIENDLY Ward that broke. (Fortune)
 *  · `nextAegisResilient`         the `grantWard` branch: the next `count` Aegis casts after the pick grant
 *                                 RESILIENT Ward instead of Ward (`AncientsState.resilientAegisLeft`). (War)
 *  · `wardBreaksGetCopy`          REAL-TIME (owner 2026-09-26): `QuestCombatMods.ancientWardCopy` carries the running
 *                                 break window into the fight; the moment the `every`th Ward breaks, a plain copy of
 *                                 one of those minions goes to hand mid-fight (a live `toHand`). `ancientAfterCombat`
 *                                 only stores the window the fight hands back. (Genesis)
 *  · `eotBuffWarded`              a virtual recurring End-of-Turn entry (`ancientTimeWard` in `recurringEotEffects`):
 *                                 every minion with Ward gains +a/+h, permanently. (Time)
 *  · `wardedGainBuffsWarded`      SHOP: `ancientBondsReact` at the reducer's per-action stat diff (+ an End-of-Turn
 *                                 pass so its grants land before the fight); COMBAT: `QuestCombatMods.ancientBonds`
 *                                 in `ctx.buff`. Its own grant never re-triggers it. (Bonds)
 *
 *  AUCTIONEER (`myra`, Pulse, `replayBattlecry`; owner pairings 2026-09-26):
 *  · `pulseRepeatThenDestroy`     the reducer's `replayBattlecry` branch: the Shout fires `1 + extra` times per Pulse,
 *                                 then the target is destroyed (a real shop death via `destroyMinionInShop`). (Death)
 *  · `shopShoutGold`              `fireBattlecryTriggered` (every SHOP Shout fire walks it): +gold next turn per fire,
 *                                 real time. Combat Shouts do not count (the text says Shop phase). (Fortune)
 *  · `pulseGrantsRallyShout`      the `replayBattlecry` branch, after the Shout: the target gains the Rally keyword and a
 *                                 grafted `rallyTriggerOwnShout` (`grantedEffects`, so it rides into combat, snapshots
 *                                 and replays). Once per minion: a second Pulse does not stack it. (War)
 *  · `pulseDiscoverShout`         the `replayBattlecry` branch REPLACED: untargeted, `cost` Gold (the pairing's `power`
 *                                 override), a Discover of a Shout minion at your tier or below. (Genesis)
 *  · `socTriggerEdgeShouts`       COMBAT: `QuestCombatMods.ancientEdgeShouts`, at Start of Combat. The power turns
 *                                 passive (the pairing's `power` override). (Time)
 *  · `shoutBuffsAdjacent`         SHOP: `fireBattlecryTriggered` (per fire, real time); COMBAT:
 *                                 `QuestCombatMods.ancientShoutAdjacent`, a `battlecryTriggered` listener. (Bonds)
 *
 * Serialisable plain data throughout, so saves / snapshots / replays can carry it cheaply later (not in the MVP).
 */
import { makeRng, type EffectDef, type Keyword, type QuestCombatMods } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { mixSeed, type BoardCard, type RunState } from './state';
import type { HeroPower } from './heroes';
import type { CombatResult } from '@game/core';
import { addBuff, aegisGrantOf, captureBuffFx, destroyMinionInShop, grantMinionToHandOrBoard, makeContext } from './recruit';
import { INDY_GILD_RECHARGE_GOLD } from './config';

export type AncientId = 'death' | 'fortune' | 'war' | 'genesis' | 'time' | 'bonds';
export const ANCIENT_IDS: readonly AncientId[] = ['death', 'fortune', 'war', 'genesis', 'time', 'bonds'];

export interface AncientDef {
  id: AncientId;
  name: string;
  /** THE ANCIENT'S COLOUR TABLE (owner 2026-09-25: Death green/teal, Fortune gold; War crimson, Genesis leaf green and
   *  Time azure are placeholders): its pill, its preview dot, and the flat placeholder emblem. `glyph` is the placeholder
   *  emblem's mark; `color2` is spare. The ✦ Ancients tuner can override each colour live. */
  glyph: string;
  color: string;
  color2: string;
}

export const ANCIENTS: Record<AncientId, AncientDef> = {
  death: { id: 'death', name: 'Ancient of Death', glyph: '☠', color: '#1fa89a', color2: '#2a1f45' },
  fortune: { id: 'fortune', name: 'Ancient of Fortune', glyph: '⚜', color: '#e3aa2b', color2: '#5a3f0c' },
  war: { id: 'war', name: 'Ancient of War', glyph: '⚔', color: '#c9363b', color2: '#4a1410' },
  genesis: { id: 'genesis', name: 'Ancient of Genesis', glyph: '✺', color: '#5aae3c', color2: '#12402a' },
  time: { id: 'time', name: 'Ancient of Time', glyph: '⧗', color: '#2f8fd8', color2: '#10334a' },
  // Purple (owner 2026-09-26: "purple aesthetic"): a warm violet, clear of Time's azure and the teal curtain.
  bonds: { id: 'bonds', name: 'Ancient of Bonds', glyph: '∞', color: '#9b5de5', color2: '#2e1650' },
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
  | { do: 'socGildRightmost' }
  /** The hero power may target an already-Gilded minion (it is not gilded again; the rest still applies). */
  | { do: 'powerTargetsGilded' }
  /** The hero power's target gains +a/+h for every minion that became Gilded this run, permanently. */
  | { do: 'powerBuffPerGild'; attack: number; health: number }
  // ── Warden (Aegis) ──
  /** Aegis destroys its target; a random other friendly minion (one without Ward first) gains its Attack (permanent)
   *  and Ward. Replaces the power's own grant. */
  | { do: 'aegisDestroyGivesAttackAndWard' }
  /** Each FRIENDLY Ward that breaks in combat: gain `gold` next turn (stacking). */
  | { do: 'wardBreakGold'; gold: number }
  /** The next `count` Aegis casts after the pick grant Resilient Ward instead of Ward. */
  | { do: 'nextAegisResilient'; count: number }
  /** Every `every` friendly Ward breaks in combat (a running count across combats): get a plain copy of one of the
   *  minions whose Ward broke in that window. */
  | { do: 'wardBreaksGetCopy'; every: number }
  /** End of Turn: every friendly minion with Ward gains +a/+h, permanently. */
  | { do: 'eotBuffWarded'; attack: number; health: number }
  /** When a friendly minion with Ward gains stats, another random friendly minion with Ward gains +attack Attack.
   *  That grant never re-triggers it. */
  | { do: 'wardedGainBuffsWarded'; attack: number }
  // ── Auctioneer (Pulse) ──
  /** Pulse fires the target's Shout `extra` more times, then destroys it (a real shop death). */
  | { do: 'pulseRepeatThenDestroy'; extra: number }
  /** Every Shout FIRE in the Shop phase: gain `gold` next turn. Combat Shouts do not count. */
  | { do: 'shopShoutGold'; gold: number }
  /** The Pulse target also gains "Rally: trigger this minion's Shout" (once per minion). */
  | { do: 'pulseGrantsRallyShout' }
  /** Pulse is replaced: Discover a Shout minion at your tier or below (the cost rides the pairing's `power`). */
  | { do: 'pulseDiscoverShout' }
  /** Start of Combat: trigger your left-most and right-most Shouts (once when they are the same minion). */
  | { do: 'socTriggerEdgeShouts' }
  /** Whenever a friendly Shout triggers (Shop AND combat), the minions next to it gain +a/+h. */
  | { do: 'shoutBuffsAdjacent'; attack: number; health: number };

export interface AncientPairing {
  /** The Ancient's text for this hero, as shown on the offer and the preview (the owner's words). */
  offerText: string;
  /** The RESOLVED hero-power text (owner ruling 5: "shows the combined power"). `{base}` = the base power's live
   *  text; `{recharge}` = Indy's live recharge Gold; `{gilds}` / `{gildA}` / `{gildH}` = the run's gild count and
   *  the live Bonds total it grants right now; `{aegis}` = Warden's live Aegis grant ("+5 Attack"); `{wardLeft}` =
   *  Ward breaks still needed for Genesis' next copy. */
  powerText: string;
  /** The resolved text once a one-shot pairing is used up (War's Resilient Aegis). Absent = `powerText` always. */
  powerTextSpent?: string;
  /** Changes to the hero power's own SHAPE while this pairing is live (Auctioneer: Time makes Pulse passive, Genesis
   *  makes it an untargeted 2 Gold Discover). Stamped on the run at the pick (`AncientsState.powerOverride`) and
   *  folded in by `activePowers`, so the button, the cost coin, the reducer's gates and the bots all read one shape. */
  power?: AncientPowerOverride;
  effects: AncientEffect[];
}

/** The hero-power fields a pairing may override. */
export type AncientPowerOverride = Partial<Pick<HeroPower, 'passive' | 'untargeted' | 'cost'>>;

/** Shown for a hero × Ancient with no written pairing. Has no effect. */
export const ANCIENT_NOT_WRITTEN = 'Not written yet.';

/** The pairing registry: hero id → Ancient → pairing. Indy is the MVP hero (owner ruling 5). */
export const ANCIENT_PAIRINGS: Record<string, Partial<Record<AncientId, AncientPairing>>> = {
  indy: {
    death: {
      // Rebirth, not Rise (owner 2026-09-25: "change indy's ancient of death to give it rebirth instead of rise. it
      // still gets taunt").
      offerText: 'Masterwork targets gain **Rebirth** and **Taunt**.',
      powerText: 'Make a friendly minion **Gilded**. It also gains **Rebirth** and **Taunt**. Recharges after you spend {recharge} Gold.',
      effects: [{ do: 'powerTargetGainsKeywords', keywords: ['RB', 'T'] }],
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
      offerText: 'Masterwork gets **2** copies of a chosen minion instead.',
      powerText: 'Get **2** plain copies of a friendly minion. Recharges after you spend {recharge} Gold.',
      effects: [{ do: 'powerGivesCopiesInstead', count: 2 }],
    },
    time: {
      offerText: '**Start of Combat:** your right-most minion becomes **Gilded** for that combat.',
      powerText: '{base} **Start of Combat:** your right-most minion becomes **Gilded** for that combat.',
      effects: [{ do: 'socGildRightmost' }],
    },
    bonds: {
      // Owner 2026-09-26: "Ancient of Bonds for Indy -> Masterwork grants +20/+20 for every Gilded minion this game.
      // Can target Gilded minions." The count is `AncientsState.gilds` (see `noteGilded`); gilding a fresh target
      // counts that gild too, so the printed total is what an already-Gilded target would get.
      offerText: 'Masterwork also gives **+20/+20** for every **Gilded** minion this game. It can target **Gilded** minions.',
      powerText: 'Make a friendly minion **Gilded**, or pick a **Gilded** one. It gains **+{gildA}/+{gildH}** (+20/+20 for every **Gilded** minion this game: **{gilds}** so far). Recharges after you spend {recharge} Gold.',
      effects: [{ do: 'powerTargetsGilded' }, { do: 'powerBuffPerGild', attack: 20, health: 20 }],
    },
  },
  // THE WARDEN (owner pairings 2026-09-26, quoted above each entry). Aegis = "Give a friendly minion Ward, then give
  // your minions with Ward +5 Attack."
  warden: {
    death: {
      // "Aegis destroys a friendly minion and gives its Attack and Ward to a friendly minion." The power is REPLACED
      // (judgement call, flagged): the recipient gets the Attack + Ward, and no +5 Attack wave follows. Owner
      // 2026-09-26: the recipient is RANDOM and smart-targeted (a minion without Ward first, else a random Warded one).
      offerText: 'Aegis destroys a friendly minion and gives its Attack and **Ward** to another random friendly minion.',
      powerText: 'Destroy a friendly minion. Give its Attack and **Ward** to another random friendly minion (one without **Ward** first).',
      effects: [{ do: 'aegisDestroyGivesAttackAndWard' }],
    },
    fortune: {
      // "When a Ward breaks in combat, gain 2 gold next turn." Friendly Wards only; one payout per break.
      offerText: 'When one of your **Wards** breaks in combat, gain **2 Gold** next turn.',
      powerText: '{base} When one of your **Wards** breaks in combat, gain **2 Gold** next turn.',
      effects: [{ do: 'wardBreakGold', gold: 2 }],
    },
    war: {
      // "Your next Aegis grants Resilient Ward. It takes 2 hits to break." Exactly the NEXT Aegis (flagged).
      offerText: 'Your next Aegis grants **Resilient Ward**. It takes 2 hits to break.',
      powerText: 'Give a friendly minion **Resilient Ward**, then give your minions with **Ward** **{aegis}**. Only your next Aegis grants **Resilient Ward**.',
      powerTextSpent: '{base}',
      effects: [{ do: 'nextAegisResilient', count: 1 }],
    },
    genesis: {
      // "When 3 Wards break in combat, get a copy of one of the Warded minions." A running count across combats.
      offerText: 'When 3 of your **Wards** break in combat, get a copy of one of those minions.',
      powerText: '{base} When 3 of your **Wards** break in combat, get a copy of one of those minions (**{wardLeft}** more to go).',
      effects: [{ do: 'wardBreaksGetCopy', every: 3 }],
    },
    time: {
      // "End of Turn: Give your Warded minions +5/+5." Permanent.
      offerText: '**End of Turn:** give your minions with **Ward** **+5/+5**.',
      powerText: '{base} **End of Turn:** give your minions with **Ward** **+5/+5**.',
      effects: [{ do: 'eotBuffWarded', attack: 5, health: 5 }],
    },
    bonds: {
      // "When a Warded minion gains stats, give another Warded minion +5 attack. this doesnt re-trigger itself".
      offerText: 'When a minion with **Ward** gains stats, give another minion with **Ward** **+5 Attack**. This does not trigger itself.',
      powerText: '{base} When a minion with **Ward** gains stats, give another minion with **Ward** **+5 Attack**. This does not trigger itself.',
      effects: [{ do: 'wardedGainBuffsWarded', attack: 5 }],
    },
  },
  // THE AUCTIONEER (hero id `myra`; owner pairings 2026-09-26, quoted above each entry). Pulse = "Trigger a friendly
  // minion's Shout." (free, once per turn).
  myra: {
    death: {
      // "Pulse triggers the chosen minion's Shout an additional time, then destroys it."
      offerText: "Pulse triggers the minion's **Shout** one more time, then destroys it.",
      powerText: "Trigger a friendly minion's **Shout** twice, then destroy it.",
      effects: [{ do: 'pulseRepeatThenDestroy', extra: 1 }],
    },
    fortune: {
      // "Whenever you trigger a Shout during the Shop phase, gain 1 Gold next turn."
      offerText: 'Whenever you trigger a **Shout** in the Shop, gain **1 Gold** next turn.',
      powerText: '{base} Whenever you trigger a **Shout** in the Shop, gain **1 Gold** next turn. **{shoutGold} Gold** banked this turn.',
      effects: [{ do: 'shopShoutGold', gold: 1 }],
    },
    war: {
      // "The minion you Pulse gains 'Rally: trigger this minion's Shout'".
      offerText: 'The minion you Pulse also gains "**Rally:** trigger this minion\'s **Shout**."',
      powerText: '{base} It also gains "**Rally:** trigger this minion\'s **Shout**."',
      effects: [{ do: 'pulseGrantsRallyShout' }],
    },
    genesis: {
      // "Pulse becomes: 2g - Discover a Shout minion."
      offerText: 'Pulse becomes: pay **2 Gold** to **Discover** a **Shout** minion.',
      powerText: '**Discover** a **Shout** minion.',
      power: { untargeted: true, cost: 2 },
      effects: [{ do: 'pulseDiscoverShout' }],
    },
    time: {
      // "Pulse becomes passive. Start of Combat: trigger your left-most and right-most Shouts. If you have only one
      // Shout, trigger it once."
      offerText: 'Pulse becomes passive. **Start of Combat:** trigger your left-most and right-most **Shouts**. With only one, trigger it once.',
      powerText: '**Start of Combat:** trigger your left-most and right-most **Shouts**. With only one, trigger it once.',
      power: { passive: true },
      effects: [{ do: 'socTriggerEdgeShouts' }],
    },
    bonds: {
      // "Shout triggers buff adjacent minions +4/+3."
      offerText: 'Whenever you trigger a **Shout**, the minions next to it gain **+4/+3**.',
      powerText: '{base} Whenever you trigger a **Shout**, the minions next to it gain **+4/+3**.',
      effects: [{ do: 'shoutBuffsAdjacent', attack: 4, health: 3 }],
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
  /** Minions that became Gilded this run (Bonds' count): +1 per `gildMinion` call that gilds a minion (Masterwork,
   *  Golden Touch, gilded Discovers and payouts, every other gild effect) and +1 per triple. Ticks from the run's
   *  start whichever Ancient is picked, so Bonds counts gilds made before it awakened. */
  gilds?: number;
  /** WARDEN × WAR: Aegis casts still to grant Resilient Ward (set on the pick, spent by Aegis). */
  resilientAegisLeft?: number;
  /** WARDEN × GENESIS: friendly Ward breaks counted since the pick (carries across combats), and the cardIds of the
   *  minions whose Ward broke in the CURRENT window (cleared each time a copy is paid). */
  wardBreaks?: number;
  wardWindow?: string[];
  /** WARDEN × BONDS: board uids whose gain (or Bonds grant) the End-of-Turn pass already handled this action, so the
   *  reducer's per-action diff does not handle them again. Transient: cleared by the diff. */
  bondsHandled?: string[];
  /** The picked pairing's hero-power shape override (`AncientPairing.power`), stamped at the pick. Read by
   *  `activePowers` (heroes.ts), which cannot import this module without a cycle. */
  powerOverride?: AncientPowerOverride;
  /** AUCTIONEER × FORTUNE: Gold banked by Shop Shouts on `wave` (the live power text prints it). */
  shoutGold?: { wave: number; gold: number };
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
  const res = effectOf(state, 'nextAegisResilient');
  if (res) a.resilientAegisLeft = res.count;
  const shape = activeAncientPairing(state)?.power;
  if (shape) a.powerOverride = { ...shape };
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
  const per = effectOf(state, 'powerBuffPerGild');
  const a = live(state);
  const gilds = a?.gilds ?? 0;
  const spent = !!effectOf(state, 'nextAegisResilient') && (a?.resilientAegisLeft ?? 0) <= 0;
  const text = spent && p.powerTextSpent ? p.powerTextSpent : p.powerText;
  const g = aegisGrantOf(state);
  const aegis = g.health > 0 ? `+${g.attack}/+${g.health}` : `+${g.attack} Attack`;
  const copy = effectOf(state, 'wardBreaksGetCopy');
  const wardLeft = copy ? copy.every - ((a?.wardWindow?.length ?? 0) % copy.every) : 0;
  const shoutGold = a?.shoutGold?.wave === state.wave ? a.shoutGold.gold : 0;
  return text.replace('{base}', base).replace('{shoutGold}', String(shoutGold)).replace('{aegis}', aegis).replace('{wardLeft}', String(wardLeft)).replace('{recharge}', String(INDY_GILD_RECHARGE_GOLD))
    .replace('{gilds}', String(gilds)).replace('{gildA}', String((per?.attack ?? 0) * gilds)).replace('{gildH}', String((per?.health ?? 0) * gilds));
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

/** The `gild` hero power may take an already-Gilded target (Bonds). */
export function ancientPowerTargetsGilded(state: RunState): boolean {
  return !!effectOf(state, 'powerTargetsGilded');
}

/** After the `gild` hero power resolved on `card` (Death: it also gains Rebirth + Taunt, permanently; Bonds: it gains
 *  +a/+h for every minion Gilded this run, the gild just made included). */
export function ancientAfterPowerGild(state: RunState, card: BoardCard): void {
  const e = effectOf(state, 'powerTargetGainsKeywords');
  if (e) for (const k of e.keywords) if (!card.keywords.includes(k)) card.keywords.push(k);
  const per = effectOf(state, 'powerBuffPerGild');
  const gilds = live(state)?.gilds ?? 0;
  if (per && gilds > 0) {
    captureBuffFx(state, undefined, 'spell', () => addBuff(card, ANCIENTS.bonds.name, per.attack * gilds, per.health * gilds));
  }
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
  const bonds = effectOf(state, 'wardedGainBuffsWarded');
  if (bonds) out.ancientBonds = { attack: bonds.attack, label: ANCIENTS.bonds.name };
  if (effectOf(state, 'wardBreakGold') || effectOf(state, 'wardBreaksGetCopy')) out.ancientTrackWardBreaks = true;
  const copy = effectOf(state, 'wardBreaksGetCopy');
  if (copy) out.ancientWardCopy = { every: copy.every, window: [...(live(state)?.wardWindow ?? [])] };
  if (effectOf(state, 'socTriggerEdgeShouts')) out.ancientEdgeShouts = { label: ANCIENTS.time.name };
  const adj = effectOf(state, 'shoutBuffsAdjacent');
  if (adj) out.ancientShoutAdjacent = { attack: adj.attack, health: adj.health, label: ANCIENTS.bonds.name };
  return out;
}

// ── Warden (Aegis) hooks ─────────────────────────────────────────────────────────────────────────────────────
/** DEATH: the Aegis destroys its target and gives the Attack + Ward to a random other friendly minion. */
export function ancientAegisDestroys(state: RunState): boolean {
  return !!effectOf(state, 'aegisDestroyGivesAttackAndWard');
}

/** DEATH: the recipient, picked BEFORE the destroy (so a Rebirth / Rise return or an Echo summon is never it): a
 *  random other friendly board minion WITHOUT Ward, or a random Warded one when every other minion has Ward. */
export function ancientAegisRecipient(state: RunState, victim: BoardCard): BoardCard | undefined {
  const others = state.board.filter((c) => c !== victim);
  if (others.length === 0) return undefined;
  const bare = others.filter((c) => !c.keywords.includes('DS'));
  const pool = bare.length > 0 ? bare : others;
  const rng = makeRng(state.rngCursor);
  const pick = pool[rng.int(pool.length)]!;
  state.rngCursor = rng.state();
  return pick;
}

/** DEATH: destroy `victim` (a real shop death: its Echo, the death watchers, a Rebirth / Rise return) and give
 *  `recipient` the Attack it had (permanent) and Ward. A Resilient Ward on the victim travels as a Resilient Ward. */
export function ancientAegisDestroyAndGive(state: RunState, victim: BoardCard, recipient: BoardCard): void {
  const attack = victim.attack;
  const resilient = victim.keywords.includes('RW');
  destroyMinionInShop(makeContext(state), victim);
  if (!state.board.includes(recipient)) return;
  captureBuffFx(state, undefined, 'spell', () => {
    if (attack > 0) addBuff(recipient, ANCIENTS.death.name, attack, 0);
    if (!recipient.keywords.includes('DS')) recipient.keywords.push('DS');
    if (resilient && !recipient.keywords.includes('RW')) recipient.keywords.push('RW');
  });
}

/** WAR: does THIS Aegis grant Resilient Ward? Spends the charge when it does. */
export function ancientAegisResilient(state: RunState): boolean {
  const a = live(state);
  if (!a || !effectOf(state, 'nextAegisResilient') || (a.resilientAegisLeft ?? 0) <= 0) return false;
  a.resilientAegisLeft = (a.resilientAegisLeft ?? 0) - 1;
  return true;
}

/** TIME: the End-of-Turn grant to every minion with Ward, when the pairing is live. */
export function ancientEotWardBuff(state: RunState): { attack: number; health: number } | undefined {
  const e = effectOf(state, 'eotBuffWarded');
  return e ? { attack: e.attack, health: e.health } : undefined;
}

/** TIME: run the End-of-Turn grant (the `ancientTimeWard` recurring entry). `apply` wraps it (the recurring
 *  runner's `step`, which captures the buff FX in the projection). */
export function ancientRunEotWardBuff(state: RunState, apply: (run: () => void) => void): void {
  const g = ancientEotWardBuff(state);
  if (!g) return;
  const warded = state.board.filter((c) => c.keywords.includes('DS'));
  if (warded.length === 0) return;
  apply(() => { for (const c of warded) addBuff(c, ANCIENTS.time.name, g.attack, g.health); });
}

/**
 * BONDS, Shop half: every BOARD minion with Ward whose stats rose since `before` gives a random OTHER board minion
 * with Ward +attack Attack. Gainers are resolved before any grant, and the grants are never re-diffed, so a Bonds
 * grant cannot trigger Bonds (the owner's "this doesnt re-trigger itself"). With `mark` (the End-of-Turn pass) every
 * uid it handled (gainers and recipients) is recorded, so the reducer's per-action diff skips them.
 */
export function ancientBondsReact(state: RunState, before: Map<string, { attack: number; health: number }>, mark = false): void {
  const a = live(state);
  const e = effectOf(state, 'wardedGainBuffsWarded');
  if (!a || !e) return;
  const handled = new Set(a.bondsHandled ?? []);
  if (!mark) a.bondsHandled = undefined; // the per-action diff is the last reader
  const warded = (c: BoardCard): boolean => c.keywords.includes('DS');
  const gainers = state.board.filter((c) => {
    if (!warded(c) || handled.has(c.uid)) return false;
    const p = before.get(c.uid);
    return !!p && (c.attack > p.attack || c.health > p.health);
  });
  if (gainers.length === 0) return;
  const touched: string[] = [];
  for (const g of gainers) {
    const others = state.board.filter((c) => c !== g && warded(c));
    if (others.length === 0) continue;
    const rng = makeRng(state.rngCursor);
    const pick = others[rng.int(others.length)]!;
    state.rngCursor = rng.state();
    captureBuffFx(state, g, 'minion', () => addBuff(pick, ANCIENTS.bonds.name, e.attack, 0));
    touched.push(g.uid, pick.uid);
  }
  if (mark) a.bondsHandled = [...handled, ...touched];
}

/** FORTUNE / GENESIS: the fight is settled. Fortune banks Gold for next turn per friendly Ward break (its text says
 *  "next turn"). Genesis already paid its copies DURING the fight (real-time, see `ancientWardCopy`); here it only
 *  keeps the running count and the window the fight handed back. */
export function ancientAfterCombat(state: RunState, result: CombatResult): void {
  const a = live(state);
  if (!a) return;
  const breaks = result.playerWardBreaks ?? [];
  const gold = effectOf(state, 'wardBreakGold');
  if (gold && breaks.length > 0) state.bonusEmbersNextTurn = (state.bonusEmbersNextTurn ?? 0) + gold.gold * breaks.length;
  if (!effectOf(state, 'wardBreaksGetCopy')) return;
  a.wardBreaks = (a.wardBreaks ?? 0) + breaks.length;
  if (result.playerWardWindow) a.wardWindow = [...result.playerWardWindow];
}

// ── Auctioneer (Pulse) hooks ─────────────────────────────────────────────────────────────────────────────────
/** DEATH: how many EXTRA times Pulse fires the Shout before destroying the target (0 = the pairing is not live). */
export function ancientPulseExtraThenDestroy(state: RunState): number {
  return effectOf(state, 'pulseRepeatThenDestroy')?.extra ?? 0;
}

/** GENESIS: Pulse is a Discover of a Shout minion instead of a replay. */
export function ancientPulseDiscovers(state: RunState): boolean {
  return !!effectOf(state, 'pulseDiscoverShout');
}

/** TIME: Pulse is passive (its Start-of-Combat half rides `ancientCombatMods`). */
export function ancientPulsePassive(state: RunState): boolean {
  return !!effectOf(state, 'socTriggerEdgeShouts');
}

/** The grafted Rally War's Pulse gives (`grantedEffects`): "Rally: trigger this minion's Shout." */
export const ANCIENT_RALLY_SHOUT: EffectDef = { on: 'onAttack', do: 'rallyTriggerOwnShout', params: {} };

/** WAR: after Pulse fired `card`'s Shout, it gains the Rally keyword and "Rally: trigger this minion's Shout" (once;
 *  a second Pulse on the same minion does not stack it). Permanent: a per-instance graft on the run card. */
export function ancientAfterPulse(state: RunState, card: BoardCard): void {
  if (!effectOf(state, 'pulseGrantsRallyShout')) return;
  if (!card.grantedEffects?.some((e) => e.do === ANCIENT_RALLY_SHOUT.do)) {
    (card.grantedEffects ??= []).push({ ...ANCIENT_RALLY_SHOUT, params: {} });
  }
  if (!card.keywords.includes('RL')) card.keywords.push('RL');
}

/**
 * ONE SHOP Shout fire (called from `fireBattlecryTriggered`, once per fire, so a Drakko-doubled Shout counts twice).
 * FORTUNE banks Gold for next turn; BONDS gives the minions next to `source` +a/+h, permanently, in real time.
 * `source` is the minion whose Shout fired (absent / off the board = no neighbours, e.g. a borrowed play).
 */
export function ancientOnShopShout(state: RunState, source: BoardCard | undefined): void {
  const a = live(state);
  if (!a) return;
  const gold = effectOf(state, 'shopShoutGold');
  if (gold) {
    state.bonusEmbersNextTurn = (state.bonusEmbersNextTurn ?? 0) + gold.gold;
    const cur = a.shoutGold?.wave === state.wave ? a.shoutGold.gold : 0;
    a.shoutGold = { wave: state.wave, gold: cur + gold.gold };
  }
  const adj = effectOf(state, 'shoutBuffsAdjacent');
  if (adj && source) {
    const i = state.board.indexOf(source);
    if (i < 0) return;
    const near = [state.board[i - 1], state.board[i + 1]].filter((c): c is BoardCard => !!c);
    if (near.length === 0) return;
    captureBuffFx(state, source, 'minion', () => { for (const c of near) addBuff(c, ANCIENTS.bonds.name, adj.attack, adj.health); });
  }
}
