/**
 * BEAT CHOREOGRAPHER PR 5 — the consequence presenter registry (blueprint §6.4).
 *
 * A presenter turns ONE emitted consequence into visuals. That is the whole idea: the legacy End-of-Turn
 * loop decided what to animate by re-deriving it — scanning card definitions for factory ids, diffing
 * projected state, and special-casing individual cards. Which is why adding a card that raised spell power
 * through a different factory silently played no cue at all (Void Curator, owner report 2026-07-28).
 *
 * Here the EVENT says what happened, so any card that produces a consequence gets its presentation for free,
 * including cards not written yet.
 *
 * Three hard rules:
 *   1. A presenter NEVER mutates gameplay and never dispatches. It reads an event and draws.
 *   2. Every FX call goes through the injected context, so this module has no DOM/Pixi/GSAP import and can be
 *      tested for coverage without a browser.
 *   3. A consequence with no presenter is a COVERAGE GAP that `presenterCoverage()` reports — not a crash,
 *      and not a silent nothing that looks fine until someone notices a missing cue months later.
 */
import type { ConsequenceEvent } from '@game/core';
import type { CompiledBeat } from './timelineTypes';

/** Every FX capability a presenter may use. Implemented by `Recruit.tsx` from its existing helpers. */
export interface PresenterContext {
  /** Generic stat-gain burst on a card (skipped when a richer authored FX already covers that target). */
  statGain: (uid: string, zone: string, attack: number, health: number) => void;
  /** Rubies landing on a board minion — the bound gem cascade. */
  rubyLanded: (uid: string, count: number) => void;
  /** Spell power rose: flourish on the source + pop the held spells whose printed values just changed. */
  spellPower: (sourceUid: string | undefined, attack: number, health: number) => void;
  /** Imp aura washed (Void Curator). */
  impAura: () => void;
  /** A card arrived in hand. */
  cardGranted: (cardId: string, uid: string) => void;
  /** A minion was summoned to the board. */
  cardSummoned: (cardId: string, uid: string) => void;
  /** A card left play — Fodder eaten, a shop offer consumed. */
  cardDestroyed: (uid: string, zone: string) => void;
  /** A shop offer grew. */
  shopBuffed: (uid: string, attack: number, health: number) => void;
  /** A HUD resource moved (Gold, max Gold, upgrade cost). */
  resourceChanged: (resource: string, amount: number) => void;
  /** A counter moved — attachments welded onto a Mech, quest progress. */
  counterChanged: (counter: string, amount: number, uid?: string) => void;
  /** A minion transformed into another card. */
  cardTransformed: (uid: string, toCardId: string) => void;
  /** A keyword was gained or lost. */
  keywordChanged: (uid: string, keyword: string, gained: boolean) => void;
}

/** What a presenter is handed: the consequence, the beat that caused it, and the FX surface. */
export interface PresenterArgs {
  consequence: ConsequenceEvent;
  beat: CompiledBeat;
  ctx: PresenterContext;
}

export type ConsequencePresenter = (args: PresenterArgs) => void;

/**
 * The registry. Keyed by consequence type so coverage is a property of the TYPE SYSTEM plus the test below,
 * rather than something a human has to remember when adding a consequence.
 */
export const CONSEQUENCE_PRESENTERS: Record<ConsequenceEvent['type'], ConsequencePresenter> = {
  statsChanged: ({ consequence: c, ctx }) => {
    if (c.type !== 'statsChanged' || !c.target.uid) return;
    // The channel says WHICH visual language this gain speaks — the same +2/+2 reads differently as a ruby,
    // a spell-power tick or an ordinary buff. Ruby/aura channels are delivered by their own consequences,
    // so only the ordinary channel draws the generic burst here.
    if (c.channel && c.channel !== 'ordinary') return;
    ctx.statGain(c.target.uid, c.target.zone, c.attack, c.health);
  },
  rubyPlayed: ({ consequence: c, ctx }) => {
    if (c.type !== 'rubyPlayed' || !c.target.uid) return;
    ctx.rubyLanded(c.target.uid, c.count);
  },
  auraChanged: ({ consequence: c, beat, ctx }) => {
    if (c.type !== 'auraChanged') return;
    // Driven by the emitted aura NAME, not by matching a factory id — the fix for the Void Curator gap.
    if (c.aura === 'spellPower') ctx.spellPower(beat.source.uid, c.attack ?? c.amount, c.health ?? 0);
    else if (c.aura === 'impAura') ctx.impAura();
  },
  cardGranted: ({ consequence: c, ctx }) => {
    if (c.type !== 'cardGranted') return;
    ctx.cardGranted(c.cardId, c.target.uid ?? c.id);
  },
  cardSummoned: ({ consequence: c, ctx }) => {
    if (c.type !== 'cardSummoned') return;
    ctx.cardSummoned(c.cardId, c.target.uid ?? c.id);
  },
  cardDestroyed: ({ consequence: c, ctx }) => {
    if (c.type !== 'cardDestroyed') return;
    ctx.cardDestroyed(c.target.uid ?? '', c.target.zone);
  },
  cardTransformed: ({ consequence: c, ctx }) => {
    if (c.type !== 'cardTransformed' || !c.target.uid) return;
    ctx.cardTransformed(c.target.uid, c.toCardId);
  },
  keywordChanged: ({ consequence: c, ctx }) => {
    if (c.type !== 'keywordChanged' || !c.target.uid) return;
    ctx.keywordChanged(c.target.uid, c.keyword, c.gained);
  },
  shopChanged: ({ consequence: c, ctx }) => {
    if (c.type !== 'shopChanged' || !c.target.uid) return;
    if (c.change === 'consumed' || c.change === 'destroyed') ctx.cardDestroyed(c.target.uid, 'shop');
    else ctx.shopBuffed(c.target.uid, c.attack ?? 0, c.health ?? 0);
  },
  resourceChanged: ({ consequence: c, ctx }) => {
    if (c.type !== 'resourceChanged') return;
    ctx.resourceChanged(c.resource, c.amount);
  },
  counterChanged: ({ consequence: c, beat, ctx }) => {
    if (c.type !== 'counterChanged') return;
    // A counter change carries no target of its own today, so it attributes to the beat's source — which is
    // correct for welds (the Mech being bolted onto is the source) and honest for quest counters.
    ctx.counterChanged(c.counter, c.amount, beat.source.uid);
  },
  // A spell resolving is narrated by the beat itself (the source cue) — it has no separate visual of its own.
  spellResolved: () => {},
};

/** Run the presenter for one consequence. Unknown types are reported by coverage, never thrown. */
export function presentConsequence(args: PresenterArgs): void {
  CONSEQUENCE_PRESENTERS[args.consequence.type]?.(args);
}

/**
 * Which consequence types have a presenter — the FX column of the six-stage coverage matrix (§15.1). A type
 * present in the union but absent here means an emitted gameplay result with NOTHING on screen, which is
 * exactly the failure this project exists to make impossible to ship unnoticed.
 */
export function presenterCoverage(types: readonly string[]): { type: string; covered: boolean }[] {
  return types.map((type) => ({ type, covered: Boolean((CONSEQUENCE_PRESENTERS as Record<string, unknown>)[type]) }));
}
