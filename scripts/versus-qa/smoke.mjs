import { rankedDuos, shopReady } from './setup.mjs';
import { stateOf } from './autopilot.mjs';
const m = await rankedDuos({ dist: process.argv[2] ?? 'apps/web/dist-bench-vt', port: 4508 });
let last = '';
try {
  await m.drive((sa, sb) => { const k = JSON.stringify([sa.phase, sa.round, sa.runPhase, sa.wave, sa.gate, sa.heroCards, sa.curtain, sa.err, sb.phase, sb.runPhase, sb.wave, sb.gate]); if (k !== last) { last = k; console.log(new Date().toISOString().slice(11, 19), k); } return shopReady(m.mem, 2)(sa); }, { capMs: 4 * 60_000 });
  console.log('OK reached round 2 shop');
} catch (e) { console.log('STUCK', e.message, JSON.stringify(await stateOf(m.A))); }
console.log(m.A.log.slice(0, 10), m.B.log.slice(0, 10));
await m.close();
