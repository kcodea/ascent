/**
 * BALANCE BOT — the `SeatPilot` registry.
 *
 * B1 ships ONE pilot, `greedy`: the smallest thing that plays a legal, complete turn, so the runner and the
 * self-play lobby can be proven end to end. It is a TEST BASELINE, not a policy — B3 replaces/extends this file
 * with the generalist (search through `productionBots`) and its budget profiles. Keep it small and labelled.
 */
import { CARD_INDEX } from '@game/content';
import { CONFIG } from '../config';
import { offerBuyPrice, reduce } from '../reducer';
import type { Action, RunState } from '../state';
import type { PilotBudget, SeatContext, SeatPilot } from './types';
import { createGeneralistPilot } from './generalistPilot';
import { createStrategistPilot } from './strategy/strategistPilot';

/** Would the engine accept this? The same probe the legacy bots use: a rejected action returns the same state. */
const legal = (run: RunState, a: Action): boolean => reduce(run, a) !== run;

/**
 * GREEDY: answer every prompt with its first option, play everything in hand (first legal target), buy the
 * cheapest affordable minion while there is room, then end the turn. Deterministic; never plans.
 */
export const GREEDY_PILOT: SeatPilot = {
  id: 'greedy',
  decide(run: RunState, _ctx: SeatContext): Action | null {
    // ── Prompts first: the engine blocks every board action until they are answered. ──
    if (run.discover) return { type: 'discover', index: 0 };
    if (run.chooseOne) return { type: 'chooseOne', index: 0 };
    if (run.pendingTarget) {
      const self = run.pendingTarget.uid;
      for (const c of run.board) if (c.uid !== self && legal(run, { type: 'battlecryTarget', targetUid: c.uid })) return { type: 'battlecryTarget', targetUid: c.uid };
      for (const o of run.shop) if (legal(run, { type: 'battlecryTarget', targetUid: o.uid })) return { type: 'battlecryTarget', targetUid: o.uid };
      for (const c of run.hand) if (c.uid !== self && legal(run, { type: 'battlecryTarget', targetUid: c.uid })) return { type: 'battlecryTarget', targetUid: c.uid };
      // Nothing aimable: a deferred pick is abandoned like a click-away; a committed aim has no clean escape
      // and is reported back as the engine sees it (the runner fails the seat if that is refused too).
      return { type: 'cancelChoice' };
    }
    if (run.questOffer) return { type: 'buyQuest', index: 0 };
    if (run.powerOffer) return { type: 'pickPower', index: 0 };
    if (run.runeforgeOffer) return legal(run, { type: 'buyRune', index: 0 }) ? { type: 'buyRune', index: 0 } : { type: 'skipRuneforge' };
    if (run.scoutedNextOpponent?.length) return { type: 'closeScout' };

    // ── Play everything in hand: spells and Rubies always (they are consumed), minions while there is room. ──
    for (const c of run.hand) {
      const def = CARD_INDEX[c.cardId];
      if (!def) continue;
      const body = !def.spell && !def.ruby;
      if (body && run.board.length >= CONFIG.boardMax) continue;
      const bare: Action = { type: 'play', uid: c.uid };
      if (legal(run, bare)) return bare;
      for (const t of run.board) {
        const aimed: Action = { type: 'play', uid: c.uid, targetUid: t.uid };
        if (legal(run, aimed)) return aimed;
      }
      for (const o of run.shop) {
        const aimed: Action = { type: 'play', uid: c.uid, targetUid: o.uid };
        if (legal(run, aimed)) return aimed;
      }
    }

    // ── Buy the cheapest affordable MINION while board + hand leave room for it. ──
    if (run.board.length + run.hand.length < CONFIG.boardMax) {
      const offers = run.shop
        .map((o, i) => ({ o, i, def: CARD_INDEX[o.cardId], price: offerBuyPrice(run, o).cost }))
        .filter((x) => x.def && !x.def.spell && !x.def.ruby)
        .sort((a, b) => a.price - b.price || a.i - b.i);
      for (const x of offers) {
        if (x.price > run.embers) break;
        const buy: Action = { type: 'buy', uid: x.o.uid };
        if (legal(run, buy)) return buy;
      }
    }
    return null; // end the turn
  },
};

// The GENERALIST (B3) — search through the production planning boundary. Seeded off the budget so two jobs with
// the same manifest tie-break identically; the runner seeds nothing else into it (the run's RNG is never touched).
// The STRATEGIST (B4) — the generalist's search with a line prior (`strategy/strategistPilot.ts`). `strategist`
// plays each run's best-fit line; `strategist:rotate` rotates the line by run seed (the EXPLORATION population —
// forced lines, never a natural pick rate); `strategist:explore<k>` pins the k-th best line.
const REGISTRY: Record<string, (budget: PilotBudget) => SeatPilot> = {
  greedy: () => GREEDY_PILOT,
  generalist: (budget) => createGeneralistPilot(budget, 0x9e3779b9),
  strategist: (budget) => createStrategistPilot(budget, 0x9e3779b9, { exploration: 0 }),
  'strategist:rotate': (budget) => createStrategistPilot(budget, 0x9e3779b9, { exploration: 'rotate' }),
};
const EXPLORE = /^strategist:explore(\d+)$/;

/** Resolve a manifest's `policy.id` to a pilot. Unknown ids throw — a report must name a policy that exists. */
export function pilotFor(id: string, budget: PilotBudget = { depth: 1, beam: 1, maxNodes: 1, positionCandidates: 1 }): SeatPilot {
  const make = REGISTRY[id];
  if (make) return make(budget);
  const explore = EXPLORE.exec(id);
  if (explore) return createStrategistPilot(budget, 0x9e3779b9, { exploration: Number(explore[1]) });
  throw new Error(`balance: unknown pilot '${id}' (registered: ${PILOT_IDS().join(', ')})`);
}

export const PILOT_IDS = (): string[] => [...Object.keys(REGISTRY), 'strategist:explore<k>'];
