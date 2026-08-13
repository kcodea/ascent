/**
 * BEAT SYSTEM PR 2 — the shared source-attributed event contracts (blueprint §7).
 *
 * Gameplay resolution EMITS these while it mutates; presentation reads them instead of re-deriving trigger
 * order from state diffs. The two hard rules from the blueprint:
 *   1. A ConsequenceEvent describes the mutation DIRECTLY — the UI never diffs state to learn what happened.
 *   2. IDs are deterministic within a resolution (batch-local counters), never `Math.random`/uuid/time —
 *      same seed + same actions → identical events, so replays and tests are exact.
 *
 * Nothing consumes these yet (PR 2 delivers the collector + no-op mode only); the recruit pipeline (PR 3),
 * End-of-Turn migration (PR 5) and combat normalizer (PR 9) wire them in.
 */
import type { PresentationPolicy, TriggerSourceKind } from './types';

export type PresentationPhase = 'recruit' | 'endOfTurn' | 'startOfCombat' | 'combat' | 'postCombat';

/** Where an effect's owner lives, so the UI can anchor a source cue to it. */
export interface TriggerSourceRef {
  kind: TriggerSourceKind;
  /** Stable content id (card/rune/quest/hero id, or a system tag). */
  id: string;
  /** A particular card INSTANCE when applicable (combat minion uid, board uid). */
  uid?: string;
  side?: 'player' | 'enemy';
  /** Optional snapshot label for old-replay resilience; the UI prefers a live content lookup. */
  label?: string;
}

/** A place a consequence lands. Recruit targets shop/hand offers, not only combat uids — hence `zone`. */
export interface ZoneTargetRef {
  zone: 'board' | 'hand' | 'shop' | 'spellShop' | 'hero' | 'runeRail' | 'questRail';
  uid?: string;
  cardId?: string;
  index?: number;
  side?: 'player' | 'enemy';
}

/** The source's readable moment. Consequences carry `parentId` back to this. */
export interface SourceTriggerEvent {
  type: 'sourceTrigger';
  id: string;
  /** Emission order within the batch. */
  sequence: number;
  /** Atomic resolution step — presentation may reorder only WITHIN a step (blueprint §13). */
  step: number;
  phase: PresentationPhase;
  source: TriggerSourceRef;
  /** The gameplay condition ('endOfTurn', 'onSummon', 'avenge', 'cast', …). */
  trigger: string;
  policy: PresentationPolicy;
  /** Set when this trigger fired inside another (nested Shouts, Oona reacting to a summon). */
  parentId?: string;
  /** Explicit ordering edges beyond parent/step (rare; most order comes from step). */
  dependencyIds?: string[];
  /** Consequences sharing this id are simultaneous (a multi-target buff wave). */
  simultaneousGroupId?: string;
  repeatIndex?: number;
  repeatCount?: number;
}

interface ConsequenceBase {
  id: string;
  sequence: number;
  step: number;
  /** The SourceTriggerEvent that caused this (the collector sets it from the active trigger scope). */
  parentId?: string;
  simultaneousGroupId?: string;
}

export interface StatsChangedConsequence extends ConsequenceBase {
  type: 'statsChanged';
  target: ZoneTargetRef;
  attack: number;
  health: number;
  permanent: boolean;
  /** Which visual channel delivers it — the UI already treats these distinctly (ruby gems, imp aura, …). */
  channel?: 'ordinary' | 'ruby' | 'spellPower' | 'impAura' | 'shopBuff';
}
export interface KeywordChangedConsequence extends ConsequenceBase {
  type: 'keywordChanged';
  target: ZoneTargetRef;
  keyword: string;
  gained: boolean;
}
export interface CardSummonedConsequence extends ConsequenceBase {
  type: 'cardSummoned';
  target: ZoneTargetRef;
  cardId: string;
}
export interface CardDestroyedConsequence extends ConsequenceBase {
  type: 'cardDestroyed';
  target: ZoneTargetRef;
}
export interface CardTransformedConsequence extends ConsequenceBase {
  type: 'cardTransformed';
  target: ZoneTargetRef;
  toCardId: string;
}
export interface CardGrantedConsequence extends ConsequenceBase {
  type: 'cardGranted';
  target: ZoneTargetRef;
  cardId: string;
}
export interface SpellResolvedConsequence extends ConsequenceBase {
  type: 'spellResolved';
  cardId: string;
  copied?: boolean;
}
export interface ResourceChangedConsequence extends ConsequenceBase {
  type: 'resourceChanged';
  resource: 'gold' | 'maxGold' | 'nextTurnGold' | 'freeRefresh' | 'upgradeCost';
  amount: number;
  valueAfter?: number;
}
export interface ShopChangedConsequence extends ConsequenceBase {
  type: 'shopChanged';
  change: 'buffed' | 'consumed' | 'destroyed' | 'refilled' | 'replaced';
  target: ZoneTargetRef;
  attack?: number;
  health?: number;
}
export interface AuraChangedConsequence extends ConsequenceBase {
  type: 'auraChanged';
  /** e.g. 'impAura', 'spellPower'. */
  aura: string;
  amount: number;
}
export interface CounterChangedConsequence extends ConsequenceBase {
  type: 'counterChanged';
  counter: string;
  amount: number;
  valueAfter?: number;
}
export interface RubyPlayedConsequence extends ConsequenceBase {
  type: 'rubyPlayed';
  target: ZoneTargetRef;
  count: number;
}

export type ConsequenceEvent =
  | StatsChangedConsequence
  | KeywordChangedConsequence
  | CardSummonedConsequence
  | CardDestroyedConsequence
  | CardTransformedConsequence
  | CardGrantedConsequence
  | SpellResolvedConsequence
  | ResourceChangedConsequence
  | ShopChangedConsequence
  | AuraChangedConsequence
  | CounterChangedConsequence
  | RubyPlayedConsequence;

export type GamePresentationEvent = SourceTriggerEvent | ConsequenceEvent;

/** An ephemeral, ordered batch from one resolution. NEVER part of a run save (blueprint §7.5). */
export interface PresentationBatch {
  id: string;
  /** The action that produced it (deterministic, human-readable — e.g. 'endOfTurn', 'play:abc'). */
  actionId: string;
  phase: PresentationPhase;
  events: GamePresentationEvent[];
}

/** A consequence without its bookkeeping fields — what a mutation site hands the collector. */
export type ConsequenceDraft =
  | Omit<StatsChangedConsequence, 'id' | 'sequence' | 'step' | 'parentId'>
  | Omit<KeywordChangedConsequence, 'id' | 'sequence' | 'step' | 'parentId'>
  | Omit<CardSummonedConsequence, 'id' | 'sequence' | 'step' | 'parentId'>
  | Omit<CardDestroyedConsequence, 'id' | 'sequence' | 'step' | 'parentId'>
  | Omit<CardTransformedConsequence, 'id' | 'sequence' | 'step' | 'parentId'>
  | Omit<CardGrantedConsequence, 'id' | 'sequence' | 'step' | 'parentId'>
  | Omit<SpellResolvedConsequence, 'id' | 'sequence' | 'step' | 'parentId'>
  | Omit<ResourceChangedConsequence, 'id' | 'sequence' | 'step' | 'parentId'>
  | Omit<ShopChangedConsequence, 'id' | 'sequence' | 'step' | 'parentId'>
  | Omit<AuraChangedConsequence, 'id' | 'sequence' | 'step' | 'parentId'>
  | Omit<CounterChangedConsequence, 'id' | 'sequence' | 'step' | 'parentId'>
  | Omit<RubyPlayedConsequence, 'id' | 'sequence' | 'step' | 'parentId'>;

/** What a mutation site hands the collector to open a trigger scope. */
export interface BeginTriggerSpec {
  phase: PresentationPhase;
  source: TriggerSourceRef;
  trigger: string;
  policy: PresentationPolicy;
  /** Open a new resolution step for this trigger (an ownBeat boundary) vs. fold into the current one. */
  boundary?: 'newStep' | 'currentStep';
  simultaneousGroupId?: string;
  repeatIndex?: number;
  repeatCount?: number;
}
