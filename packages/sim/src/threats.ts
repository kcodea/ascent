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

/** The rising curve (handoff C.7): how board size and stats scale with the wave. */
export function enemyScaling(wave: number): { extraCount: number; statScale: number } {
  return {
    extraCount: Math.floor(wave / CONFIG.curve.extraCountPerWaves),
    statScale: 1 + wave * CONFIG.curve.statScalePerWave,
  };
}

/**
 * Build the enemy board for a (threat, wave) pair. Deterministic for a given
 * `rng` — callers derive the rng purely from (seed, wave) so the recruit-phase
 * preview is byte-identical to the board fought at combat.
 */
export function buildEnemyBoard(threatId: ThreatId, wave: number, rng: Rng): BoardMinion[] {
  const template = TEMPLATES[threatId];
  const { extraCount, statScale } = enemyScaling(wave);
  const count = Math.min(
    CONFIG.boardMax,
    template.count[0] + rng.int(template.count[1] - template.count[0] + 1) + extraCount,
  );
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
