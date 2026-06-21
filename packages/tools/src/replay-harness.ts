/* Replay harness (M3 — board capture). Records a bot run as `(seed, heroId, action-log)`, replays it
 * headlessly via `replayRun`, verifies it reproduces the run byte-identically, and dumps the per-wave
 * board snapshots it yields — the atoms that feed the board library + async-PvP opponent pool. A real
 * `(seed, action-log)` exported from the UI (store.exportReplay) feeds the exact same `replayRun`.
 * Run: `npm run replay`. */
import { CARD_INDEX } from '@game/content';
import {
  createRun,
  reduce,
  serialize,
  snapshotBoard,
  replayRun,
  CONFIG,
  type Action,
  type BoardSnapshot,
  type RunState,
  type ShopCard,
} from '@game/sim';

const stat = (c: { attack: number; health: number }): number => c.attack + c.health;
const offerValue = (o: ShopCard): number => {
  const d = CARD_INDEX[o.cardId];
  return (d ? d.attack + d.health + d.tier * 2 : 0) + (o.atk ?? 0) + (o.hp ?? 0);
};
const bestOffer = (s: RunState): ShopCard | undefined => [...s.shop].sort((a, b) => offerValue(b) - offerValue(a))[0];

/** Competent greedy bot (mirrors player-curve) that records its action log + live snapshots as it plays. */
function recordRun(seed: number): { replay: { seed: number; heroId: string; actions: Action[] }; live: BoardSnapshot[]; final: RunState } {
  let s = createRun(seed);
  const actions: Action[] = [];
  const live: BoardSnapshot[] = [];
  const act = (a: Action): boolean => {
    const before = s;
    s = reduce(s, a);
    if (s !== before) {
      actions.push(a);
      return true;
    }
    return false;
  };
  let steps = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && steps++ < 20000) {
    if (s.discover) { act({ type: 'discover', index: 0 }); continue; }
    if (s.chooseOne) { act({ type: 'chooseOne', index: 0 }); continue; }
    if (s.pendingTarget) { act({ type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid }); continue; }
    if (s.phase === 'combat') { act({ type: 'resolveCombat' }); continue; }
    if (s.board.length < CONFIG.boardMax && s.hand.length > 0) {
      act({ type: 'play', uid: [...s.hand].sort((a, c) => stat(c) - stat(a))[0]!.uid });
      continue;
    }
    if (s.tier < CONFIG.maxTier && s.embers >= s.upgradeCost && (s.upgradeCost <= 3 || s.board.length >= 4) && act({ type: 'upgrade' })) continue;
    if (s.embers >= CONFIG.minionCost && s.board.length + s.hand.length < CONFIG.boardMax) {
      const o = bestOffer(s);
      if (o && act({ type: 'buy', uid: o.uid })) continue;
    }
    if (s.heroReady && s.board.length > 0 && act({ type: 'heroPower', uid: [...s.board].sort((a, c) => stat(c) - stat(a))[0]!.uid })) continue;
    const before = s;
    s = reduce(s, { type: 'faceOmen' });
    if (s === before) break;
    actions.push({ type: 'faceOmen' });
    if (s.lastCombat) live.push(snapshotBoard(s));
  }
  return { replay: { seed, heroId: s.heroId, actions }, live, final: s };
}

console.log('\n=== ASCENT — replay harness (board capture) ===');
console.log('Record a bot run → replay it headlessly → verify it is byte-identical → dump per-wave snapshots.\n');

for (const seed of [1, 7, 42]) {
  const { replay, live, final } = recordRun(seed);
  const out = replayRun(replay);
  const faithful = serialize(out.final) === serialize(final);
  const snapsMatch = JSON.stringify(out.snapshots) === JSON.stringify(live);
  const kb = (JSON.stringify(replay).length / 1024).toFixed(1);
  console.log(
    `seed ${String(seed).padStart(4)} — reached wave ${final.wave}, ${replay.actions.length} actions ` +
      `(${kb} KB replay) · replay faithful: ${faithful ? '✓' : '✗ BUG'} · snapshots match: ${snapsMatch ? '✓' : '✗'}`,
  );
  for (const snap of out.snapshots) {
    const names = snap.minions
      .map((m) => `${CARD_INDEX[m.cardId]?.name ?? m.cardId}${m.golden ? '*' : ''} ${m.attack}/${m.health}`)
      .join(', ');
    console.log(`   w${String(snap.wave).padStart(2)}  pow ${String(snap.power).padStart(4)}  ${snap.result ?? '?'}  [${names || '—'}]`);
  }
  console.log('');
}
console.log('Each snapshot is a serializable BoardMinion[] + (wave, power, tribes, hero, result) — drops');
console.log('straight into simulate() as a strength-matched enemy. This is the board library\'s atom.\n');
