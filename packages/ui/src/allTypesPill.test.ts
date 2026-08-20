import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { CARD_INDEX } from '@game/content';

/**
 * "ALL TYPES" cards must never print their data tribe (owner report 2026-08-20: Lab Experiment, Paragon and
 * Standard Bearer read "Neutral"). They carry `tribe: 'neutral'` in DATA but count as every tribe, so showing
 * NEUTRAL says the opposite of what the card does — it reads as taking no tribal buffs at all.
 *
 * The pill logic in `Card.tsx` was always right; SIX CardView builders simply dropped the flag on the way in
 * (the Compendium, Career, Leaderboard, quest- and rune-reward previews, the sandbox editor). The fix derives
 * it from the CARD DEF inside `Card`, so a projection that forgets still renders ALL — which is what this
 * test guards: the DEFS are the source of truth, so any surface reading them is correct by construction.
 */
describe('the "All types" cards are flagged in DATA', () => {
  const universal = Object.values(CARD_INDEX).filter((c) => (c as { universalTribe?: boolean }).universalTribe);

  it('the known All-type cards all carry `universalTribe`', () => {
    const ids = new Set(universal.map((c) => c.id));
    for (const id of ['labexperiment', 'n2_paragon', 'n2_standardbearer']) {
      expect(ids.has(id), `${id} must be flagged universalTribe or its pill prints its data tribe`).toBe(true);
    }
  });

  it('and none of them RESTATE it in their text — the pill already says it', () => {
    // Owner ruling 2026-08-20: the "Counts as all tribes." clause is redundant beside an ALL pill, and it was
    // eating a line of rules text on every one of these cards. The ANOMALY REACTOR spell is deliberately
    // exempt (it GRANTS the state to a target, and a spell has no tribe pill to say it for them).
    for (const c of universal) {
      expect(c.text ?? '', `${c.id} restates its own pill`).not.toMatch(/counts as all tribes/i);
      expect(c.goldenText ?? '', `${c.id} (golden) restates its own pill`).not.toMatch(/counts as all tribes/i);
    }
  });

  it('every All-type card would be misread without the flag — they are all `neutral` in data', () => {
    // This is WHY the pill matters: without it these read as Neutral, the one label that implies the opposite.
    for (const c of universal) expect(c.tribe, `${c.id}`).toBe('neutral');
  });
});

/**
 * The RUNE-ONLY minion batch (owner add 2026-08-20) — authored ahead of its art, exactly like the Set 3
 * scaffold below. Listed by id rather than matched by a prefix because these are spread across five tribe
 * files and share no naming convention; an explicit list is also the thing that shrinks as art lands, so the
 * exclusion can't quietly outlive the reason for it. Delete an entry the moment its art is wired.
 */
const ART_PENDING = new Set([
  'n2_deepchef', 'k_gemsage', 'n2_wanderer', 'n2_clockwork', 'dm_nightmarket', 'n2_muckslinger',
  'n2_salesman', 'dw_kegheart', 'n2_ninefold', 'n2_echomimic', 'n2_muster', 'n2_trooper',
  'b2_stonehorn', 'd2_ascendant', 'n2_abomination', 'dm_behemoth',
]);

describe('art coverage for live cards', () => {
  it('every non-token live card has art (Set 3 scaffold + the 2026-08-20 rune batch excluded — not shipped yet)', () => {
    const wired = (d: string) => (existsSync(d) ? new Set(readdirSync(d).map((f) => f.replace(/\.(webp|png|jpe?g)$/i, ''))) : new Set<string>());
    const minions = wired('packages/ui/src/art/minions');
    const spells = wired('packages/ui/src/art/spells');
    const missing = Object.values(CARD_INDEX)
      .filter((c) => !c.id.startsWith('c3_') && !c.id.startsWith('hm_test_') && !ART_PENDING.has(c.id))
      .filter((c) => !minions.has(c.id) && !spells.has(c.id))
      .map((c) => `${c.id} (${c.name})`);
    expect(missing, `these live cards render the tribe-sprite fallback instead of their art`).toEqual([]);
  });
});
