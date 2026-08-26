/**
 * Registry integrity — the invariants that keep the rulebook trustworthy:
 *  · ids unique and never blank; approved rules carry evidence (evidence supports, decisions approve —
 *    but an approved entry with NO evidence trail is unauditable).
 *  · every decision references a rule that exists (a decision on a vanished id means a queue item was
 *    resolved — surfaced, not silently dropped).
 *  · a `revise` decision must carry the owner's wording.
 *  · content ids referenced by rules resolve in CARD_INDEX or the rune registry.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { APPROVED_RULES, DECISIONS, PENDING_RULES, allRules } from './index';

describe('rulebook registry integrity', () => {
  const all = [...APPROVED_RULES, ...PENDING_RULES];

  it('rule ids are unique and well-formed', () => {
    const ids = all.map((r) => r.id);
    expect(new Set(ids).size, 'duplicate rule id').toBe(ids.length);
    for (const id of ids) expect(id, 'blank id').toMatch(/^(R|q)-[A-Za-z0-9_-]+/);
  });

  it('approved rules carry evidence; pending rules carry current behaviour', () => {
    for (const r of APPROVED_RULES) expect(r.evidence.length, `${r.id} has no evidence`).toBeGreaterThan(0);
    for (const r of PENDING_RULES) expect(r.currentBehaviour, `${r.id} states no current behaviour`).toBeTruthy();
  });

  it('every decision references an existing rule, and revisions carry wording', () => {
    const known = new Set(all.map((r) => r.id));
    for (const [id, d] of Object.entries(DECISIONS)) {
      expect(known.has(id), `decision on unknown rule '${id}' — if its queue item resolved, retire the decision explicitly`).toBe(true);
      if (d.decision === 'revise') expect(d.note, `${id}: a revise decision must carry the owner's wording`).toBeTruthy();
    }
  });

  it('content ids referenced by rules resolve', () => {
    for (const r of all) {
      for (const cid of r.contentIds ?? []) {
        expect(!!CARD_INDEX[cid] || !!RUNE_INDEX[cid], `${r.id} references unknown content '${cid}'`).toBe(true);
      }
    }
  });

  it('the backlog is real (a seeding collapse must fail loudly, not read as all-decided)', () => {
    expect(PENDING_RULES.length).toBeGreaterThanOrEqual(15); // 22 after the owner audit (2026-08-26) collapsed instrument noise into policy cards + a Doc Bot backlog
    expect(allRules().length).toBe(APPROVED_RULES.length + PENDING_RULES.length);
  });
});
