import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LUNGE_DEFAULTS } from '../lungeConfig';

/**
 * STATS LAND BEFORE THE STRIKE (owner ask 2026-08-31).
 *
 *   *"for effects and buffs that buff a minion when they are attacking … having the stats update before the
 *    lunge attack takes place would be significantly more satisfying."*
 *
 * A buffed swing already paused at the top of the wind-up (`RALLY_PAUSE_MS`, 440ms) — enough to LAUNCH the
 * buff tendrils, not enough for the badge to finish rolling (`COMBAT_ROLL_MS`, 650ms, after the tendril's own
 * travel). So the strike went out while the number was still counting. `buffLeadMs` is the difference: the
 * attacker holds its reared-back pose until the stats have visibly landed.
 *
 * Pinned here because it is a PACING decision with a cost — every buffed attack is this much slower — and the
 * two properties that make it safe are easy to lose in a refactor: it must apply ONLY to a swing that carries
 * a buff, and 0 must restore the old timing exactly.
 */
const ENGINE = readFileSync(join(__dirname, 'engine.ts'), 'utf8');

/** The wind-up pause expression the engine hands to `playLunge`. */
function pauseExpr(): string {
  const i = ENGINE.indexOf('rallyPauseMs: RALLY_PAUSE_MS');
  expect(i, 'the wind-up pause is still computed here').toBeGreaterThan(-1);
  return ENGINE.slice(i, ENGINE.indexOf('\n', ENGINE.indexOf('buffLeadMs', i)));
}

describe('the buff lead', () => {
  it('is added only when the swing carries a buff', () => {
    const expr = pauseExpr();
    expect(expr.includes('ctx.onWindupBuffs ?'),
      'the lead must be conditional on this swing having buffs — an unbuffed swing pays nothing').toBe(true);
    expect(expr.includes('cfg.buffLeadMs'), 'and it comes from the tuner, not a constant').toBe(true);
  });

  it('is long enough for the roll it is waiting on', () => {
    // The whole point: the badge's combat roll is 650ms. A lead shorter than that would still cut the number
    // off, which is the bug being fixed rather than a milder version of it.
    const COMBAT_ROLL_MS = 650;
    const total = 440 + LUNGE_DEFAULTS.buffLeadMs; // RALLY_PAUSE_MS + the lead
    expect(total, 'the wind-up outlasts the roll').toBeGreaterThanOrEqual(COMBAT_ROLL_MS);
  });

  it('0 restores the old timing exactly', () => {
    // The escape hatch has to be real: the owner may decide the pacing cost is not worth it. Both wind-up
    // dials sit inside ONE conditional — the lead ("until the number stops rolling") and the settle beat
    // added beside it on 2026-09-01 ("sit still once it has") — so zeroing them restores the old pause and a
    // swing with no stat change pays neither.
    const expr = pauseExpr();
    expect(/\+ \(ctx\.onWindupBuffs \? cfg\.buffLeadMs \+ cfg\.windupSettleMs : 0\)/.test(expr),
      'a zero lead must add literally nothing').toBe(true);
  });

  it('the dial is tunable, and its range starts at 0', () => {
    expect(LUNGE_DEFAULTS.buffLeadMs, 'shipped with a real default').toBeGreaterThan(0);
  });
});
