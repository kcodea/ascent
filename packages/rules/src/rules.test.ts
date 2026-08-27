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
import { APPROVED_RULES, DECISIONS, MANUAL_PENDING, PENDING_RULES, allRules, undecided } from './index';
import { RETIRED_IDS, RETIRED_RULES } from './registry/retired';
import { AUTO_RETIRED_IDS, AUTO_RETIRED_RULES } from './registry/retired.generated';

describe('rulebook registry integrity', () => {
  const all = [...APPROVED_RULES, ...PENDING_RULES, ...MANUAL_PENDING];

  it('rule ids are unique and well-formed', () => {
    const ids = all.map((r) => r.id);
    expect(new Set(ids).size, 'duplicate rule id').toBe(ids.length);
    for (const id of ids) expect(id, 'blank id').toMatch(/^(R|q)-[A-Za-z0-9_-]+/);
  });

  it('approved rules carry evidence; pending rules carry current behaviour', () => {
    for (const r of APPROVED_RULES) expect(r.evidence.length, `${r.id} has no evidence`).toBeGreaterThan(0);
    for (const r of [...PENDING_RULES, ...MANUAL_PENDING]) expect(r.currentBehaviour, `${r.id} states no current behaviour`).toBeTruthy();
  });

  it('every decision references an existing rule, and revisions carry wording', () => {
    const known = new Set(all.map((r) => r.id));
    for (const [id, d] of Object.entries(DECISIONS)) {
      expect(known.has(id) || RETIRED_IDS.has(id) || AUTO_RETIRED_IDS.has(id), `decision on unknown rule '${id}' — if its queue item resolved, retire it explicitly in registry/retired.ts`).toBe(true);
      if (d.decision === 'revise') expect(d.note, `${id}: a revise decision must carry the owner's wording`).toBeTruthy();
    }
  });

  it('retired rules (hand and auto) carry a disposition and never shadow a live rule', () => {
    const live = new Set(all.map((r) => r.id));
    for (const r of [...RETIRED_RULES, ...AUTO_RETIRED_RULES]) {
      expect(r.why.length, `${r.id} retired with no disposition`).toBeGreaterThan(20);
      expect(live.has(r.id), `${r.id} is retired AND still live — pick one`).toBe(false);
    }
  });

  it('ids are never recycled: a tombstoned or approved id never reappears as a NEW pending id', () => {
    const approvedIds = new Set(APPROVED_RULES.map((r) => r.id));
    for (const p of [...PENDING_RULES, ...MANUAL_PENDING]) {
      expect(RETIRED_IDS.has(p.id), `pending '${p.id}' resurrects a hand-retired id`).toBe(false);
      expect(AUTO_RETIRED_IDS.has(p.id), `pending '${p.id}' resurrects an auto-retired id`).toBe(false);
      expect(approvedIds.has(p.id), `pending '${p.id}' recycles an approved rule id`).toBe(false);
    }
    // And the two tombstone files never disagree about who owns an id.
    for (const r of RETIRED_RULES) expect(AUTO_RETIRED_IDS.has(r.id), `${r.id} tombstoned in BOTH retired files`).toBe(false);
  });

  it('rejected decisions never correspond to a still-pending rule (§10.4 — the seeder must tombstone them)', () => {
    const pendingIds = new Set(PENDING_RULES.map((r) => r.id));
    const manualIds = new Set(MANUAL_PENDING.map((r) => r.id));
    for (const [id, d] of Object.entries(DECISIONS)) {
      if (d.decision !== 'reject') continue;
      expect(pendingIds.has(id), `'${id}' was REJECTED but is still on the pending board — run \`npm run rules:seed\` (its hygiene pass tombstones rejects into retired.generated.ts)`).toBe(false);
      expect(manualIds.has(id), `'${id}' was REJECTED but still lives in pendingManual.ts — the seeder never touches manual cards, so remove it BY HAND and tombstone the id in registry/retired.ts`).toBe(false);
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
    expect(PENDING_RULES.length).toBeGreaterThanOrEqual(3); // the owner's 2026-08-26 triage session drained the board to the standing policy/watch cards; the resolved ids live in registry/retired.ts, and the rejected rune-duplicates card is tombstoned in retired.generated.ts
    expect(allRules().length).toBe(APPROVED_RULES.length + PENDING_RULES.length + MANUAL_PENDING.length);
  });
});

describe('hand-authored pending cards (pendingManual.ts) — the 2026-08-27 owner-question format bar', () => {
  it('every manual card is self-contained: verbatim cardText, a concrete example, and explicit click semantics', () => {
    for (const r of MANUAL_PENDING) {
      expect(r.status, `${r.id} must be needs-ruling`).toBe('needs-ruling');
      expect(r.cardText, `${r.id} has no cardText (owner format feedback 2026-08-26: every card must stand alone)`).toBeTruthy();
      expect(r.example, `${r.id} has no concrete example`).toBeTruthy();
      expect(r.currentBehaviour, `${r.id} states no current behaviour`).toBeTruthy();
      expect(r.evidence.length, `${r.id} cites no evidence`).toBeGreaterThan(0);
      expect(r.sourceQueue, `${r.id} names no Doc Bot source lane`).toBeTruthy();
      // Explicit click semantics: the statement must spell out what ✓ Approve and ✕ Reject each DO.
      expect(r.statement, `${r.id}: statement must contain the literal '✓ Approve ='`).toContain('✓ Approve =');
      expect(r.statement, `${r.id}: statement must contain the literal '✕ Reject ='`).toContain('✕ Reject =');
      expect(r.statement, `${r.id}: statement must offer '✎ Revise'`).toContain('✎ Revise');
    }
  });

  it('manual ids never collide with generated, approved, or retired ids', () => {
    const taken = new Set([
      ...APPROVED_RULES.map((r) => r.id),
      ...PENDING_RULES.map((r) => r.id),
      ...RETIRED_IDS,
      ...AUTO_RETIRED_IDS,
    ]);
    const seen = new Set<string>();
    for (const r of MANUAL_PENDING) {
      expect(taken.has(r.id), `manual '${r.id}' collides with a generated/approved/retired id`).toBe(false);
      expect(seen.has(r.id), `manual '${r.id}' is duplicated inside pendingManual.ts`).toBe(false);
      seen.add(r.id);
    }
  });

  it('board smoke: every undecided manual card reaches the Rulebook Triage worklist', () => {
    const board = new Set(undecided().map((r) => r.id));
    for (const r of MANUAL_PENDING) {
      if (DECISIONS[r.id]) continue; // a decided card correctly leaves the worklist
      expect(board.has(r.id), `${r.id} is undecided but missing from undecided()`).toBe(true);
    }
  });
});
