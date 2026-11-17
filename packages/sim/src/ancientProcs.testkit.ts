/**
 * Test kit for ANCIENT TRIGGER PROCS (owner 2026-11-17, R-FX-ANCIENT-PROC-01). Drives the REAL reducer / simulator and
 * reads the four proc signals the UI plays the rune-trigger burst from:
 *
 *  · SHOP     `ancients.procs` rising across one action (`procAncient`).
 *  · COMBAT   the fight's `questTrigger`s whose flag `isAncientProcFlag`, per side.
 *  · SOT      Start-of-Turn beats (`sotBeatFx`) sourced on the hero and named for an Ancient (the Shop plays the burst
 *             when the beat's pulse fires, `Recruit.tsx`).
 *  · EOT      End-of-Turn beats (the authoritative batch's `sourceTrigger`s) sourced on the hero, named for an Ancient and
 *             carrying at least one consequence (the End-of-Turn player bursts the button as the beat activates).
 *
 * The CLASSIFICATION of which pairings are event-fired lives here too (`ANCIENT_PROC_PHASES`, by primitive, plus
 * per-pairing overrides): the table test (`ancientProcs.test.ts`) requires one case per (pairing, phase) it names.
 */
import { CARD_INDEX } from '@game/content';
import type { CombatEvent, Side } from '@game/core';
import { ANCIENT_IDS, ANCIENT_PAIRINGS, type AncientId } from './ancients';
import { isAncientBuffLabel } from './ancientBuffFx';
import { isAncientProcFlag } from './ancientProcs';
import { createRun, enableAncients, prepareActionWithPresentation, reduce, type Action, type BoardCard, type BoardSnapshot, type RunState } from './index';

export type ProcPhase = 'shop' | 'combat' | 'sot' | 'eot';

/**
 * Which phase(s) each EVENT-FIRED primitive fires in. A primitive not listed is not event-fired (a modifier of the hero
 * power's own use, a price / cadence / shape passive, a pick-time one-shot): the hero power's own click already plays its
 * activation burst, and a passive has no moment to mark. Keep this in step with `ancients.ts`'s "Where each primitive
 * fires" notes.
 */
export const ANCIENT_PROC_PHASES: Readonly<Record<string, readonly ProcPhase[]>> = {
  // ── deaths: every hero Avenge is ONE running count across the Shop AND combat ──
  avengeAdvanceCommission: ['shop', 'combat'], avengeAdvanceCrown: ['shop', 'combat'], avengeAllInGold: ['shop', 'combat'],
  avengeBuffTier7: ['shop', 'combat'], avengeCopyLastTurnBuy: ['shop', 'combat'], avengeCopyTopAttack: ['shop', 'combat'],
  avengeFreeRefresh: ['shop', 'combat'], avengeGrantCard: ['shop', 'combat'], avengeGrantTribeMinion: ['shop', 'combat'],
  avengeImproveSpells: ['shop', 'combat'], avengeMaxGold: ['shop', 'combat'], avengeRandomShopSpell: ['shop', 'combat'],
  avengeReduceDiceLock: ['shop', 'combat'], avengeSummonSprout: ['shop', 'combat'], avengeTierMinion: ['shop', 'combat'],
  avengeUnitedFront: ['shop', 'combat'], deathGivesAttack: ['shop', 'combat'], deathsGetGildedMinion: ['shop', 'combat'],
  friendlyDeathBuffsGilded: ['shop', 'combat'], gildedEchoGetCard: ['shop', 'combat'],
  combatLastDeathCopy: ['combat'], afterCombatFirstFoeCopy: ['combat'],
  // ── stat gains / Rise / summons / Shouts / spells, both phases ──
  wardedGainBuffsWarded: ['shop', 'combat'], gildedGainBuffsGilded: ['shop', 'combat'], copyMachineBonds: ['shop', 'combat'],
  riseTriggersAdjacentEcho: ['shop', 'combat'], shoutBuffsDrakkos: ['shop', 'combat'], summonGainPerGoldSpent: ['shop', 'combat'],
  spellCastBuffsEachType: ['shop', 'combat'], spellsGiveWardAttack: ['shop', 'combat'], spellsGrantShopSpell: ['shop', 'combat'],
  spellsRechargePower: ['shop', 'combat'], spellsRechargeSpellbook: ['shop', 'combat'],
  // ── combat only ──
  wardBreakGold: ['combat'], wardBreaksGetCopy: ['combat'], riseGold: ['combat'], undyingRegainsRise: ['combat'],
  undyingReturnsDoubleAndAttacks: ['combat'], summonsSummonExtra: ['combat'], summonBuffsOthers: ['combat'],
  firstSummonsAttack: ['combat'], attacksGold: ['combat'], flashSecondKill: ['combat'], minionsRallyGold: ['combat'],
  reclaimBondsAdjacent: ['combat'], reclaimEchoExtra: ['combat'], reclaimGainImproves: ['combat'], reclaimSummonsTwice: ['combat'],
  pummelClearanceStack: ['combat'], pummelCopyWarband: ['combat'], pummelEnemyCopy: ['combat'], pummelGrantsCards: ['combat'],
  pummelPowerUse: ['combat'], pummelSwapCharge: ['combat'], autoReclaimLeftmostEcho: ['combat'],
  socBladeMastery: ['combat'], socBuffPerGildedPlayed: ['combat'], socBuffPerShout: ['combat'], socBuffTribePerBought: ['combat'],
  socCopyTier7: ['combat'], socCopyTopHealth: ['combat'], socGildRightmost: ['combat'], socRallyPerGoldSpent: ['combat'],
  socTriggerEdgeShouts: ['combat'], socTripleNeutrals: ['combat'], socWardFlurry: ['combat'], socWardPerGildedFoe: ['combat'],
  // ── Shop events ──
  buyNextRefreshFree: ['shop'], buysBuffImproves: ['shop'], buysDiscoverLocked: ['shop'], clearanceDestroyFirstFree: ['shop'],
  clearanceSaleGivesStats: ['shop'], coinCastImproves: ['shop'], contrabandBuyFreeRefresh: ['shop'], contrabandKeyword: ['shop'],
  copyOfControlledBuffImproves: ['shop'], discoverImprovesSpells: ['shop'], duplicatePlayBuffsOthers: ['shop'],
  enchantedBuyBuffImproves: ['shop'], firstBuyExtraCopy: ['shop'], firstTargetedSpellsTwice: ['shop'], fourPeatPassive: ['shop'],
  giftsCastOnAdjacent: ['shop'], gildAlsoTripleReward: ['shop'], gildedPlayBuffsGilded: ['shop'], gildedPlayExtraRewards: ['shop'],
  goldSpentDiscoverTier7: ['shop'], luckySeatCopyPurchased: ['shop'], memoryFirstBuyCopy: ['shop'], playParityBuff: ['shop'],
  refreshUpgradeDiscount: ['shop'], refreshesCastSpell: ['shop'], saleBuffsLeftmost: ['shop'], saleDiscountsTribe: ['shop'],
  sellGildedGetsPlainCopy: ['shop'], sellsGetCopy: ['shop'], sellsGrantFreeRefresh: ['shop'], shopShoutGold: ['shop'],
  spendGoldBuffsRandom: ['shop'], spoilsPassive: ['shop'], summitGildTier7: ['shop'], tribeBuyBuffsOthers: ['shop'],
  tripleRewardGold: ['shop'], tripleRewardOpenGold: ['shop'], tripleRewardPickKeyword: ['shop'], tripleRewardTwice: ['shop'],
  commissionBuffsBoard: ['shop'], commissionFreeRefreshes: ['shop'], commissionGrantsTierMinion: ['shop'], commissionPaysTwice: ['shop'],
  // ── Start of Turn (the Ancient's own beat) ──
  sotBuffPerCombatSummon: ['sot'], sotCopyLastCombatDeath: ['sot'], sotCopyLastFoe: ['sot'], sotCopyToHand: ['sot'],
  sotDiscoverTierAbove: ['sot'], sotGainGold: ['sot'], sotGetCard: ['sot'], sotGildRandom: ['sot'],
  discoverTier7InTurns: ['sot'], investmentDiscoverTierCopies: ['sot'], greatPresenceGrantsCard: ['sot'],
  // ── End of Turn (the Ancient's own virtual entry beat) ──
  eotBuffPerEnchantedBuy: ['eot'], eotBuffPerTribeBuy: ['eot'], eotCastSpell: ['eot'], eotCoinsImprove: ['eot'], eotMaxGold: ['eot'],
  eotRandomShopSpells: ['eot'], eotRefreshTopTribeFreeze: ['eot'], eotTierMinion: ['eot'], eotTriggerLeftmostShout: ['eot'],
  eotUnitedFrontPerShopSpells: ['eot'], eotUpgradeDiscount: ['eot'], eotVinesImproves: ['eot'], pairsGoldNextTurn: ['eot'],
  unitedFrontAtEndOfTurn: ['eot'],
  // ── the Duos heroes (Ancients reach Duos since #2758) ──
  passEchoGainsRise: ['shop'], passSpellResetsPassaria: ['shop'], passBuffsLeftmosts: ['shop'], socBuffPerPass: ['combat'],
  hatUpgradeDiscount: ['shop'], socMateCopiesShareStats: ['combat'], sotCopyPassedCard: ['sot'],
  avengeTeammateGetsCard: ['shop', 'combat'], goldSpentRefreshesPower: ['shop'], socGildLeftmost: ['combat'], nextTurnTeamCard: ['sot'],
};

/** Per-pairing corrections on top of the primitive map (`hero.ancient` → phases; `[]` = not event-fired here). Add a row
 *  only when a pairing's primitive fires somewhere else for that hero, with a one-line reason. */
export const ANCIENT_PROC_OVERRIDES: Readonly<Record<string, readonly ProcPhase[]>> = {
  // group 2: a commission's payout extras resolve at Start of Turn, inside the payout's own hero-sourced beat
  'cassen.fortune': ['sot'], 'cassen.war': ['sot'], 'cassen.genesis': ['sot'], 'cassen.bonds': ['sot'],
  // group 2: Drakko × Time's `alsoSoc` also fires the left-most Shout at Start of Combat
  'drakko.time': ['eot', 'combat'],
};

/** Heroes left out (none since #2758 put Ancients in Duos: Priestess, Magician and Cindy are covered too). */
export const ANCIENT_PROC_SKIP_HEROES: ReadonlySet<string> = new Set();

/** Every (hero, Ancient, phase) the table requires a proc case for. */
export function expectedProcRows(): { hero: string; ancient: AncientId; phase: ProcPhase }[] {
  const out: { hero: string; ancient: AncientId; phase: ProcPhase }[] = [];
  for (const [hero, row] of Object.entries(ANCIENT_PAIRINGS)) {
    if (ANCIENT_PROC_SKIP_HEROES.has(hero)) continue;
    for (const ancient of ANCIENT_IDS) {
      const p = row?.[ancient];
      if (!p) continue;
      const key = `${hero}.${ancient}`;
      const phases = ANCIENT_PROC_OVERRIDES[key]
        ?? [...new Set(p.effects.flatMap((e) => ANCIENT_PROC_PHASES[e.do] ?? []))];
      for (const phase of phases) out.push({ hero, ancient, phase });
    }
  }
  return out;
}

/** One proc case: drive the pairing through `fires` real fires in `phase` and return the procs observed. */
export interface ProcCase {
  hero: string;
  ancient: AncientId;
  phase: ProcPhase;
  /** How many times the scenario makes the pairing fire (prefer 2+, so per-fire counting is proven). */
  fires: number;
  /** Runs the scenario; returns the number of procs the signal for `phase` carried. */
  run: () => number;
  /** Optional note (what the scenario does). */
  note?: string;
}

// ── scenario helpers ─────────────────────────────────────────────────────────────────────────────────────────────

export const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};

/** A run of `hero` with Ancients on and `id` picked through the real `pickAncient` action. */
export function pickedRun(hero: string, id: AncientId, over: Partial<RunState> = {}, seed = 7): RunState {
  let s = enableAncients({ ...createRun(seed, hero), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  if (s.ancients?.picked !== id) throw new Error(`${hero} × ${id}: the pick did not land`);
  return s;
}

/** A served foe board: `n` × sandbag (attack / health). */
export function foes(wave: number, attack: number, health: number, n = 1, extra: Partial<BoardSnapshot['minions'][number]> = {}): BoardSnapshot {
  return {
    v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health * n,
    minions: Array.from({ length: n }, () => ({ cardId: 'sandbag', attack, health, keywords: [], ...extra })), seed: 1, origin: 'self',
  } as BoardSnapshot;
}

/** Shop procs one action made. */
export function shopProcs(prev: RunState, action: Action): { next: RunState; procs: number } {
  const next = reduce(prev, action);
  return { next, procs: (next.ancients?.procs ?? 0) - (prev.ancients?.procs ?? 0) };
}

/** Shop procs over several actions (each may be a function of the state so far). */
export function shopProcsOver(s: RunState, actions: readonly (Action | ((s: RunState) => Action))[]): { s: RunState; procs: number } {
  let procs = 0;
  for (const a of actions) {
    const r = shopProcs(s, typeof a === 'function' ? a(s) : a);
    s = r.next;
    procs += r.procs;
  }
  return { s, procs };
}

/** Ancient proc markers in a fight's log for `side`. */
export function combatProcCount(events: readonly CombatEvent[], side: Side = 'player'): number {
  return events.filter((e) => e.type === 'questTrigger' && e.side === side && isAncientProcFlag(e.flag)).length;
}

/** Fight `foe` through the real `faceOmen` (the run's own side state, Ancient mods included). */
export function fight(s: RunState, foe: BoardSnapshot = foes(s.wave, 1, 200)): { s: RunState; events: CombatEvent[]; procs: number } {
  const next = reduce({ ...s, servedBoards: { ...(s.servedBoards ?? {}), [s.wave]: foe } }, { type: 'faceOmen' });
  const events = (next.lastCombat?.events ?? []) as CombatEvent[];
  return { s: next, events, procs: combatProcCount(events) };
}

/** Start-of-Turn Ancient beats an action recorded (hero source, an Ancient's name). */
export function sotAncientBeats(next: RunState): number {
  return (next.sotBeatFx ?? []).filter((b) => b.source.kind === 'hero' && isAncientBuffLabel(b.source.label)).length;
}

/** Fight, settle (`resolveCombat`, which runs Start of Turn) and count the Ancient's Start-of-Turn beats. */
export function sotProcsAfterFight(s: RunState, foe?: BoardSnapshot): { s: RunState; procs: number } {
  const fought = fight(s, foe).s;
  const next = reduce(fought, { type: 'resolveCombat' });
  return { s: next, procs: sotAncientBeats(next) };
}

/** End-of-Turn Ancient beats through the authoritative batch (`faceOmen`): hero-sourced triggers named for an Ancient
 *  that carry at least one consequence. */
export function eotAncientBeats(state: RunState): number {
  const prepared = prepareActionWithPresentation(state, { type: 'faceOmen' });
  const events = (prepared.batch?.events ?? []) as { type: string; id?: string; parentId?: string; source?: { kind: string; label?: string } }[];
  const parents = new Set(events.filter((e) => e.type !== 'sourceTrigger').map((e) => e.parentId));
  return events.filter((e) => e.type === 'sourceTrigger' && e.source?.kind === 'hero' && isAncientBuffLabel(e.source.label) && parents.has(e.id)).length;
}
