import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatResult } from '@game/core';
import {
  createRun, reduce, spellAttackBonusLive, spellHealthBonusLive, spellEscalationLive, spellDisplayText,
  type Action, type RunState,
} from '@game/sim';
import { combatBuffDelta } from './runBuffs';

/**
 * LIVE SPELL TEXT DURING COMBAT (owner report 2026-09-22: "front to backs text / maybe all spells? not
 * updating in real time from buffs in combat", and "rune of adventuring should affect the # shown for spell
 * buffs too, since it re-triggers things like chorus drake etc.").
 *
 * The rule: a spell's printed number must show what it would ACTUALLY cast for right now, at every moment of
 * the fight, and must land on exactly the number settle banks. `simulate` keeps its own spell power and its
 * own escalation step live inside the combat, but the RUN only learns the totals at settle, so every surface
 * reading the raw run counters printed a pre-combat number for the whole fight.
 *
 * The UI computes nothing here: both numbers are DERIVED from narrations the simulator already emits, and the
 * only new logic is the display-only fold. This file pins the derivation end to end (ticks live, equals
 * settle) and, separately, that no card-text surface quietly goes back to the raw counters.
 */

const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 40000 }];

/** Quil (casts the left-most held spell at Start of Combat) beside two Beasts, holding Front to Back. */
function escalationFight(): CombatResult {
  return simulate(
    [
      { cardId: 'stray', attack: 1, health: 400, sourceUid: 'L' },
      { cardId: 'b2_quil', attack: 7, health: 400, sourceUid: 'Q' },
      { cardId: 'stray', attack: 1, health: 400, sourceUid: 'R' },
    ],
    wall, makeRng(5), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['beast'], handSpellIds: ['fronttoback'] }),
    combatSide({ tier: 1 }),
  );
}

/** Chorus Drake alone against a wall. Its Rally pumps Shop-spell Health once per attack. */
function spellPowerFight(mods: object = {}): CombatResult {
  return simulate(
    [{ cardId: 'd2_chorus', attack: 3, health: 4000, sourceUid: 'D' }],
    wall, makeRng(5), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['dragon'], handSpellIds: ['fronttoback'], questMods: mods as never }),
    combatSide({ tier: 1 }),
  );
}

/** A run parked in combat on `result`, with a Front to Back in hand: the surface the owner was looking at. */
function runInCombat(result: CombatResult): RunState {
  return {
    ...createRun(1), phase: 'combat', wave: 1, lastCombat: result, combatSettled: false,
    hand: [{ uid: 'h1', cardId: 'fronttoback', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
  } as unknown as RunState;
}

/** What a Front to Back in hand PRINTS, read the way every card-text surface reads it. */
const printed = (s: RunState): string =>
  spellDisplayText('fronttoback', spellAttackBonusLive(s), spellEscalationLive(s).attack,
    spellHealthBonusLive(s), 0, spellEscalationLive(s).health);

/** The replay's escalation channel: one dispatch per "<spell> improves +A/+H" narration, player side. */
function replayEscalation(s: RunState, result: CombatResult, upto: number): RunState {
  let next = s;
  for (let i = 0; i < Math.min(upto, result.events.length); i++) {
    const e = result.events[i]!;
    if (e.type !== 'sc' || !e.text || e.side !== 'player') continue;
    const m = /improves \+(\d+)\/\+(\d+)$/.exec(e.text);
    if (!m) continue;
    next = reduce(next, { type: 'combatEscalationPreview', attack: Number(m[1]), health: Number(m[2]) } as Action);
  }
  return next;
}

/** The replay's spell-power channel: the absolute FOLD over the events played so far. */
function replaySpellPower(s: RunState, result: CombatResult, upto: number): RunState {
  const d = combatBuffDelta(result.events, upto);
  return reduce(s, { type: 'combatSpellPowerPreview', attack: d.spellAttack, health: d.spellHealth } as Action);
}

const settle = (s: RunState): RunState => reduce(s, { type: 'settleCombat' } as Action);

describe('live spell text in combat: Front to Back escalating mid-fight (owner report A)', () => {
  it('the simulator really does escalate the spell inside the fight', () => {
    const r = escalationFight();
    expect(r.playerSpellEscalationGain, 'nothing escalated, so the fixture stopped exercising the bug').toBeTruthy();
    expect(r.playerSpellEscalationGain!.attack).toBeGreaterThan(0);
  });

  it('the printed value TICKS as the fight plays, and lands exactly where settle banks it', () => {
    const r = escalationFight();
    const base = runInCombat(r);
    const before = printed(base);

    // Half way through the log the number has already moved, which is the whole point of the report.
    const mid = printed(replayEscalation(base, r, Math.floor(r.events.length / 2)));
    const end = replayEscalation(base, r, r.events.length);
    const live = printed(end);
    expect(live, 'the printed value never moved during the fight').not.toBe(before);
    expect(mid === before && mid === live, 'the value jumped at the end instead of ticking').toBe(false);

    // It is not a UI invention: settling the same fight prints the same thing.
    const settled = settle(base);
    expect(printed(settled)).toBe(live);
    // The preview retires at settle, so the real carry-back can never be counted twice.
    expect(settled.fxEscalationPreview).toBeUndefined();
  });
});

describe('live spell text in combat: spell power gained mid-fight (owner report A, "maybe all spells?")', () => {
  it('the printed value TICKS as Chorus Drake pumps it, and lands exactly where settle banks it', () => {
    const r = spellPowerFight();
    expect(r.playerSpellPower!.health, 'the fixture gained no spell power').toBeGreaterThan(0);
    const base = runInCombat(r);
    const before = printed(base);

    const half = printed(replaySpellPower(base, r, Math.floor(r.events.length / 2)));
    const live = printed(replaySpellPower(base, r, r.events.length));
    expect(live, 'spell power never reached the printed number').not.toBe(before);
    expect(half === before && half === live, 'the value jumped at the end instead of ticking').toBe(false);

    const settled = settle(base);
    expect(printed(settled)).toBe(live);
    expect(settled.fxSpellPowerPreview).toBeUndefined();
  });

  it('the fold is ABSOLUTE, so scrubbing or re-playing a beat cannot double-count', () => {
    const r = spellPowerFight();
    const base = runInCombat(r);
    const once = replaySpellPower(base, r, r.events.length);
    const again = replaySpellPower(once, r, r.events.length); // the same beat published twice
    expect(spellHealthBonusLive(again)).toBe(spellHealthBonusLive(once));
    // Rewinding goes back DOWN rather than staying at the high-water mark.
    const rewound = replaySpellPower(once, r, 0);
    expect(spellHealthBonusLive(rewound)).toBe(spellHealthBonusLive(base));
  });

  it('display only: the preview never touches the run counter the cast math reads', () => {
    const r = spellPowerFight();
    const live = replaySpellPower(runInCombat(r), r, r.events.length);
    expect(live.spellBonus?.health ?? 0).toBe(0); // the REAL bonus is still untouched mid-fight
    expect(spellHealthBonusLive(live)).toBeGreaterThan(0); // while the DISPLAY value has moved
  });
});

describe('Rune of Adventuring doubles the number the spell PRINTS (owner report B)', () => {
  it('the simulation already doubles: a Rally that casts fires twice', () => {
    const plain = spellPowerFight();
    const doubled = spellPowerFight({ rallyExtraAlways: 1 });
    expect(doubled.playerRallies).toBe((plain.playerRallies ?? 0) * 2);
    expect(doubled.playerSpellPower!.health).toBe(plain.playerSpellPower!.health * 2);
  });

  it('and so does the printed value, because it is derived from the same narrations', () => {
    const plain = spellPowerFight();
    const doubled = spellPowerFight({ rallyExtraAlways: 1 });
    const live = (r: CombatResult): number =>
      spellHealthBonusLive(replaySpellPower(runInCombat(r), r, r.events.length));
    expect(live(doubled)).toBe(live(plain) * 2);
    // Landing on what settle banks, under the rune as well as without it.
    expect(spellHealthBonusLive(settle(runInCombat(doubled)))).toBe(live(doubled));
  });
});

describe('no card-text surface may go back to the raw run counters', () => {
  // The silent failure mode: the derivation is right, and one surface (or one hand-maintained useMemo dep
  // array) keeps reading `run.frontToBackBonus` / `spellAttackBonus(run)`. That reviews clean and does
  // nothing in play, which is exactly how the owner's report survived the previous live-text passes.
  const read = (f: string): string => fs.readFileSync(path.join(__dirname, f), 'utf8');

  it('Recruit.tsx and Unit.tsx read the Live accessors, never the raw counters', () => {
    for (const f of ['Recruit.tsx', 'Unit.tsx']) {
      const src = read(f);
      expect(src.includes('run.frontToBackBonus'), `${f} still reads the raw escalation counter`).toBe(false);
      expect(/[^a-zA-Z]spellAttackBonus\(/.test(src), `${f} still reads the raw spell-power bonus`).toBe(false);
      expect(/[^a-zA-Z]spellHealthBonus\(/.test(src), `${f} still reads the raw spell-power bonus`).toBe(false);
    }
  });

  it('every useMemo that prints a card carries the live escalation scalars in its deps', () => {
    // `ftbBonus` / `ftbBonusH` are values, not run fields, so a dep array that dropped them would simply
    // never recompute. Count the uses against the dep mentions rather than trusting review.
    const src = read('Recruit.tsx');
    expect((src.match(/\bftbBonus\b/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect((src.match(/\bftbBonusH\b/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
