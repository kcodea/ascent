/**
 * DOC BOT — HERO-POWER ACTIVATION FAMILIES (handoff §6.2, PR 4).
 *
 * Every `HeroPowerKind` is classified into ONE activation family — the mechanism that has to be driven to
 * make the power act. The map is `Record<HeroPowerKind, …>`, so adding a power kind without classifying it is
 * a COMPILE error ("classify me"), and `heroPowerStagers.test.ts` additionally walks the live HEROES registry
 * at runtime so a hero wielding an unmapped kind fails the lane with the same instruction.
 *
 * The families deliberately mirror the handoff's list (start-of-run, turn-number, thresholds, combat
 * triggers, adopted powers, modal openers) rather than the reducer's internal branch layout — the family says
 * WHAT a stager must stage, not where the code lives.
 */
import type { HeroPowerKind } from '../heroes';

export type ActivationFamily =
  | 'active' // fires through the real `heroPower` action with at most a board/shop target — verified by the heroScan lane
  | 'active-conditional' // active, but only against a staged precondition (a pair to complete, a fight behind you, a spell cast)
  | 'modal-choice' // the activation carries a choice payload (`commission` pick, Flash's first/last)
  | 'start-of-run' // the work happens at `createRun` — opening tokens, locked Discovers, the turn-1 quest offer
  | 'turn-number' // opens/fires on one specific wave (Runeforge t5, Epic Runeforge t8, Void t4)
  | 'every-n-turns' // a repeating schedule (Chaos every 5, Gifts every 4, Re-Pete every 3, Mimic every turn)
  | 'count-threshold' // a buy/sell/refresh/tally counter crossing a threshold
  | 'shop-action-trigger' // rides one specific shop action (a tier-up, a play position)
  | 'passive-pricing' // an always-on price/rule rewrite (2-Gold minions, Dwarf rates, Gild-at-2)
  | 'combat-trigger' // the payoff happens inside/around `simulate()` (SoC banners, Avenge, attack scaling, kill claims)
  | 'unlock-recharge' // active, but gated by its own lock/recharge schedule (Dice, Preparation, Indy's Gild)
  | 'adopted-secondary' // powers that ADOPT other heroes' powers (Mimic / Void) — staged via the pickPower ceremony
  | 'retired'; // kept in the union so old saves/replays resolve — no live hero wields it

export const POWER_FAMILY: Record<HeroPowerKind, ActivationFamily> = {
  // NOTE `fortify`: no live hero carries it, but it is the `heroPower` case's FALL-THROUGH else-branch, so it
  // stays classified 'active' rather than 'retired' — see the fall-through note below.
  fortify: 'active',
  gild: 'unlock-recharge',
  replayBattlecry: 'active',
  replayEndOfTurn: 'retired',
  replayAllEndOfTurn: 'active',
  resummon: 'combat-trigger',
  spellAmplify: 'retired',
  gainMaxMana: 'active',
  grantWard: 'active',
  scalingGold: 'retired',
  cheapMinions: 'passive-pricing',
  summitLock: 'start-of-run',
  discoLock: 'start-of-run',
  questChronos: 'count-threshold',
  // ARCHIVED 2026-08-28 — see `ARCHIVED_POWER_KINDS`. Deliberately NOT reclassified to 'retired': `retired`
  // means "no hero wields it and the code path is gone", and this one is neither. Fi and Coran still wield it,
  // the whole start-of-run machinery is intact, and a redesign will switch it back on — so it keeps the family
  // that describes what a stager would have to drive, and the archive is asserted separately.
  heroQuest: 'start-of-run',
  lesserQuest: 'retired',
  collision: 'retired',
  quest: 'count-threshold',
  chaos: 'every-n-turns',
  sellGold: 'count-threshold',
  displace: 'active',
  grantReborn: 'active',
  recurringGoldcrafter: 'retired',
  greatPresence: 'every-n-turns',
  gildcrafter: 'active-conditional',
  runeforge: 'turn-number',
  epicRuneforge: 'turn-number',
  pathfinder: 'retired',
  dynamiteDig: 'active',
  dragonTamer: 'active',
  secondHand: 'every-n-turns',
  possession: 'retired',
  fourPeat: 'count-threshold',
  pocketMagic: 'active',
  dice: 'unlock-recharge',
  copyMachine: 'active',
  clearance: 'active',
  contraband: 'count-threshold',
  companyRate: 'passive-pricing',
  unitedFront: 'combat-trigger',
  archive: 'active-conditional',
  roundedSpellbook: 'active-conditional',
  vanguard: 'shop-action-trigger',
  soulkeeper: 'active-conditional',
  empowerment: 'active',
  investment: 'count-threshold',
  luckySeat: 'count-threshold',
  exhibition: 'shop-action-trigger',
  buyout: 'active',
  soulbind: 'active',
  allIn: 'active',
  startingReflector: 'start-of-run',
  commission: 'modal-choice',
  devour: 'active',
  memory: 'active-conditional',
  baldgecoin: 'count-threshold',
  midasTouch: 'passive-pricing',
  firstOrLast: 'modal-choice',
  crownTally: 'count-threshold',
  preparation: 'unlock-recharge',
  empoweringVines: 'combat-trigger',
  mimic: 'adopted-secondary',
  voidTwin: 'adopted-secondary',
  tempest: 'count-threshold',
  bladeMastery: 'combat-trigger',
  hoard: 'combat-trigger',
  rubyWealth: 'active',
};

/**
 * ARCHIVED POWER KINDS (owner ruling 2026-08-28) — a power kind whose SYSTEM is switched off but whose code,
 * content and classification all remain. Distinct from the `'retired'` family in three ways that matter to
 * this lane:
 *
 *   · a retired kind has NO live wielder; an archived kind still has wielders, and they are `wip: true`;
 *   · a retired kind's behaviour is gone; an archived kind's behaviour is intact behind one archive switch;
 *   · a retired kind is history, an archived kind is a redesign waiting to happen.
 *
 * `heroPowerStagers.test.ts` enforces the invariant both ways: every hero wielding an archived kind must be
 * `wip` (so it cannot reach a picker), and the kind's stager asserts the ARCHIVE holds rather than asserting
 * the payoff it used to stage. That keeps the classification honest instead of quietly dropping coverage.
 *
 * `heroQuest` — Fi's Errand and Coran's Pathfinder. Archived with the quest system itself; see
 * `QUESTS_ARCHIVED` in config.ts.
 */
export const ARCHIVED_POWER_KINDS: ReadonlySet<HeroPowerKind> = new Set<HeroPowerKind>(['heroQuest']);

/**
 * The heroScan SILENT QUEUE, drained (handoff §6.4). Every hero whose power changes nothing under the
 * heroScan fixture is named here with its family and its verification: `'stager'` means a stager in
 * `heroPowerStagers.test.ts` drives the real engine to the power's activation point and asserts the payoff;
 * `'needs-stager'` is the explicitly-typed remainder and must carry a concrete reason (never the generic
 * "passive hero" excuse). `heroPowerLane.test.ts` cross-checks this table against the live scan, so a hero
 * joining or leaving the silent set without a verdict here fails the lane.
 */
export type SilentVerdict =
  | { kind: HeroPowerKind; family: ActivationFamily; verdict: 'stager' }
  | { kind: HeroPowerKind; family: ActivationFamily; verdict: 'needs-stager'; reason: string };

export const SILENT_QUEUE_VERDICTS: Record<string, SilentVerdict> = {
  rohan: { kind: 'startingReflector', family: 'start-of-run', verdict: 'stager' },
  chaos: { kind: 'chaos', family: 'every-n-turns', verdict: 'stager' },
  brackus: { kind: 'summitLock', family: 'start-of-run', verdict: 'stager' },
  discodan: { kind: 'discoLock', family: 'start-of-run', verdict: 'stager' },
  // ARCHIVED 2026-08-28 — the stager below still runs and still counts, but what it now asserts is that the
  // archive HOLDS (no offer on any seed, absent from every picker) rather than that the offer pays out. The
  // verdict stays `'stager'` on purpose: dropping these to `'needs-stager'` would be a false claim of missing
  // coverage, and dropping them entirely would leave the archive itself unwatched.
  fi: { kind: 'heroQuest', family: 'start-of-run', verdict: 'stager' },
  coran: { kind: 'heroQuest', family: 'start-of-run', verdict: 'stager' },
  mimic: { kind: 'mimic', family: 'adopted-secondary', verdict: 'stager' },
  drakko: { kind: 'quest', family: 'count-threshold', verdict: 'stager' },
  chronoshero: { kind: 'questChronos', family: 'count-threshold', verdict: 'stager' },
  robin: { kind: 'sellGold', family: 'count-threshold', verdict: 'stager' },
  pete: { kind: 'contraband', family: 'count-threshold', verdict: 'stager' },
  cia: { kind: 'luckySeat', family: 'count-threshold', verdict: 'stager' },
  odelle: { kind: 'exhibition', family: 'shop-action-trigger', verdict: 'stager' },
  emeraldwarden: { kind: 'vanguard', family: 'shop-action-trigger', verdict: 'stager' },
  hermithank: { kind: 'cheapMinions', family: 'passive-pricing', verdict: 'stager' },
  flint: { kind: 'companyRate', family: 'passive-pricing', verdict: 'stager' },
  runesmith: { kind: 'runeforge', family: 'turn-number', verdict: 'stager' },
  runeguard: { kind: 'epicRuneforge', family: 'turn-number', verdict: 'stager' },
  vale: { kind: 'unitedFront', family: 'combat-trigger', verdict: 'stager' },
  flash: { kind: 'firstOrLast', family: 'modal-choice', verdict: 'stager' },
  cassen: { kind: 'commission', family: 'modal-choice', verdict: 'stager' },
  underdweller: { kind: 'soulkeeper', family: 'active-conditional', verdict: 'stager' },
  membrance: { kind: 'memory', family: 'active-conditional', verdict: 'stager' },
  gildmaster: { kind: 'gildcrafter', family: 'active-conditional', verdict: 'stager' },
};

/**
 * ⚠️ KNOWN SMELL, documented not fixed (PR 4 audit, 2026-08-27): the `heroPower` case's else-if chain ends in
 * a FORTIFY fall-through, and several passive kinds are not named in its explicit passive no-op list
 * (`secondHand`, `fourPeat`, `greatPresence`, `crownTally`, `baldgecoin`, `midasTouch`, `tempest`,
 * `bladeMastery`, `hoard`, `empoweringVines`, `voidTwin`). A `heroPower` action for one of those heroes with a
 * valid target therefore applies a free +Tier/+Tier Fortify buff and spends the once-per-turn charge — which
 * is also why the heroScan lane reads them "active". The UI never arms a passive power's button, so players
 * can't reach it, but any headless driver (bots, scene bridge, a doctored replay) can. Their REAL behaviour is
 * covered by the dedicated suites listed here (asserted to exist by the lane).
 */
export const FALL_THROUGH_PASSIVE_COVERAGE: Partial<Record<HeroPowerKind, string>> = {
  secondHand: 'packages/sim/src/heroBeats.test.ts',
  fourPeat: 'packages/sim/src/wishboneDoubling.test.ts',
  greatPresence: 'packages/sim/src/gifts.test.ts',
  crownTally: 'packages/sim/src/keshiCrown.test.ts',
  baldgecoin: 'packages/sim/src/heroesBatchAug17.test.ts',
  midasTouch: 'packages/sim/src/heroesBatchAug17.test.ts',
  tempest: 'packages/sim/src/heroBatchAug23.test.ts',
  bladeMastery: 'packages/sim/src/heroBatchAug23.test.ts',
  hoard: 'packages/sim/src/heroBatchAug23.test.ts',
  empoweringVines: 'packages/sim/src/heroBatchAug22.test.ts',
  voidTwin: 'packages/sim/src/heroBatchAug22.test.ts',
};
