import { describe, it, expect } from 'vitest';
import { PRESENTATION_POLICIES } from '@game/core';
import { combatFlagOwner } from '@game/content';
import { RUNES, EPIC_RUNES, QUEST_DEFS } from '@game/content';

/**
 * BEAT CHOREOGRAPHER PR 17 — every combat flag resolves to a REAL registry row.
 *
 * The combat adapter turns a `questTrigger`/`questComplete` flag into a `policyKey`. If any flag resolved to a
 * key the registry doesn't carry, that moment would be an orphan identity — unclassifiable, untimeable, and
 * reported as a ghost. This walks every `combatFlag` reward the content defines and asserts its resolved key
 * exists, so a new combat rune/quest can't silently produce an un-anchored beat.
 */
function combatFlags(): { flag: string; owner: string }[] {
  const out: { flag: string; owner: string }[] = [];
  const scan = (reward: unknown, owner: string): void => {
    const r = reward as { kind: string; flag?: string; rewards?: unknown[] };
    if (r.kind === 'multi') { for (const x of r.rewards ?? []) scan(x, owner); return; }
    if (r.kind === 'combatFlag' && r.flag) out.push({ flag: r.flag, owner });
  };
  for (const r of [...RUNES, ...EPIC_RUNES]) scan(r.reward, r.id);
  for (const q of QUEST_DEFS) scan(q.reward, q.id);
  return out;
}

describe('combat flags are registry-anchored', () => {
  const flags = combatFlags();

  it('the content actually defines combat flags to check', () => {
    expect(flags.length).toBeGreaterThan(0);
  });

  it('every combat flag resolves to an owner', () => {
    for (const { flag, owner } of flags) {
      expect(combatFlagOwner(flag), `${flag} (from ${owner}) resolves to no owner`).toBeTruthy();
    }
  });

  it('every resolved key exists in the registry — no orphan combat identities', () => {
    for (const { flag } of flags) {
      const owner = combatFlagOwner(flag);
      if (!owner) continue;
      expect(PRESENTATION_POLICIES[owner.key], `${flag} → ${owner.key} is not classified`).toBeDefined();
    }
  });

  it('Rune of Attacking Gems specifically is addressable', () => {
    const owner = combatFlagOwner('runeAttackingGems');
    expect(owner?.key).toBe('rune:rune_attacking_gems:combat');
    expect(PRESENTATION_POLICIES[owner!.key]).toBeDefined();
  });
});
