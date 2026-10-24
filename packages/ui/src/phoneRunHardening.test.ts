/**
 * R-TOUCH-CRASH-REPORT-02 (owner 2026-10-23, real iPhone: "i got to hero select and then it
 * crashed both times after selecting a hero, when the animation should play"). The hero pick, the launch curtain and
 * the falling gate leave crash-log steps.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (f: string): string => fs.readFileSync(path.join(__dirname, f), 'utf8');

describe('phone run hardening', () => {
  it('the hero pick, the launch curtain and the gate leave light crash-log steps', () => {
    const ceremony = src('hero-select/HeroSelectCeremony.tsx');
    expect(ceremony).toMatch(/crumbTrail\('hero picked', \{ hero: heroId \}, true\)/);
    expect(ceremony).toMatch(/crumbLight\(`hero ceremony \$\{state\.phase\}`\)/);
    const curtain = src('hero-select/HeroLaunchCurtain.tsx');
    for (const s of ['launch cover', 'launch covered', 'run built', 'launch reveal']) expect(curtain).toContain(`crumbLight('${s}'`);
    expect(curtain).toMatch(/crumbTrail\('first shop', undefined, true\)/);
    expect(src('Recruit.tsx')).toMatch(/crumbLight\(`gate \$\{wipe\}`\)/);
  });
});
