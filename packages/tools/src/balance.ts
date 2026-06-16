/**
 * Balance runner (handoff M2) — probes the A.6 counter matrix, which is balance
 * *truth*: each tribe should beat the threats it "answers" more often than the
 * ones it doesn't. We bake a naive mono-tribe board per tribe (play its whole
 * card list so recruit Battlecries/summons fold in), fight every threat across a
 * spread of waves and seeds, and print a tribe×threat win-rate matrix plus an
 * adherence check. Run with: `npm run balance`.
 *
 * Caveat (logged, not hidden): these are *mono-tribe* boards at base stats with
 * no triples/Hero Power/cross-tribe glue, so absolute win% runs low — it's the
 * *relative* answered-vs-other signal that validates the matrix.
 */
import { simulate, makeRng, type BoardMinion, type Tribe } from '@game/core';
import { BUYABLE_CARDS, CARD_INDEX } from '@game/content';
import {
  createRun,
  reduce,
  buildEnemyBoard,
  THREATS,
  THREAT_IDS,
  type BoardCard,
  type ThreatId,
} from '@game/sim';

const TRIBES: Tribe[] = ['beast', 'dragon', 'undead', 'mech', 'demon', 'neutral'];
const WAVES = [4, 7, 10, 13];
const SEEDS = 40;
const mix = (a: number, b: number, c: number): number => ((a * 73856093) ^ (b * 19349663) ^ (c * 83492791)) >>> 0;

/** Bake a mono-tribe board: play the tribe's whole list so recruit effects fold in. */
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

/** Win rate of `board` vs a threat, averaged over WAVES × SEEDS fresh enemy instances. */
function winRate(board: BoardMinion[], threat: ThreatId, ti: number): number {
  if (board.length === 0) return 0;
  let wins = 0;
  let trials = 0;
  for (const wave of WAVES) {
    for (let seed = 0; seed < SEEDS; seed++) {
      const enemy = buildEnemyBoard(threat, wave, makeRng(mix(wave, seed, ti)));
      const r = simulate(board, enemy, makeRng(mix(seed, ti, wave) + 1), CARD_INDEX);
      if (r.result === 'win') wins++;
      trials++;
    }
  }
  return wins / trials;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`.padStart(4);
const power = (b: BoardMinion[]): number => b.reduce((s, m) => s + m.attack + m.health, 0);

console.log('\n=== ASCENT — balance runner: A.6 counter matrix ===');
console.log(`Mono-tribe baked boards vs each threat · waves [${WAVES.join(', ')}] × ${SEEDS} seeds.`);
console.log('A ✓ marks a counter-matrix "answers" pairing (should read high).\n');

const boards = new Map<Tribe, BoardMinion[]>(TRIBES.map((t) => [t, bakeBoard(t)]));

// header
const head = THREAT_IDS.map((id) => THREATS[id].name.slice(0, 6).padStart(7)).join('');
console.log('tribe'.padEnd(9) + head);

const adherence: { tribe: Tribe; answered: number; other: number }[] = [];
for (const tribe of TRIBES) {
  const board = boards.get(tribe)!;
  let row = tribe.padEnd(9);
  let ansSum = 0;
  let ansN = 0;
  let othSum = 0;
  let othN = 0;
  THREAT_IDS.forEach((threat, ti) => {
    const wr = winRate(board, threat, ti);
    const answers = THREATS[threat].answeredBy.includes(tribe);
    row += (answers ? '✓' : ' ') + pct(wr) + '  ';
    if (answers) {
      ansSum += wr;
      ansN++;
    } else {
      othSum += wr;
      othN++;
    }
  });
  console.log(row);
  if (ansN > 0) adherence.push({ tribe, answered: ansSum / ansN, other: othN ? othSum / othN : 0 });
}

console.log(`\npower (Σ atk+hp of baked board): ${TRIBES.map((t) => `${t} ${power(boards.get(t)!)}`).join(' · ')}`);

console.log('\nCounter-matrix adherence — avg win% on answered threats vs the rest:');
let holds = 0;
let conclusive = 0;
for (const a of adherence) {
  const dominant = a.answered >= 0.9 && a.other >= 0.9;
  const floored = a.answered <= 0.1 && a.other <= 0.1;
  const margin = a.answered - a.other;
  const ok = margin > 0.05; // a meaningful edge on the threats it should answer
  const tag = dominant
    ? '— dominant everywhere (inconclusive; power dial too high)'
    : floored
      ? '— too weak everywhere (inconclusive; power dial too low)'
      : ok
        ? '✓ holds'
        : margin < -0.05
          ? '✗ inverted (loses more to its own answers!)'
          : '— flat (generically strong; no counter edge)';
  if (!dominant && !floored) {
    conclusive++;
    if (ok) holds++;
  }
  console.log(`  ${a.tribe.padEnd(8)} answered ${pct(a.answered)}  vs  other ${pct(a.other)}   ${tag}`);
}
console.log(
  `\nMatrix holds for ${holds}/${conclusive} tribes with a measurable signal` +
    ` (the rest sit at ceiling/floor — tuning targets, not matrix failures).`,
);
