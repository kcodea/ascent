/**
 * DOC BOT LANE `spellPowerFolding` — every stat-spell factory folds spell power, or says why not.
 *
 * History: #817 "Ales fold spell power — the last two stat-spell factories that skipped it" (this scan says
 * they weren't the last), #731 "spell power on Hoardflame + Lantern Light". The pattern: the `spellBuff*`
 * family plus the stat extras are all supposed to add `spellAttackBonus`/`spellHealthBonus` to their grant —
 * each fix hand-audited the family, and each new member re-opened the hole.
 *
 * The scan slices every matching factory body out of `RECRUIT_FACTORIES`' source and requires a spell-power
 * reference — or an entry in `SPELL_POWER_EXCUSED` with a reason (Apples' two options are DOCUMENTED flat;
 * two Ruby-channel factories are needs-triage awaiting a ruling). Source-heuristic by design: it cannot prove
 * the fold is arithmetically right, but the shipped bugs were all "no fold at all", which it sees exactly.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPELL_POWER_EXCUSED } from './historyRegistry';

const SIM = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The stat-spell family: the shared `isStatSpell` prefix rule + its extras (see recruit.ts). */
const isStatFamily = (name: string): boolean => name.startsWith('spellBuff') || name === 'rubyStatGain' || name === 'spellAverageStats'
  // Great Pot's factory: a stat-granting cast whose name slips the `spellBuff*` prefix — it shipped flat and
  // became bug a17a48ab (Bug Board round 1). Listed as an extra so the lane holds its fold from now on.
  || name === 'buffOnePerTribe';

describe('Doc Bot — stat spells fold spell power', () => {
  const src = readFileSync(join(SIM, 'recruit.ts'), 'utf8');
  const entries = [...src.matchAll(/\n  ([a-zA-Z0-9_]+): \(ctx/g)].map((m) => ({ name: m[1]!, start: m.index! }));

  it('found the family (18 stat-spell factories as of 2026-08-26)', () => {
    expect(entries.filter((e) => isStatFamily(e.name)).length).toBeGreaterThanOrEqual(15);
  });

  it('every stat-spell factory body references the spell-power fold, or carries a reasoned excuse', () => {
    const bare: string[] = [];
    entries.forEach((e, i) => {
      if (!isStatFamily(e.name) || SPELL_POWER_EXCUSED[e.name]) return;
      const body = src.slice(e.start, entries[i + 1]?.start ?? src.length);
      if (!/spellAttackBonus|spellHealthBonus|spellStatBonus|spellBonus/.test(body)) bare.push(e.name);
    });
    expect(bare.map((n) => `${n}: a stat-spell factory with NO spell-power fold — the #817/#731 class. Fold spellAttackBonus/spellHealthBonus, or excuse it in historyRegistry.ts with the reason.`)).toEqual([]);
  });

  it('excuses are not stale: each names a factory that exists and still lacks the fold', () => {
    const stale: string[] = [];
    for (const name of Object.keys(SPELL_POWER_EXCUSED)) {
      const i = entries.findIndex((e) => e.name === name);
      if (i < 0) { stale.push(`${name}: excused but no such factory — delete the entry`); continue; }
      const body = src.slice(entries[i]!.start, entries[i + 1]?.start ?? src.length);
      if (/spellAttackBonus|spellHealthBonus|spellStatBonus/.test(body)) stale.push(`${name}: excused but it NOW folds spell power — delete the entry (the implementation wins)`);
    }
    expect(stale, stale.join('\n')).toEqual([]);
  });
});
