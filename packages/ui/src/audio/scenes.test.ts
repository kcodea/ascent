import { describe, it, expect } from 'vitest';
import { SCENES } from './scenes';
import { CATEGORY_GAINS } from './config';

describe('SCENES', () => {
  it('every scene references only real cue methods', () => {
    const cues = new Set(['buy', 'sell', 'roll', 'play', 'castSpell', 'attack', 'death', 'shieldBreak',
      'cardVoice', 'summon', 'heroSelect', 'heroPower', 'discover', 'skullBurst', 'buff', 'combatStart']);
    for (const scene of SCENES) {
      expect(scene.name.length).toBeGreaterThan(0);
      for (const step of scene.steps) expect(cues.has(step.cue), `${scene.name}:${step.cue}`).toBe(true);
    }
  });
  it('has the four planned scenes', () => {
    expect(SCENES.map((s) => s.id).sort()).toEqual(['combat', 'hero', 'shop', 'torture']);
  });
  it('config has categories', () => { expect(Object.keys(CATEGORY_GAINS).length).toBeGreaterThan(10); });
});
