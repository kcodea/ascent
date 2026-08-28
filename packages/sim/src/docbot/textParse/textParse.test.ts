/**
 * DOC BOT 2.0 WP E — the text-intelligence PR-gate lane.
 *
 * What this suite pins:
 *  1. §18-E exit gate — every active object classified into exactly ONE of the four buckets; a row with
 *     unresolved spans can NEVER read parsed-equivalent (§4.3/§11.1 — no unresolved parse as a clean pass).
 *  2. The unresolved-parse queue is a RATCHETED, grow-loudly backlog (cap pinned; a parser regression or
 *     new unparsed content fails here and the pin moves consciously, never silently).
 *  3. VERIFY-BEFORE-ALARM — every mismatch is registry-pinned with an investigated verdict; a NEW
 *     mismatch fails with instructions, a STALE pin fails the other way.
 *  4. Sabotage (§4.5) — a doctored parse amount, a doctored guide rule, and a doctored gilded factor are
 *     each detected; the real configuration produces none of the doctored alarms.
 *  5. Authority honesty (§6.1) — a mismatch on an APPROVED contract is a verified-text-defect finding; a
 *     mismatch on a draft is questionable-interaction, never a conviction.
 *  6. The Sitting-3 deck builder stays deterministic and inside the owner's fly-through format bar.
 *
 * Runtime: pure parsing + structural comparison — no simulate(), no reducer; well inside the PR gate.
 */
import { describe, expect, it } from 'vitest';
import { LANGUAGE_GUIDE, type LanguageGuideEntry } from '@game/rules';
import { allContracts } from '@game/rules/contracts';
import { parseObjectText } from './parser';
import { textObjectOf } from './corpus';
import { KNOWN_TEXT_MISMATCH, runTextSweep, TEXT_EXCEPTIONS } from './classify';
import { runRewriteAdvisor } from './rewriteAdvisor';
import { buildWordingQuestions, wordingCorpus } from './wordingQuestions';
import { AURA_TARGET_RE, RETIRED_SCOPE_TAIL_RE } from './lexicon';
import { IMPLEMENTED_TAXONOMY } from './types';

const CONTRACTS = allContracts();
const SWEEP = runTextSweep({ contracts: CONTRACTS });

/** The grow-loudly cap on the unresolved queue (first full run 2026-08-27: 534 of 901). Shrink freely;
 *  raising it is a conscious act that names the new unparsed content in the PR. */
const UNRESOLVED_CAP = 540;
/** Collapse floor: the parser fully consuming fewer objects than this means a grammar regression. */
const PARSED_FLOOR = 340;

describe('WP E classification — the §18-E exit gate', () => {
  it('every active object is classified into exactly one bucket; the totals reconcile', () => {
    expect(SWEEP.rows.length).toBe(CONTRACTS.length);
    const sum = Object.values(SWEEP.buckets).reduce((a, b) => a + b, 0);
    expect(sum).toBe(CONTRACTS.length);
  });

  it('NO unresolved parse is reported as a clean pass (§4.3/§11.1)', () => {
    for (const r of SWEEP.rows) {
      if (r.unresolvedCount > 0) {
        expect(r.bucket, `${r.contentId} has ${r.unresolvedCount} unresolved span(s) yet reads '${r.bucket}'`).not.toBe('parsed-equivalent');
      }
      if (r.bucket === 'parsed-equivalent') expect(r.unresolvedCount).toBe(0);
    }
  });

  it('the unresolved queue is ratcheted grow-loudly (cap + collapse floor)', () => {
    expect(SWEEP.buckets['unresolved-parse'],
      `unresolved-parse grew past the pin (${UNRESOLVED_CAP}) — either grow the grammar or move the pin CONSCIOUSLY, naming the new content`).toBeLessThanOrEqual(UNRESOLVED_CAP);
    expect(SWEEP.buckets['parsed-equivalent'],
      'parsed-equivalent collapsed below the floor — a grammar regression, not a content change').toBeGreaterThanOrEqual(PARSED_FLOOR);
  });

  it('verify-before-alarm: every mismatch is registry-pinned; no pin is stale', () => {
    expect(SWEEP.unpinnedMismatchIds,
      'NEW text mismatches — investigate each (real defect? parser mis-read? draft-contract gap?) and pin the verdict in KNOWN_TEXT_MISMATCH before it may stand').toEqual([]);
    expect(SWEEP.staleKnownIds,
      'stale KNOWN_TEXT_MISMATCH pins — the mismatch no longer reproduces; delete the entry').toEqual([]);
  });

  it('pinned taxonomies still match what the sweep observes (a pin cannot drift from its finding)', () => {
    for (const [id, pin] of Object.entries(KNOWN_TEXT_MISMATCH)) {
      const observed = SWEEP.mismatches.filter((m) => m.contentId === id).map((m) => m.taxonomy);
      expect(observed, `${id}: pinned taxonomy '${pin.taxonomy}' not among observed [${observed.join(', ')}]`).toContain(pin.taxonomy);
    }
  });

  it('the exceptions registry holds only owner rulings (none yet — §23: never auto-approved)', () => {
    expect(Object.keys(TEXT_EXCEPTIONS)).toEqual([]);
  });

  it('the approved-exception bucket mechanism works when an exception exists (injected)', () => {
    const subject = SWEEP.rows.find((r) => r.bucket === 'unresolved-parse')!;
    const injected = runTextSweep({
      contracts: CONTRACTS.filter((c) => c.contentId === subject.contentId),
      exceptions: { [subject.contentId]: { why: 'test-injected exception' } },
    });
    expect(injected.rows[0]!.bucket).toBe('approved-exception');
  });

  it('quests are textless by design and land parsed-equivalent, counted separately', () => {
    const quests = SWEEP.rows.filter((r) => r.contentType === 'quest');
    expect(quests.length).toBeGreaterThan(0);
    for (const q of quests) {
      expect(q.textless).toBe(true);
      expect(q.bucket).toBe('parsed-equivalent');
    }
    expect(SWEEP.textless).toBeGreaterThanOrEqual(quests.length);
  });
});

describe('parser — grammar spot checks over real printed text', () => {
  it('a simple spell parses fully (spiritfire: "Give a minion +2/+3.")', () => {
    const p = parseObjectText('Give a minion **+2/+3**.');
    expect(p.fullyParsed).toBe(true);
    expect(p.effects[0]?.kind).toBe('stat-buff');
    expect(p.effects[0]?.amount).toEqual({ attack: 2, health: 3 });
  });

  it('a bare keyword line parses fully with the letters (trainingdummy)', () => {
    const p = parseObjectText('**Taunt.** **Ward.**');
    expect(p.fullyParsed).toBe(true);
    expect(p.keywordLine).toEqual(['T', 'DS']);
  });

  it('a summon clause resolves count, token id and printed body (pack)', () => {
    const p = parseObjectText('**Deathrattle:** summon two 1/1 Pups.');
    expect(p.fullyParsed).toBe(true);
    expect(p.triggers[0]).toMatchObject({ event: 'onDeath', display: 'Deathrattle' });
    expect(p.effects[0]).toMatchObject({ kind: 'summon', summonCount: 2, refId: 'pup', amount: { attack: 1, health: 1 } });
  });

  it('an Avenge prefix carries its threshold (spellappraiser shape)', () => {
    const p = parseObjectText('**Avenge (3):** your Shop spells have **+1 Attack** this run.');
    expect(p.triggers[0]).toMatchObject({ event: 'avenge', threshold: 3 });
    expect(p.persistence.some((x) => x.kind === 'run-wide')).toBe(true);
  });

  it('a multiplier print parses with its extra-fire count (rune_fury)', () => {
    const p = parseObjectText('Your **Avenge** effects trigger twice.');
    expect(p.fullyParsed).toBe(true);
    expect(p.effects[0]).toMatchObject({ kind: 'multiplier-print', amount: { value: 1, unit: 'extra-fires' } });
  });

  it('an unparseable clause lands verbatim in unresolvedPhrases — never dropped', () => {
    const p = parseObjectText('Rotate the shop widdershins under a full moon.');
    expect(p.fullyParsed).toBe(false);
    expect(p.unresolvedPhrases[0]?.text).toContain('widdershins');
  });
});

/**
 * THE AURA VOCABULARY (owner ruling 2026-08-28 — decision q-word-lg-scope-01, REVISE).
 *
 * The run-wide reach that used to print as "wherever they are" / "everywhere" now prints as an AURA noun:
 * "give your Beast Aura +8/+8". Wording only — no mechanic, id or effect path moved. This lane is the
 * grow-loudly guard: a new card cannot reintroduce a retired scope tail, and the parser must keep reading
 * the Aura target (LG-SCOPE-01 carries the rule).
 */
describe('the Aura vocabulary — LG-SCOPE-01', () => {
  const corpus = wordingCorpus();

  it('NO live printed text uses a retired scope tail ("wherever they are" / "everywhere")', () => {
    const offenders = corpus.filter((r) => RETIRED_SCOPE_TAIL_RE.test(r.text)).map((r) => `${r.id}: "${r.text}"`);
    expect(offenders,
      'the retired scope vocabulary is back in printed text — name the Aura instead ("your Imp Aura +4/+4"), per LG-SCOPE-01').toEqual([]);
  });

  it('the Aura noun is live, and every printed Aura rides the "your <Tribe> Aura" shape', () => {
    const auraRows = corpus.filter((r) => /\bAura\b/.test(r.text));
    expect(auraRows.length, 'no printed text names an Aura — the rebrand has been reverted').toBeGreaterThan(0);
    for (const r of auraRows) {
      expect(AURA_TARGET_RE.test(r.text), `${r.id} prints "Aura" outside the "your <Tribe> Aura" shape: "${r.text}"`).toBe(true);
    }
  });

  it('the guide entry is the owner-approved canon with a machine-checkable predicate', () => {
    const entry = LANGUAGE_GUIDE.find((e) => e.id === 'LG-SCOPE-01')!;
    expect(entry.status).toBe('approved');
    expect(entry.contested).toBeUndefined(); // settled — the advisor may now flag, the deck no longer asks
    expect(new RegExp(entry.predicate!.deprecated).test('give your Beasts +8/+8 wherever they are')).toBe(true);
    expect(new RegExp(entry.predicate!.deprecated).test('give your Beast Aura +8/+8')).toBe(false);
  });

  it('the settled wording pair no longer produces a Sitting-3 question (it self-retired)', () => {
    expect(buildWordingQuestions().map((q) => q.id)).not.toContain('q-word-lg-scope-01');
  });

  it('the parser reads an Aura target: trigger, scope and amount all resolve', () => {
    const p = parseObjectText('**Echo:** give your **Beast Aura** **+8/+8**.');
    expect(p.fullyParsed).toBe(true);
    expect(p.triggers[0]).toMatchObject({ event: 'onDeath', display: 'Echo' });
    expect(p.effects[0]).toMatchObject({ kind: 'stat-buff', verb: 'give', amount: { attack: 8, health: 8 } });
    expect(p.effects[0]?.target).toMatchObject({ cardinality: 'all', scope: 'your-beast-aura', friendly: true });
  });

  it('the parser reads the Attack-only and "improve … by" Aura shapes', () => {
    const atk = parseObjectText('**Battlecry:** Give your **Undead Aura** **+1 Attack**.');
    expect(atk.fullyParsed).toBe(true);
    expect(atk.effects[0]).toMatchObject({ kind: 'stat-buff', amount: { attack: 1, health: 0 } });
    expect(atk.effects[0]?.target).toMatchObject({ scope: 'your-undead-aura' });

    const imp = parseObjectText('**Avenge (3):** improve your **Imp Aura** by **+6/+6**.');
    expect(imp.fullyParsed).toBe(true);
    expect(imp.effects[0]).toMatchObject({ kind: 'stat-buff', verb: 'improve', amount: { attack: 6, health: 6 } });
    expect(imp.effects[0]?.target).toMatchObject({ scope: 'your-imp-aura' });
  });

  it('the rewritten cards kept their exact magnitudes (wording only — zero mechanical change)', () => {
    // The 2026-08-28 rebrand carriers, with the numbers they printed before it.
    const magnitudes: Record<string, number[]> = {
      kennel: [1, 4], grim: [8, 8], trophystalker: [5, 5, 5, 5],
      deathswarmer: [1], forsakenweaver: [4], lanternofsouls: [3],
      scrapherald: [2, 2], chorusengine: [4, 4, 2], b2_armadiyo: [2, 4],
      rune_summoning: [2, 2], rune_cinder_ledger: [3, 6, 6],
    };
    for (const [id, nums] of Object.entries(magnitudes)) {
      const row = corpus.find((r) => r.id === id);
      expect(row, `${id} vanished from the printed corpus`).toBeTruthy();
      expect((row!.text.match(/\d+/g) ?? []).map(Number), `${id}'s printed numbers moved — this was a wording change only`).toEqual(nums);
    }
  });
});

describe('sabotage — every comparator is provably alive (§4.5)', () => {
  it('a doctored parse amount is detected as wrong-amount (and the real parse is clean)', () => {
    const spiritfire = CONTRACTS.filter((c) => c.contentId === 'spiritfire');
    expect(spiritfire.length).toBe(1);
    const clean = runTextSweep({ contracts: spiritfire });
    expect(clean.mismatches.filter((m) => m.taxonomy === 'wrong-amount')).toEqual([]);
    const doctored = runTextSweep({
      contracts: spiritfire,
      parseOf: (t) => {
        const p = parseObjectText(t.text);
        for (const e of p.effects) if (e.kind === 'stat-buff' && e.amount) e.amount = { attack: 3, health: 3 };
        return p;
      },
    });
    expect(doctored.mismatches.some((m) => m.contentId === 'spiritfire' && m.taxonomy === 'wrong-amount')).toBe(true);
  });

  it('a doctored guide rule produces a doctored recommendation (the advisor reads the registry)', () => {
    const objects = [textObjectOf(CONTRACTS.find((c) => c.contentId === 'rune_fury')!)];
    const real = runRewriteAdvisor({ objects, guide: LANGUAGE_GUIDE });
    expect(real.filter((f) => f.ruleIds.includes('LG-DOCTORED-99'))).toEqual([]);
    const doctoredRule: LanguageGuideEntry = {
      id: 'LG-DOCTORED-99', topic: 'general', rule: 'DOCTORED: "twice" is banned', evidence: [], status: 'seeded',
      predicate: { deprecated: '\\btwice\\b', canonical: 'an additional time' },
    };
    const doctored = runRewriteAdvisor({ objects, guide: [doctoredRule] });
    expect(doctored.some((f) => f.ruleIds.includes('LG-DOCTORED-99') && f.suggestedText?.includes('an additional time'))).toBe(true);
  });

  it('a doctored gilded factor is detected as wrong-gilded-amount (and factor 2 is clean)', () => {
    const base = { contentId: 'pack', contentType: 'minion' as const, revision: 1, reviewStatus: 'extracted' as const };
    const clean = runTextSweep({
      contracts: [{ ...base, gildedDelta: { kind: 'multiply', factor: 2, description: 'real ×2' } }],
    });
    expect(clean.mismatches.filter((m) => m.taxonomy === 'wrong-gilded-amount')).toEqual([]);
    const doctored = runTextSweep({
      contracts: [{ ...base, gildedDelta: { kind: 'multiply', factor: 3, description: 'DOCTORED ×3' } }],
    });
    expect(doctored.mismatches.some((m) => m.contentId === 'pack' && m.taxonomy === 'wrong-gilded-amount')).toBe(true);
  });
});

describe('authority honesty — §6.1 drives the finding class', () => {
  it('the xerox mismatch (approved contract) is a verified-text-defect finding', () => {
    const f = SWEEP.findings.find((x) => x.contentIds.includes('hero:xerox'));
    expect(f?.class).toBe('verified-text-defect');
    expect(f?.severity).toBe('error');
  });

  it('draft-contract mismatches are questionable, never convictions', () => {
    for (const f of SWEEP.findings.filter((x) => !x.contentIds.includes('hero:xerox'))) {
      expect(f.class, `${f.id}: a draft-contract text mismatch may only be questionable`).toBe('questionable-interaction');
      expect(f.status).toBe('needs-ruling');
    }
  });

  it('the implemented taxonomy is the only vocabulary findings use', () => {
    const implemented = new Set<string>(IMPLEMENTED_TAXONOMY);
    for (const m of SWEEP.mismatches) expect(implemented.has(m.taxonomy), `unimplemented taxonomy '${m.taxonomy}' emitted`).toBe(true);
  });
});

describe('the rewrite advisor — recommendations only (§11.4/§23)', () => {
  const objects = CONTRACTS.map(textObjectOf);
  const recs = runRewriteAdvisor({ objects, guide: LANGUAGE_GUIDE });

  it('every recommendation is class wording-recommendation, severity info, with the current text quoted', () => {
    expect(recs.length).toBeGreaterThan(0); // zyff/uron (LG-TWICE-01) + selfless (LG-KEYWORD-01) exist today
    for (const f of recs) {
      expect(f.class).toBe('wording-recommendation');
      expect(f.severity).toBe('info');
      expect(f.observed, `${f.id} does not quote the current text`).toBeTruthy();
    }
  });

  it('predicate suggestions preserve mechanics (pure term swaps — numbers untouched)', () => {
    for (const f of recs.filter((x) => x.suggestedText)) {
      const nums = (s: string): string[] => s.match(/\d+/g) ?? [];
      expect(nums(f.suggestedText!)).toEqual(nums(String(f.observed)));
    }
  });

  it('contested and reserved guide rules never advise (the Sitting-3 deck asks; the owner rename is theirs)', () => {
    const advisedRules = new Set(recs.flatMap((f) => f.ruleIds));
    for (const e of LANGUAGE_GUIDE.filter((x) => x.contested || x.reserved)) {
      expect(advisedRules.has(e.id), `${e.id} is contested/reserved yet the advisor cited it`).toBe(false);
    }
  });
});

describe('the Sitting-3 deck builder', () => {
  it('is deterministic and derives one question per still-inconsistent guide rule', () => {
    const a = buildWordingQuestions();
    const b = buildWordingQuestions();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.length).toBeGreaterThan(0);
    for (const q of a) expect(q.id).toMatch(/^q-word-lg-[a-z]+-\d{2}$/);
  });

  it('never asks about a reserved pair (the owner\'s in-flight Rebirth rename)', () => {
    const ids = buildWordingQuestions().map((q) => q.id);
    expect(ids).not.toContain('q-word-lg-keyword-02');
  });

  it('every fresh statement rides the owner\'s fly-through bar (≤ 30 words before the micro-tail)', () => {
    for (const q of buildWordingQuestions()) {
      const words = (q.statement.split('—')[0] ?? '').trim().split(/\s+/).filter(Boolean).length;
      expect(words, `${q.id} is ${words} words`).toBeLessThanOrEqual(30);
      expect(q.statement).toContain('✓ yes');
    }
  });
});
