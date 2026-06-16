/**
 * Headless run-loop harness. A greedy bot plays full runs end to end (no UI),
 * showing how far the curve lets a naive board climb — and proving the whole
 * loop is deterministic. Run with: `npm run bot`.
 *
 * The bot is intentionally dumb (buy the first affordable offer, upgrade when
 * flush, then face the omen). It has no synergy awareness — that's what the real
 * balance bots in M2 will add — so it dies early; the point here is the loop.
 */
import { createRun, reduce, serialize, THREATS, type RunState } from '@game/sim';

function playRun(seed: number): RunState {
  let s = createRun(seed);
  let steps = 0;
  while (s.phase !== 'gameover' && steps++ < 100000) {
    if (s.phase === 'combat') {
      s = reduce(s, { type: 'resolveCombat' });
    } else if (s.hand.length > 0 && s.board.length < 7) {
      s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    } else if (s.embers >= 3 && s.board.length + s.hand.length < 7) {
      s = reduce(s, { type: 'buy', uid: s.shop[0]!.uid });
    } else if (s.tier < 6 && s.embers >= s.upgradeCost) {
      s = reduce(s, { type: 'upgrade' });
    } else if (s.heroReady && s.board[0]) {
      s = reduce(s, { type: 'heroPower', uid: s.board[0].uid });
    } else {
      s = reduce(s, { type: 'faceOmen' });
    }
  }
  return s;
}

console.log('\n=== ASCENT — run-loop harness (greedy bot) ===\n');
for (const seed of [1, 2, 3, 7, 42, 1000]) {
  const end = playRun(seed);
  console.log(
    `seed ${String(seed).padStart(5)} → reached wave ${String(end.wave).padStart(3)}` +
      `  (tier ${end.tier}, board ${end.board.length}, last omen ${THREATS[end.threat].name})`,
  );
}

const a = playRun(12345);
const b = playRun(12345);
const deterministic = serialize(a) === serialize(b);
console.log(
  `\nDETERMINISM: same seed → ${deterministic ? 'IDENTICAL final state ✓' : 'DIFFERENT ✗ — BUG'}`,
);

if (!deterministic) process.exit(1);
