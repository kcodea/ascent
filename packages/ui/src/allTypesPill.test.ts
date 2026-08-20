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

  it('every All-type card would be misread without the flag — they are all `neutral` in data', () => {
    // This is WHY the pill matters: without it these read as Neutral, the one label that implies the opposite.
    for (const c of universal) expect(c.tribe, `${c.id}`).toBe('neutral');
  });
});

describe('art coverage for live cards', () => {
  it('every non-token live card has art (Set 3 scaffold excluded — not shipped yet)', () => {
    const wired = (d: string) => (existsSync(d) ? new Set(readdirSync(d).map((f) => f.replace(/\.(webp|png|jpe?g)$/i, ''))) : new Set<string>());
    const minions = wired('packages/ui/src/art/minions');
    const spells = wired('packages/ui/src/art/spells');
    const missing = Object.values(CARD_INDEX)
      .filter((c) => !c.id.startsWith('c3_') && !c.id.startsWith('hm_test_'))
      .filter((c) => !minions.has(c.id) && !spells.has(c.id))
      .map((c) => `${c.id} (${c.name})`);
    expect(missing, `these live cards render the tribe-sprite fallback instead of their art`).toEqual([]);
  });
});
