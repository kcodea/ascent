/**
 * `npm run lobby` — play an 8-seat lobby headlessly and print what happened.
 *
 * The prototype's whole purpose: see whether the loop and the damage pacing feel right BEFORE any of it is
 * committed to. Every seat is a recorded run today; `--bots` swaps them all to bot seats through the same
 * `SeatDriver` interface, which is the pivot the owner asked for.
 *
 *   npm run lobby                 # 8 recorded runs, seed 1
 *   npm run lobby -- --seed 7     # a different lobby
 *   npm run lobby -- --bots       # all-bot seats
 *   npm run lobby -- --runs 20    # 20 lobbies, summary only (pacing / round-count distribution)
 *   npm run lobby -- --exhaust eliminate
 */
import { HEROES, createLobby, runLobby, standings, recordRun, botSeat, type LobbyState, type SeatDriver } from '@game/sim';

const argv = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name: string): boolean => argv.includes(`--${name}`);

const SEED = Number(flag('seed', '1'));
const RUNS = Number(flag('runs', '1'));
const USE_BOTS = has('bots');
const EXHAUST = (flag('exhaust', 'repeatFinal') ?? 'repeatFinal') as 'repeatFinal' | 'eliminate';

/** Eight seats from eight different heroes, so a lobby isn't eight copies of one strategy. */
function buildSeats(lobbySeed: number): SeatDriver[] {
  const heroes = HEROES.filter((h) => !h.wip);
  return Array.from({ length: 8 }, (_, i) => {
    const hero = heroes[(lobbySeed + i) % heroes.length]!;
    const seed = lobbySeed * 1000 + i;
    return USE_BOTS ? botSeat(seed, hero.id, `bot:${hero.name}`) : recordRun(seed, hero.id, hero.name);
  });
}

function report(s: LobbyState): void {
  const order = standings(s);
  console.log(`\n=== lobby seed ${s.seed} — ${s.round - 1} rounds, ${s.encounters.filter((e) => e.fought).length} fights ===`);
  for (const [i, seat] of order.entries()) {
    const hp = seat.alive ? `${seat.resolve}hp +${seat.armor}armor` : `out round ${seat.eliminatedRound}`;
    console.log(`  ${String(seat.placement ?? i + 1).padStart(2)}. ${seat.driver.label.padEnd(22)} ${seat.driver.kind.padEnd(9)} ${hp}`);
  }
  const dry = order.filter((x) => x.driver.prepare(s.round) === null).length;
  if (dry > 0) console.log(`  (${dry}/8 recordings had run dry by the end — exhaustion policy: ${s.rules.exhaustion})`);
}

if (RUNS === 1) {
  const s = runLobby(createLobby(SEED, buildSeats(SEED), { exhaustion: EXHAUST }));
  report(s);
  console.log('\nround-by-round:');
  for (const e of s.encounters) {
    if (e.bye) { console.log(`  r${String(e.round).padStart(2)}  ${e.bye} — bye`); continue; }
    const tag = e.fought ? e.outcome : 'no-board';
    console.log(`  r${String(e.round).padStart(2)}  ${e.a} vs ${e.b}  ${tag.padEnd(8)} -${e.damageToA}/-${e.damageToB}`);
  }
} else {
  // Pacing sweep: the number that actually tells you whether the mode feels right is how long a lobby lasts.
  const lengths: number[] = [];
  const winners = new Map<string, number>();
  for (let i = 0; i < RUNS; i++) {
    const s = runLobby(createLobby(SEED + i, buildSeats(SEED + i), { exhaustion: EXHAUST }));
    lengths.push(s.round - 1);
    const champ = standings(s)[0]!.driver.label;
    winners.set(champ, (winners.get(champ) ?? 0) + 1);
  }
  lengths.sort((a, b) => a - b);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  console.log(`\n=== ${RUNS} lobbies (${USE_BOTS ? 'bot' : 'recorded'} seats, exhaustion: ${EXHAUST}) ===`);
  console.log(`  rounds: min ${lengths[0]}  median ${lengths[Math.floor(lengths.length / 2)]}  max ${lengths[lengths.length - 1]}  mean ${mean.toFixed(1)}`);
  console.log('  winners:');
  for (const [name, n] of [...winners].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${name.padEnd(22)} ${n}`);
  }
}
