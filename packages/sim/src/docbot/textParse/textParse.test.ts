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
// 540 → 541 on 2026-09-09: Set 3 Neutrals tranche 3 (Highway Hustler / Warband Recruiter / Equipment Charger) —
// three new texts, one of which the grammar does not yet parse.
// 541 → 556 on 2026-09-09: Set 3 Spirits tranche 1 — seventeen new Spirit texts, fifteen of which the grammar does not yet parse.
// 556 → 563 on 2026-09-09: Set 3 Spirits tranche 2 — the seven hand-summon cards.
// 563 → 565 on 2026-09-10: two objects left verified-mismatch for the unresolved queue — hero:xerox (its text was
// FIXED to "an exact copy"; like most hero powers the parser cannot fully resolve it yet) and kennel (its curated
// contract gained the Start of Combat leg the text always printed; the Aura clause is still partial). A conscious move.
// 565 → 570 on 2026-09-10 (second move): the extractor learned Choose One branches + the weld-carried Rally, so the
// nine draft-contract-gap objects (shaper, godfodder, contractimp, crestclimb, n3_splitboon, k_veinbreaker,
// k3_forkvein, n2_spellsword, betterbot) left verified-mismatch; five of them the parser cannot fully resolve yet
// (the Choose One "…, or …" shape), so they join the queue. A conscious move.
// 570 → 576 on 2026-09-10 (third move): the seven Set 3 spells arrived; six print shapes the parser cannot fully
// resolve yet (a random HAND minion, board-and-hand, "also casts on", destroy-then-get, left-most in hand,
// per-tribe-played). A conscious move.
// 576 → 577: Stellar Chorus (tranche II) — its per-spell improvement clause is unresolved; Split Decision parses.
// 577 → 582 on 2026-09-11: the eight reworked Set 3 Celestials arrived; five print shapes the parser cannot resolve
// yet ("your next Shop spell +A/+H", "a copy of the first spell you cast this turn", "the first time each turn you
// cast <named spell> on this", "after you cast your third Shop spell", "Equip <X> (N): casts N additional times").
// A conscious move.
// 582 → 55 on 2026-09-11: the histogram-driven coverage pass (docs/devlog/2026-09-11-docbot-text-parser-coverage.md)
// — mid-text trigger prefixes, the general target grammar, subject-first sentences, conditional clauses mapped onto
// the content `on` vocabulary, improvement / scaler / cadence clauses, Ruby casts, Equip, consume, stat transfers,
// cost sentences, token bodies, notes and limits. The ratchet may only SHRINK from here.
const UNRESOLVED_CAP = 55;
/** Collapse floor: the parser fully consuming fewer objects than this means a grammar regression. */
const PARSED_FLOOR = 900;
/** The HARD ceiling (2026-09-11): the unresolved share of active objects may never reach this fraction again. A
 *  content PR cannot raise `UNRESOLVED_CAP` past it — past this line the grammar must grow, not the pin. */
const UNRESOLVED_SHARE_CEILING = 0.35;

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

  it('HARD ceiling: the unresolved share stays below 35% of active objects — and the pin itself sits under it', () => {
    const share = SWEEP.buckets['unresolved-parse'] / CONTRACTS.length;
    expect(share, `${SWEEP.buckets['unresolved-parse']} of ${CONTRACTS.length} unresolved — the grammar must grow, the pin cannot`).toBeLessThan(UNRESOLVED_SHARE_CEILING);
    expect(UNRESOLVED_CAP / CONTRACTS.length, 'UNRESOLVED_CAP was raised past the hard ceiling — a content PR may not do that; extend the parser').toBeLessThan(UNRESOLVED_SHARE_CEILING);
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
 * THE 2026-09-11 COVERAGE PASS — one positive fixture per grammar family (a real printed text parses to the
 * semantic the comparators read), one negative per family (a near-miss stays unresolved — an unresolved parse is
 * NEVER a clean pass), and one sabotage per comparator the families map onto (a deliberately wrong contract is
 * reported as verified-mismatch while the real contract is clean).
 */
describe('grammar families (2026-09-11) — positive fixtures', () => {
  it('a trigger prefix after a keyword sentence is read (the leading-space gap that hid ~45 objects)', () => {
    const p = parseObjectText('**Taunt.** **Echo:** give your **Beast Aura** **+2/+4**.');
    expect(p.fullyParsed).toBe(true);
    expect(p.keywordLine).toEqual(['T']);
    expect(p.triggers.map((t) => t.event)).toEqual(['onDeath']);
    expect(p.effects.at(-1)).toMatchObject({ kind: 'stat-buff', amount: { attack: 2, health: 4 }, target: { scope: 'your-beast-aura' } });
  });

  it('a conditional clause maps onto the content `on` vocabulary and the target carries its printed count', () => {
    const p = parseObjectText('When you spend 5 Gold, give 2 random friendly Dwarves **+5/+5**.');
    expect(p.fullyParsed).toBe(true);
    expect(p.triggers[0]).toMatchObject({ event: 'goldSpent' });
    expect(p.effects[0]).toMatchObject({ kind: 'stat-buff', amount: { attack: 5, health: 5 }, target: { cardinality: 'exactly', count: 2, random: true, friendly: true } });
  });

  it('a first-per-window subject sentence records subject, target and the first-n limit', () => {
    const p = parseObjectText('The first Shop spell you cast each turn gives your Rubies **+1/+1**.');
    expect(p.fullyParsed).toBe(true);
    expect(p.effects[0]).toMatchObject({ kind: 'stat-buff', amount: { attack: 1, health: 1 }, target: { scope: 'your-rubies' } });
    expect(p.effects[0]?.subject?.scope).toMatch(/^first-/);
    expect(p.limits.some((l) => l.kind === 'first-n')).toBe(true);
  });

  it('an improvement clause carries its step and its countdown', () => {
    const p = parseObjectText('**Ward.** Whenever you summon a Beast, give it **+3/+3**. Improves **+3/+3** every 3 Beasts summoned.');
    expect(p.fullyParsed).toBe(true);
    expect(p.triggers[0]).toMatchObject({ event: 'onSummon' });
    expect(p.effects.find((e) => e.kind === 'improvement')).toMatchObject({ amount: { attack: 3, health: 3 }, cadence: { every: 3 } });
  });

  it('a Ruby cast prints its count and target; an Equip prefix carries its charge count', () => {
    const ruby = parseObjectText('**Rally:** cast 2 Rubies on your minions.');
    expect(ruby.fullyParsed).toBe(true);
    expect(ruby.effects[0]).toMatchObject({ kind: 'cast-ruby', amount: { value: 2, unit: 'rubies' }, target: { scope: 'your-minions', cardinality: 'all' } });
    const equip = parseObjectText('**Equip Comet (4):** your next spell casts 2 additional times.');
    expect(equip.fullyParsed).toBe(true);
    expect(equip.triggers[0]).toMatchObject({ event: 'equip', threshold: 4 });
    expect(equip.effects[0]).toMatchObject({ kind: 'multiplier-print', amount: { value: 2 } });
  });

  it('a Start-of-Turn repeat, a named get, a token body and a limit sentence all resolve', () => {
    const rune = parseObjectText('Get a Gold Pouch. Repeat every Start of Turn.');
    expect(rune.fullyParsed).toBe(true);
    expect(rune.effects[0]).toMatchObject({ kind: 'get-card', refId: 'emberpouch', summonCount: 1 });
    expect(rune.effects[1]).toMatchObject({ kind: 'repeat', cadence: { of: 'Start of Turn' } });
    const token = parseObjectText('A 3/1 Dwarf that attacks immediately when summoned.');
    expect(token.fullyParsed).toBe(true);
    expect(token.effects[0]).toMatchObject({ kind: 'token-body', amount: { attack: 3, health: 1 }, action: 'attacks-immediately' });
    const limit = parseObjectText('Summon an exact copy of a friendly minion. Needs a free board slot. Once per game.');
    expect(limit.fullyParsed).toBe(true);
    expect(limit.effects.map((e) => e.kind)).toEqual(['copy', 'note', 'note']);
    expect(limit.effects[0]?.copyMode).toBe('exact');
  });

  it('Choose One with an elided verb, a stat transfer, a stat multiply and a consume all resolve', () => {
    const choose = parseObjectText('**Choose One:** give a minion **+4 Attack**, or **+4 Health**.');
    expect(choose.fullyParsed).toBe(true);
    expect(choose.effects.map((e) => e.amount)).toEqual([{ attack: 4, health: 0 }, { attack: 0, health: 4 }]);
    const transfer = parseObjectText("**Rally:** give this minion's Attack to 2 other friendly minions.");
    expect(transfer.fullyParsed).toBe(true);
    expect(transfer.effects[0]).toMatchObject({ kind: 'stat-transfer', target: { count: 2 } });
    const mult = parseObjectText('When you sell a Demon, this gains double its stats.');
    expect(mult.fullyParsed).toBe(true);
    expect(mult.effects[0]?.kind).toBe('stat-transfer');
    const consume = parseObjectText('**Shout:** target a friendly Demon. It Consumes a minion in the Shop.');
    expect(consume.fullyParsed).toBe(true);
    expect(consume.effects[1]).toMatchObject({ kind: 'consume', summonCount: 1, subject: { scope: 'it' } });
  });

  it('a scaler, a cost sentence, a subject-first attack and an ability grant all resolve', () => {
    const scaler = parseObjectText('Give a minion **+1/+1**, plus **+2/+2** for every 6 Gold spent this turn.');
    expect(scaler.fullyParsed).toBe(true);
    expect(scaler.effects[0]?.scaler).toMatchObject({ every: 6, amount: { attack: 2, health: 2 } });
    const cost = parseObjectText('Shop Spells cost 1 less this turn.');
    expect(cost.fullyParsed).toBe(true);
    expect(cost.effects[0]).toMatchObject({ kind: 'cost-mod', amount: { value: 1, unit: 'less' } });
    const attack = parseObjectText('**Start of Combat:** your left-most and right-most Beasts attack immediately.');
    expect(attack.fullyParsed).toBe(true);
    expect(attack.effects[0]).toMatchObject({ kind: 'attack-immediately', subject: { scope: 'your-left-most-and-right-most-beasts' } });
    const grant = parseObjectText('Your Gemheart Golems gain Echo: summon an exact copy of this without Echo.');
    expect(grant.fullyParsed).toBe(true);
    expect(grant.effects.map((e) => e.kind)).toEqual(['grant-ability', 'copy']);
    expect(grant.effects[1]?.copyMode).toBe('exact');
  });

  it('a hand summon and a comma-list get resolve with their targets / names intact', () => {
    const hand = parseObjectText('**Echo:** summon the highest-Health minion from your hand.');
    expect(hand.fullyParsed).toBe(true);
    expect(hand.effects[0]).toMatchObject({ kind: 'summon', summonCount: 1, target: { scope: 'the-highest-health-minion-from-your-hand' } });
    const list = parseObjectText('Get a random Beast, Demon, Dragon, Mech, and Undead.');
    expect(list.fullyParsed).toBe(true);
    expect(list.effects[0]?.refName).toBe('Beast, Demon, Dragon, Mech, and Undead');
  });

  it('every span the grammar reads is visible — as a claim or as a listed modifier (§4.3)', () => {
    const p = parseObjectText('**Echo:** give the right-most Shop minion **+3/+2** permanently.');
    expect(p.fullyParsed).toBe(true);
    expect(p.consumedModifiers.map((m) => m.text.trim())).toEqual(['permanently']);
    expect(p.persistence.some((x) => x.kind === 'permanent')).toBe(true);
  });
});

describe('grammar families (2026-09-11) — negative fixtures: a near-miss is never a clean pass', () => {
  const unresolved = (text: string, contains: string): void => {
    const p = parseObjectText(text);
    expect(p.fullyParsed, `${JSON.stringify(text)} must NOT fully parse`).toBe(false);
    expect(p.unresolvedPhrases.map((u) => u.text).join(' | ')).toContain(contains);
  };

  it('an unmapped conditional stays an unresolved trigger even though its body parses', () => {
    const p = parseObjectText('When the moon is full, give your minions **+1/+1**.');
    expect(p.fullyParsed).toBe(false);
    expect(p.triggers[0]?.event).toBe('conditional:unknown');
    expect(p.effects[0]?.kind).toBe('stat-buff'); // the partial parse is honest — the claim it DID read stays
  });

  it('an unmapped cadence subject, a non-Gold "gain", a stray verb and a bespoke summon all stay unresolved', () => {
    unresolved('Every 5 moonbeams, get a Gold Pouch.', 'Every 5 moonbeams');
    unresolved('Gain 30 seconds on your turn timer next turn.', 'gain 30 seconds'.replace('gain', 'Gain'));
    unresolved('Improve your Rubies by **+1/+1** and dance.', 'dance');
    unresolved('Summon a token with stats equal to its Ruby bonuses.', 'token');
  });

  it('a name stops at a relative clause; a bespoke first-per-window body stays unresolved', () => {
    unresolved('Get 5 Rubies that give **+3/+3**.', 'that give');
    unresolved('The first minion you buy each turn refills its Shop slot.', 'refills');
  });

  it('a whole-sentence note is recognized only from the tight list — free prose is not a note', () => {
    unresolved('Needs a free board slot and a cup of tea.', 'cup of tea');
  });
});

describe('grammar families (2026-09-11) — sabotage: each new comparator convicts a doctored contract', () => {
  type Contract = (typeof CONTRACTS)[number];
  const one = (id: string): Contract => {
    const c = CONTRACTS.find((x) => x.contentId === id);
    if (!c) throw new Error(`${id} left the registry`);
    return c;
  };
  const withPlain = (c: Contract, edit: (plain: Record<string, unknown>) => void): Contract => {
    const e = structuredClone(c.effects![0]!);
    if (e.amount?.kind !== 'const') throw new Error('fixture expects a const amount');
    edit(e.amount.plain as Record<string, unknown>);
    return { ...c, effects: [e] };
  };
  const taxonomiesOf = (c: Contract): string[] => runTextSweep({ contracts: [c] }).mismatches.map((m) => m.taxonomy);

  it('composite wrong-amount (Beardsley: +3/+3 beside every/improve)', () => {
    expect(taxonomiesOf(one('b2_beardsley'))).toEqual([]);
    expect(taxonomiesOf(withPlain(one('b2_beardsley'), (p) => { p.attack = 4; }))).toContain('wrong-amount');
  });

  it('wrong-target-count (Billings: "give 2 random friendly Dwarves")', () => {
    expect(taxonomiesOf(one('dw_billings'))).toEqual([]);
    expect(taxonomiesOf(withPlain(one('dw_billings'), (p) => { p.count = 3; }))).toContain('wrong-target-count');
  });

  it('improvement step and countdown (Beardsley: "Improves +3/+3 every 3 Beasts summoned")', () => {
    expect(taxonomiesOf(withPlain(one('b2_beardsley'), (p) => { p.improve = 5; }))).toContain('wrong-amount');
    expect(taxonomiesOf(withPlain(one('b2_beardsley'), (p) => { p.every = 4; }))).toContain('wrong-threshold');
  });

  it('Ruby-cast count (Ruby Roach: "cast a Ruby on your minions")', () => {
    expect(taxonomiesOf(one('k3_rubyroach'))).toEqual([]);
    expect(taxonomiesOf(withPlain(one('k3_rubyroach'), (p) => { p.count = 2; }))).toContain('wrong-amount');
  });

  it('cadence prefix (Scale: "Every 5 Gold you spend")', () => {
    expect(taxonomiesOf(one('rune_scale'))).toEqual([]);
    expect(taxonomiesOf(withPlain(one('rune_scale'), (p) => { p.per = 7; }))).toContain('wrong-threshold');
  });

  it('conditional-clause and Equip triggers compare against the contract trigger vocabulary', () => {
    const billings = one('dw_billings');
    expect(taxonomiesOf({ ...billings, triggers: [{ event: 'onBuy', phase: 'shop' }] })).toContain('wrong-trigger');
    const artificer = one('ce3_artificer');
    expect(taxonomiesOf(artificer)).toEqual([]);
    expect(taxonomiesOf({ ...artificer, triggers: [{ event: 'onPlay', phase: 'shop' }] })).toContain('wrong-trigger');
  });

  it('Gem Gorger: "you cast 3 spells" over a `rubyCast` factory is correct text — the trigger is the spell+Ruby umbrella (owner 2026-07-24, 2026-09-11)', () => {
    const gorger = one('k_gemgorge');
    expect(gorger.triggers?.map((t) => t.event)).toContain('rubyCast');
    expect(taxonomiesOf(gorger)).toEqual([]);
    // Sabotage: the same text over a contract that names an unrelated trigger is still convicted.
    expect(taxonomiesOf({ ...gorger, triggers: [{ event: 'onBuy', phase: 'shop' }] })).toContain('wrong-trigger');
  });

  it('the Brood draft-contract gap reproduces when its curated gild shape is doctored back to ×2', () => {
    const brood = one('brood');
    expect(brood.gildedDelta?.kind).toBe('reshape');
    expect(taxonomiesOf(brood)).toEqual([]);
    expect(taxonomiesOf({ ...brood, gildedDelta: { kind: 'multiply', factor: 2, description: 'DOCTORED — the extractor\'s old guess' } })).toContain('wrong-gilded-amount');
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
  it('the xerox text is FIXED (2026-09-10: "an exact copy") — and a doctored plain wording against the approved contract is a verified-text-defect', () => {
    expect(SWEEP.findings.find((x) => x.contentIds.includes('hero:xerox')), 'no live finding: the printed text names the copy mode').toBeUndefined();
    const xerox = CONTRACTS.find((c) => c.contentId === 'hero:xerox')!;
    // A hero power's text object reads the LIVE power text, so the doctoring goes through `parseOf`.
    const doctored = runTextSweep({
      contracts: [xerox],
      parseOf: (t) => parseObjectText(t.contentId === 'hero:xerox' ? 'Summon a copy of a friendly minion. Needs a free board slot. Once per game.' : t.text),
    });
    const f = doctored.findings.find((x) => x.contentIds.includes('hero:xerox'));
    expect(f?.class, 'an approved contract + an unmarked "copy" is a conviction, not a question').toBe('verified-text-defect');
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
    // No live recommendation is expected as of 2026-09-10 (Selfless Sentinel's "Divine Shield" was the last one;
    // LG-TWICE-01 is contested and never advises). The detector is proven on a doctored object below.
    const doctored = runRewriteAdvisor({
      objects: [{ ...textObjectOf(CONTRACTS.find((c) => c.contentId === 'selfless')!), text: '**Deathrattle:** give a friend a **Divine Shield**.' }],
      guide: LANGUAGE_GUIDE,
    });
    expect(doctored.some((f) => f.ruleIds.includes('LG-KEYWORD-01') && f.suggestedText?.includes('Ward')), 'the Ward rule still advises on a doctored "Divine Shield"').toBe(true);
    for (const f of [...recs, ...doctored]) {
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
