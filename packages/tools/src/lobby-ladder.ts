/**
 * `npm run lobby:ladder` — measure bot strength IN THE MODE THE BOTS ACTUALLY PLAY.
 *
 * `bot:ladder` measures an Ascent run: a 17-round course against the served opponent pool, scored by how many
 * wins cover the Oath. Lobby bots do a different job. They run `mode: 'lobby'` (no course clock, so boards keep
 * growing and late rounds stay dangerous), they fight OTHER SEATS rather than the pool, and success is not a
 * win count at all — it is placement, and being last standing.
 *
 * So the Ascent number can't answer "does this bot threaten the player at the table". This can: it seats eight
 * bots of assigned policies, runs the lobby to its finish, and reports the placement distribution per policy.
 *
 * The metric is MEAN PLACEMENT (1 = won the lobby, 8 = out first). A policy that is genuinely stronger finishes
 * higher on average; if two policies land inside each other's error bars they are the same bot wearing two
 * labels, no matter what their search budgets say.
 *
 *   npm run lobby:ladder                  # 20 lobbies, one seat per policy
 *   npm run lobby:ladder -- --lobbies 40  # tighter error bars
 */
import {
  botSeat, createLobby, runLobby, standings,
  OPPONENT_POOL, OPPONENT_POOL_DATA, registerOpponents,
  HEROES, type SeatPolicy,
} from '@game/sim';

// The seats' private runs still fight the ordinary pool for their own progression, so it has to be loaded here
// for the same reason `bot:ladder` needs it — see the note there.
if (OPPONENT_POOL.length === 0) registerOpponents([...OPPONENT_POOL_DATA]);

const argv = process.argv.slice(2);
const flag = (n: string, d: string): string => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : d;
};
const LOBBIES = Number(flag('lobbies', '20'));

// Two seats each, so a policy's result isn't hostage to one hero. Eight seats = a full table.
const SEATING: SeatPolicy[] = ['legacy', 'legacy', 'easy', 'easy', 'normal', 'normal', 'expert', 'expert'];

const heroes = HEROES.filter((h) => !h.wip);
const placements = new Map<SeatPolicy, number[]>();
const wins = new Map<SeatPolicy, number>();
for (const p of SEATING) { placements.set(p, placements.get(p) ?? []); wins.set(p, 0); }

let totalRounds = 0;
for (let i = 0; i < LOBBIES; i++) {
  const seed = 1000 + i * 17;
  // Rotate hero assignment per lobby so a policy isn't permanently handed the best or worst hero.
  const drivers = SEATING.map((policy, s) => {
    const hero = heroes[(seed + s + i) % heroes.length]!;
    return botSeat(seed * 100 + s, hero.id, `${policy}:${hero.name}`, policy);
  });
  const done = runLobby(createLobby(seed, drivers));
  totalRounds += done.round;
  standings(done).forEach((seat, idx) => {
    const policy = SEATING[Number(seat.id.replace(/\D/g, ''))]!;
    const place = seat.placement ?? idx + 1;
    placements.get(policy)!.push(place);
    if (place === 1) wins.set(policy, wins.get(policy)! + 1);
  });
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const stderr = (xs: number[]): number => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length)) / Math.sqrt(Math.max(1, xs.length));
};

console.log(`\n=== lobby ladder — ${LOBBIES} lobbies, 8 seats, mean length ${(totalRounds / LOBBIES).toFixed(1)} rounds ===`);
console.log('placement: 1 = won the lobby, 8 = eliminated first\n');
console.log('policy    mean placement   lobby wins   top half');
for (const policy of [...new Set(SEATING)]) {
  const ps = placements.get(policy)!;
  const topHalf = ps.filter((p) => p <= 4).length;
  console.log(
    `${String(policy).padEnd(9)} ${mean(ps).toFixed(2)} ±${stderr(ps).toFixed(2)}`.padEnd(26) +
    `${String(wins.get(policy)).padStart(6)}   ` +
    `${((100 * topHalf) / ps.length).toFixed(0).padStart(7)}%`,
  );
}
console.log('');
