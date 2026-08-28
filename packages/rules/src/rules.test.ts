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
import { CARD_INDEX, QUEST_DEFS, RUNE_INDEX } from '@game/content';
import { APPROVED_RULES, CONVENTION_PENDING, DECISIONS, INTERACTION_PENDING, MANUAL_PENDING, PENDING_RULES, WORDING_PENDING, allRules, undecided } from './index';
import { RETIRED_IDS, RETIRED_RULES } from './registry/retired';
import { AUTO_RETIRED_IDS, AUTO_RETIRED_RULES } from './registry/retired.generated';

describe('rulebook registry integrity', () => {
  const all = [...APPROVED_RULES, ...PENDING_RULES, ...MANUAL_PENDING, ...CONVENTION_PENDING, ...WORDING_PENDING, ...INTERACTION_PENDING];

  it('rule ids are unique and well-formed', () => {
    const ids = all.map((r) => r.id);
    expect(new Set(ids).size, 'duplicate rule id').toBe(ids.length);
    for (const id of ids) expect(id, 'blank id').toMatch(/^(R|q)-[A-Za-z0-9_-]+/);
  });

  it('approved rules carry evidence; pending rules carry current behaviour', () => {
    for (const r of APPROVED_RULES) expect(r.evidence.length, `${r.id} has no evidence`).toBeGreaterThan(0);
    for (const r of [...PENDING_RULES, ...MANUAL_PENDING, ...CONVENTION_PENDING, ...WORDING_PENDING]) expect(r.currentBehaviour, `${r.id} states no current behaviour`).toBeTruthy();
    for (const r of [...PENDING_RULES, ...MANUAL_PENDING, ...CONVENTION_PENDING, ...INTERACTION_PENDING]) expect(r.currentBehaviour, `${r.id} states no current behaviour`).toBeTruthy();
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
    for (const p of [...PENDING_RULES, ...MANUAL_PENDING, ...CONVENTION_PENDING, ...WORDING_PENDING, ...INTERACTION_PENDING]) {
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
    const conventionIds = new Set(CONVENTION_PENDING.map((r) => r.id));
    const wordingIds = new Set(WORDING_PENDING.map((r) => r.id));
    const interactionIds = new Set(INTERACTION_PENDING.map((r) => r.id));
    for (const [id, d] of Object.entries(DECISIONS)) {
      if (d.decision !== 'reject') continue;
      expect(wordingIds.has(id), `'${id}' was REJECTED but is still on the wording board — run \`npm run docbot:text\` (its shared hygiene pass tombstones rejects)`).toBe(false);
      expect(interactionIds.has(id), `'${id}' was REJECTED but is still on the interaction board — run \`npm run docbot:interactions\` (its shared hygiene pass tombstones rejects)`).toBe(false);
      expect(pendingIds.has(id), `'${id}' was REJECTED but is still on the pending board — run \`npm run rules:seed\` (its hygiene pass tombstones rejects into retired.generated.ts)`).toBe(false);
      expect(manualIds.has(id), `'${id}' was REJECTED but still lives in pendingManual.ts — the seeder never touches manual cards, so remove it BY HAND and tombstone the id in registry/retired.ts`).toBe(false);
      expect(conventionIds.has(id), `'${id}' was REJECTED but is still on the convention board — run \`npm run contracts:extract\` (its shared hygiene pass tombstones rejects)`).toBe(false);
    }
  });

  it('content ids referenced by rules resolve', () => {
    const questIds = new Set(QUEST_DEFS.map((q) => q.id));
    for (const r of all) {
      for (const cid of r.contentIds ?? []) {
        expect(!!CARD_INDEX[cid] || !!RUNE_INDEX[cid] || questIds.has(cid), `${r.id} references unknown content '${cid}'`).toBe(true);
      }
    }
  });

  it('the backlog is real (a seeding collapse must fail loudly, not read as all-decided)', () => {
    expect(PENDING_RULES.length).toBeGreaterThanOrEqual(3); // the owner's 2026-08-26 triage session drained the board to the standing policy/watch cards; the resolved ids live in registry/retired.ts, and the rejected rune-duplicates card is tombstoned in retired.generated.ts
    expect(CONVENTION_PENDING.length).toBeGreaterThanOrEqual(60); // WP B's Sitting-1 deck (~70 family/keyword/hero/global/quest-shape cards) — a regeneration collapse must fail loudly
    expect(allRules().length).toBe(APPROVED_RULES.length + PENDING_RULES.length + MANUAL_PENDING.length + CONVENTION_PENDING.length + WORDING_PENDING.length + INTERACTION_PENDING.length);
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
      // Click semantics: the compact micro-tail (owner fly-through ask 2026-08-27 — "2-5s each").
      expect(r.statement, `${r.id}: statement must carry the compact click tail`).toContain('✓ yes');
      expect(r.statement, `${r.id}: statement must carry the reject hint`).toContain('✕ no');
      expect(r.statement, `${r.id}: statement must offer the revise key`).toContain('✎');
    }
  });

  it('manual ids never collide with generated, approved, or retired ids', () => {
    const taken = new Set([
      ...APPROVED_RULES.map((r) => r.id),
      ...PENDING_RULES.map((r) => r.id),
      ...CONVENTION_PENDING.map((r) => r.id),
      ...INTERACTION_PENDING.map((r) => r.id),
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

describe('language guide (schema v0, WP B §11.3)', () => {
  it('entries are unique, evidenced, and never machine-approved', async () => {
    const { LANGUAGE_GUIDE } = await import('./languageGuide');
    const ids = LANGUAGE_GUIDE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of LANGUAGE_GUIDE) {
      expect(e.id).toMatch(/^LG-[A-Z]+-\d{2}$/);
      expect(e.evidence.length, `${e.id} cites no evidence`).toBeGreaterThan(0);
      expect(['seeded', 'approved']).toContain(e.status);
      // 'approved' is never a machine verdict: it requires an OWNER decision on the entry, cited in evidence
      // (LG-SCOPE-01 is the first — the Aura rebrand, owner ruling 2026-08-28). A seeded entry is Claude's
      // reading of majority usage and may never claim approval.
      if (e.status === 'approved') {
        expect(e.evidence.some((v) => v.kind === 'owner-chat' || v.kind === 'owner-handoff'),
          `${e.id}: 'approved' requires an owner decision cited in evidence (owner-chat / owner-handoff)`).toBe(true);
      }
    }
  });
});

describe('convention questions (pendingConventions.generated.ts) — the Sitting-1 format bar (WP B)', () => {
  it('every convention card is self-contained: exemplar text, concrete example, explicit click semantics, source queue', () => {
    for (const r of CONVENTION_PENDING) {
      expect(r.id, `${r.id} outside the q-conv- namespace`).toMatch(/^q-conv-[A-Za-z0-9-]+$/);
      expect(r.status, `${r.id} must be needs-ruling`).toBe('needs-ruling');
      expect(r.cardText, `${r.id} has no cardText (every card must stand alone — owner format feedback 2026-08-26)`).toBeTruthy();
      expect(r.example, `${r.id} has no concrete example`).toBeTruthy();
      expect(r.currentBehaviour, `${r.id} states no current behaviour`).toBeTruthy();
      expect(r.evidence.length, `${r.id} cites no evidence`).toBeGreaterThan(0);
      expect(r.sourceQueue, `${r.id} names no source queue`).toBe('contracts.conventions');
      // Click semantics: the compact micro-tail (owner fly-through ask 2026-08-27 — "2-5s each").
      expect(r.statement, `${r.id}: statement must carry the compact click tail`).toContain('✓ yes');
      expect(r.statement, `${r.id}: statement must carry the reject hint`).toContain('✕ no');
      expect(r.statement, `${r.id}: statement must offer the revise key`).toContain('✎');
      // A future approval must not grow the approved-but-unenforced queue: every card carries its pin.
      expect(r.enforcement?.kind, `${r.id} carries no enforcement — an approval would land in the unenforced queue`).toBe('oracle');
    }
  });

  it('every undecided convention card reaches the Rulebook Triage worklist', () => {
    const board = new Set(undecided().map((r) => r.id));
    for (const r of CONVENTION_PENDING) {
      if (DECISIONS[r.id]) continue;
      expect(board.has(r.id), `${r.id} is undecided but missing from undecided()`).toBe(true);
    }
  });
});

describe('wording questions (pendingWording.generated.ts) — the Sitting-3 format bar (WP E)', () => {
  it('every wording card is self-contained: both-side exemplars, concrete example, click semantics, source queue, enforcement', () => {
    for (const r of WORDING_PENDING) {
      expect(r.id, `${r.id} outside the q-word- namespace`).toMatch(/^q-word-[a-z0-9-]+$/);
      expect(r.status, `${r.id} must be needs-ruling`).toBe('needs-ruling');
      expect(r.domain, `${r.id} must live in the text domain`).toBe('text');
      expect(r.cardText, `${r.id} has no cardText (every card must stand alone — owner format feedback 2026-08-26)`).toBeTruthy();
      expect(r.example, `${r.id} has no concrete example`).toBeTruthy();
      expect(r.currentBehaviour, `${r.id} states no current behaviour`).toBeTruthy();
      expect(r.evidence.length, `${r.id} cites no evidence`).toBeGreaterThan(0);
      expect(r.sourceQueue, `${r.id} names no source queue`).toBe('textParse.wording');
      expect(r.statement, `${r.id}: statement must carry the compact click tail`).toContain('✓ yes');
      expect(r.statement, `${r.id}: statement must carry the reject hint`).toContain('✕ no');
      expect(r.statement, `${r.id}: statement must offer the revise key`).toContain('✎');
      expect(r.enforcement?.kind, `${r.id} carries no enforcement — an approval would land in the unenforced queue`).toBe('oracle');
    }
  });

  it('every undecided wording card reaches the Rulebook Triage worklist', () => {
    const board = new Set(undecided().map((r) => r.id));
    for (const r of WORDING_PENDING) {
      if (DECISIONS[r.id]) continue;
      expect(board.has(r.id), `${r.id} is undecided but missing from undecided()`).toBe(true);
    }
  });
});

describe('interaction questions (pendingInteractions.generated.ts) — the Sitting-2 format bar (WP F)', () => {
  it('every interaction card is self-contained: exemplar text, concrete example, click semantics, source queue, enforcement', () => {
    for (const r of INTERACTION_PENDING) {
      expect(r.id, `${r.id} outside the q-interact2- namespace`).toMatch(/^q-interact2-[0-9a-f]{8}$/);
      expect(r.status, `${r.id} must be needs-ruling`).toBe('needs-ruling');
      expect(r.cardText, `${r.id} has no cardText (every card must stand alone — owner format feedback 2026-08-26)`).toBeTruthy();
      expect(r.example, `${r.id} has no concrete example`).toBeTruthy();
      expect(r.currentBehaviour, `${r.id} states no current behaviour`).toBeTruthy();
      expect(r.evidence.length, `${r.id} cites no evidence`).toBeGreaterThan(0);
      expect(r.sourceQueue, `${r.id} names no source queue`).toBeTruthy();
      expect(r.statement, `${r.id}: statement must carry the compact click tail`).toContain('✓ yes');
      expect(r.statement, `${r.id}: statement must carry the reject hint`).toContain('✕ no');
      expect(r.statement, `${r.id}: statement must offer the revise key`).toContain('✎');
      expect(r.enforcement?.kind, `${r.id} carries no enforcement — an approval would land in the unenforced queue`).toBe('oracle');
    }
  });

  it('every undecided interaction card reaches the Rulebook Triage worklist', () => {
    const board = new Set(undecided().map((r) => r.id));
    for (const r of INTERACTION_PENDING) {
      if (DECISIONS[r.id]) continue;
      expect(board.has(r.id), `${r.id} is undecided but missing from undecided()`).toBe(true);
    }
  });
});

describe('the four gilding REVISE decisions survive regeneration (owner 2026-08-28)', () => {
  const REVISED = ['q-conv-family-avenge', 'q-conv-family-castPayoff', 'q-conv-family-echo', 'q-conv-family-spellCast'];

  it('each decision is still on file, still a revise, still carrying the owner\'s wording', () => {
    for (const id of REVISED) {
      const d = DECISIONS[id];
      expect(d, `${id}: the owner's ruling was lost by a reseed — seed hygiene must carry decisions across regeneration`).toBeTruthy();
      expect(d!.decision).toBe('revise');
      expect((d!.note ?? '').trim().length, `${id}: a revise must carry the owner's wording`).toBeGreaterThan(0);
    }
  });

  it('each revised card is still on the board and still names the rule the owner gave', () => {
    for (const id of REVISED) {
      const card = CONVENTION_PENDING.find((r) => r.id === id);
      expect(card, `${id}: a decided card must not be tombstoned by regeneration`).toBeTruthy();
      expect(AUTO_RETIRED_IDS.has(id), `${id} was auto-retired despite carrying an owner decision`).toBe(false);
      // The regenerated statement must state the owner's ACTUAL gilding rule, not the retired flat claim.
      expect(card!.statement, `${id} still asserts the flat "gilding doubles their numbers" claim the owner revised`)
        .not.toMatch(/gilding doubles their numbers/i);
    }
    // The two families whose outliers the owner NAMED say so; the spell family says spells never gild.
    expect(CONVENTION_PENDING.find((r) => r.id === 'q-conv-family-avenge')!.statement).toMatch(/gilded token|proc/i);
    expect(CONVENTION_PENDING.find((r) => r.id === 'q-conv-family-echo')!.statement).toMatch(/gilded token/i);
    expect(CONVENTION_PENDING.find((r) => r.id === 'q-conv-family-castPayoff')!.statement).toMatch(/Mykel/);
    expect(CONVENTION_PENDING.find((r) => r.id === 'q-conv-family-spellCast')!.statement).toMatch(/never gild/i);
  });
});

describe('the fly-through bar — Sitting cards stay readable in 2-5 seconds (owner 2026-08-27)', () => {
  const words = (statement: string): number =>
    (statement.split('—')[0] ?? statement).trim().split(/\s+/).filter(Boolean).length;
  it('every convention statement is one short sentence (≤ 30 words before the micro-tail)', () => {
    const over = CONVENTION_PENDING.filter((r) => words(r.statement) > 30)
      .map((r) => `${r.id} (${words(r.statement)}w)`);
    expect(over, `wordy convention cards — simplify the template, never raise this pin: ${over.join(', ')}`).toEqual([]);
  });
  it('every wording statement is one short sentence (≤ 30 words before the micro-tail) — the Sitting-3 deck rides the SAME bar', () => {
    const over = WORDING_PENDING.filter((r) => words(r.statement) > 30)
      .map((r) => `${r.id} (${words(r.statement)}w)`);
    expect(over, `wordy wording cards — simplify the template, never raise this pin: ${over.join(', ')}`).toEqual([]);
  });
  it('every interaction (Sitting-2) statement is one short sentence (≤ 30 words before the micro-tail)', () => {
    const over = INTERACTION_PENDING.filter((r) => words(r.statement) > 30)
      .map((r) => `${r.id} (${words(r.statement)}w)`);
    expect(over, `wordy interaction cards — simplify the template, never raise this pin: ${over.join(', ')}`).toEqual([]);
  });
});
