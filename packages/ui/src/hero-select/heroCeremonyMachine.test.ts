/**
 * HERO SELECT CEREMONY — phase machine tests.
 *
 * These pin the load-bearing safety property of the feature: run creation is delayed behind a Start Game
 * button, so a double-launch would create TWO runs. The machine makes that structurally impossible —
 * `launching` is terminal, reachable only via `startGame` from `ready`, exactly once. Everything else here
 * (referential no-ops, the forward-only order) exists so a stray timer or double click can never resurrect
 * or skip the ceremony.
 *
 * The referential-no-op contract matters on its own: illegal events must return the SAME object (asserted
 * with `toBe`, never `toEqual`) so callers can cheaply detect "nothing happened" and so a timer firing
 * after a reset can't re-enter the ceremony via a structurally-equal-but-fresh state.
 */
import { describe, expect, it } from 'vitest';
import {
  CEREMONY_IDLE, CEREMONY_ORDER, ceremonyAcceptsClicks, ceremonyActive, ceremonyCanLaunch,
  ceremonyReduce, isLegalAdvance,
  type HeroCeremonyPhase, type HeroCeremonyState, type RectSnapshot,
} from './heroCeremonyMachine';

const RECT: RectSnapshot = { left: 100, top: 200, width: 120, height: 168 };

const selectEv = (heroId = 'brackus') =>
  ({ type: 'select', heroId, rect: RECT, index: 2, now: 1234 }) as const;

/**
 * Drive the machine to a given phase through the ONLY legal path: select, then one advance per step
 * (startGame for the final door). If the machine ever breaks, these tests fail on the way in — the helper
 * never fabricates a state by object literal.
 */
function stateIn(phase: HeroCeremonyPhase): HeroCeremonyState {
  let s: HeroCeremonyState = CEREMONY_IDLE;
  if (phase === 'idle') return s;
  s = ceremonyReduce(s, selectEv());
  const target = CEREMONY_ORDER.indexOf(phase);
  for (let i = CEREMONY_ORDER.indexOf('committed') + 1; i <= target; i++) {
    const to = CEREMONY_ORDER[i]!;
    s = to === 'launching'
      ? ceremonyReduce(s, { type: 'startGame' })
      : ceremonyReduce(s, { type: 'advance', to });
    expect(s.phase, `stateIn helper must be able to reach ${to}`).toBe(to);
  }
  return s;
}

describe('select — the only way in', () => {
  it('starts idle and the first valid select commits, capturing the click context', () => {
    expect(CEREMONY_IDLE.phase).toBe('idle');
    const s = ceremonyReduce(CEREMONY_IDLE, selectEv('yazzus'));
    expect(s.phase).toBe('committed');
    expect(s.heroId).toBe('yazzus');
    expect(s.sourceRect).toEqual(RECT);
    expect(s.sourceIndex).toBe(2);
    expect(s.startedAt).toBe(1234);
  });

  it('a second select during ANY non-idle phase is a referential no-op — not queued, not merged', () => {
    for (const phase of CEREMONY_ORDER) {
      if (phase === 'idle') continue;
      const s = stateIn(phase);
      const after = ceremonyReduce(s, selectEv('someone-else'));
      // toBe, not toEqual: the caller detects "ignored" by identity, and the first hero must survive.
      expect(after, `select during ${phase} must return the same object`).toBe(s);
    }
  });
});

describe('advance — forward-only, one step at a time', () => {
  it('every legal single step succeeds; every skip and every backward step is a referential no-op', () => {
    // Iterate the full from×to matrix off CEREMONY_ORDER rather than hand-listing pairs, so adding a
    // phase to the order automatically extends the coverage.
    for (const from of CEREMONY_ORDER) {
      const s = stateIn(from);
      for (const to of CEREMONY_ORDER) {
        const after = ceremonyReduce(s, { type: 'advance', to });
        if (to !== 'launching' && isLegalAdvance(from, to)) {
          expect(after.phase, `${from} -> ${to} is the legal next step`).toBe(to);
          expect(after, 'a real advance must produce a new state object').not.toBe(s);
        } else {
          // Skips (committed -> voicing), backwards (ready -> focusing), self-loops, and launching.
          expect(after, `advance ${from} -> ${to} must be a referential no-op`).toBe(s);
        }
      }
    }
  });

  it('advance can NEVER reach launching — even the "legal-looking" ready -> launching step', () => {
    const ready = stateIn('ready');
    // isLegalAdvance says ready -> launching is adjacent on the path, but the reducer still refuses:
    // startGame is the only door, so no timer beat can ever create a run.
    expect(isLegalAdvance('ready', 'launching')).toBe(true);
    expect(ceremonyReduce(ready, { type: 'advance', to: 'launching' })).toBe(ready);
  });
});

describe('startGame — the single door into launching', () => {
  it('is ignored (referentially) in every phase except ready', () => {
    for (const phase of CEREMONY_ORDER) {
      if (phase === 'ready') continue;
      const s = stateIn(phase);
      expect(ceremonyReduce(s, { type: 'startGame' }), `startGame during ${phase}`).toBe(s);
    }
  });

  it('from ready it launches exactly once; a second press is a referential no-op', () => {
    const ready = stateIn('ready');
    const launched = ceremonyReduce(ready, { type: 'startGame' });
    expect(launched.phase).toBe('launching');
    expect(launched.heroId).toBe('brackus'); // the commit context rides along into the launch
    // The double-click that would have created two runs: identical object back, nothing to act on.
    expect(ceremonyReduce(launched, { type: 'startGame' })).toBe(launched);
  });
});

describe('reset — the only road back to idle', () => {
  it('returns CEREMONY_IDLE from every phase, launching included', () => {
    for (const phase of CEREMONY_ORDER) {
      // toBe the shared constant: a reset hands back the canonical idle object, so a stale timer
      // comparing identity against it sees "the ceremony is gone".
      expect(ceremonyReduce(stateIn(phase), { type: 'reset' }), `reset from ${phase}`).toBe(CEREMONY_IDLE);
    }
  });
});

describe('the guard helpers agree with the phase', () => {
  it('idle: inactive, accepts clicks, cannot launch', () => {
    const s = stateIn('idle');
    expect(ceremonyActive(s)).toBe(false);
    expect(ceremonyAcceptsClicks(s)).toBe(true);
    expect(ceremonyCanLaunch(s)).toBe(false);
  });

  it('ready: active, no clicks, CAN launch', () => {
    const s = stateIn('ready');
    expect(ceremonyActive(s)).toBe(true);
    expect(ceremonyAcceptsClicks(s)).toBe(false);
    expect(ceremonyCanLaunch(s)).toBe(true);
  });

  it('launching: active, no clicks, can no longer launch again', () => {
    const s = stateIn('launching');
    expect(ceremonyActive(s)).toBe(true);
    expect(ceremonyAcceptsClicks(s)).toBe(false);
    expect(ceremonyCanLaunch(s)).toBe(false);
  });
});
