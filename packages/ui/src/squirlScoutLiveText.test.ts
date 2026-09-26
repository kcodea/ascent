import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatResult } from '@game/core';
import { createRun, deserialize, reduce, serialize, squirlScoutBuffLive, type Action, type RunState } from '@game/sim';
import { combatPreviewFold } from './runBuffs';
import { squirlScoutText } from './cardText';

/**
 * SQUIRL SCOUT'S PRINTED GRANT IS LIVE IN COMBAT (R-TEXT-11, owner 2026-09-26).
 *
 * Since R-REALTIME-03 a combat Squirl Scout Shout (Dawnclaw / Ryme, an Ancient of Time) improves the run-wide
 * snowball mid-fight, but the text read the frozen run value, so every Squirl Scout printed its start-of-fight
 * number until settle. The fight now logs the improve (`improve` with `scout`, player side), the replay folds it
 * (`combatPreviewFold.scout`), Recruit publishes the fold (`combatScoutPreview`), and BOTH text chains read
 * `squirlScoutBuffLive` (Unit.tsx in combat, liveCardText for hand / board). Display only: settle banks the real
 * growth through `playerShoutCarry.squirlScoutBuff` and clears the preview.
 */

const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 50, health: 40000 }];

/** Squirl Scouts beside Dawnclaw: Dawnclaw dies to the first swing and its Echo re-fires a neighbour's Shout. */
function scoutFight(): CombatResult {
  return simulate(
    [
      { cardId: 'squirlscout', attack: 1, health: 9999, sourceUid: 'S' },
      { cardId: 'b2_dawnclaw', attack: 1, health: 1, sourceUid: 'D' },
      { cardId: 'squirlscout', attack: 1, health: 9999, sourceUid: 'S2' },
    ],
    wall, makeRng(4), CARD_INDEX, combatSide({ tier: 6, squirlScoutBuff: 3 }), combatSide({ tier: 1 }),
  );
}

const runInCombat = (result: CombatResult): RunState => ({
  ...createRun(1), phase: 'combat', wave: 1, lastCombat: result, combatSettled: false, squirlScoutBuff: 3,
} as unknown as RunState);
const publish = (s: RunState, r: CombatResult, upto: number): RunState =>
  reduce(s, { type: 'combatScoutPreview', amount: combatPreviewFold(r.events, upto).scout } as Action);
/** What a Squirl Scout prints, read the way both text chains read it. */
const printed = (s: RunState): string => squirlScoutText('squirlscout', false, squirlScoutBuffLive(s)) ?? CARD_INDEX.squirlscout!.text;

describe('R-TEXT-11 — Squirl Scout prints its CURRENT grant as it grows mid-fight', () => {
  it('the fight really does grow the snowball', () => {
    const r = scoutFight();
    expect(r.playerShoutCarry?.squirlScoutBuff, 'no re-fire grew it: the fixture proves nothing').toBeGreaterThan(0);
    expect(combatPreviewFold(r.events, r.events.length).scout, 'the fold sees exactly what settle banks').toBe(r.playerShoutCarry!.squirlScoutBuff);
  });

  it('the printed number TICKS on the beat, and lands exactly where settle banks it', () => {
    const r = scoutFight();
    const base = runInCombat(r);
    const before = printed(base);
    const first = r.events.findIndex((e) => e.type === 'improve' && (e as { scout?: number }).scout);
    expect(first).toBeGreaterThan(0);
    expect(printed(publish(base, r, first)), 'not yet grown before the improve').toBe(before);
    const mid = printed(publish(base, r, first + 1));
    expect(mid, 'the first improve moved the printed grant').not.toBe(before);
    const step = 1; // Squirl Scout's printed improve
    expect(mid).toContain(`+${3 + step + step}/+${3 + step + step}`); // 3 banked + 1 grown + the next play's own +1
    const grown = r.playerShoutCarry!.squirlScoutBuff!;
    const live = printed(publish(base, r, r.events.length));
    expect(live).toContain(`+${3 + grown + step}/+${3 + grown + step}`);
    const settled = reduce(base, { type: 'settleCombat' } as Action);
    expect(printed(settled), 'the live value is not a UI invention').toBe(live);
    expect(settled.fxScoutPreview).toBeUndefined();
  });

  it('a fold, so re-publishing or resuming a save never double-counts', () => {
    const r = scoutFight();
    const once = publish(runInCombat(r), r, r.events.length);
    expect(squirlScoutBuffLive(publish(once, r, r.events.length))).toBe(squirlScoutBuffLive(once));
    expect(deserialize(serialize(once)).fxScoutPreview).toBeUndefined();
  });

  it("an enemy Squirl Scout's growth never moves the player's number", () => {
    const r = simulate(wall, [{ cardId: 'squirlscout', attack: 1, health: 9999 }, { cardId: 'b2_dawnclaw', attack: 1, health: 1 }],
      makeRng(4), CARD_INDEX, combatSide({ tier: 1 }), combatSide({ tier: 6 }));
    expect(r.events.some((e) => e.type === 'improve')).toBe(true);
    expect(combatPreviewFold(r.events, r.events.length).scout).toBe(0);
  });

  it('both text chains read the live value (Unit.tsx in combat, the Recruit liveCardText callers)', () => {
    const read = (f: string): string => fs.readFileSync(path.join(__dirname, f), 'utf8');
    for (const f of ['Unit.tsx', 'Recruit.tsx']) {
      const src = read(f);
      expect(/squirlScoutBuff: (foe \? 0 : )?run\.squirlScoutBuff\b/.test(src), `${f} prints the frozen snowball`).toBe(false);
      expect(src.includes('squirlScoutBuffLive(run)'), `${f} reads the live snowball`).toBe(true);
    }
  });
});
