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
  /**
   * CHOREOGRAPHER (§7.1): the REGISTRY key this effect was classified under, emitted by the gameplay code
   * that knows its factory/rune/quest identity. Presentation must never reconstruct it from the display
   * source id — that is the documented trap where a minion's card id gets mistaken for its factory id and
   * timing falls through unpredictably. Optional only during the migration.
   */
  policyKey?: string;
  /** The coarse timing bucket ('endOfTurn', 'shout', 'echo', 'summonReact', …) — normally the registry
   *  entry's `family` for `policyKey`. The timing resolver keys family templates on it. */
  family?: string;
  /** Distinguishes several independently-tunable moments inside ONE source+trigger (a card that acts on the
   *  left then the right). Identity, never a display label. */
  occurrenceKey?: string;
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
  /**
   * CHOREOGRAPHER (§7.3): WHICH marker of its source beat delivers this consequence. Defaults to `primary`
   * (the source's delivery marker). Staged effects name a sub-marker — 'consume.depart', 'consume.arrive',
   * 'summon.appear', 'attack.contact', 'resource.land'. This is what stops every consequence from being
   * assumed to land at `start + windup`.
   */
  deliveryKey?: string;
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
  /** The board slot the minion was INSERTED at (0-based, as committed). The shop summons adjacent to the
   *  summoner (`makeContext().summon` splices at `near + 1`), and without this the projection could only
   *  APPEND — so an End-of-Turn rally summon flashed in the right-most slot, then "corrected itself" when
   *  the committed board arrived (owner report 2026-08-20). Optional: a legacy batch without it still plays,
   *  the ghost just appends. */
  index?: number;
}
/**
 * An ECHO (Deathrattle) FIRED on a body that is still on the board — Ossuary Rite, Deathsayer, Rune of the
 * Reliquary, a Gravetwin's copied Echo. Its EFFECTS ride the ordinary consequences (a summon, a stat grant);
 * this is the fire itself, so the beat can play the skull-shatter on the Echo minion AT ITS BEAT. A shop
 * DESTROY does not emit it — the body has already left the board, and `cardDestroyed` plays that skull.
 * Before this (owner report 2026-09-01: "rune of the reliquary literally has no beats, animations or
 * anything firing") the skull was a legacy commit-time stamp, which for an End-of-Turn Echo landed after the
 * phase had flipped to combat — off screen.
 */
export interface EchoFiredConsequence extends ConsequenceBase {
  type: 'echoFired';
  target: ZoneTargetRef;
  cardId: string;
}
export interface CardDestroyedConsequence extends ConsequenceBase {
  type: 'cardDestroyed';
  target: ZoneTargetRef;
  /** The board slot the body LEFT (0-based, as it stood before the removal) — the departure sibling of
   *  `cardSummoned.index`. A destroy that carries no position leaves the projection nothing to animate at:
   *  the body can only wink out wherever the committed board happens not to have it, which is exactly the
   *  snap the owner reported for Graverobber and Funeral on Loan (2026-08-28). Optional: a legacy batch
   *  without it still plays. */
  index?: number;
  /** True when the body is coming BACK this same beat (Rise) — the UI shows the death but must not treat the
   *  slot as freed for good. Mirrors combat's `death.rise` flag. */
  rise?: boolean;
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
  /** Single-axis magnitude (kept for auras that have one). For the two-axis channels below it equals
   *  `attack + health`, so a viewer that only reads `amount` still shows a sensible total. */
  amount: number;
  /** Two-axis channels (spell power, imp aura) carry both parts; absent for single-axis auras. */
  attack?: number;
  health?: number;
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
  /**
   * The STAT DELTA these Rubies applied — `count × (1 + rubyBonus)` per axis, computed where `rubyBonus` is
   * known. Without it presentation could show the gem cascade but not the numbers climbing, because a Ruby's
   * worth depends on run state the UI would have to re-derive. Found by live playtest: the board sat at its
   * base stats for the whole animation and then snapped at commit (2026-08-13).
   */
  attack?: number;
  health?: number;
}

/**
 * CHOREOGRAPHER PR 11 — a Fodder token consumed off the board.
 *
 * Deliberately NOT a plain `cardDestroyed`. The eat choreography flies the consumed token's stats INTO the
 * eater, so it needs to know who ate what and what they gained — data a destroy event does not carry. When
 * the presenters were migrated (PR 5) this was the one visual left on the legacy path for exactly that
 * reason, and the gap was recorded in code rather than faked with a half-working imitation.
 */
export interface FodderEatenConsequence extends ConsequenceBase {
  type: 'fodderEaten';
  /** The minion that ate it — the FX flies from the Fodder to this card. */
  eaterUid: string;
  fodderId: string;
  /** The consumed token's own stats, and what the eater gained (they differ when a rule scales the meal). */
  attack: number;
  health: number;
  gainAttack: number;
  gainHealth: number;
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
  | RubyPlayedConsequence
  | FodderEatenConsequence
  | EchoFiredConsequence;

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
  | Omit<RubyPlayedConsequence, 'id' | 'sequence' | 'step' | 'parentId'>
  | Omit<FodderEatenConsequence, 'id' | 'sequence' | 'step' | 'parentId'>
  | Omit<EchoFiredConsequence, 'id' | 'sequence' | 'step' | 'parentId'>;

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
  /** CHOREOGRAPHER: stable identity, copied verbatim onto the event (see SourceTriggerEvent). The emitting
   *  gameplay code is the ONLY place that knows these — presentation must not re-derive them. */
  policyKey?: string;
  family?: string;
  occurrenceKey?: string;
  /** Explicit causal edges beyond parent/step: this beat may not present before those beats' markers. */
  dependencyIds?: string[];
}
