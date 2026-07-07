/* Player-strength curve by wave (M2 balance — companion to enemy-curve). A reasonably competent greedy
 * bot plays full runs across many seeds + every hero, and we snapshot the board it actually fought each
 * wave plus the outcome, then print player power against the enemy curve so the crossover is visible.
 *
 * The bot: play the strongest hand minion, buy the strongest affordable offer, tavern-up when it's cheap
 * or a board exists, sell the weakest body for a much-stronger shop offer, fire Hero Power on the carry.
 * It has NO synergy / tribe / triple / positioning awareness, so it's a mid-skill FLOOR-TO-PAR proxy,
 * not an optimal player — read it as "where a decent-but-naive board lands". Run: `npm run player`. */
import { makeRng } from '@game/core';
import { CARD_INDEX } from '@game/content';
import {
  createRun,
  reduce,
  buildEnemyBoard,
  CONFIG,
  HEROES,
  THREAT_IDS,
  type RunState,
  type ShopCard,
} from '@game/sim';

const RUNS = 100; // each wave runs 1000 odds-sims in faceOmen, so keep this modest
const power = (b: { attack: number; health: number }[]): number => b.reduce((s, m) => s + m.attack + m.health, 0);
const stat = (c: { attack: number; health: number }): number => c.attack + c.health;
const offerValue = (o: ShopCard): number => {
  const d = CARD_INDEX[o.cardId];
  return (d ? d.attack + d.health + d.tier * 2 : 0) + (o.atk ?? 0) + (o.hp ?? 0);
};
const bestOffer = (s: RunState): ShopCard | undefined => [...s.shop].sort((a, b) => offerValue(b) - offerValue(a))[0];
const heroes = HEROES.map((h) => h.id);

interface Snap {
  wave: number;
  power: number;
  win: boolean;
}

/** One greedy recruit action (precondition-guarded; falls through on a rejected action, always ends in faceOmen). */
function recruitStep(s: RunState): RunState {
  let n: RunState;
  if (s.board.length < CONFIG.boardMax && s.hand.length > 0) {
    const best = [...s.hand].sort((a, b) => stat(b) - stat(a))[0]!;
    n = reduce(s, { type: 'play', uid: best.uid });
    if (n !== s) return n;
  }
  if (s.tier < CONFIG.maxTier && s.embers >= s.upgradeCost && (s.upgradeCost <= 3 || s.board.length >= 4)) {
    n = reduce(s, { type: 'upgrade' });
    if (n !== s) return n;
  }
  if (s.embers >= CONFIG.minionCost && s.board.length + s.hand.length < CONFIG.boardMax) {
    const o = bestOffer(s);
    if (o) {
      n = reduce(s, { type: 'buy', uid: o.uid });
      if (n !== s) return n;
    }
  }
  if (s.heroReady && s.board.length > 0) {
    const best = [...s.board].sort((a, b) => stat(b) - stat(a))[0]!;
    n = reduce(s, { type: 'heroPower', uid: best.uid });
    if (n !== s) return n;
  }
  if (s.board.length >= CONFIG.boardMax && s.embers >= CONFIG.minionCost) {
    const weakest = [...s.board].sort((a, b) => stat(a) - stat(b))[0]!;
    const o = bestOffer(s);
    if (o && offerValue(o) > stat(weakest) * 1.7) {
      n = reduce(s, { type: 'sell', uid: weakest.uid });
      if (n !== s) return n;
    }
  }
  return reduce(s, { type: 'faceOmen' });
}

function playRun(seed: number, heroId: string): Snap[] {
  let s = createRun(seed, heroId);
  const snaps: Snap[] = [];
  let steps = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && steps++ < 20000) {
    if (s.questOffer) { s = reduce(s, { type: 'buyQuest', index: 0 }); continue; }
    if (s.discover) {
      s = reduce(s, { type: 'discover', index: 0 });
      continue;
    }
    if (s.chooseOne) {
      s = reduce(s, { type: 'chooseOne', index: 0 });
      continue;
    }
    if (s.pendingTarget) {
      s = reduce(s, { type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid });
      continue;
    }
    if (s.phase === 'combat') {
      snaps.push({ wave: s.wave, power: power(s.board), win: s.lastCombat?.result === 'win' });
      s = reduce(s, { type: 'resolveCombat' });
      continue;
    }
    s = recruitStep(s);
  }
  return snaps;
}

const MAX_WAVE = CONFIG.maxWave;
const reached = Array(MAX_WAVE + 1).fill(0) as number[];
const powSum = Array(MAX_WAVE + 1).fill(0) as number[];
const wins = Array(MAX_WAVE + 1).fill(0) as number[];
let bestSum = 0;
for (let i = 0; i < RUNS; i++) {
  const snaps = playRun(1000 + i, heroes[i % heroes.length]!);
  let best = 1;
  for (const sn of snaps) {
    if (sn.wave > MAX_WAVE) continue;
    reached[sn.wave]++;
    powSum[sn.wave] += sn.power;
    if (sn.win) wins[sn.wave]++;
    best = Math.max(best, sn.wave);
  }
  bestSum += best;
}

// enemy avg power per wave (deterministic, cheap) for the side-by-side overlay
const STAT_SEEDS = 40;
const mix = (a: number, b: number, c: number): number => ((a * 73856093) ^ (b * 19349663) ^ (c * 83492791)) >>> 0;
const enemyPow = (wave: number): number => {
  let sum = 0;
  let n = 0;
  THREAT_IDS.forEach((tid, ti) => {
    for (let s = 0; s < STAT_SEEDS; s++) {
      sum += power(buildEnemyBoard(tid, wave, makeRng(mix(wave, s, ti))));
      n++;
    }
  });
  return Math.round(sum / n);
};

const pad = (v: string | number, n: number): string => String(v).padStart(n);
console.log(`\n=== ASCENT — player strength curve vs enemy (greedy bot · ${RUNS} runs × ${heroes.length} heroes) ===`);
console.log('Bot: best hand/buy, tavern-up, sell-up, Hero Power — NO synergy/triples. A floor-to-par proxy.\n');
console.log('wave   enemy pow   player pow   win%   reached%   stat race');
let crossover = 0;
for (let w = 1; w <= MAX_WAVE; w++) {
  const ep = enemyPow(w);
  if (reached[w] === 0) {
    console.log(pad(w, 3) + '     ' + pad(ep, 5) + '         —       —        0%      (no runs)');
    continue;
  }
  const pp = Math.round(powSum[w] / reached[w]);
  const wr = Math.round((wins[w] / reached[w]) * 100);
  const rp = Math.round((reached[w] / RUNS) * 100);
  if (!crossover && pp < ep) crossover = w;
  const race = pp >= ep * 1.15 ? 'player ahead' : pp >= ep * 0.85 ? 'even' : 'enemy ahead';
  console.log(
    pad(w, 3) + '     ' + pad(ep, 5) + '       ' + pad(pp, 5) + '     ' + pad(wr + '%', 4) + '     ' + pad(rp + '%', 4) + '      ' + race,
  );
}
console.log(`\nAvg deepest wave reached: ${(bestSum / RUNS).toFixed(1)} (of ${MAX_WAVE}).`);
console.log(`Player Σpower first falls behind the enemy at wave ${crossover || '—'} (stat race; win% is the real signal).`);
console.log('');
