/**
 * The QA Workbench plugin's PURE half — path resolution. The tests that matter are the negative ones: this
 * middleware runs on a developer's machine with the whole repo under it, so "the request can never choose
 * the path" has to be provable, not asserted.
 */
import { describe, expect, it } from 'vitest';
import { WORKBENCH_ARTIFACTS, resolveArtifact, resolveScenarioPath } from './workbenchPlugin';

describe('resolveArtifact', () => {
  it('resolves every key in the closed set', () => {
    for (const key of Object.keys(WORKBENCH_ARTIFACTS)) {
      const r = resolveArtifact(key);
      expect(r, key).not.toBeNull();
      expect(r!.hint, `${key} must tell the developer how to produce it`).toBeTruthy();
    }
  });

  it('refuses anything outside the set — including prototype keys', () => {
    for (const bad of ['', 'nope', '../../etc/passwd', '__proto__', 'constructor', 'prototype', 'toString']) {
      expect(resolveArtifact(bad), bad).toBeNull();
    }
  });
});

describe('resolveScenarioPath', () => {
  it('looks in curated regressions first, then the general scenarios dir', () => {
    const paths = resolveScenarioPath('regression-abcd1234-multiplier-fold')!;
    expect(paths).toHaveLength(2);
    expect(paths[0]!.replace(/\\/g, '/')).toMatch(/scenarios\/regressions\/regression-abcd1234-multiplier-fold\.json$/);
    expect(paths[1]!.replace(/\\/g, '/')).toMatch(/scenarios\/regression-abcd1234-multiplier-fold\.json$/);
  });

  it('refuses any id that is not a plain slug', () => {
    for (const bad of ['', '../secret', 'a/b', 'A-Upper', 'x'.repeat(200), '.env', 'foo.json', 'foo bar']) {
      expect(resolveScenarioPath(bad), bad).toBeNull();
    }
  });

  it('accepts the ids the graduation command actually mints', () => {
    expect(resolveScenarioPath('regression-00000000-resolution-order')).not.toBeNull();
    expect(resolveScenarioPath('avenge-window-exact-copy')).not.toBeNull();
  });
});
