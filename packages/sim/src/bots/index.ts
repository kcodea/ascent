/**
 * The balance-bot roster (owner ask 2026-07-21; docs/bot-sims-handoff.md). Four pilots, each a `BotWeights`
 * valuation + a `BotBehaviour` knob set over the shared turn engine (`decide`) — plus the meta bot's combat
 * rollout. Run any of them through the balance report to get a strategy-specific read on every card:
 *
 *   - greedy   — spend it all NOW: buy the biggest body available, fill the board, upgrade hard, never reroll.
 *                A floor for "what does raw tempo-by-stats look like".
 *   - tempo    — conservative: prize survivability (Taunt / Divine Shield), keep a Gold reserve, upgrade
 *                sparingly, hold out for quality. Low variance.
 *   - midrange — down the middle: value + a bit of economy, rerolls when the shop is weak, seeks triples and
 *                tribe synergy, upgrades on a sane curve.
 *   - meta     — win at all costs: the midrange brain PLUS combat rollout — it simulates its final board
 *                against the pinned opponent and keeps the arrangement that actually wins. The strongest pilot;
 *                use it to find the ceiling / flag the truly dominant cards.
 *
 * A card is genuinely weak only if even the pilot built to want it can't win with it; dominant if it wins
 * across pilots. Add a new pilot by adding a preset here — the engine and report need no changes.
 */
import type { RunState, Action } from '../state';
import { decide, type BotPolicy, type BotBehaviour } from './policy';
import type { BotWeights } from './scoring';

export type { BotPolicy } from './policy';
export type { BotWeights } from './scoring';

function make(id: string, name: string, weights: BotWeights, behaviour: BotBehaviour): BotPolicy {
  return { id, name, weights, behaviour, act: (state: RunState): Action => decide(state, weights, behaviour) };
}

// ---- GREEDY — raw stats, spend everything, no patience. ----
const GREEDY = make('greedy', 'Greedy', {
  statValue: 1, taunt: 1, divineShield: 2, windfury: 1, venom: 1, reborn: 1, cleave: 1, stealth: 0.5,
  tribeSynergy: 0.2, tripleProgress: 1, tripleComplete: 6, costPenalty: 0, tierValue: 0.5,
}, {
  buyThreshold: -Infinity, goldReserve: 0, upgradeBias: 1, reroll: false, sellForUpgrade: false, rollout: false,
});

// ---- TEMPO — conservative, survivability-first, disciplined economy. ----
const TEMPO = make('tempo', 'Tempo', {
  statValue: 1, taunt: 5, divineShield: 6, windfury: 2, venom: 4, reborn: 4, cleave: 2, stealth: 1,
  tribeSynergy: 0.5, tripleProgress: 1.5, tripleComplete: 7, costPenalty: 0.3, tierValue: 1,
}, {
  // Conservative ≠ passive: it still FILLS its board (a modest threshold + reroll to find a safe body), it
  // just leans on survivability keywords, keeps a small reserve, and upgrades sparingly (low econ risk).
  buyThreshold: 4, goldReserve: 1, upgradeBias: 0.3, reroll: true, sellForUpgrade: true, rollout: false,
});

// ---- MIDRANGE — balanced value + economy, rerolls, triple/synergy aware. ----
const MIDRANGE = make('midrange', 'Midrange', {
  statValue: 1, taunt: 3, divineShield: 4, windfury: 2, venom: 3, reborn: 3, cleave: 1.5, stealth: 1,
  tribeSynergy: 1, tripleProgress: 2.5, tripleComplete: 8, costPenalty: 0.2, tierValue: 0.8,
}, {
  buyThreshold: 5, goldReserve: 0, upgradeBias: 0.7, reroll: true, sellForUpgrade: true, rollout: false,
});

// ---- META — the midrange brain + combat rollout. Plays to WIN. ----
const META = make('meta', 'Meta', {
  ...MIDRANGE.weights, tribeSynergy: 1.4, tripleProgress: 3, tripleComplete: 9,
}, {
  buyThreshold: 4, goldReserve: 0, upgradeBias: 0.7, reroll: true, sellForUpgrade: true, rollout: true,
});

export const BOTS: readonly BotPolicy[] = [GREEDY, TEMPO, MIDRANGE, META];
export const BOT_BY_ID: Record<string, BotPolicy> = Object.fromEntries(BOTS.map((b) => [b.id, b]));
export const DEFAULT_BOT = GREEDY;
