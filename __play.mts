import { createRun, reduce, type RunState } from './packages/sim/src/index';
import { createController, decide, DIFFICULTY_IDS } from './packages/sim/src/productionBots/index';

for (const diff of DIFFICULTY_IDS) {
  const t0 = performance.now();
  let s: RunState = createRun(4242, 'drakko');
  let c = createController('t', diff);
  let steps = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && steps++ < 6000) {
    const d = decide(s, c);
    if (!d) break;
    c = d.controller;
    const n = reduce(s, d.action);
    if (n === s) { console.log(`${diff}: STUCK on`, JSON.stringify(d.action)); break; }
    s = n;
  }
  const wins = s.history.filter(r => r === 'win').length;
  const ms = performance.now() - t0;
  console.log(`${diff.padEnd(7)} wave ${String(s.wave).padStart(2)} ${s.phase.padEnd(8)} ${wins}W/${s.history.length} board=${s.board.length} tier=${s.tier} steps=${steps} ${ms.toFixed(0)}ms`);
}
