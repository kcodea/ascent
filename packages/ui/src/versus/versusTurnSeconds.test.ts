/**
 * MORE TIME IN VERSUS (owner 2026-10-30, R-VERSUS-TURN-TIME-01): "let's do a 15% increase in versus/group and a 30%
 * increase for duos". One function (`versusTurnSeconds`, packages/sim/src/versus/constants.ts) is the shop clock the
 * Worker stamps every Versus deadline with and the HUD shows before a deadline exists.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LIVE_SHOP_BONUS_SECONDS, VERSUS_TURN_PERCENT, versusTurnSeconds } from '@game/sim';
import { standardTurnSeconds } from '../turnClock';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('Versus turn clock per mode (R-VERSUS-TURN-TIME-01)', () => {
  it('1v1 and Group are 15% longer, Duos and Ranked Duos 30% longer (instead of, not on top of)', () => {
    expect(VERSUS_TURN_PERCENT).toEqual({ duel: 115, group: 115, duos: 130, ranked_duos: 130 });
    const rounds = Array.from({ length: 15 }, (_, i) => i + 1);
    const table = (mode: string) => rounds.map((r) => versusTurnSeconds(r, mode));
    expect(table('duel')).toEqual([24, 25, 30, 35, 39, 76, 55, 60, 89, 69, 74, 92, 97, 101, 106]);
    expect(table('group')).toEqual(table('duel'));
    expect(table('duos')).toEqual([27, 29, 34, 39, 44, 82, 62, 68, 98, 78, 83, 104, 109, 114, 120]);
    expect(table('ranked_duos')).toEqual(table('duos'));
    expect(versusTurnSeconds(40, 'duel')).toBe(106);
    expect(versusTurnSeconds(40, 'duos')).toBe(120);
  });

  it('is the lobby schedule times the percent, rounded half up to whole seconds, plus the round 6 / 9 bonus', () => {
    for (let r = 1; r <= 80; r++) {
      for (const [mode, pct] of Object.entries(VERSUS_TURN_PERCENT)) {
        const s = versusTurnSeconds(r, mode);
        expect(Number.isInteger(s), `r${r} ${mode}`).toBe(true);
        expect(s, `r${r} ${mode}`).toBe(Math.round((standardTurnSeconds(r) * pct) / 100) + (r === 6 || r === 9 ? 25 : 0));
      }
    }
    // 30 s x 1.15 = 34.5 rounds UP (a float 1.15 would land on 34.4999 and round down).
    expect(versusTurnSeconds(4, 'duel')).toBe(35);
  });

  it('R-VERSUS-TURN-TIME-02: turns 6 and 9 get 25 more seconds in every live mode; the ranked solo lobby does not', () => {
    expect(LIVE_SHOP_BONUS_SECONDS).toEqual({ 6: 25, 9: 25 });
    for (const mode of Object.keys(VERSUS_TURN_PERCENT)) {
      expect([5, 6, 9, 10].map((r) => versusTurnSeconds(r, mode) - Math.round((standardTurnSeconds(r) * VERSUS_TURN_PERCENT[mode as keyof typeof VERSUS_TURN_PERCENT]) / 100)), mode).toEqual([0, 25, 25, 0]);
    }
    // The ranked solo lobby (and Practice / the solo modes) read the plain schedule, unchanged.
    expect([5, 6, 9, 10].map((r) => standardTurnSeconds(r))).toEqual([34, 44, 56, 60]);
  });

  it('an unknown or missing mode reads as the 1v1', () => {
    expect(versusTurnSeconds(3, undefined)).toBe(versusTurnSeconds(3, 'duel'));
    expect(versusTurnSeconds(3, 'nope')).toBe(versusTurnSeconds(3, 'duel'));
    expect(versusTurnSeconds(3, 'toString')).toBe(versusTurnSeconds(3, 'duel'));
  });

  it('the Worker deadlines and the HUD face read this one function with the match mode', () => {
    const group = read('../../../../workers/versus/src/core/groupMatch.ts');
    expect(group.match(/versusTurnSeconds\((?:round|m\.round), m\.options\.mode\) \* 1000/g)?.length).toBe(2);
    expect(group).not.toMatch(/function turnSeconds/);
    const room = read('../../../../workers/versus/src/core/roomCore.ts');
    expect(room).toMatch(/return versusTurnSeconds\(round, mode\);/);
    const hud = read('./VersusHud.tsx');
    expect(hud).toMatch(/turnClock\.set\(versusTurnSeconds\(run\.wave, match\?\.options\?\.mode/);
    expect(hud).not.toMatch(/standardTurnSeconds/);
  });
});
