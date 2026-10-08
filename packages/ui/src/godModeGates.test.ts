/**
 * GOD MODE presentation gates (owner 2026-10-08): `sandbox: true` was built for the DEV rig, so a God Mode run
 * needs a few exceptions — no shop clock (whatever the DEV rules say), music + the good-luck intro play, the DEV
 * sandbox panels never mount over it, and the lobby rail is hidden.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shopClockInfinite } from './goldClock';
import { isMusicWanted } from './music';
import { shouldPlayGoodLuckIntro } from './goodLuck/goodLuckIntroStore';

const src = (f: string): string => readFileSync(join(__dirname, f), 'utf8');
const god = { mode: 'practice', sandbox: true, godMode: true as const, seed: 1, wave: 1 };

describe('God Mode gates', () => {
  it('has no shop clock, whatever the DEV Scene Builder rules say', () => {
    expect(shopClockInfinite(god, 'normal')).toBe(true);
    expect(shopClockInfinite({ sandbox: true }, 'normal')).toBe(false);
    expect(shopClockInfinite({ sandbox: true }, 'god')).toBe(true);
    expect(shopClockInfinite({ sandbox: false }, 'god')).toBe(false);
  });
  it('plays music and the good-luck intro (sandbox would silence them)', () => {
    expect(isMusicWanted({ showTitle: false, heroChoices: null, practiceSetupOpen: false, replaying: false, run: god } as never)).toBe(true);
    expect(isMusicWanted({ showTitle: false, heroChoices: null, practiceSetupOpen: false, replaying: false, run: { ...god, godMode: undefined } } as never)).toBe(false);
    expect(shouldPlayGoodLuckIntro(god)).toBe(true);
    expect(shouldPlayGoodLuckIntro({ ...god, godMode: undefined })).toBe(false);
  });
  it('never mounts the DEV sandbox panels over a God Mode run, and hides the lobby rail', () => {
    expect(src('Game.tsx')).toContain('SandboxDevPanels && sandbox && !godMode &&');
    expect(src('Recruit.tsx')).toContain('run.lobby && !run.godMode && (run.mode === \'gauntlet\'');
  });
  it('shows no timer plaque in God Mode (an untimed turn must not count down)', () => {
    const r = src('Recruit.tsx');
    expect(r).toContain('godMode={run.godMode === true}');
    expect(r).toContain("{mode !== 'tutorial' && !godMode && (");
  });
  it('hides the combat ROUND label in God Mode (the player picks each fight\'s round, so it means nothing)', () => {
    const r = src('Recruit.tsx');
    expect(r).toContain('godMode={run.godMode === true}'); // ShopControls' godMode prop is run.godMode
    expect(r).toContain('{inCombat && !godMode && <CombatRoundLabel round={combatRoundNo} />}');
    // No other mount of the label bypasses the gate.
    expect(r.match(/<CombatRoundLabel\b/g)).toHaveLength(1);
  });
});
