import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANCIENTS_DEFAULTS } from './ancientsConfig';

/** THE REVEAL IS A MAGIC REVEAL, NOT A SLAM (owner 2026-09-27: "i dont want that slammy boom sound when they pop in").
 *  Nothing the reveal plays may carry an impact: its Pixi defs have no sound layers, and its two cues are the light
 *  gather + sheen, never an impact / implosion / boom clip. */
describe('the Ancients reveal sounds', () => {
  it('its Pixi defs carry no sound layer', () => {
    for (const id of ['ancient-reveal-spark', 'ancient-pick-impact', 'ancient-slam-sparks']) {
      const def = JSON.parse(readFileSync(join(__dirname, '..', 'fx', 'defs', `${id}.json`), 'utf8')) as { layers: { primitive: string }[] };
      expect(def.layers.filter((l) => l.primitive === 'sound'), id).toEqual([]);
    }
  });
  it('its cues are the light gather + sheen, not an impact', () => {
    expect(ANCIENTS_DEFAULTS).toMatchObject({ revealSparkClip: 'triggerglow', cardRevealClip: 'equipmentsheen' });
    for (const k of ['revealSparkClip', 'cardRevealClip'] as const) {
      expect(String(ANCIENTS_DEFAULTS[k])).not.toMatch(/impact|implosion|boom|slam|thud|smack|explosion/i);
    }
  });
});
