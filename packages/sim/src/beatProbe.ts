/**
 * BEAT CHOREOGRAPHER PR 13 — the EMISSION probe (blueprint §15.2, "actual emission").
 *
 * The audit could always answer "is this effect classified?". It could never answer the question that
 * actually matters: **does gameplay announce it?** That gap is the whole reason a green report could sit on
 * top of a screen where nothing happened — Fleeting Vigor was classified and silent for weeks.
 *
 * This module answers it with evidence rather than inference: it RUNS deterministic scenarios and collects
 * the `policyKey`s gameplay really emitted. No card-text scanning, no "this factory looks like it should
 * fire" — if a key is not in the result, nothing emitted it, full stop.
 *
 * Deliberately incomplete, and honest about it: a probe can only reach what its scenarios reach. Un-emitted
 * is therefore reported as "not observed", never as "does not exist" — the difference between a fact and a
 * conclusion the data cannot support.
 */
import { createRun } from './state';
import { reduceWithPresentation } from './reducer';
import type { Action, RunState } from './state';
import { ALL_CARDS, CARD_INDEX } from '@game/content';
import { CONFIG } from './config';
import type { PresentationPhase, SourceTriggerEvent } from '@game/core';

export interface ObservedBeat {
  policyKey: string;
  phase: PresentationPhase;
  /** How many consequences the trigger carried — zero means it claimed a moment but delivered nothing. */
  consequences: number;
}

export interface ProbeResult {
  /** policyKey → what was observed (merged across every scenario). */
  observed: Map<string, ObservedBeat>;
  /** Triggers that emitted with NO policyKey — un-migrated emitters, honest-absent rather than guessed. */
  unidentified: { source: string; trigger: string; phase: PresentationPhase }[];
  scenarios: number;
}

const faceOmen = { type: 'faceOmen' } as unknown as Action;

/** One probe scenario: a named state, resolved by one action. */
export interface ProbeScenario {
  name: string;
  state: RunState;
  action?: Action;
}

const minion = (uid: string, cardId: string, attack = 2, health = 2) =>
  ({ uid, cardId, tribe: 'beast', attack, health, keywords: [], golden: false });

/**
 * The built-in scenarios. Each targets a family of effects whose emission we want evidence for; the set grows
 * as phases are instrumented. Kept deterministic (fixed seeds, explicit boards) so the report never flickers.
 */
export function defaultScenarios(): ProbeScenario[] {
  const base = (over: Partial<RunState>): RunState => ({
    ...createRun(7, 'warden'),
    phase: 'recruit',
    ...over,
  }) as RunState;

  return [
    {
      name: 'End of Turn — economy runes',
      state: base({ board: [minion('b1', 'stray')], runeCoffers: true, runeShopkeep: true, upgradeCost: 9 } as Partial<RunState>),
    },
    {
      name: 'End of Turn — Lapidary rubies',
      state: base({ board: [minion('b1', 'stray')], runeLapidary: true, playedThisTurn: ['a', 'b', 'c'] } as Partial<RunState>),
    },
    {
      // Rune of the Reliquary: End of Turn fires the two left-most Echoes — one beat per Echo, sourced on the
      // Echo minion, each with its summons + its `echoFired`. Was classified and never observed (owner report
      // 2026-09-01: nothing on screen).
      name: 'End of Turn — Reliquary Echoes',
      state: base({ board: [minion('b1', 'pack'), minion('b2', 'manasaber'), minion('b3', 'stray')], questRecurringEndOfTurn: ['triggerLeftmostEcho'] } as Partial<RunState>),
    },
    {
      name: 'Start of Combat — Fleeting Vigor',
      state: base({ board: [minion('b1', 'stray')], fleetingVigor: { attack: 2, health: 2 } } as Partial<RunState>),
    },
    {
      name: 'Start of Combat — banked keywords + Imps',
      state: base({ board: [minion('b1', 'stray')], pendingCombatKeywords: [{ uid: 'b1', keyword: 'T' }], pendingSCImps: 2 } as Partial<RunState>),
    },
    {
      name: 'Hero power — Re-Pete Second Hand',
      state: ({ ...createRun(11, 'repete'), phase: 'recruit', wave: 3, board: [minion('b1', 'stray')], hand: [minion('h1', 'stray')] }) as RunState,
    },
  ];
}

/**
 * BROAD scenarios: every card carrying an End-of-Turn effect, batched onto real boards.
 *
 * The hand-written scenarios above target specific mechanics. They cannot tell you whether the ~550 card
 * effects announce themselves, and a report where almost everything reads "not observed" is not a gap list —
 * it is an evidence gap wearing one, which is worse than saying nothing.
 *
 * Cards are batched a full board at a time rather than one scenario each: `faceOmen` resolves an entire
 * combat, so per-card scenarios would multiply that cost by several hundred for no extra signal.
 */
export function cardScenarios(): ProbeScenario[] {
  const eotCards = ALL_CARDS.filter((c) => c.effects.some((e) => e.on === 'endOfTurn')).map((c) => c.id);
  const out: ProbeScenario[] = [];
  const perBoard = CONFIG.boardMax;
  for (let i = 0; i < eotCards.length; i += perBoard) {
    const slice = eotCards.slice(i, i + perBoard);
    out.push({
      name: `End of Turn - cards ${i}..${i + slice.length - 1}`,
      state: ({
        ...createRun(13 + i, 'warden'),
        phase: 'recruit',
        board: slice.map((cardId, k) => {
          const def = CARD_INDEX[cardId];
          return { uid: `p${i}_${k}`, cardId, tribe: def?.tribe ?? 'neutral', attack: def?.attack ?? 1, health: def?.health ?? 1, keywords: [...(def?.keywords ?? [])], golden: false };
        }),
      }) as RunState,
    });
  }
  return out;
}

/**
 * Shout (`onPlay`) coverage: play each card that has one.
 *
 * NOT batched, unlike the End-of-Turn boards — playing is a per-card ACTION, so each needs its own scenario.
 * They are cheap (a recruit action, no combat), which is why several hundred of them cost far less than the
 * handful of End-of-Turn scenarios that each resolve a full fight.
 */
export function shoutScenarios(): ProbeScenario[] {
  const out: ProbeScenario[] = [];
  const cards = ALL_CARDS.filter((c) => c.effects.some((e) => e.on === 'onPlay'));
  cards.forEach((def, i) => {
    out.push({
      name: `Shout - ${def.id}`,
      state: ({
        ...createRun(29 + i, 'warden'),
        phase: 'recruit',
        // Plenty of Gold and an empty board, so the play is legal for cost and space rather than by luck.
        embers: 20,
        maxEmbers: 20,
        board: [],
        hand: [{ uid: 'h0', cardId: def.id, tribe: def.tribe, attack: def.attack, health: def.health, keywords: [...def.keywords], golden: false }],
      }) as RunState,
      action: { type: 'play', uid: 'h0' } as unknown as Action,
    });
  });
  return out;
}

/**
 * Spell (`cast`) coverage: cast each spell onto a board that gives it something to act on.
 *
 * A board minion is present because many spells target one; an untargeted spell simply ignores it. Spells
 * that REQUIRE an explicit target still will not resolve here, so their keys stay "not observed" — an
 * evidence gap the report is careful to distinguish from "does not emit".
 */
export function spellScenarios(): ProbeScenario[] {
  const out: ProbeScenario[] = [];
  const spells = ALL_CARDS.filter((c) => c.effects.some((e) => e.on === 'cast'));
  spells.forEach((def, i) => {
    out.push({
      name: `Cast - ${def.id}`,
      state: ({
        ...createRun(101 + i, 'warden'),
        phase: 'recruit',
        embers: 20,
        maxEmbers: 20,
        board: [minion('t0', 'stray')],
        hand: [{ uid: 'h0', cardId: def.id, tribe: def.tribe, attack: def.attack, health: def.health, keywords: [...def.keywords], golden: false }],
      }) as RunState,
      action: { type: 'play', uid: 'h0', targetUid: 't0' } as unknown as Action,
    });
  });
  return out;
}

/** Every built-in scenario: targeted mechanics, End-of-Turn cards, every Shout, and every spell cast. */
export function allScenarios(): ProbeScenario[] {
  return [...defaultScenarios(), ...cardScenarios(), ...shoutScenarios(), ...spellScenarios()];
}

/** Run the scenarios and report what gameplay ACTUALLY emitted. Pure: no scenario state is shared or mutated. */
export function probeEmission(scenarios: ProbeScenario[] = defaultScenarios()): ProbeResult {
  const observed = new Map<string, ObservedBeat>();
  const unidentified: ProbeResult['unidentified'] = [];

  for (const s of scenarios) {
    // Each scenario gets its own deep copy: a probe that let one scenario mutate another's input would
    // report emission that depends on the order the report happened to run in.
    const state = JSON.parse(JSON.stringify(s.state)) as RunState;
    const { batch } = reduceWithPresentation(state, s.action ?? faceOmen, true);
    if (!batch) continue;

    const childCount = new Map<string, number>();
    for (const e of batch.events) {
      if (e.type === 'sourceTrigger' || !e.parentId) continue;
      childCount.set(e.parentId, (childCount.get(e.parentId) ?? 0) + 1);
    }

    for (const e of batch.events) {
      if (e.type !== 'sourceTrigger') continue;
      const t = e as SourceTriggerEvent;
      if (!t.policyKey) {
        unidentified.push({ source: `${t.source.kind}:${t.source.id}`, trigger: t.trigger, phase: t.phase });
        continue;
      }
      const prev = observed.get(t.policyKey);
      const consequences = childCount.get(t.id) ?? 0;
      // Merge across scenarios: the best evidence wins, so one scenario reaching a richer path is not hidden
      // by another that reached the same trigger with nothing to deliver.
      observed.set(t.policyKey, {
        policyKey: t.policyKey,
        phase: t.phase,
        consequences: Math.max(prev?.consequences ?? 0, consequences),
      });
    }
  }
  return { observed, unidentified, scenarios: scenarios.length };
}
