import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import type { RunState } from '@game/sim';
import { summonBuffText } from './cardText';
import { gatherRunBuffs } from './runBuffs';

/**
 * TWO REPORTS FROM 2026-08-04.
 *
 * **1. "Thunderous Sovereign's buff is wrong — it must be splitting the stats amongst all dragons."**
 *
 * It was never splitting: every Dragon always got the full grant. What was wrong is that `scBeastAura` had no
 * golden multiplier, while `summonBuffText` — the number PRINTED on the card — has always doubled for golden.
 * So a golden Sovereign advertised twice what it granted, and "the stats are being split" is a very reasonable
 * reading of a card that promises +6/+6 to your Dragons and hands out +3/+3.
 *
 * The text matched the design (Pack Leader's `scTribeBuffImproving` doubles `(base + accrual)`, and both cards
 * carry a "golden doubles both" comment). The factory was the liar. The load-bearing test is therefore not
 * "golden gives 2×" in isolation — it is that the PRINTED number and the GRANTED number are the same number.
 *
 * **2. "Ruby buffs aren't currently shown in the buff drawer."**
 *
 * `gatherRunBuffs` listed twelve run-wide auras and no Ruby row, so `rubyBonus` — the single most important
 * scaler on a Ruby-engine board — was invisible in the one window built to show run-wide buffs.
 */

const bm = (cardId: string, attack: number, health: number, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, ...over } as BoardMinion);

/** What the aura actually grants each tribe member, read off the combat log. */
const grantOf = (cardId: string, golden: boolean, summonBonus: number): { attack: number; health: number } => {
  const player = [
    bm(cardId, 8, 8, { golden, summonBonus }),
    bm('d2_curator', 4, 4), // a Dragon
    bm('pack', 2, 2),       // a Beast
  ];
  const r = simulate(player, [bm('sandbag', 1, 9999)], makeRng(3), CARD_INDEX,
    combatSide({ tier: 6 }), combatSide({ tier: 6 }));
  const first = r.events.find((e) => e.type === 'buff' && (e as { source?: string }).source === 'm0');
  const e = first as unknown as { attack: number; health: number } | undefined;
  return { attack: e?.attack ?? 0, health: e?.health ?? 0 };
};

describe('a Start-of-Combat tribe aura grants what its card prints', () => {
  it('Thunderous Sovereign: golden grants DOUBLE, not the plain amount', () => {
    const plain = grantOf('d2_sovereign', false, 3);
    const golden = grantOf('d2_sovereign', true, 3);
    // Step is +2/+2 per cast since the 2026-08-07 balance change: base 1 + 3 casts x 2 = 7; golden doubles
    // the WHOLE grant (base and accrual), so 14.
    expect(plain, 'base 1 + 3 accrued at +2/+2 each').toEqual({ attack: 7, health: 7 });
    expect(golden, 'the golden grant was identical to the plain one — the reported bug').toEqual({ attack: 14, health: 14 });
  });

  it('the PRINTED number equals the GRANTED number — the actual contract', () => {
    // `summonBuffText` injects the live magnitude into the card text as `{{N}}`. Whatever it prints, the
    // aura must hand out. Checked across accruals and both gildings, since the mismatch only showed on golden.
    for (const [cardId, tribeMate] of [['d2_sovereign', 'd2_curator'], ['kennel', 'pack']] as const) {
      void tribeMate;
      for (const golden of [false, true]) {
        for (const bonus of [1, 3, 5]) {
          const printed = summonBuffText(cardId, bonus, golden);
          const n = Number(/\{\{\+?(\d+)/.exec(printed ?? '')?.[1]);
          expect(Number.isFinite(n), `${cardId} printed no live number for bonus ${bonus}`).toBe(true);
          const granted = grantOf(cardId, golden, bonus);
          // Kennelmaster is Attack-only (stepHealth 0), so Attack is the stat both agree on.
          expect(granted.attack, `${cardId} golden=${golden} bonus=${bonus}: prints ${n}, grants ${granted.attack}`)
            .toBe(n);
        }
      }
    }
  });

  it('every tribe member gets the FULL grant — it is not divided among them', () => {
    // The owner's actual hypothesis, pinned so it can never become true.
    const player = [
      bm('d2_sovereign', 8, 8, { summonBonus: 3 }),
      bm('d2_curator', 4, 4), bm('d2_broodwhelp', 2, 2), bm('d2_archivist', 5, 5),
    ];
    const r = simulate(player, [bm('sandbag', 1, 9999)], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const buffs = r.events.filter((e) => e.type === 'buff' && (e as { source?: string }).source === 'm0')
      .map((e) => (e as unknown as { attack: number }).attack);
    expect(buffs.length, 'all four Dragons should be buffed').toBe(4);
    expect(new Set(buffs).size, 'the Dragons got DIFFERENT amounts — that would be a split').toBe(1);
    expect(buffs[0], 'base 1 + 3 accrued at +2/+2 each').toBe(7);
  });
});

describe('the Buffs window shows Ruby power', () => {
  // `gatherRunBuffs` walks the board for aura sources, so the fixture needs the collections it reads —
  // an empty object throws before it ever reaches the Ruby row.
  const run = (over: Partial<RunState>): RunState =>
    ({ board: [], hand: [], shop: [], ...over } as unknown as RunState);

  it('lists the run-wide Ruby bonus', () => {
    const rows = gatherRunBuffs(run({ rubyBonus: { attack: 2, health: 3 } }));
    expect(rows.find((r) => r.key === 'ruby')).toMatchObject({ label: 'Ruby power', value: '+2/+3' });
  });

  it('stays absent when no Ruby bonus is in play', () => {
    expect(gatherRunBuffs(run({})).find((r) => r.key === 'ruby')).toBeUndefined();
    expect(gatherRunBuffs(run({ rubyBonus: { attack: 0, health: 0 } })).find((r) => r.key === 'ruby')).toBeUndefined();
  });

  it('shows a one-sided bonus rather than hiding it', () => {
    expect(gatherRunBuffs(run({ rubyBonus: { attack: 0, health: 4 } })).find((r) => r.key === 'ruby')?.value)
      .toBe('+0/+4');
  });
});
