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
 *  · `aegisUpgradesWardToResilient`  the `grantWard` branch: an Aegis on a minion that ALREADY has Ward upgrades it
 *                                 to RESILIENT Ward (every Aegis, a standing rule; owner 2026-09-26). (War)
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
 *  LORD OF THE RISEN (`risen`, Undying, `grantReborn`; owner pairings 2026-09-26). Undying marks its target with
 *  `tempReborn`; the combat halves find that body by its run uid (`QuestCombatMods.ancientUndying.uids`, matched
 *  against each combat body's `sourceUid`), so nothing new rides the board card or a snapshot.
 *  · `undyingRegainsRise`         COMBAT: `ancientUndying.regainRise` in `killOrReborn`'s Rise branch: the Undying
 *                                 body regains Rise right after it returns, once per combat (a BLUE Rise). (Death)
 *  · `riseGold`                   COMBAT: `ancientCountRises` counts every friendly Rise (an `onRise` listener, the
 *                                 moment it happens); `ancientAfterCombat` banks +gold next turn per Rise. (Fortune)
 *  · `undyingReturnsDoubleAndAttacks` COMBAT: `ancientUndying.war` in the Rise branch: double Attack on the return,
 *                                 then an interrupting "attacks immediately" strike (R-ORD-05). A RED Rise. (War)
 *  · `summonsSummonExtra`         COMBAT: `ancientSummonExtra` in `placeSummon` (landed or overflowed) and on every
 *                                 Rise / Rebirth return (a copy without the returning keyword). (Genesis)
 *  · `sotBuffPerCombatSummon`     COMBAT counts (`ancientCountSummons`, at the summon-entry chokepoint); the next
 *                                 Start of Turn (`ancientStartOfTurn`) buffs the board per summon, permanently. (Time)
 *  · `riseTriggersAdjacentEcho`   COMBAT: `ancientRiseEcho`, an `onRise` listener (`triggerEcho`); SHOP: `fireOnRise`
 *                                 (`ancientOnShopRise`, the shop Echo ritual). (Bonds)
 *
 *  ALBUS (Empowerment, `empowerment`; owner pairings 2026-09-28). Empowerment = "Choose a Shop minion. Discover a
 *  minion from the tier above it for it to become." The pick REPLACES the Shop offer (`discoverIntoShopUid`), so
 *  "a minion discovered by Empowerment" is that new Shop offer (or the hand card, when the offer was gone by the
 *  time a queued pick resolved). `ancientOnEmpowerPick` is the one hook, called from `takeDiscoverPick`.
 *  · `empowerEchoGainsRise`       the pick, when it has an Echo, gains Rise (on the offer: baked in when bought). (Death)
 *  · `empowerFree`                the new Shop offer costs 0 Gold (`ShopCard.cost`, the set-price channel). (Fortune)
 *  · `pummelGrantsCards`          COMBAT: `QuestCombatMods.ancientPummel`, a HERO-level Pummel read at the keyword's
 *                                 own damage site (`noteDamageDealt`): every friendly landed hit, one lifetime tally
 *                                 (`AncientsState.pummelDealt`), once per combat, paid to hand mid-fight. (War)
 *  · `empowerCopyToHand`          the pick also sends a plain copy to hand; Empowerment costs 3 Gold (`power`). (Genesis)
 *  · `sotDiscoverTierAbove`       Empowerment turns passive (`power`); `ancientStartOfTurn` queues a Discover of a
 *                                 minion from the tier above your Shop tier, on its own Start of Turn beat. (Time)
 *  · `playParityBuff`             SHOP: `playCard` (the one "played from hand" chokepoint): playing an odd-tier minion
 *                                 gives your OTHER odd-tier minions +a/+h, even likewise. Combat has no play. (Bonds)
 *
 * Serialisable plain data throughout, so saves / snapshots / replays can carry it cheaply later (not in the MVP).
 */
import { makeRng, type CardDef, type EffectDef, type Keyword, type QuestCombatMods, type RiseTint } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { mixSeed, type BoardCard, type RunState, type ShopCard, type SotBeatFx } from './state';
import { pushSotBeat, recordSotBeat } from './sotBeat';
import type { HeroPower } from './heroes';
import type { CombatResult } from '@game/core';
import { addBuff, aegisGrantOf, captureBuffFx, destroyMinionInShop, fireShopEchoOf, grantMinionToHandOrBoard, instanceEffects, makeContext, queueDiscover } from './recruit';
import { INDY_GILD_RECHARGE_GOLD, hasTier7Access } from './config';

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
  | { do: 'aegisUpgradesWardToResilient' }
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
  | { do: 'shoutBuffsAdjacent'; attack: number; health: number }
  // ── Lord of the Risen (Undying) ──
  /** The Undying body regains Rise right after it Rises in combat, once per combat. */
  | { do: 'undyingRegainsRise' }
  /** Every friendly Rise in combat: gain `gold` next turn. */
  | { do: 'riseGold'; gold: number }
  /** The Undying body returns from its Rise with double Attack and attacks immediately. */
  | { do: 'undyingReturnsDoubleAndAttacks' }
  /** Every friendly summon in combat (a Rise and a Rebirth included) summons `extra` more copies. */
  | { do: 'summonsSummonExtra'; extra: number }
  /** Start of Turn: your minions gain +a/+h for every friendly minion summoned in the last combat. */
  | { do: 'sotBuffPerCombatSummon'; attack: number; health: number }
  /** Whenever a friendly minion Rises (Shop AND combat), trigger the Echo of a minion next to it. */
  | { do: 'riseTriggersAdjacentEcho' }
  // ── Albus (Empowerment) ──
  /** A minion Empowerment discovers gains Rise when it has an Echo. */
  | { do: 'empowerEchoGainsRise' }
  /** A minion Empowerment discovers costs 0 Gold to buy. */
  | { do: 'empowerFree' }
  /** Hero-level Pummel (X): every friendly landed hit fills one tally; each multiple of `every` gets `count` × `cardId`
   *  to hand, once per combat. */
  | { do: 'pummelGrantsCards'; every: number; count: number; cardId: string }
  /** Empowerment also sends a plain copy of the chosen minion to hand (the cost rides the pairing's `power`). */
  | { do: 'empowerCopyToHand' }
  /** Empowerment is passive; Start of Turn: Discover a minion from the tier above your Shop tier. */
  | { do: 'sotDiscoverTierAbove' }
  /** Playing an odd-tier minion from hand gives your other odd-tier minions +a/+h (even likewise). */
  | { do: 'playParityBuff'; attack: number; health: number };

export interface AncientPairing {
  /** The Ancient's text for this hero, as shown on the offer and the preview (the owner's words). */
  offerText: string;
  /** The RESOLVED hero-power text (owner ruling 5: "shows the combined power"). `{base}` = the base power's live
   *  text; `{recharge}` = Indy's live recharge Gold; `{gilds}` / `{gildA}` / `{gildH}` = the run's gild count and
   *  the live Bonds total it grants right now; `{aegis}` = Warden's live Aegis grant ("+5 Attack"); `{wardLeft}` =
   *  Ward breaks still needed for Genesis' next copy; `{riseGold}` = Gold the Risen's last combat banked;
   *  `{summons}` / `{timeA}` / `{timeH}` = the Risen's summon count and the Start-of-Turn grant it pays: LIVE during a
   *  fight (the replay's running count, `{timeWhen}` = "This combat"), else the last combat's (`{timeWhen}` = "Last
   *  combat"), R-ANCRISEN-07. Albus: `{timeTier}` = the tier Time's next Discover draws from; `{pummelNow}` /
   *  `{pummelEvery}` = War's live Pummel progress (toward the next payout, the badge rule) and its X. */
  powerText: string;
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
      // Owner 2026-09-26 (replacing "Your next Aegis grants Resilient Ward"): "using aegis on a warded minion grants it
      // resilient ward". A standing rule: every Aegis on a minion that already has Ward upgrades it; the +5 wave stays.
      offerText: 'Aegis on a minion with **Ward** gives it **Resilient Ward** instead. It takes 2 hits to break.',
      powerText: 'Give a friendly minion **Ward**. If it already has **Ward**, it gets **Resilient Ward**. Then give your minions with **Ward** **{aegis}**.',
      effects: [{ do: 'aegisUpgradesWardToResilient' }],
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
  // LORD OF THE RISEN (hero id `risen`; owner pairings 2026-09-26, quoted above each entry). Undying = "Give a friendly
  // minion Rise for the next combat."
  risen: {
    death: {
      // "Undying's target gains Rise after rising. (Once per combat.)" Shown as a BLUE Rise.
      offerText: "Undying's target gains **Rise** again after it Rises. Once per combat.",
      powerText: '{base} After it Rises, it gains **Rise** again. Once per combat.',
      effects: [{ do: 'undyingRegainsRise' }],
    },
    fortune: {
      // "When a minion Rises each combat, gain 1 Gold next turn."
      offerText: 'When one of your minions Rises in combat, gain **1 Gold** next turn.',
      powerText: '{base} When one of your minions Rises in combat, gain **1 Gold** next turn. Last combat: **{riseGold} Gold**.',
      effects: [{ do: 'riseGold', gold: 1 }],
    },
    war: {
      // "The minion chosen by Undying returns with double Attack and attacks immediately." Shown as a RED Rise.
      offerText: 'The minion you pick with Undying Rises with double Attack and attacks immediately.',
      powerText: '{base} When it Rises, it has double Attack and attacks immediately.',
      effects: [{ do: 'undyingReturnsDoubleAndAttacks' }],
    },
    genesis: {
      // "Your summons summon an extra minion in combat." (owner: "adds 1 to any and all summon effects in combat,
      // including rise"; "make sure these count as overflows"; "this also makes echo summons summon an extra body")
      // Owner text trim 2026-09-26: "remove the sentence 'This includes minions that Rise.'" (behaviour unchanged: a
      // Rise still gets its extra copy).
      offerText: 'In combat, each minion you summon summons an extra copy.',
      powerText: '{base} In combat, each minion you summon summons an extra copy.',
      effects: [{ do: 'summonsSummonExtra', extra: 1 }],
    },
    time: {
      // "Start of Turn: Give your minions +3/+2 for every minion summoned in combat." (owner: the previous combat only;
      // "summoned counts anything from hand, echo summons, and rising bodies")
      offerText: '**Start of Turn:** give your minions **+3/+2** for each minion you summoned last combat.',
      powerText: '{base} **Start of Turn:** give your minions **+3/+2** for each minion you summoned last combat. {timeWhen}: **{summons}** summoned (**+{timeA}/+{timeH}**).',
      effects: [{ do: 'sotBuffPerCombatSummon', attack: 3, health: 2 }],
    },
    bonds: {
      // "When a minion Rises, trigger an adjacent Echo." (owner: a random one when both neighbours have one; nothing
      // when neither; "this stacks with any other potential effects and triggers")
      offerText: 'When one of your minions Rises, trigger the **Echo** of a minion next to it.',
      powerText: '{base} When one of your minions Rises, trigger the **Echo** of a minion next to it.',
      effects: [{ do: 'riseTriggersAdjacentEcho' }],
    },
  },
  // ALBUS (owner pairings 2026-09-28, quoted above each entry). Empowerment = "Choose a Shop minion. Discover a minion
  // from the tier above it for it to become." (1 Gold, once per turn). The pick replaces the Shop offer.
  albus: {
    death: {
      // "Echo minions discovered from Empowerment gain Rise."
      offerText: 'Minions you **Discover** with Empowerment that have an **Echo** gain **Rise**.',
      powerText: '{base} If it has an **Echo**, it gains **Rise**.',
      effects: [{ do: 'empowerEchoGainsRise' }],
    },
    fortune: {
      // "Minions discovered by Empowerment are free."
      offerText: 'Minions you **Discover** with Empowerment are free.',
      powerText: '{base} It costs **0 Gold**.',
      effects: [{ do: 'empowerFree' }],
    },
    war: {
      // "Pummel (80): Get 2 Strange Revisions. (Once per Combat)" A hero-level Pummel over your minions' damage.
      offerText: '**Pummel (80):** get **2** Strange Revisions. Once per combat. Counts damage dealt by all your minions.',
      powerText: '{base} **Pummel (80):** get **2** Strange Revisions. Once per combat. Counts damage dealt by all your minions (**{pummelNow}/{pummelEvery}**).',
      effects: [{ do: 'pummelGrantsCards', every: 80, count: 2, cardId: 'strangerevision' }],
    },
    genesis: {
      // "Empowerment costs 3g. You also get a copy of the chosen minion sent to your hand."
      offerText: 'Empowerment costs **3 Gold**. You also get a copy of the minion you choose in your hand.',
      powerText: '{base} You also get a copy of it in your hand.',
      power: { cost: 3 },
      effects: [{ do: 'empowerCopyToHand' }],
    },
    time: {
      // "Empowerment becomes Start of Turn: Discover a minion from the tier above you."
      offerText: 'Empowerment becomes passive. **Start of Turn:** **Discover** a minion from the tier above your Shop.',
      powerText: '**Start of Turn:** **Discover** a minion from the tier above your Shop (**Tier {timeTier}**).',
      power: { passive: true },
      effects: [{ do: 'sotDiscoverTierAbove' }],
    },
    bonds: {
      // "Playing odd tier units grants +3/+3 to friendly odd tier units. Playing even tier units grants +3/+3 to
      // friendly even tier units." The played minion itself is not included (the "other" convention).
      offerText: 'Playing an odd-tier minion gives your other odd-tier minions **+3/+3**. Playing an even-tier minion gives your other even-tier minions **+3/+3**.',
      powerText: '{base} Playing an odd-tier minion gives your other odd-tier minions **+3/+3**. Playing an even-tier minion gives your other even-tier minions **+3/+3**.',
      effects: [{ do: 'playParityBuff', attack: 3, health: 3 }],
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
  /** RISEN × FORTUNE: Gold the last combat's Rises banked for this turn (the live power text prints it). */
  riseGold?: number;
  /** RISEN × TIME: friendly minions summoned in the last combat (paid at the next Start of Turn; printed live). */
  lastSummons?: number;
  /** ALBUS × WAR: the hero-Pummel LIFETIME tally (friendly damage dealt), carried across combats like the keyword. */
  pummelDealt?: number;
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

/** Live combat values the Ancient power text folds in (undefined outside a fight being replayed). */
export interface AncientPowerLive {
  /** ALBUS × WAR: friendly damage LANDED so far in the fight on screen (the replay's `dmg` events whose dealer is a
   *  player body, Heavy Hand folded), added to the carried-in tally so the Pummel readout ticks with each hit. */
  friendlyDamage?: number;
  /** Friendly minions summoned SO FAR in the fight on screen (the replay's step-tagged `summonCombat` tally, the same
   *  summon-entry chokepoint `ancientCountSummons` counts), so Time's printed count follows the replay beat. */
  combatSummons?: number;
}

/** The resolved hero-power text, or undefined when no pairing is active (the caller keeps its base text). */
export function ancientPowerText(state: RunState, base: string, combat: AncientPowerLive = {}): string | undefined {
  const p = activeAncientPairing(state);
  if (!p) return undefined;
  const per = effectOf(state, 'powerBuffPerGild');
  const a = live(state);
  const gilds = a?.gilds ?? 0;
  const text = p.powerText;
  const g = aegisGrantOf(state);
  const aegis = g.health > 0 ? `+${g.attack}/+${g.health}` : `+${g.attack} Attack`;
  const copy = effectOf(state, 'wardBreaksGetCopy');
  const wardLeft = copy ? copy.every - ((a?.wardWindow?.length ?? 0) % copy.every) : 0;
  const shoutGold = a?.shoutGold?.wave === state.wave ? a.shoutGold.gold : 0;
  const time = effectOf(state, 'sotBuffPerCombatSummon');
  // RISEN × TIME, REAL TIME (R-REALTIME-01 / R-ANCRISEN-07): during a fight the count is the replay's running tally of
  // friendly summons up to the beat on screen, so it ticks with each summon instead of jumping at resolution.
  const liveSummons = !!time && combat.combatSummons !== undefined;
  const summons = liveSummons ? combat.combatSummons! : a?.lastSummons ?? 0;
  const pummel = effectOf(state, 'pummelGrantsCards');
  const pummelNow = pummel ? ((a?.pummelDealt ?? 0) + (combat.friendlyDamage ?? 0)) % Math.max(1, pummel.every) : 0;
  return text.replace('{base}', base).replace('{timeTier}', String(albusTimeTier(state)))
    .replace('{pummelNow}', String(pummelNow)).replace('{pummelEvery}', String(pummel?.every ?? 0)).replace('{timeWhen}', liveSummons ? 'This combat' : 'Last combat').replace('{shoutGold}', String(shoutGold))
    .replace('{riseGold}', String(a?.riseGold ?? 0)).replace('{summons}', String(summons))
    .replace('{timeA}', String((time?.attack ?? 0) * summons)).replace('{timeH}', String((time?.health ?? 0) * summons)).replace('{aegis}', aegis).replace('{wardLeft}', String(wardLeft)).replace('{recharge}', String(INDY_GILD_RECHARGE_GOLD))
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
  // LORD OF THE RISEN: the Undying body is the board card Undying marked (`tempReborn`) this turn.
  const regain = effectOf(state, 'undyingRegainsRise');
  const riseWar = effectOf(state, 'undyingReturnsDoubleAndAttacks');
  if (regain || riseWar) {
    const uids = state.board.filter((c) => c.tempReborn && c.keywords.includes('R')).map((c) => c.uid);
    if (uids.length > 0) {
      out.ancientUndying = { uids, label: (riseWar ? ANCIENTS.war : ANCIENTS.death).name, ...(regain ? { regainRise: true } : {}), ...(riseWar ? { war: true } : {}) };
    }
  }
  if (effectOf(state, 'riseGold')) out.ancientCountRises = true;
  const extra = effectOf(state, 'summonsSummonExtra');
  if (extra) out.ancientSummonExtra = extra.extra;
  if (effectOf(state, 'sotBuffPerCombatSummon')) out.ancientCountSummons = true;
  if (effectOf(state, 'riseTriggersAdjacentEcho')) out.ancientRiseEcho = { label: ANCIENTS.bonds.name };
  const pummel = effectOf(state, 'pummelGrantsCards');
  if (pummel) {
    out.ancientPummel = { every: pummel.every, count: pummel.count, cardId: pummel.cardId, dealt: live(state)?.pummelDealt ?? 0, label: ANCIENTS.war.name };
  }
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

/** WAR: an Aegis on a minion that ALREADY has Ward upgrades it to Resilient Ward (every Aegis; owner 2026-09-26).
 *  `hadWard` = the target's Ward BEFORE this Aegis. */
export function ancientAegisResilient(state: RunState, hadWard: boolean): boolean {
  return hadWard && !!live(state) && !!effectOf(state, 'aegisUpgradesWardToResilient');
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
  // RISEN × FORTUNE: +gold next turn per friendly Rise (counted the moment each happened, in the fight).
  const riseGold = effectOf(state, 'riseGold');
  if (riseGold) {
    a.riseGold = riseGold.gold * (result.playerRises ?? 0);
    if (a.riseGold > 0) state.bonusEmbersNextTurn = (state.bonusEmbersNextTurn ?? 0) + a.riseGold;
  }
  // RISEN × TIME: the count the next Start of Turn pays on.
  if (effectOf(state, 'sotBuffPerCombatSummon')) a.lastSummons = result.playerSummonsMade ?? 0;
  // ALBUS × WAR: the lifetime Pummel tally the fight hands back (the payout already happened mid-fight).
  if (effectOf(state, 'pummelGrantsCards') && result.playerAncientPummelDealt !== undefined) a.pummelDealt = result.playerAncientPummelDealt;
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

// ── Lord of the Risen (Undying) hooks ─────────────────────────────────────────────────────────────────────────
/** WAR: the Undying target's Rise wears the RED look in the Shop too (the combat body reads `riseTint` off its
 *  snapshot). Undefined = the ordinary Rise look. */
export function ancientRiseTint(state: RunState, card: BoardCard): RiseTint | undefined {
  // Owner 2026-09-26 ("they look identical"): the Undying target wears its pairing's colour from the moment Undying
  // lands, not only once it has risen: War RED, Death BLUE.
  if (!card.tempReborn || !card.keywords.includes('R')) return undefined;
  if (effectOf(state, 'undyingReturnsDoubleAndAttacks')) return 'red';
  if (effectOf(state, 'undyingRegainsRise')) return 'blue';
  return undefined;
}

/** TIME: Start of Turn, every board minion gains +a/+h for each friendly minion summoned in the last combat,
 *  permanently (owner 2026-09-26: the previous combat only). */
export function ancientStartOfTurn(state: RunState): void {
  albusStartOfTurn(state);
  const a = live(state);
  const e = effectOf(state, 'sotBuffPerCombatSummon');
  const n = a?.lastSummons ?? 0;
  if (!a || !e || n <= 0 || state.board.length === 0) return;
  // ITS OWN START-OF-TURN BEAT (owner 2026-09-26, R-SOT-BEAT-01): the grant is recorded on the Start-of-Turn beat
  // channel (the power button pulses, then each minion's gain lands, after the return wipe), NOT the per-action
  // buff-FX channel, whose replay fired under the return-to-shop curtain where nobody saw it. Gains are the real
  // per-minion deltas (a buff multiplier or mirror can change them), measured around the grant.
  const before = new Map(state.board.map((c) => [c.uid, { attack: c.attack, health: c.health }]));
  for (const c of state.board) addBuff(c, ANCIENTS.time.name, e.attack * n, e.health * n);
  const gains: SotBeatFx['gains'] = [];
  for (const c of state.board) {
    const p = before.get(c.uid);
    if (!p) continue;
    const da = c.attack - p.attack, dh = c.health - p.health;
    if (da > 0 || dh > 0) gains.push({ uid: c.uid, attack: da, health: dh });
  }
  if (gains.length === 0) return;
  pushSotBeat(state, { source: { kind: 'hero', id: state.heroId, label: ANCIENTS.time.name }, gains });
}

/** BONDS, Shop half: a friendly minion Rose in the Shop (a shop destroy's Rise return). Trigger the Echo of a
 *  minion next to it, a random one when both neighbours have an Echo, through the shop's own Echo ritual (the
 *  Echo multipliers and the Echo tally apply). Nothing when neither neighbour has one. */
export function ancientOnShopRise(state: RunState, risen: BoardCard): void {
  if (!effectOf(state, 'riseTriggersAdjacentEcho')) return;
  const i = state.board.indexOf(risen);
  if (i < 0) return;
  const near = [state.board[i - 1], state.board[i + 1]].filter((c): c is BoardCard => !!c && instanceEffects(c).some((e) => e.on === 'onDeath'));
  if (near.length === 0) return;
  let target = near[0]!;
  if (near.length > 1) {
    const rng = makeRng(state.rngCursor);
    target = near[rng.int(near.length)]!;
    state.rngCursor = rng.state();
  }
  captureBuffFx(state, risen, 'minion', () => fireShopEchoOf(state, target));
}

// ── Albus (Empowerment) hooks ────────────────────────────────────────────────────────────────────────────────
/** TIME: Empowerment is passive (its Start of Turn half is `albusStartOfTurn`). */
export function ancientEmpowerPassive(state: RunState): boolean {
  return !!effectOf(state, 'sotDiscoverTierAbove');
}

/** TIME: the tier the Start of Turn Discover draws from: one above your Shop tier, clamped at the ceiling the way
 *  Empowerment itself clamps (Tier 6, or Tier 7 with access), so at the top it Discovers from your own top tier. */
export function albusTimeTier(state: RunState): number {
  return Math.min(state.tier + 1, hasTier7Access(state) ? 7 : 6);
}

/** TIME: Start of Turn, queue a Discover of a minion from the tier above your Shop tier, as its own beat (R-SOT-BEAT-01). */
function albusStartOfTurn(state: RunState): void {
  if (!live(state) || !effectOf(state, 'sotDiscoverTierAbove')) return;
  const tier = albusTimeTier(state);
  recordSotBeat(state, { kind: 'hero', id: state.heroId, label: ANCIENTS.time.name }, () => {
    queueDiscover(state, { kind: 'minion', tier, exactTier: tier });
  });
}

/**
 * A minion Empowerment discovered has just arrived: `offer` is the Shop offer it became (the usual case), or `card`
 * the hand card it became when the targeted offer was already gone. DEATH: it gains Rise when it has an Echo. FORTUNE:
 * the offer costs 0 Gold. GENESIS: a plain copy of it goes to hand (hand first, the board when the hand is full).
 */
export function ancientOnEmpowerPick(state: RunState, def: CardDef, offer?: ShopCard, card?: BoardCard): void {
  if (!live(state)) return;
  if (effectOf(state, 'empowerEchoGainsRise') && def.effects.some((e) => e.on === 'onDeath')) {
    if (offer && !def.keywords.includes('R') && !(offer.keywords ?? []).includes('R')) (offer.keywords ??= []).push('R');
    if (card && !card.keywords.includes('R')) card.keywords.push('R');
  }
  if (offer && effectOf(state, 'empowerFree')) offer.cost = 0;
  if (effectOf(state, 'empowerCopyToHand')) grantMinionToHandOrBoard(state, def, false);
}

/** BONDS, Shop: a minion was PLAYED from hand. Every OTHER board minion of the same tier parity (odd / even) gains
 *  +a/+h, permanently, in real time. The played minion is not included. */
export function ancientOnPlay(state: RunState, played: BoardCard): void {
  const e = effectOf(state, 'playParityBuff');
  if (!e) return;
  const tier = CARD_INDEX[played.cardId]?.tier;
  if (tier === undefined) return;
  const parity = tier % 2;
  const mates = state.board.filter((c) => c !== played && (CARD_INDEX[c.cardId]?.tier ?? -1) % 2 === parity);
  if (mates.length === 0) return;
  captureBuffFx(state, played, 'minion', () => { for (const c of mates) addBuff(c, ANCIENTS.bonds.name, e.attack, e.health); });
}
