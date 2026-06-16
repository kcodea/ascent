import type { BoardMinion, Keyword, Rng, Tribe } from '@game/core';
import { CONFIG } from './config';

export type ThreatId = 'venom' | 'iron' | 'horde' | 'glass' | 'undying';

export const THREAT_IDS: ThreatId[] = ['venom', 'iron', 'horde', 'glass', 'undying'];

export interface Threat {
  id: ThreatId;
  name: string;
  /** Plain-language telegraph (handoff A.5) — what it is and how to answer it. */
  description: string;
  /** What this archetype punishes. */
  punishes: string;
  /** Tribes that answer it well (handoff A.6 counter matrix). */
  answeredBy: Tribe[];
}

export const THREATS: Record<ThreatId, Threat> = {
  venom: {
    id: 'venom',
    name: 'Venom Swarm',
    description:
      'Many small minions, several with Poison — one touch kills your biggest minion. Bring Divine Shields or cheap bodies to soak it.',
    punishes: 'Single big carries; low body count',
    answeredBy: ['mech', 'demon'],
  },
  iron: {
    id: 'iron',
    name: 'Ironwall',
    description:
      'A few enormous Taunt + Shield minions. Chip damage bounces off — use Poison to kill them in one hit.',
    punishes: 'Wide chip; low burst',
    answeredBy: ['undead', 'dragon'],
  },
  horde: {
    id: 'horde',
    name: 'Horde',
    description:
      'A very wide board of medium minions that overwhelms slow, tall boards. Answer with Cleave or your own wide board.',
    punishes: 'Slow/tall boards; few attackers',
    answeredBy: ['beast', 'dragon'],
  },
  glass: {
    id: 'glass',
    name: 'Glass Cannon',
    description:
      'One or two giant-Attack minions, fragile underneath. They one-shot unguarded boards. Absorb the blow or kill the carry first.',
    punishes: 'Passive boards that get one-shot',
    answeredBy: ['undead', 'mech'],
  },
  undying: {
    id: 'undying',
    name: 'Undying',
    description:
      'Minions that keep coming back (Reborn). Tempo alone can’t close. Bring Poison, destroy-effects, or a flood of bodies.',
    punishes: 'Tempo boards that can’t close',
    answeredBy: ['beast', 'demon'],
  },
};

/** Board templates (handoff A.5, ported from the prototype). First-pass numbers — tune via the balance runner. */
interface Template {
  count: [min: number, max: number];
  stat: [min: number, max: number];
  /** Per-unit keyword pool; `null` = no keyword. Weighted by repetition. */
  keywords: (Keyword | null)[];
}

const TEMPLATES: Record<ThreatId, Template> = {
  venom: { count: [5, 7], stat: [1, 2], keywords: ['P', 'P', null] },
  iron: { count: [2, 3], stat: [6, 9], keywords: ['T', 'DS'] },
  horde: { count: [6, 7], stat: [2, 3], keywords: [null, null] },
  glass: { count: [2, 2], stat: [8, 12], keywords: [null] },
  undying: { count: [4, 5], stat: [2, 3], keywords: ['R', 'R', null] },
};

/** Weighted threat pick that avoids immediately repeating the previous wave's threat. */
export function selectThreat(_wave: number, rng: Rng, previous?: ThreatId): ThreatId {
  const pool = previous ? THREAT_IDS.filter((id) => id !== previous) : THREAT_IDS;
  return rng.pick(pool);
}

/**
 * The rising curve (handoff C.7) with a deliberately gentle on-ramp: the player
 * opens with a 1-minion board (3 embers = one buy), so early waves must stay
 * near that size or the run is unwinnable. Enemy *width* is capped near the wave
 * number, and stats ramp from ~55% at wave 1 to full template strength by ~wave
 * 5; from there the A.5 scaling takes over. These are starting dials — tune via
 * `npm run balance`.
 */
export function enemyScaling(wave: number): { countCap: number; statScale: number } {
  const ramp = Math.min(1, 0.55 + 0.12 * (wave - 1)); // w1≈0.55 … w5≈1.0
  return {
    countCap: wave + 1, // bind enemy width near the player's board early
    statScale: (1 + wave * CONFIG.curve.statScalePerWave) * ramp,
  };
}

/**
 * Build the enemy board for a (threat, wave) pair. Deterministic for a given
 * `rng` — callers derive the rng purely from (seed, wave) so the recruit-phase
 * preview is byte-identical to the board fought at combat.
 */
export function buildEnemyBoard(threatId: ThreatId, wave: number, rng: Rng): BoardMinion[] {
  const template = TEMPLATES[threatId];
  const { countCap, statScale } = enemyScaling(wave);
  const natural =
    template.count[0] +
    rng.int(template.count[1] - template.count[0] + 1) +
    Math.floor(wave / CONFIG.curve.extraCountPerWaves);
  const count = Math.max(1, Math.min(CONFIG.boardMax, countCap, natural));
  const board: BoardMinion[] = [];
  for (let i = 0; i < count; i++) {
    const base = template.stat[0] + rng.int(template.stat[1] - template.stat[0] + 1);
    const keyword = template.keywords[rng.int(template.keywords.length)];
    board.push({
      cardId: 'omen',
      attack: Math.max(1, Math.round(base * statScale)),
      health: Math.max(1, Math.round((base + 1) * statScale)),
      keywords: keyword ? [keyword] : [],
    });
  }
  return board;
}
