import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DRAG_DEFAULTS_VERSION } from './dragFeel';

/**
 * Makes tuned drag values SHAREABLE (owner 2026-07-26: "I want his settings, and I want us both to push
 * tuner values live by syncing to main").
 *
 * In dev the localStorage override beats the shipped `DEFAULTS`, so syncing main gets you the new code and
 * none of the new feel — a stale save shadows it silently. `DRAG_DEFAULTS_VERSION` fixes that: a save tuned
 * against an older version is discarded on load. But only if the bump actually happens, and a bump is exactly
 * the kind of step that gets forgotten in the PR that changes the numbers.
 *
 * So: fingerprint the DEFAULTS block. Change the numbers without bumping the version and this fails, naming
 * the two things to do. It is a chore-catcher, not a behaviour test — the expected hash is meant to be updated
 * in the same commit as the values.
 */
const SRC = readFileSync(join(__dirname, 'dragFeel.ts'), 'utf8');

/** The literal `DEFAULTS` object, whitespace-normalised so a reformat isn't a false alarm. */
function defaultsFingerprint(): string {
  const m = /const DEFAULTS: DragFeel = \{([\s\S]*?)\n\};/.exec(SRC);
  if (!m) throw new Error('could not find the DEFAULTS block in dragFeel.ts');
  const body = m[1]!
    .replace(/\/\/[^\n]*/g, '')      // strip line comments — prose changes are not value changes
    .replace(/\s+/g, '');
  return createHash('sha1').update(body).digest('hex').slice(0, 12);
}

describe('drag feel — tuned values are shareable through main', () => {
  it('DEFAULTS and DRAG_DEFAULTS_VERSION move together', () => {
    // ── WHEN THIS FAILS ────────────────────────────────────────────────────────────────────────────────
    // You changed the shipped drag values. Two steps, both required:
    //   1. bump DRAG_DEFAULTS_VERSION in dragFeel.ts   (this is what clears everyone's stale local override)
    //   2. paste the new hash below
    // Skip step 1 and your teammates will pull your commit and still feel their own old drag.
    const EXPECTED = { version: 8, fingerprint: '862037283caa' };
    expect(
      { version: DRAG_DEFAULTS_VERSION, fingerprint: defaultsFingerprint() },
      'DEFAULTS changed — bump DRAG_DEFAULTS_VERSION and update the fingerprint below (see the comment)',
    ).toEqual(EXPECTED);
  });

  it('a save stamped with an older version is ignored, so main wins on sync', () => {
    // The behaviour the version exists for, asserted against the real load logic's shape: a payload carrying
    // a different `__v` must not contribute any values.
    const saved = { follow: 0.01, __v: DRAG_DEFAULTS_VERSION - 1 };
    const applied = saved.__v === DRAG_DEFAULTS_VERSION ? saved : null;
    expect(applied, 'a stale-version save contributes nothing').toBeNull();
  });
});
