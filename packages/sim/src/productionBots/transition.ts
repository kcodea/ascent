import { CARD_INDEX, EQUIPMENT_INDEX } from '@game/content';
import type { CardDef } from '@game/core';
import { reduce } from '../reducer';
import { mixSeed, type Action, type RunState } from '../state';
import { fingerprint, toBotVisibleState } from './visibleState';
import type { BotVisibleState, PlanningStateHandle, PlanningTransition, RevealBoundary } from './types';

/**
 * THE ONLY MODULE THAT MAY CALL `reduce()` DURING SEARCH.
 *
 * `reduce()` is authoritative but hostile to speculation: its wrapper writes to its INPUT before `reduceCore()`
 * clones — it resets `recruitBuffFx` and `auraFx`, stamps `weldFxBaseSeq`, and (the dangerous one) PINS this
 * wave's opponent into `servedBoards`. Calling it on the live run to "just try" an action would therefore
 * decide the player's next fight as a side effect of thinking about it, and calling it on a shared node would
 * corrupt every sibling candidate.
 *
 * So a planning state is never handed out. Callers get an opaque `PlanningStateHandle`; the `RunState` behind it
 * lives only in this module's store, and every expansion clones the parent before touching the reducer.
 *
 * Handles are reference-counted by the caller via `release()`. A search that forgets leaks memory but nothing
 * worse — the store is per-decision and `releaseAll()` drops the lot.
 */

const STORE = new Map<string, RunState>();
/** The projection of a stored state, computed once. Safe: a stored state is never mutated after insertion —
 *  every expansion clones first — so its projection cannot go stale. */
const VISIBLE = new Map<string, BotVisibleState>();
/**
 * The state BEHIND a projection this module produced (a stored handle's, or a sampled future's). Read by
 * `probeFuture` alone, which clones it before anything touches it. A `WeakMap` so a projection the caller drops
 * takes its state with it; keyed by the projection object, so a visible state built anywhere else (a test, a
 * hand-made view) has no state behind it and a probe of it returns null rather than guessing.
 */
const STATE_OF = new WeakMap<BotVisibleState, RunState>();
let nextId = 0;

function visibleFor(id: string, s: RunState): BotVisibleState {
  let v = VISIBLE.get(id);
  if (!v) { v = toBotVisibleState(s); VISIBLE.set(id, v); STATE_OF.set(v, s); }
  return v;
}

/** Deep-clone a planning state. `lastCombat` is large, read-only and irrelevant to a shop decision, so it is
 *  dropped rather than copied — the same trick the reducer uses, for the same reason. */
function clonePlanning(s: RunState): RunState {
  const rest = { ...s };
  delete (rest as { lastCombat?: unknown }).lastCombat;
  return structuredClone(rest) as RunState;
}

/**
 * Take a private snapshot of the live run to plan against. The caller's state is never retained or mutated —
 * the clone happens here, before anything else can touch it.
 */
export function createPlanningRoot(run: RunState): PlanningStateHandle {
  const id = `p${nextId++}`;
  STORE.set(id, clonePlanning(run));
  return { id };
}

/** The redacted view of a handle. The only way to look at a planning state from outside this module. */
export function visibleOf(handle: PlanningStateHandle): BotVisibleState {
  const s = STORE.get(handle.id);
  if (!s) throw new Error(`planning handle ${handle.id} has been released`);
  return visibleFor(handle.id, s);
}

// ───────────────────────────────────────────── the reveal audit ─────────────────────────────────────────────
//
// Two halves, because neither alone is enough:
//
//  1. STATIC, BY EFFECT (`revealOf`): before an action is applied, does the thing it fires carry an effect that
//     can mint, discover, transform, steal or otherwise generate something the bot has not seen? Derived from
//     the card / hero-power / Equipment definition's effect ids, so a search can know a candidate is a boundary
//     without applying it. The content package publishes no "this factory is random" metadata (its factory
//     maps cover card REFERENCES, not randomness), so the predicate is a documented NAME-PATTERN over effect ids
//     (`RANDOM_EFFECT`) restricted to recruit-phase triggers — conservative by design, and audited by
//     `coverage.test.ts` against the factory-id list so a new random factory that dodges the pattern is caught.
//
//  2. DYNAMIC, BY THE ENGINE (`rngConsumed`): after applying on a private clone, did the run's RNG cursor move?
//     If it did, the child's contents depend on the hidden future — whatever the action was called. This is
//     the authoritative half; the static half exists so generation and tracing can reason before applying.
//
// Either half marks the transition as a reveal. Search must not expand a reveal child, and must not score it by
// looking at the real child (the engine is seeded — that is reading the future of the decision being made).
// `sampleCandidate` below is the honest way to score one: apply the action on clones whose hidden future has
// been REPLACED by a fixed panel of independent seeds, and average.

/** Recruit-phase triggers — the events a shop action can fire on the played thing or on a board watcher. */
const RECRUIT_EVENTS = new Set<string>([
  'onPlay', 'cast', 'spellCast', 'spellCastOnThis', 'chooseOnePlayed', 'cardsPlayed', 'cardsBought', 'onBuy',
  'goldSpent', 'onSell', 'minionSold', 'onTribePlayed', 'onGainCard', 'equip', 'onRubyPlayed', 'rubyPlayedAnywhere',
  'onGetRuby', 'rubyCast', 'shopRefreshed', 'spellBought', 'onConsume', 'starformGained', 'starformRemoved',
  'battlecryTriggered', 'endOfTurn', 'passive',
]);

/**
 * The documented name-pattern: an effect id containing any of these generates or reshapes cards or targets the
 * bot has not seen. `getRubies` is deliberately NOT here — it mints a NAMED Ruby (deterministic); a card that
 * mints a random one says so in its id.
 */
export const RANDOM_EFFECT = /random|discover|conjure|transform|gild\w*tavern|swap|steal|magnet|copyrecent|mystery|lucky|dice|shuffle/i;

/** Hero-power kinds whose activation draws a card or a target the bot has not seen. Name-pattern, same caveat. */
const RANDOM_POWER = /dig|tamer|displace|dice|pocket|archive|mimic|lucky|discover|random|spellbook|memory|hoard|tempest|exhibition/i;

function defHasRandomRecruitEffect(def: CardDef | undefined): string | null {
  if (!def) return null;
  if (def.discoverOnPlay) return 'discoverOnPlay'; // the Triple Reward token and its kin: a Discover opens on play
  const effects = [...def.effects, ...(def.chooseOne?.flatMap((o) => o.effects) ?? [])];
  for (const e of effects) {
    if (RECRUIT_EVENTS.has(e.on) && RANDOM_EFFECT.test(e.do)) return e.do;
  }
  return null;
}

/** Board watchers that fire on a recruit event and do something random (Hellrider counting refreshes is not
 *  random; a "when you play a Beast, buff a random friendly" is). */
function boardWatcherRandom(v: BotVisibleState, events: readonly string[]): string | null {
  for (const c of v.board) {
    const def = CARD_INDEX[c.cardId];
    if (!def) continue;
    for (const e of def.effects) {
      if (events.includes(e.on) && RANDOM_EFFECT.test(e.do)) return `${c.cardId}:${e.do}`;
    }
  }
  return null;
}

/**
 * Which actions hand the bot information it does not already hold — the STATIC half of the audit.
 *
 * With no `visible` (the legacy signature) only the inherently-revealing action types are known. With one, the
 * effect audit runs: a play whose card can discover/generate, a hero power that draws, an Equipment whose
 * factory (or Choose One branch, or cast spell) is random, a buy that completes a triple, and a board watcher
 * that fires randomly on the action's event.
 */
export function revealOf(action: Action, visible?: BotVisibleState): RevealBoundary | null {
  switch (action.type) {
    case 'roll':
      return { kind: 'refresh', because: 'a refresh draws a shop the bot has not seen' };
    case 'rerollRuneforge':
      return { kind: 'forge', because: 'a forge reroll draws runes the bot has not seen' };
    case 'buyRune':
      return { kind: 'forge', because: 'forging can grant randomly and re-opens the offer' };
    case 'buyQuest':
      return { kind: 'randomGrant', because: 'a quest reward can generate cards the bot has not seen' };
    default:
      break;
  }
  if (!visible) return null;
  switch (action.type) {
    case 'play': {
      const card = visible.hand.find((c) => c.uid === action.uid);
      const def = card ? CARD_INDEX[card.cardId] : undefined;
      // A TRIPLE combines at buy time (three copies → one golden in hand) and playing the golden grants the
      // Triple Reward SPELL — both deterministic. The reveal is the reward's CAST, which `defHasRandomRecruitEffect`
      // catches below through its `spellDiscover…` effect id like any other Discover spell.
      const own = defHasRandomRecruitEffect(def);
      if (own) return { kind: 'randomGrant', because: `${card!.cardId} fires ${own} on play` };
      const watcher = boardWatcherRandom(visible, def?.spell ? ['spellCast', 'cardsPlayed', 'rubyPlayedAnywhere', 'rubyCast'] : ['cardsPlayed', 'onTribePlayed', 'onSummon']);
      if (watcher) return { kind: 'randomGrant', because: `board watcher ${watcher} fires on play` };
      return null;
    }
    case 'buy': {
      const offer = [...visible.shop, ...(visible.spellOffer ? [visible.spellOffer] : [])].find((o) => o.uid === action.uid);
      if (!offer) return null;
      const watcher = boardWatcherRandom(visible, ['cardsBought', 'onBuy', 'goldSpent', 'spellBought']);
      if (watcher) return { kind: 'randomGrant', because: `board watcher ${watcher} fires on buy` };
      return null;
    }
    case 'sell': {
      const watcher = boardWatcherRandom(visible, ['onSell', 'minionSold']);
      return watcher ? { kind: 'randomGrant', because: `board watcher ${watcher} fires on sell` } : null;
    }
    case 'heroPower': {
      const p = visible.hero.powers.find((x) => x.slot === (action.slot === 1 ? 1 : 0));
      if (p && RANDOM_POWER.test(p.kind)) return { kind: 'randomGrant', because: `hero power ${p.kind} draws` };
      if (action.commission === 'discover') return { kind: 'discover', because: 'a Discover commission' };
      return null;
    }
    case 'activateEquipment': {
      const eq = visible.equipment.find((e) => e.selected);
      if (!eq) return null;
      const def = EQUIPMENT_INDEX[eq.equipmentId];
      const ids = [eq.effectId, ...eq.chooseOne];
      const hit = ids.find((id) => RANDOM_EFFECT.test(id));
      if (hit) return { kind: 'randomGrant', because: `${eq.equipmentId} resolves ${hit}` };
      if (def?.spellId) {
        const spell = defHasRandomRecruitEffect(CARD_INDEX[def.spellId]);
        if (spell) return { kind: 'randomGrant', because: `${eq.equipmentId} casts ${def.spellId}, which fires ${spell}` };
      }
      return null;
    }
    case 'chooseOne': {
      const m = visible.mandatoryDecision;
      if (m?.kind !== 'chooseOne') return null;
      if (m.equipmentId) {
        const branch = EQUIPMENT_INDEX[m.equipmentId]?.chooseOne?.[action.index];
        return branch && RANDOM_EFFECT.test(branch.effectId) ? { kind: 'randomGrant', because: `${m.equipmentId} branch ${branch.effectId}` } : null;
      }
      const src = visible.hand.find((c) => c.uid === m.sourceUid);
      const branch = src ? CARD_INDEX[src.cardId]?.chooseOne?.[action.index] : undefined;
      const hit = branch?.effects.find((e) => RANDOM_EFFECT.test(e.do));
      return hit ? { kind: 'randomGrant', because: `${src!.cardId} branch fires ${hit.do}` } : null;
    }
    default:
      return null;
  }
}

/**
 * Apply one candidate to a PRIVATE clone of the parent and return the child.
 *
 * `changed: false` means the reducer rejected it — `reduce()` signals a no-op by returning its input, so
 * identity is the check. A rejected candidate still yields a handle (pointing at an unchanged clone) so callers
 * can treat every candidate uniformly instead of branching on null.
 *
 * `reveal` is the union of the static audit and the dynamic one: an action the static predicate called
 * deterministic that nonetheless moved the RNG cursor is reported as `rngConsumed`.
 */
export function applyCandidate(parent: PlanningStateHandle, action: Action): PlanningTransition {
  const base = STORE.get(parent.id);
  if (!base) throw new Error(`planning handle ${parent.id} has been released`);
  // Clone FIRST. `reduce()` mutates whatever it is handed, so passing `base` would corrupt the parent node and
  // every sibling expanded from it.
  const own = clonePlanning(base);
  const cursorBefore = own.rngCursor;
  const staticReveal = revealOf(action, visibleFor(parent.id, base));
  const next = reduce(own, action);
  const changed = next !== own;
  const id = `p${nextId++}`;
  STORE.set(id, next);
  const visible = visibleFor(id, next);
  const rngConsumed = changed && next.rngCursor !== cursorBefore;
  const reveal = staticReveal ?? (rngConsumed ? { kind: 'rngConsumed' as const, because: `${action.type} consumed the run RNG` } : null);
  return {
    changed,
    child: { id },
    visible,
    fingerprint: fingerprint(visible),
    reveal,
    rngConsumed,
  };
}

/**
 * SCORE A REVEAL WITHOUT READING THE FUTURE.
 *
 * Apply `action` to `n` private clones of the parent whose hidden future has been REPLACED: each clone gets a
 * seed + cursor mixed from `panelSeed` and its index, so the outcome is drawn from the same distribution a
 * player faces but is independent of the run's real hidden draw. Every candidate scored in one decision uses
 * the SAME panel (the caller fixes `panelSeed` per decision), so two refreshes are compared against the same
 * imagined futures rather than each against its own lucky draw — the comparability property `fightScore`'s
 * panel taught us is load-bearing.
 *
 * Returns the visible states of the sampled children (rejected samples excluded); the caller averages its
 * evaluator over them. Every sample handle is released before returning — nothing to hold on to.
 */
export function sampleCandidate(parent: PlanningStateHandle, action: Action, panelSeed: number, n: number): BotVisibleState[] {
  const base = STORE.get(parent.id);
  if (!base) throw new Error(`planning handle ${parent.id} has been released`);
  const out: BotVisibleState[] = [];
  for (let i = 0; i < n; i++) {
    const own = clonePlanning(base);
    // Both channels the engine draws from during recruit: the cursor (shop rolls, discovers, random grants)
    // and the seed (seed+wave-derived draws such as Magnetic targets and the forge reroll).
    own.rngCursor = mixSeed(panelSeed, i, 0x5eed) >>> 0;
    own.seed = mixSeed(panelSeed, i, 0x0bad) >>> 0;
    const next = reduce(own, action);
    if (next === own) continue;
    const v = toBotVisibleState(next);
    STATE_OF.set(v, next);
    out.push(v);
  }
  return out;
}

// ───────────────────────────────────────────── the future probe (B6) ─────────────────────────────────────────────

/** A private, throwaway state a probe drives through the reducer. Never handed out; released when `probeFuture` returns. */
export interface ProbeSession {
  /** Apply one action to the probe's state. False when the reducer refused it (the state is unchanged). */
  apply(action: Action): boolean;
  /** The probe state's redacted projection, rebuilt on every call (the state moves under it). */
  visible(): BotVisibleState;
}

/**
 * RUN THE ENGINE FORWARD ON A PRIVATE CLONE — the mechanism behind the ENGINE-GROWTH term (`growth.ts`).
 *
 * The evaluator cannot see what a card will DO next turn from its stats; the reducer can show it. `fn` receives a
 * session over a clone of the state behind `v` and drives it through ordinary actions — `faceOmen { deferFight }`
 * (End of Turn fires, the side is prepared, NO fight is resolved), `resolveCombat { fight }` with a neutral
 * result the caller fabricates (a 0-damage draw — the probe never knows how the real fight goes), then a scripted
 * recruit turn — and reads back projections only. Four things make it honest:
 *
 *  1. THE HIDDEN FUTURE IS REPLACED, exactly as `sampleCandidate` does: seed + cursor mixed from `panelSeed`, so
 *     the imagined next shop is a draw from the same distribution a player faces, never the run's real one. One
 *     `panelSeed` per decision → every candidate is probed against the SAME imagined future (comparability).
 *  2. THE TABLE IS STRIPPED. `s.lobby` is deleted from the clone, so ending the turn settles no lobby round: the
 *     other seats' boards (a recorded seat's FUTURE boards, in a pinned job) are never touched.
 *  3. THE SERVED OPPONENT IS PINNED TO NONE for this wave, so `faceOmen` consults no pool and no served board.
 *  4. THE CLONE IS PRIVATE and dies with the call — nothing it does reaches the live run or a planning handle.
 *
 * Null when `v` is not a projection this module produced (there is no state to clone).
 */
export function probeFuture<T>(v: BotVisibleState, panelSeed: number, fn: (p: ProbeSession) => T): T | null {
  const base = STATE_OF.get(v);
  if (!base) return null;
  let own = clonePlanning(base);
  own.rngCursor = mixSeed(panelSeed, 0x6f07, 0x5eed) >>> 0;
  own.seed = mixSeed(panelSeed, 0x6f07, 0x0bad) >>> 0;
  delete (own as { lobby?: unknown }).lobby;
  own.lobbySettledRound = undefined;
  own.servedBoards = { [own.wave]: null };
  const session: ProbeSession = {
    apply(action: Action): boolean {
      const next = reduce(own, action);
      if (next === own) return false;
      own = next;
      return true;
    },
    visible: () => toBotVisibleState(own),
  };
  return fn(session);
}

/** Drop a handle's state. Safe to call twice. */
export function release(handle: PlanningStateHandle): void {
  STORE.delete(handle.id);
  VISIBLE.delete(handle.id);
}

/** Drop every handle — call between decisions so planning memory can't accumulate across turns. */
export function releaseAll(): void {
  STORE.clear();
  VISIBLE.clear();
}

/** Live handle count, for the performance gates in Ticket 9. */
export function liveHandleCount(): number {
  return STORE.size;
}

/**
 * TEST ONLY — the raw state behind a handle. Named to make misuse obvious in review.
 *
 * The isolation guarantee cannot be verified through `visibleOf()`: the fields `reduce()` corrupts on its input
 * are `recruitBuffFx`, `auraFx`, `weldFxBaseSeq` and `servedBoards`, and every one of them is deliberately
 * REDACTED from `BotVisibleState`. Checking for the damage through the projection means checking through a lens
 * built to hide it — which is exactly what happened: removing the defensive clone from `applyCandidate` left
 * every isolation test passing.
 *
 * Nothing outside a test may call this. The module-boundary test enforces the rest.
 */
export function __unsafeStateForTests(handle: PlanningStateHandle): RunState | undefined {
  return STORE.get(handle.id);
}
