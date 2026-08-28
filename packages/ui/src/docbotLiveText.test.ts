/**
 * DOC BOT LANE `docbotLiveText` — a dual-stat scaling card's LIVE text keeps BOTH halves of its grant.
 *
 * The hard rule (CLAUDE.md, owner rulings 2026-07-02 / 07-08): a scaling card prints the number it will
 * really produce. The failure mode this file exists for is SUBTLER than a missing helper — a helper that
 * exists but renders only half the grant. Kringle shipped exactly that (owner report 2026-08-26): authored
 * as "+1 Attack per card", rebalanced twice to "+1/+2 per card", and `perCardPlayedText` never grew a Health
 * term — so the moment you played a card, the accurate printed "+1/+2" was REPLACED by "+N Attack" and the
 * Health half vanished from the card. Its own test asserted the buggy string, so nothing caught it.
 *
 * This test cannot be satisfied by pinning strings, because it re-derives its worklist on every run:
 *   1. read `cardText.ts` and collect every factory id the live-text chain keys on;
 *   2. keep the ones whose CONTENT params grant both Attack AND Health;
 *   3. drive every user card through the real `liveCardText` chain under a rich all-scalers-hot bag;
 *   4. demand (a) every such factory ENGAGES — the bag really exercises it — and (b) every replacement text
 *      still carries both halves (a `+A/+H` pair, or Attack and Health both named).
 * A new scaling card with a half-blind helper fails (b); a helper the bag can't reach fails (a) instead of
 * silently passing — the instrument refuses to claim coverage it didn't achieve (tallyCoverage's lesson).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX } from '@game/content';
import { liveCardText, type LiveTextParams } from './instView';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Factories the live-text chain keys on (from source), narrowed to the ones content uses with BOTH stats. */
function dualStatHelperFactories(): Map<string, string[]> {
  const src = readFileSync(join(HERE, 'cardText.ts'), 'utf8');
  const referenced = new Set([...src.matchAll(/e\.do === '([a-zA-Z0-9_]+)'/g)].map((m) => m[1]!));
  const out = new Map<string, string[]>();
  for (const f of referenced) {
    const users = Object.values(CARD_INDEX).filter((c) =>
      c?.effects.some((e) => e.do === f
        && typeof (e.params?.attack) === 'number' && (e.params.attack as number) > 0
        && typeof (e.params?.health) === 'number' && (e.params.health as number) > 0));
    if (users.length) out.set(f, users.map((c) => c!.id));
  }
  return out;
}

/** Every scaler hot, every counter mid-run — so each helper has something live to fold in. Values are chosen
 *  to be distinctive (nothing 0/1) so a folded number visibly differs from the printed base. */
const RICH: LiveTextParams = {
  tier: 5, golden: false,
  spellBonus: 2, spellBonusH: 3, frontToBackBonus: 2, frontToBackBonusH: 2, growthBonus: 2,
  spellsThisTurn: 3, spellsCast: 7, deathrattlesTriggered: 5, rubyCasts: 4, improveReps: 1,
  clingEnchant: { attack: 2, health: 3 }, fodderConsumed: { attack: 2, health: 2 },
  undeadBuyAtk: 2, soulsmanGold: 6,
  cardBuffs: {}, impAura: { attack: 2, health: 3 },
  spellProgress: 5, /* past Runescale's every-4 improve step */ ascendProgress: 2, summonBonus: 2, overflowBonus: 2, hpGrantBonus: 2,
  eotTick: 2, eotBonus: 2, sellBonus: 2, soldProgress: 2,
  playedThisTurn: ['alley', 'alley', 'alley'], attackSeen: 9, permaGain: { attack: 2, health: 2 },
  squirlScoutBuff: 3, conductorBuff: 3, onBoard: false,
  goldSpent: 6, goldSpentRun: 12, goldPouchValue: 2,
  alesThisTurn: 2, zooSummons: 2, rallySpreadAtk: 5,
  rubyBonus: { attack: 2, health: 2 },
};

/** Both halves present: a `+A/+H` pair, or Attack and Health both named in the live portion. */
const bothHalves = (text: string): boolean =>
  /\+\d+\s*\/\s*\+\d+/.test(text) || (/Attack/i.test(text) && /Health/i.test(text));

describe('Doc Bot — dual-stat live text keeps both halves', () => {
  const factories = dualStatHelperFactories();

  it('found a real worklist (the derivation itself must not silently go blind)', () => {
    // 17 as of 2026-08-26. If refactoring cardText.ts changes how helpers key on factories, this floor makes
    // the scan fail loudly instead of the suite passing over an empty list.
    expect(factories.size).toBeGreaterThanOrEqual(15);
  });

  it('every dual-stat helper ENGAGES under the rich bag, and every replacement keeps both halves', () => {
    const neverEngaged: string[] = [];
    const halfBlind: string[] = [];
    for (const [factory, users] of factories) {
      let engaged = false;
      for (const id of users) {
        const def = CARD_INDEX[id]!;
        for (const golden of [false, true] as const) {
          const { text, goldenText } = liveCardText(id, { ...RICH, golden });
          const base = golden ? (def.goldenText ?? def.text) : def.text;
          const live = golden ? (goldenText ?? text) : text;
          if (live === base) continue; // helper didn't fire for this card/variant
          engaged = true;
          if (bothHalves(base) && !bothHalves(live)) {
            halfBlind.push(`${id} (${factory}${golden ? ', golden' : ''}): printed "${base}" → live "${live}" — the live text DROPPED a stat half (the Kringle bug)`);
          }
        }
      }
      if (!engaged) neverEngaged.push(`${factory} (users: ${users.join(', ')})`);
    }
    expect(halfBlind, halfBlind.join('\n')).toEqual([]);
    expect(neverEngaged, `Helper(s) never engaged under the rich bag — enrich RICH in this file until they fire (coverage must be real, not assumed):\n  ${neverEngaged.join('\n  ')}`).toEqual([]);
  });
});
