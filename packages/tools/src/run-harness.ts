/**
 * Headless run-loop harness. A greedy bot plays full runs end to end (no UI),
 * showing how far the curve lets a naive board climb — and proving the whole
 * loop is deterministic. Run with: `npm run bot`.
 *
 * The bot is intentionally dumb (play/buy the first thing it can, upgrade when
 * flush, then face the omen) — the smarter bots live in the balance tools
 * (`npm run player` / `npm run balance`). But it DOES answer every pending
 * modal (Discover / Choose One / targeted Battlecry): the reducer blocks all
 * other actions while one is open, so a bot that ignores them silently stalls
 * the run and under-reports the reachable wave (the pre-2026-07-03 bug).
 * Rejected actions fall through (reduce returns the same reference), so the
 * step always makes progress toward faceOmen.
 */
import { CONFIG, createRun, reduce, serialize, THREATS, type RunState } from '@game/sim';

/** One greedy recruit action — precondition-guarded, falls through on a rejected action, ends in faceOmen. */
function recruitStep(s: RunState): RunState {
  let n: RunState;
  if (s.hand.length > 0 && s.board.length < CONFIG.boardMax) {
    n = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    if (n !== s) return n;
  }
  if (s.embers >= CONFIG.minionCost && s.shop.length > 0 && s.board.length + s.hand.length < CONFIG.boardMax) {
    n = reduce(s, { type: 'buy', uid: s.shop[0]!.uid });
    if (n !== s) return n;
  }
  if (s.tier < CONFIG.maxTier && s.embers >= s.upgradeCost) {
    n = reduce(s, { type: 'upgrade' });
    if (n !== s) return n;
  }
  if (s.heroReady && s.board[0]) {
    n = reduce(s, { type: 'heroPower', uid: s.board[0].uid });
    if (n !== s) return n;
  }
  return reduce(s, { type: 'faceOmen' });
}

function playRun(seed: number): RunState {
  let s = createRun(seed);
  let steps = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && steps++ < 100000) {
    if (s.discover) s = reduce(s, { type: 'discover', index: 0 });
    else if (s.chooseOne) s = reduce(s, { type: 'chooseOne', index: 0 });
    else if (s.pendingTarget) s = reduce(s, { type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid });
    else if (s.phase === 'combat') s = reduce(s, { type: 'resolveCombat' });
    else s = recruitStep(s);
  }
  return s;
}

console.log('\n=== ASCENT — run-loop harness (greedy bot) ===\n');
for (const seed of [1, 2, 3, 7, 42, 1000]) {
  const end = playRun(seed);
  const outcome = end.phase === 'victory' ? 'COURSE COMPLETE' : `reached wave ${String(end.wave).padStart(3)}`;
  console.log(
    `seed ${String(seed).padStart(5)} → ${outcome}` +
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
