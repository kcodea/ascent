/* Enemy difficulty curve by wave (M2 balance). Dumps the intrinsic enemy-board strength per wave —
 * width, average per-unit stats, and Σ(atk+hp) "power" — averaged across the five threats, with the
 * narrow→wide power spread, plus a beatability anchor: the win% of a FIXED reference player board (a
 * baked mono-tribe board, averaged over tribes) against each wave. The enemy curve itself is fully
 * deterministic; only the beatability sample varies by seed. Re-run after tuning CONFIG.curve /
 * enemyScaling: `npm run curve`. */
import { simulate, makeRng, type BoardMinion, type Tribe } from '@game/core';
import { BUYABLE_CARDS, CARD_INDEX } from '@game/content';
import {
  createRun,
  reduce,
  buildEnemyBoard,
  enemyScaling,
  THREAT_IDS,
  THREATS,
  type BoardCard,
  type ThreatId,
} from '@game/sim';

const MAX_WAVE = 20;
const STAT_SEEDS = 80; // enemy-stat sampling — no combat, cheap
const FIGHT_SEEDS = 16; // beatability sampling — runs simulate()
const TRIBES: Tribe[] = ['beast', 'dragon', 'undead', 'mech', 'demon', 'neutral'];

const mix = (a: number, b: number, c: number): number => ((a * 73856093) ^ (b * 19349663) ^ (c * 83492791)) >>> 0;
const power = (b: BoardMinion[]): number => b.reduce((s, m) => s + m.attack + m.health, 0);
const ti = (id: ThreatId): number => THREAT_IDS.indexOf(id);

/** Bake a mono-tribe reference board (its whole list, recruit effects folded in) — same as the balance runner. */
function bakeBoard(tribe: Tribe): BoardMinion[] {
  const pool = BUYABLE_CARDS.filter((c) => c.tribe === tribe).sort((a, b) => a.tier - b.tier);
  if (pool.length === 0) return [];
  const chosen = Array.from({ length: 7 }, (_, i) => pool[i % pool.length]!);
  let s = createRun(1);
  s = {
    ...s,
    embers: 0,
    board: [],
    hand: chosen.map((c, i) => ({
      uid: `h${i}`,
      cardId: c.id,
      tribe: c.tribe,
      attack: c.attack,
      health: c.health,
      keywords: [...c.keywords],
      golden: false,
    })) as BoardCard[],
  };
  for (const c of [...s.hand]) {
    if (s.board.length >= 7) break;
    s = reduce(s, { type: 'play', uid: c.uid });
  }
  return s.board.map((b) => ({ cardId: b.cardId, attack: b.attack, health: b.health, keywords: [...b.keywords] }));
}

const refBoards = TRIBES.map(bakeBoard).filter((b) => b.length > 0);
const refPower = Math.round(refBoards.reduce((s, b) => s + power(b), 0) / refBoards.length);

const pad = (s: string | number, n: number): string => String(s).padStart(n);
const band = (w: number): string => (w <= 3 ? 'on-ramp' : w <= 6 ? 'ramp' : w <= 10 ? 'par' : w <= 15 ? 'hard' : 'brutal');

console.log('\n=== ASCENT — enemy difficulty curve by wave ===');
console.log('Per wave: stat-scale dial, enemy width, avg unit (atk/hp), board power Σ(atk+hp) avg over');
console.log('threats, the narrow→wide threat-power spread, and a reference board\'s win% vs that wave.');
console.log(`Reference = baked mono-tribe boards (avg Σpower ${refPower}, a ~mid-game board that stopped`);
console.log(`improving); ${FIGHT_SEEDS} seeds × 5 threats × ${refBoards.length} tribes per wave.\n`);
console.log('wave  band      sScale  width  unit(a/h)   power   threat spread (low→high)     ref win%');

for (let wave = 1; wave <= MAX_WAVE; wave++) {
  const sc = enemyScaling(wave);
  let widthSum = 0;
  let atkSum = 0;
  let hpSum = 0;
  let powSum = 0;
  const threatPow: Record<string, number> = {};
  for (const tid of THREAT_IDS) {
    let tp = 0;
    let tw = 0;
    let ta = 0;
    let th = 0;
    for (let s = 0; s < STAT_SEEDS; s++) {
      const e = buildEnemyBoard(tid, wave, makeRng(mix(wave, s, ti(tid))));
      tp += power(e);
      tw += e.length;
      ta += e.reduce((x, m) => x + m.attack, 0) / e.length;
      th += e.reduce((x, m) => x + m.health, 0) / e.length;
    }
    threatPow[tid] = Math.round(tp / STAT_SEEDS);
    powSum += tp / STAT_SEEDS;
    widthSum += tw / STAT_SEEDS;
    atkSum += ta / STAT_SEEDS;
    hpSum += th / STAT_SEEDS;
  }
  const nT = THREAT_IDS.length;

  let wins = 0;
  let trials = 0;
  for (const rb of refBoards) {
    for (const tid of THREAT_IDS) {
      for (let s = 0; s < FIGHT_SEEDS; s++) {
        const e = buildEnemyBoard(tid, wave, makeRng(mix(wave, s, ti(tid))));
        if (simulate(rb, e, makeRng(mix(s, wave, 7) + 1), CARD_INDEX).result === 'win') wins++;
        trials++;
      }
    }
  }

  const lo = Math.min(...Object.values(threatPow));
  const hi = Math.max(...Object.values(threatPow));
  const loId = THREAT_IDS.find((t) => threatPow[t] === lo)!;
  const hiId = THREAT_IDS.find((t) => threatPow[t] === hi)!;
  console.log(
    pad(wave, 3) +
      '   ' +
      band(wave).padEnd(8) +
      '  ' +
      pad(sc.statScale.toFixed(2), 5) +
      '   ' +
      pad((widthSum / nT).toFixed(1), 4) +
      '   ' +
      pad((atkSum / nT).toFixed(1) + '/' + (hpSum / nT).toFixed(1), 9) +
      '   ' +
      pad(Math.round(powSum / nT), 4) +
      '   ' +
      (THREATS[loId].name.slice(0, 5) + ' ' + lo + ' → ' + THREATS[hiId].name.slice(0, 5) + ' ' + hi).padEnd(26) +
      '  ' +
      pad(Math.round((wins / trials) * 100) + '%', 5),
  );
}
console.log('');
