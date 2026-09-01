import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRun, heroPowerText, type RunState } from '../index';

/**
 * DOC BOT LANE `heroPowerLiveInCombat` — a hero-power counter that COMBAT advances must advance ON SCREEN
 * during combat.
 *
 * ── The bug (owner report 2026-08-31) ─────────────────────────────────────────────────────────────────────
 *
 *   *"gorun's hero power x/8 doesn't update in real time in combat ... real-time text updating is our
 *    standard across the board."*
 *
 * Gorun's Blade Mastery improves every 8 attacks, and its printed "improves in N attacks" is fed by
 * `RunState.bladeAttacks` — which is BANKED AT SETTLE. So the number was frozen for the whole fight and then
 * jumped afterwards, which is precisely the stretch a player is watching it.
 *
 * ── Why this is a CLASS, not one card ─────────────────────────────────────────────────────────────────────
 *
 * The repo's live-text rule ("card text ALWAYS shows the CURRENT value") is enforced for CARDS by several
 * lanes. Hero powers print live magnitudes too, and their run-state counters have a second failure mode cards
 * mostly don't: a value the SIMULATOR tracks per-fight and only writes back at settle. The text is correct in
 * the shop and stale in combat, so any check that only ever looks at a shop state passes.
 *
 * So this lane drives the text with a live combat tally and demands it MOVE.
 */
const RECRUIT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../recruit.ts'), 'utf8');

/** A run whose hero is the one under test. `createRun` pins the rest; only the power matters here. */
const gorunRun = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(3, 'gorun'), ...over } as RunState);

describe('Doc Bot — a combat-driven hero-power counter reads live', () => {
  it('fixture floor: Gorun prints an attack countdown at all', () => {
    const t = heroPowerText(gorunRun());
    expect(t, `Gorun's power text should mention attacks: ${t}`).toMatch(/attack/i);
  });

  it("Gorun's countdown moves with attacks made THIS FIGHT", () => {
    // The regression, stated directly: the same run state, with and without a live combat tally, must not
    // print the same thing.
    const run = gorunRun({ bladeAttacks: 0 });
    const shop = heroPowerText(run);
    const midFight = heroPowerText(run, 0, { attacks: 3 });
    expect(midFight, 'the counter must advance during the fight, not only at settle').not.toBe(shop);
  });

  it('and it crosses its threshold live, exactly as the simulator does', () => {
    // 8 attacks is a step. The GRANT itself must grow mid-fight too, not just the countdown — the simulator
    // computes `mods.bladeMastery.attacks + attacks so far`, and the text has to make the same sum.
    const run = gorunRun({ bladeAttacks: 0 });
    expect(heroPowerText(run, 0, { attacks: 0 })).toContain('+3 Attack');
    expect(heroPowerText(run, 0, { attacks: 8 }), 'past the 8th attack the grant is +6').toContain('+6 Attack');
  });

  it('the banked count and the live one ADD, rather than one replacing the other', () => {
    // A fight that starts with 6 banked and makes 2 more is at a step boundary. Reading either half alone
    // gets this wrong in a way that only shows up mid-run.
    const run = gorunRun({ bladeAttacks: 6 });
    expect(heroPowerText(run, 0, { attacks: 2 }), '6 + 2 = 8 → the grant has stepped').toContain('+6 Attack');
  });

  it('the text helper still takes NO live tally by default, so shop callers are unchanged', () => {
    // The third parameter is optional on purpose: every existing caller passes two arguments.
    expect(/export function heroPowerText\(state: RunState, which = 0, live: HeroPowerLive = \{\}\)/.test(RECRUIT),
      'the live argument must stay optional').toBe(true);
  });
});
