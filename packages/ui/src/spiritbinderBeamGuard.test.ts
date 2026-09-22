import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * REGRESSION PIN — Spiritbinder's beam must be the ONLY cue the body it lands on gets, and it must land
 * before that body's numbers move.
 *
 * Two facts this pins, both found by eye in the browser rather than by CI (there is no render harness for
 * `Recruit`, which is why the source-level technique `rubyStatHoldGuard.test.ts` uses applies here too):
 *
 *  1. `choreo/bindings.json` still gives `minionSelfBuffed` a GENERIC default (`self-buff-burst`). An
 *     Equipment carrying an authored use def skips the `recruitBuffFx` capture, so the board body its effect
 *     buffed arrives in the self-buff board diff with no FX target to suppress it — and plays a burst ON TOP
 *     of the beam unless `burstable` filters it out. One press, two cues, which the 2026-08-11 ruling forbids.
 *     Dropping the `!beamedNow.has(u)` term brings that straight back.
 *  2. The badge is held to CONTACT. `EQUIP_BUFF_LAND_MS` is the beam layer's `travelMs`, so the roll opens as
 *     the strand arrives; the shockwave layer's earlier `at` put the numbers 110ms ahead of it (review
 *     2026-09-22).
 *
 * And the third, from the sim side of the same feature: no board Spirit means NO beam. The slot fallback in
 * that effect would otherwise fire the owner's def from the button to the button.
 */
const SRC = readFileSync(new URL('./Recruit.tsx', import.meta.url), 'utf8');
const BINDINGS = JSON.parse(readFileSync(new URL('./choreo/bindings.json', import.meta.url), 'utf8')) as {
  kinds?: Record<string, { def?: string }>;
};
const DEF = JSON.parse(readFileSync(new URL('./fx/defs/spiritbinder.json', import.meta.url), 'utf8')) as {
  layers: { primitive: string; at?: number; params?: Record<string, unknown> }[];
};

/** The self-buff board-diff effect body: from the FX-target set it builds to the filter it feeds. */
function selfBuffFilter(): string {
  const start = SRC.indexOf('const fxTargets = new Set(run.recruitBuffFx.map(');
  expect(start, 'the self-buff board diff must still build its recruitBuffFx skip set').toBeGreaterThan(-1);
  const end = SRC.indexOf('const burstable = newly.filter(', start);
  expect(end, 'the self-buff board diff must still narrow to a burstable list').toBeGreaterThan(start);
  return SRC.slice(start, SRC.indexOf('\n', end));
}

describe('Spiritbinder beam guard', () => {
  it('still has a generic self-buff default to suppress, so the filter is load-bearing', () => {
    expect(
      BINDINGS.kinds?.minionSelfBuffed?.def,
      'if this default is ever removed, the beamedNow filter and the comment beside it need revisiting - do not just delete this assertion',
    ).toBeTruthy();
  });

  it('excludes the beamed body from the generic self-buff burst', () => {
    expect(selfBuffFilter()).toContain('!beamedNow.has(u)');
  });

  it('builds that exclusion from use cues of a useFxTargetsBuffed Equipment only', () => {
    const body = selfBuffFilter();
    expect(body).toContain("f.kind === 'use'");
    expect(body).toContain('useFxTargetsBuffed');
    // Narrowed on purpose: an AIMED Equipment's behaviour in this pulse is unchanged.
    expect(body).toContain('f.targetUid');
  });

  it('plays nothing at all when such an Equipment picked no board body', () => {
    const start = SRC.indexOf('const aimlessBeam = ');
    expect(start, 'the no-target guard must still exist').toBeGreaterThan(-1);
    const body = SRC.slice(start, SRC.indexOf('\n', SRC.indexOf('if (eq.useFxId', start)));
    expect(body).toContain('eq.useFxTargetsBuffed === true && !cue.targetUid');
    expect(body, 'the def gate must consult the guard, or the beam fires slot to slot').toContain('!aimlessBeam');
  });

  it('opens the badge roll at the beam contact the def actually authors', () => {
    const beam = DEF.layers.find((l) => l.primitive === 'beam');
    expect(beam, 'spiritbinder.json must still carry a beam layer').toBeTruthy();
    const travelMs = Number(beam?.params?.travelMs);
    const m = /const EQUIP_BUFF_LAND_MS = (\d+);/.exec(SRC);
    expect(m, 'EQUIP_BUFF_LAND_MS must still exist').toBeTruthy();
    expect(
      Number(m![1]),
      `the hold opens at EQUIP_BUFF_LAND_MS but the beam arrives at travelMs (${travelMs}ms). If the def was retuned, re-sync the constant so the numbers still move on contact.`,
    ).toBe(travelMs);
  });

  it('holds the beamed body with the gain the cue carried, not a re-derived one', () => {
    const start = SRC.indexOf('if (cue.targetUid && (cue.buffAttack || cue.buffHealth))');
    expect(start, 'the cue-origin hold must still exist').toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 400);
    expect(body).toContain('cue.buffAttack');
    expect(body).toContain('cue.buffHealth');
    expect(body).toContain("origin: 'cue'");
    expect(body).toContain('EQUIP_BUFF_LAND_MS');
  });
});
