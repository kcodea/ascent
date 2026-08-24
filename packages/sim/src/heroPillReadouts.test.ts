/**
 * HERO POWER READOUTS (owner ask 2026-08-24). The StatusBar shows two live slots — a top pill (progress) and
 * a centre magnitude (Odelle-style). These tests pin the DATA those slots read for the four heroes wired in
 * this batch; the JSX that renders them is a thin `switch`, but the values must be right.
 *
 * Cindara's Avenge tracker is a COMBAT counter with no run total, so it reads a display-only preview
 * (`fxFriendlyDeathPreview`) that the replay ticks as her minions fall. The last block drives that preview
 * through the REAL reducer action so the plumbing is proven end to end, not just the arithmetic.
 */
import { describe, expect, it } from 'vitest';
import { createRun, reduce, type RunState } from './index';
import {
  tempestGrantOf, bladeMasteryGrantOf, hoardWhelpStatsOf,
  TEMPEST_KILLS_PER_STEP, BLADE_ATTACKS_PER_STEP,
} from './recruit';

const runWith = (heroId: string): RunState => createRun(5, heroId, 'practice');

// The exact expressions StatusBar's `powerTally` / `powerCenter` switches evaluate, kept here so a change to
// either the pill wiring or the helper is caught against a fixed table.
const tempestPill = (r: RunState): string => {
  const k = r.tempestKills ?? 0;
  return k < TEMPEST_KILLS_PER_STEP ? `${k}/${TEMPEST_KILLS_PER_STEP} 🔒` : `${k % TEMPEST_KILLS_PER_STEP}/${TEMPEST_KILLS_PER_STEP}`;
};
const tempestCentre = (r: RunState): string | null => { const g = tempestGrantOf(r); return g > 0 ? `+${g}/+${g}` : null; };
const bladePill = (r: RunState): string => `${(r.bladeAttacks ?? 0) % BLADE_ATTACKS_PER_STEP}/${BLADE_ATTACKS_PER_STEP}`;
const bladeCentre = (r: RunState): string => `+${bladeMasteryGrantOf(r)}`;
const hoardPill = (r: RunState): string => `${(r.fxFriendlyDeathPreview ?? 0) % 4}/4`;
const hoardCentre = (r: RunState): string => { const w = hoardWhelpStatsOf(r); return `${w.attack}/${w.health}`; };
const valeCentre = (r: RunState): string => `+${r.spellsCast}/+${r.spellsCast}`;

describe('Aevor — Tempest pill + centre', () => {
  it('the pill counts toward the UNLOCK below 15, then toward each step, and the lock mark tracks it', () => {
    const r = runWith('aevor');
    r.tempestKills = 0; expect(tempestPill(r)).toBe('0/15 🔒');
    r.tempestKills = 14; expect(tempestPill(r)).toBe('14/15 🔒');
    r.tempestKills = 15; expect(tempestPill(r)).toBe('0/15');
    r.tempestKills = 22; expect(tempestPill(r)).toBe('7/15');
    r.tempestKills = 30; expect(tempestPill(r)).toBe('0/15');
  });
  it('the centre is blank until unlocked, then the live grant', () => {
    const r = runWith('aevor');
    r.tempestKills = 14; expect(tempestCentre(r)).toBeNull();
    r.tempestKills = 15; expect(tempestCentre(r)).toBe('+4/+4');
    r.tempestKills = 30; expect(tempestCentre(r)).toBe('+8/+8');
  });

  it('live combat kills fold in — the unlock crosses mid-fight as enemies fall', () => {
    // StatusBar folds `combatEnemyDeaths` (the store's live enemy-death count) into the total, so a run at 13
    // kills crosses the 15 unlock during the fight rather than only at settle.
    const r = runWith('aevor');
    r.tempestKills = 13;
    const withDeaths = (n: number) => ({ ...r, tempestKills: (r.tempestKills ?? 0) + n });
    expect(tempestPill(withDeaths(1))).toBe('14/15 \u{1F512}'); // still locked
    expect(tempestCentre(withDeaths(1))).toBeNull();
    expect(tempestPill(withDeaths(2))).toBe('0/15'); // 15 -> unlocked, live
    expect(tempestCentre(withDeaths(2))).toBe('+4/+4');
  });
});

describe('Gorun — Blade Mastery pill + centre', () => {
  it('the pill counts attacks toward the next step; the centre is the current grant', () => {
    const r = runWith('gorun');
    expect(bladePill(r)).toBe('0/8');
    expect(bladeCentre(r)).toBe('+3'); // no unlock floor — +3 from the very first swing
    r.bladeAttacks = 7; expect(bladePill(r)).toBe('7/8'); expect(bladeCentre(r)).toBe('+3');
    r.bladeAttacks = 8; expect(bladePill(r)).toBe('0/8'); expect(bladeCentre(r)).toBe('+6');
    r.bladeAttacks = 16; expect(bladeCentre(r)).toBe('+9');
  });

  it('the live preview folds into pill and centre (what StatusBar shows during combat)', () => {
    const r = runWith('gorun');
    r.bladeAttacks = 6; r.fxBladeAttacksPreview = 3; // effective 9 -> past the first step
    const eff = { ...r, bladeAttacks: (r.bladeAttacks ?? 0) + (r.fxBladeAttacksPreview ?? 0) };
    expect(bladePill(eff)).toBe('1/8');
    expect(bladeCentre(eff)).toBe('+6');
  });

  it('the live preview count MATCHES the settle count, so the pill never jumps', () => {
    // The replay dispatches one `combatBladeAttackPreview` per player-side `bladeMastery` questTrigger; settle
    // banks `bladeAttacks` from `questTally.attack`. If those counted different units the pill would tick to
    // one number mid-fight and snap to another at settle. Driven through a real fight.
    let s: RunState = { ...runWith('gorun'), board: [
      { uid: 'a', cardId: 'b2_packstrider', attack: 3, health: 20, keywords: [], effects: [], buffs: [] },
      { uid: 'b', cardId: 'b2_packstrider', attack: 3, health: 20, keywords: [], effects: [], buffs: [] },
    ] as never };
    const before = s.bladeAttacks ?? 0;
    s = reduce(s, { type: 'faceOmen' });
    const triggers = (s.lastCombat?.events ?? []).filter(
      (e) => (e as { type: string; flag?: string; side?: string }).type === 'questTrigger'
        && (e as { flag?: string }).flag === 'bladeMastery' && (e as { side?: string }).side === 'player').length;
    s = reduce(s, { type: 'resolveCombat' }); s = reduce(s, { type: 'settleCombat' });
    expect(triggers).toBe((s.bladeAttacks ?? 0) - before);
    expect(s.fxBladeAttacksPreview, 'the preview retires at settle').toBeUndefined();
  });
});

describe('Cindara — Hoard pill + centre', () => {
  it('the centre is the next Whelp size, base then banked', () => {
    const r = runWith('cindara');
    expect(hoardCentre(r)).toBe('1/1');
    r.hoardWhelpBuff = { attack: 6, health: 6 };
    expect(hoardCentre(r)).toBe('7/7');
  });

  it('the pill is a fresh 0/4 in the shop — deaths are combat-only, there is no run total to carry in', () => {
    expect(hoardPill(runWith('cindara'))).toBe('0/4');
  });

  it('the live Avenge tracker ticks through the REAL preview action and wraps at 4', () => {
    let s = runWith('cindara');
    const tick = (): void => { s = reduce(s, { type: 'combatFriendlyDeathPreview' }); };
    tick(); expect(hoardPill(s)).toBe('1/4');
    tick(); tick(); expect(hoardPill(s)).toBe('3/4');
    tick(); expect(hoardPill(s), 'the 4th death fires the Avenge and the display wraps').toBe('0/4');
    tick(); expect(hoardPill(s)).toBe('1/4');
  });

  it('settle retires the preview, so the next fight opens at 0/4 rather than leaking the last count', () => {
    // Driven through a REAL fight rather than a hand-built CombatResult, so the settle path actually runs and
    // the reset is proven where it lives, next to `fxSpellsCastPreview`.
    let s: RunState = {
      ...runWith('cindara'),
      board: [{ uid: 'a', cardId: 'b2_packstrider', attack: 4, health: 4, keywords: [], effects: [], buffs: [] }] as never,
      fxFriendlyDeathPreview: 3,
    };
    for (const a of [{ type: 'faceOmen' }, { type: 'resolveCombat' }, { type: 'settleCombat' }] as const) s = reduce(s, a);
    expect(s.fxFriendlyDeathPreview).toBeUndefined();
    expect(hoardPill(s)).toBe('0/4');
  });
});

describe('Vale — United Front centre', () => {
  it('shows the per-type grant, scaling with spells cast this game', () => {
    const r = runWith('vale');
    expect(valeCentre(r)).toBe('+0/+0');
    r.spellsCast = 5;
    expect(valeCentre(r)).toBe('+5/+5');
  });
});
