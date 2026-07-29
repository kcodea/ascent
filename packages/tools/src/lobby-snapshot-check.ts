/**
 * `npm run lobby:snapshots` — check that real player runs are seating into lobbies, and how they place.
 *
 * Registers the cached player-board pool (`npm run boards:fetch`), lists the runs it can reassemble, then plays
 * lobbies and reports mean placement per seat KIND. That last number is the point: it says whether a real
 * player's recorded run is a harder opponent than a bot, which is the whole reason to seat them.
 */
import { readFileSync } from 'node:fs';
import { registerOpponents, createLobbyRun, reduce, createController, decide, type BoardSnapshot, type RunState } from '@game/sim';

const human = JSON.parse(readFileSync('packages/tools/.cache/player-boards.json', 'utf8')) as BoardSnapshot[];
registerOpponents(human);

const playOut = (s: RunState, maxSteps = 8000): RunState => {
  let c = createController('p', 'expert');
  let g = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && g++ < maxSteps) {
    const d = decide(s, c);
    if (!d) break;
    c = d.controller;
    const n = reduce(s, d.action);
    if (n === s) break;
    s = n;
  }
  return s;
};

const place: Record<string, number[]> = { snapshot: [], hybrid: [], player: [] };
let rounds = 0, lobbies = 0;
for (const seed of [3, 7, 11, 15, 19, 23, 27, 31, 35, 39]) {
  const s = playOut(createLobbyRun(seed, 'drakko'));
  const lobby = s.lobby!;
  if (!lobby.seats.some((x) => x.placement)) continue;
  lobbies++; rounds += lobby.round;
  const alive = lobby.seats.filter((x) => x.alive);
  for (const seat of lobby.seats) {
    const p = seat.placement ?? alive.length; // survivors share the top places
    place[seat.kind]?.push(p);
  }
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
console.log(`\n${lobbies} lobbies, mean length ${(rounds / Math.max(1, lobbies)).toFixed(1)} rounds`);
console.log('placement (1 = won the lobby, 8 = out first):\n');
for (const [kind, xs] of Object.entries(place)) {
  if (!xs.length) continue;
  console.log(`  ${kind.padEnd(9)} n=${String(xs.length).padStart(3)}  mean placement ${mean(xs).toFixed(2)}  wins ${xs.filter((p) => p === 1).length}`);
}
