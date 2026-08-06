import { describe, it, expect } from 'vitest';
import type { CombatSideState } from '@game/core';
import { createRun, type RunState } from './state';
import { reduce } from './reducer';
import { snapshotBoard } from './snapshot';
import { sideFromSnapshot } from './boardSide';

/**
 * SNAPSHOT FIDELITY — a served board must fight with the run context its OWNER had.
 *
 * The ground truth for "the run context a board fights with" is the player-side `CombatSideState` the
 * reducer assembles at End Turn. This test stages ONE RunState with every scaler set to a distinctive
 * non-default value, captures that state's player-side context via the reducer itself (`faceOmen` stashes it
 * in `lastCombat.oddsInput`), and diffs it — field by field, over the REAL key set — against the context a
 * snapshot of the same state reconstitutes (`snapshotBoard` → `sideFromSnapshot`).
 *
 * The point of iterating the actual keys: a NEW scaler added to the reducer's builder shows up here
 * automatically and fails until it is captured in `snapshotBoard`, threaded in `sideFromSnapshot`, and — if
 * genuinely player-only — added to the documented exclusion list. That is the guard the 2026-08-06 audit
 * bought (owner report: a served Rune of Gemstorm played 1/1 Rubies because the board's +16/+16 `rubyBonus`
 * never travelled; seven more scalers turned out to be dropped the same way).
 */

/** Fields the snapshot deliberately does NOT reproduce — each with the reason it is player-only. */
const EXCLUDED: Record<string, string> = {
  poolIds: 'both sides draw from the LIVE run\'s pinned pool by design (see sideFromSnapshot\'s doc)',
  pendingQuests: 'mid-combat quest completion is the live player\'s own UI arc — a served board\'s quests are already-active mods',
};

const staged = (): RunState => ({
  ...createRun(7, 'drakko'),
  phase: 'recruit',
  embers: 0,
  shop: [],
  tier: 4,
  board: [
    { uid: 'a', cardId: 'gnash', tribe: 'beast', attack: 6, health: 6, keywords: [], golden: false },
    { uid: 'b', cardId: 'alley', tribe: 'beast', attack: 2, health: 4, keywords: [], golden: false },
  ],
  hand: [
    { uid: 'h1', cardId: 'growth', tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false },
    { uid: 'h2', cardId: 'stray', tribe: 'beast', attack: 4, health: 5, keywords: ['T'], golden: true },
  ],
  // Every run-level scaler the reducer threads, at a distinctive value so a dropped field cannot pass by
  // coinciding with a default.
  spellsThisTurn: 3,
  spellsCast: 17,
  deathrattlesTriggered: 5,
  spellBonus: { attack: 2, health: 3 },
  undeadAttackBonus: 4,
  undeadHealthBonus: 2,
  undeadBuyAtk: 1,
  impBuff: { attack: 2, health: 1 },
  fodderConsumedThisTurn: { attack: 3, health: 3 },
  beastBuyAtk: 2,
  playedThisTurn: ['gnash', 'stray'],
  cardsBoughtThisTurn: 4,
  magneticBuyAtk: 1,
  magneticBuyHp: 2,
  rubyBonus: { attack: 16, health: 16 }, // the owner's reported case, verbatim
  runeWildHuntGrown: 6,
  cardBuffs: { whelpling: { attack: 2, health: 2 } },
  beastHuntExtra: 1,
  beastRitualExtra: 1,
} as RunState);

describe('a served snapshot reconstitutes the OWNER\'s full combat context', () => {
  it('field-for-field against the reducer\'s own player-side builder (new fields fail until threaded)', () => {
    const s = staged();
    // Ground truth: what the reducer says this state fights with, straight out of its own builder.
    const player = reduce(s, { type: 'faceOmen' }).lastCombat!.oddsInput!.playerState;
    // The round trip: capture the SAME state, rebuild the side a future run would fight against.
    const rebuilt = sideFromSnapshot(snapshotBoard(s), s.tier, player.poolIds ? [...player.poolIds] : []);

    const mismatches: string[] = [];
    for (const key of Object.keys(player) as (keyof CombatSideState)[]) {
      if (key in EXCLUDED) continue;
      const a = player[key];
      const b = rebuilt[key];
      // Normalise undefined vs the builder's zero-defaults: combatSide() fills 0/[]/{} where the reducer may
      // pass undefined (and vice versa) — a missing OPTIONAL field equal to its neutral value is not a drop.
      const neutral = (v: unknown): boolean =>
        v === undefined || v === 0 || v === false
        || (Array.isArray(v) && v.length === 0)
        || (typeof v === 'object' && v !== null && Object.keys(v).length === 0);
      if (neutral(a) && neutral(b)) continue;
      if (JSON.stringify(a) !== JSON.stringify(b)) mismatches.push(`${key}: player=${JSON.stringify(a)} rebuilt=${JSON.stringify(b)}`);
    }
    expect(mismatches, 'scalers dropped between capture and rebuild:\n' + mismatches.join('\n')).toEqual([]);
  });

  it('the reported case end-to-end: a +16/+16 run\'s Gemstorm Rubies survive the round trip', () => {
    const snap = snapshotBoard(staged());
    expect(snap.rubyBonus, 'the Ruby strength travelled').toEqual({ attack: 16, health: 16 });
    const side = sideFromSnapshot(snap, 4, []);
    expect(side.rubyBonus, 'and reconstitutes on the enemy side').toEqual({ attack: 16, health: 16 });
  });
});
