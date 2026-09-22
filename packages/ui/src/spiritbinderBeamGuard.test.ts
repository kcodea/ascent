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
 *
 * Since the 2026-09-22 ruling "one beam per fire", the cues that DID pick a body are played by
 * `equipBeamCascade.ts` (one beam per cue, staggered, one hold per recipient) rather than by `Recruit`'s cue
 * loop, so the hold pin moved there, and a fourth pin checks the loop actually hands those cues over — a loop
 * that played them AND the cascade played them would be two beams per fire. The cascade's behaviour itself is
 * pinned by a mounted test (`equipBeamCascade.test.tsx`); this file only pins the wiring text,
 * including that the loop leaves the recipient's measurement to the cascade (one rect read per beam, at launch,
 * none in the loop).
 */
const SRC = readFileSync(new URL('./Recruit.tsx', import.meta.url), 'utf8');
const CASCADE = readFileSync(new URL('./equipBeamCascade.ts', import.meta.url), 'utf8');
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

/** The use-cue loop's def gate: from the no-target guard to the end of the `if (eq.useFxId` line. */
function defGate(): string {
  const start = SRC.indexOf('const aimlessBeam = ');
  expect(start, 'the no-target guard must still exist').toBeGreaterThan(-1);
  return SRC.slice(start, SRC.indexOf('\n', SRC.indexOf('if (eq.useFxId', start)));
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

  it('builds that exclusion from use cues of a useFxTargetsBuffed Equipment only — over EVERY cue, so N fires cover N bodies', () => {
    const body = selfBuffFilter();
    expect(body).toContain("f.kind === 'use'");
    expect(body).toContain('useFxTargetsBuffed');
    // Narrowed on purpose: an AIMED Equipment's behaviour in this pulse is unchanged.
    expect(body).toContain('f.targetUid');
    // A set over the whole list, never `.at(-1)` / `[0]`: with one cue per fire, every recipient is beamed.
    expect(body).toContain('(run.equipFx ?? [])');
    expect(body).not.toMatch(/equipFx[^\n]*\.at\(-1\)|equipFx[^\n]*\[0\]/);
  });

  it('plays nothing at all when such an Equipment picked no board body', () => {
    const body = defGate();
    expect(body).toContain('eq.useFxTargetsBuffed === true && !cue.targetUid');
    expect(body, 'the def gate must consult the guard, or the beam fires slot to slot').toContain('!aimlessBeam');
  });

  it('hands a cue that DID pick a body to the beam cascade instead of playing it in the loop (one beam per fire, never two)', () => {
    const body = defGate();
    expect(body).toContain('const cascaded = eq.useFxTargetsBuffed === true && !!cue.targetUid');
    expect(body, 'the def gate must skip cascaded cues, or every fire plays twice').toContain('!cascaded');
    const call = SRC.indexOf('useEquipBeamCascade({');
    expect(call, 'Recruit must mount the cascade').toBeGreaterThan(-1);
    const args = SRC.slice(call, call + 300);
    expect(args).toContain('seq: run.equipFxSeq');
    expect(args).toContain('cues: run.equipFx');
    expect(args).toContain('phase: run.phase');
    // The cascade's stop list IS the use-def stop list: one set of disposers for every use def and beam.
    expect(SRC).toContain('const useDefStopsRef = equipBeams.stops;');
    // The recipient is measured at LAUNCH and transform-immune, so a later beam lands where the card rests.
    const anchors = SRC.slice(SRC.indexOf('equipBeamAnchorsRef.current = {'), call);
    expect(anchors).toContain('restingCenterOf(');
  });

  it('does not measure a cascaded cue in the loop: the cascade reads each recipient at its own launch', () => {
    const body = defGate();
    // The guard is decided first, then the rect read is skipped for a cascaded cue. Measured here it would be a
    // layout read no beam ever uses, N times per press (review 2026-09-22).
    expect(body.indexOf('const cascaded = '), 'the cascade guard must be decided before the target is measured')
      .toBeLessThan(body.indexOf('findEl(cue.targetUid)'));
    expect(body).toContain('cue.targetUid && !cascaded ? findEl(cue.targetUid)');
  });

  it('opens the badge roll at the beam contact the def actually authors', () => {
    const beam = DEF.layers.find((l) => l.primitive === 'beam');
    expect(beam, 'spiritbinder.json must still carry a beam layer').toBeTruthy();
    const travelMs = Number(beam?.params?.travelMs);
    const m = /export const EQUIP_BUFF_LAND_MS = (\d+);/.exec(CASCADE);
    expect(m, 'EQUIP_BUFF_LAND_MS must still exist in equipBeamCascade.ts').toBeTruthy();
    expect(
      Number(m![1]),
      `the hold opens at EQUIP_BUFF_LAND_MS but the beam arrives at travelMs (${travelMs}ms). If the def was retuned, re-sync the constant so the numbers still move on contact.`,
    ).toBe(travelMs);
  });

  it('holds the beamed body with the gain the cue carried, not a re-derived one', () => {
    // The gain rides the cue → the beam → the hold plan; nothing here reads a buff ledger.
    const beams = CASCADE.slice(CASCADE.indexOf('export function equipBeamsOf('), CASCADE.indexOf('export interface EquipBeamSlot'));
    expect(beams).toContain('cue.buffAttack');
    expect(beams).toContain('cue.buffHealth');
    const hook = CASCADE.slice(CASCADE.indexOf('export function useEquipBeamCascade('));
    expect(hook).toContain("origin: 'cue'");
    expect(hook).toContain('equipBeamHoldPlan(beams, base)');
    expect(hook, 'the hold is placed pre-paint, in the layout effect the beams are scheduled from').toContain('useLayoutEffect(');
    expect(CASCADE).not.toMatch(/cardBuff\(|\.buffs\b/);
  });
});
