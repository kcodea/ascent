/**
 * THE SUMMON SOUND, ONE PER BURST PER CLIP (owner 2026-09-24: "a mass summon should not stack sounds, so apply the
 * same gap idea per clip"). `sfx.summon` asks `summonClipAllowed` for the general `summon` pop and for each token's
 * own voiceline, with the spell-cast burst gap (120 ms).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSummonSfxGate, summonClipAllowed } from '../sfx';
import { resetBuffFxConfig } from '../buffFxConfig';

let clock = 1000;
beforeEach(() => { resetSummonSfxGate(); resetBuffFxConfig(); vi.spyOn(performance, 'now').mockImplementation(() => clock); });
afterEach(() => { vi.restoreAllMocks(); });

describe('summon clip gate', () => {
  it('a burst rings each clip once; a different clip still rings; past the gap it rings again', () => {
    expect(summonClipAllowed('summon')).toBe(true);
    expect(summonClipAllowed('summon')).toBe(false);
    expect(summonClipAllowed('cards/stray')).toBe(true);
    expect(summonClipAllowed('cards/stray')).toBe(false);
    expect(summonClipAllowed('cards/alley')).toBe(true);
    clock += 300;
    expect(summonClipAllowed('summon')).toBe(true);
  });
});
