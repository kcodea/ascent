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
  /** A minion buffed ITSELF this beat — the authored self-buff def (`self-buff-gold`), the richer twin of the
   *  green `statGain` burst. Matches the per-action path so a self-buff looks the same on any beat. */
  selfBuff: (uid: string) => void;
  /** Rubies landing on a board minion — the bound gem cascade. */
  rubyLanded: (uid: string, count: number) => void;
  /** Spell power rose: flourish on the source + pop the held spells whose printed values just changed. */
  spellPower: (sourceUid: string | undefined, attack: number, health: number) => void;
  /** Imp aura washed (Void Curator). */
  impAura: () => void;
  /** Ruby strength rose ("Your Rubies gain +X" — Deepvein Tender, Facetwright): float + glow on held Rubies. */
  rubyAura: (sourceUid: string | undefined, attack: number, health: number) => void;
  /** A card arrived in hand. `sourceUid` is the board minion that granted it (Brunni's End-of-Turn Ale),
   *  or undefined when the grant came from a rune/quest/spell rather than a unit. */
  cardGranted: (cardId: string, uid: string, sourceUid?: string) => void;
  /** A minion was summoned to the board. */
  cardSummoned: (cardId: string, uid: string) => void;
  /** An Echo fired on a body still on the board (Ossuary Rite, Deathsayer, Rune of the Reliquary) — the
   *  skull-shatter on that minion, at its beat. */
  echoFired: (uid: string, cardId: string) => void;
  /** A card left play — Fodder eaten, a shop offer consumed, a BOARD minion destroyed in the shop
   *  (Graverobber, Funeral on Loan). `cardId` and `rise` let the board case pick the same death visual combat
   *  picks: the Echo skull when the card has an onDeath effect, the authored dissolve when it does not, and
   *  neither when the body is rising (it re-forms rather than dissolving). */
  cardDestroyed: (uid: string, zone: string, cardId?: string, rise?: boolean) => void;
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

  // ── PR 6: beat-level sequences. These were the last legacy-only visuals. Each is now derived from the
  // EVENT rather than from a hardcoded list of card/effect ids, which is why they cover more than legacy did.
  /**
   * A gold ribbon from a rune/quest rail node to the unit its reward hit. Legacy hardcoded exactly two
   * effects (`triggerLeftmostShout`, `triggerLeftmostEcho`) and re-derived their target by re-running the
   * reducer's pick in the UI; every other recurring reward drew nothing. Driven by the emitted target, ANY
   * rune/quest reward that lands on a unit now draws its ribbon — and it points at the unit gameplay
   * actually chose, not one the UI guessed at.
   */
  questTendril: (sourceKind: 'rune' | 'quest', sourceId: string, targetUid: string, index: number) => void;
  /** The tavern rush when a shop offer is buffed (Maw / Ritualist's Fodder pump). */
  tavernGust: (shopUid: string, cardId: string | undefined) => void;
  /** Attachments bolted onto a Mech this beat. */
  weldPulse: (hostUid: string, count: number) => void;
  /**
   * A Fodder token was consumed — the ghost-crumble choreography, flying the meal into its eater. Carries the
   * full meal because a destroy event alone cannot express it (see `FodderEatenConsequence`).
   */
  fodderEaten: (meal: { eaterUid: string; fodderId: string; attack: number; health: number; gainAttack: number; gainHealth: number }) => void;
}

/** What a presenter is handed: the consequence, the beat that caused it, and the FX surface. */
export interface PresenterArgs {
  consequence: ConsequenceEvent;
  beat: CompiledBeat;
  ctx: PresenterContext;
  /** Position within this beat's deliveries — lets a ribbon alternate its arc so a wave doesn't overlap. */
  index?: number;
}

export type ConsequencePresenter = (args: PresenterArgs) => void;

/**
 * The registry. Keyed by consequence type so coverage is a property of the TYPE SYSTEM plus the test below,
 * rather than something a human has to remember when adding a consequence.
 */
export const CONSEQUENCE_PRESENTERS: Record<ConsequenceEvent['type'], ConsequencePresenter> = {
  statsChanged: ({ consequence: c, beat, ctx, index = 0 }) => {
    if (c.type !== 'statsChanged' || !c.target.uid) return;
    // A rune/quest reward that lands on a unit draws its ribbon from the rail to that unit.
    if ((beat.source.kind === 'rune' || beat.source.kind === 'quest') && c.target.zone === 'board') {
      ctx.questTendril(beat.source.kind, beat.source.id, c.target.uid, index);
    }
    // The channel says WHICH visual language this gain speaks — the same +2/+2 reads differently as a ruby,
    // a spell-power tick or an ordinary buff. Ruby/aura channels are delivered by their own consequences,
    // so only the ordinary channel draws the generic burst here.
    if (c.channel && c.channel !== 'ordinary') return;
    // A SELF-buff — the minion that triggered this beat is the one gaining stats — gets the authored self-buff
    // def (the beat twin of the per-action `minionSelfBuffed` path). Everything else (a buff FROM another minion,
    // an aura, a rune/quest reward whose ribbon already drew above) keeps the generic green burst.
    if (beat.source.kind === 'minion' && beat.source.uid && beat.source.uid === c.target.uid) {
      ctx.selfBuff(c.target.uid);
      return;
    }
    ctx.statGain(c.target.uid, c.target.zone, c.attack, c.health);
  },
  rubyPlayed: ({ consequence: c, beat, ctx, index = 0 }) => {
    if (c.type !== 'rubyPlayed' || !c.target.uid) return;
    // The Lapidary's Rubies are a rune reward landing on a unit — ribbon AND cascade.
    if (beat.source.kind === 'rune' || beat.source.kind === 'quest') {
      ctx.questTendril(beat.source.kind, beat.source.id, c.target.uid, index);
    }
    ctx.rubyLanded(c.target.uid, c.count);
  },
  auraChanged: ({ consequence: c, beat, ctx }) => {
    if (c.type !== 'auraChanged') return;
    // Driven by the emitted aura NAME, not by matching a factory id — the fix for the Void Curator gap.
    if (c.aura === 'spellPower') ctx.spellPower(beat.source.uid, c.attack ?? c.amount, c.health ?? 0);
    else if (c.aura === 'impAura') ctx.impAura();
    else if (c.aura === 'ruby') ctx.rubyAura(beat.source.uid, c.attack ?? c.amount, c.health ?? 0);
  },
  cardGranted: ({ consequence: c, beat, ctx }) => {
    if (c.type !== 'cardGranted') return;
    // Thread the GRANTING unit (a minion beat's source) so a Dwarf's End-of-Turn Ale can burst from it;
    // rune/quest/spell grants have no unit source and pass undefined.
    ctx.cardGranted(c.cardId, c.target.uid ?? c.id, beat.source.kind === 'minion' ? beat.source.uid : undefined);
  },
  cardSummoned: ({ consequence: c, ctx }) => {
    if (c.type !== 'cardSummoned') return;
    ctx.cardSummoned(c.cardId, c.target.uid ?? c.id);
  },
  echoFired: ({ consequence: c, ctx }) => {
    if (c.type !== 'echoFired' || !c.target.uid) return;
    ctx.echoFired(c.target.uid, c.cardId);
  },
  cardDestroyed: ({ consequence: c, ctx }) => {
    if (c.type !== 'cardDestroyed') return;
    // Just the departure. The crumble rides its own `fodderEaten` consequence, which carries the meal.
    ctx.cardDestroyed(c.target.uid ?? '', c.target.zone, c.target.cardId, c.rise);
  },
  fodderEaten: ({ consequence: c, ctx }) => {
    if (c.type !== 'fodderEaten') return;
    ctx.fodderEaten({
      eaterUid: c.eaterUid, fodderId: c.fodderId,
      attack: c.attack, health: c.health, gainAttack: c.gainAttack, gainHealth: c.gainHealth,
    });
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
    if (c.change === 'consumed' || c.change === 'destroyed') { ctx.cardDestroyed(c.target.uid, 'shop'); return; }
    ctx.shopBuffed(c.target.uid, c.attack ?? 0, c.health ?? 0);
    ctx.tavernGust(c.target.uid, c.target.cardId); // the shop-wide rush that accompanies the climb
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
    if (c.counter === 'attachments' && beat.source.uid) ctx.weldPulse(beat.source.uid, c.amount);
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
