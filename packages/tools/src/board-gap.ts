/** What do human boards HAVE at each wave that expert-bot boards lack? Name the gap, then build toward it. */
import { readFileSync } from 'node:fs';
import { createRun, reduce, registerOpponents, OPPONENT_POOL, createController, decide, type RunState, type BoardSnapshot } from '@game/sim';
import { CARD_INDEX } from '@game/content';

const human = JSON.parse(readFileSync('packages/tools/.cache/player-boards.json', 'utf8')) as BoardSnapshot[];
registerOpponents(human); // bots progress against the real pool, same as the ladder

function botBoardsAt(wave: number): { minions: { cardId: string; attack: number; health: number; golden?: boolean }[]; tier: number; triples: number }[] {
  const out = [];
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    let s: RunState = createRun(seed, 'drakko');
    let c = createController('gap', 'expert');
    let g = 0;
    while (s.wave < wave && s.phase !== 'gameover' && s.phase !== 'victory' && g++ < 4000) {
      const d = decide(s, c); if (!d) break; c = d.controller;
      const n = reduce(s, d.action); if (n === s) break; s = n;
    }
    if (s.wave >= wave && s.board.length) out.push({ minions: s.board, tier: s.tier, triples: s.triplesMade });
  }
  return out;
}

const stat = (bs: { minions: { cardId: string; attack: number; health: number; golden?: boolean }[]; tier?: number; triples?: number }[]) => {
  const per = bs.map((b) => {
    const defs = b.minions.map((m) => CARD_INDEX[m.cardId]).filter(Boolean);
    const tribes = new Map<string, number>();
    for (const d of defs) { for (const t of [d!.tribe, d!.tribe2].filter(Boolean)) tribes.set(t as string, (tribes.get(t as string) ?? 0) + 1); }
    const top = Math.max(0, ...tribes.values());
    return {
      n: b.minions.length,
      power: b.minions.reduce((a, m) => a + m.attack + m.health, 0),
      golden: b.minions.filter((m) => m.golden).length,
      meanTier: defs.reduce((a, d) => a + d!.tier, 0) / Math.max(1, defs.length),
      t6: defs.filter((d) => d!.tier >= 6).length,
      concentration: top / Math.max(1, b.minions.length),
      effects: defs.reduce((a, d) => a + d!.effects.length, 0),
    };
  });
  const m = (k: keyof typeof per[0]) => (per.reduce((a, x) => a + (x[k] as number), 0) / Math.max(1, per.length)).toFixed(2);
  return `n=${m('n')} pow=${m('power')} golden=${m('golden')} meanTier=${m('meanTier')} T6+=${m('t6')} conc=${m('concentration')} fx=${m('effects')}`;
};

for (const wave of [7, 10, 13]) {
  const h = human.filter((b) => b.wave === wave && b.minions.length > 0);
  console.log(`wave ${wave}:`);
  console.log(`  human (${h.length}): ${stat(h)}`);
  const bb = botBoardsAt(wave);
  console.log(`  bot    (${bb.length}): ${stat(bb)}  [triples ${(bb.reduce((a, b) => a + b.triples, 0) / Math.max(1, bb.length)).toFixed(1)}]`);
}
