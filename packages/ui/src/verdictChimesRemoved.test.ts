/**
 * The round WON / LOST verdict chimes are GONE (owner ask 2026-09-23, with the lobby background music: "remove the
 * round won and round lost chimes that play currently"). The combat replay's finish plays no sting: the music
 * runs through the verdict uninterrupted. Pinned at the source, so the two cues cannot quietly return — neither
 * as a call at the replay's end nor as a key on the sound bank.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPLAY = readFileSync(join(__dirname, 'useCombatReplay.ts'), 'utf8');
const SFX = readFileSync(join(__dirname, 'sfx.ts'), 'utf8');

describe('the round won / lost chimes are removed', () => {
  it('the combat replay never calls sfx.win / sfx.lose when it finishes', () => {
    expect(REPLAY.includes('sfx.win(')).toBe(false);
    expect(REPLAY.includes('sfx.lose(')).toBe(false);
  });
  it('the sound bank has no win / lose cue to call', () => {
    expect(/^\s*win:\s*\(/m.test(SFX)).toBe(false);
    expect(/^\s*lose:\s*\(/m.test(SFX)).toBe(false);
  });
});
