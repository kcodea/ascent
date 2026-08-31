/**
 * DOC BOT 2.0 WP E — semantic comparison + the §18-E classification (blueprint §11.2).
 *
 * For every active object (enumerated BY the contract registry, so the surface equals WP B's inventory):
 * parse the printed text, compare the claims the parse honestly supports against the object's contract,
 * and classify into exactly one of the four exit-gate buckets:
 *
 *   parsed-equivalent  — every span consumed AND no comparison disagreed (textless objects are vacuously
 *                        equivalent and counted separately — a quest prints no free text by design);
 *   verified-mismatch  — at least one implemented detector disagreed (finding class then follows §6.1
 *                        authority: approved/exception contract ⇒ verified-text-defect; a draft ⇒
 *                        questionable, queued for review — never a conviction);
 *   approved-exception — the object is in TEXT_EXCEPTIONS (owner-sanctioned bespoke wording);
 *   unresolved-parse   — unconsumed spans remain and nothing disagreed. NEVER reported as a clean pass
 *                        (§4.3/§11.1): the report and the lane both carry it as a visible queue.
 *
 * VERIFY-BEFORE-ALARM: every mismatch must be investigated before it may stand — the KNOWN_TEXT_MISMATCH
 * registry records each verdict (real defect pending fix / parser limitation being tolerated / triage),
 * and textParse.test.ts fails loudly on any mismatch the registry does not carry.
 */
import type { ContentContract } from '@game/rules/contracts/schema';
import { makeFinding, type DocbotFinding } from '../findings';
import { textObjectOf, type TextObject } from './corpus';
import { parseObjectText } from './parser';
import type { MismatchTaxonomyId, ParsedTextContract, TextBucket, TextMismatch } from './types';

export const TEXT_LANE = 'text-parse';

// ── registries (typed excuses; the ratchet in textParse.test.ts pins both) ───────────────────────────────

/** Owner-sanctioned bespoke wording: classification 'approved-exception'. NOTHING is seeded — an entry
 *  here requires an explicit owner ruling on the object's wording (§23: never auto-approved). */
export const TEXT_EXCEPTIONS: Readonly<Record<string, { why: string }>> = {};

export interface KnownTextMismatch {
  taxonomy: MismatchTaxonomyId;
  /**
   *  'confirmed-defect-pending-fix' — investigated, the text/contract disagreement is REAL; documented
   *                                   here (WP E never edits content — §23) until the fix PR deletes it.
   *  'parser-limitation'            — investigated, the disagreement is the parser mis-reading bespoke
   *                                   prose; tolerated with the exact reason until the grammar grows.
   *  'draft-contract-gap'           — investigated, the text is right and the EXTRACTED contract's guess
   *                                   is what disagrees; queues the contract for review, not the text.
   *  'needs-triage'                 — found, not yet ruled. Tolerated, reported, pinned.
   */
  kind: 'confirmed-defect-pending-fix' | 'parser-limitation' | 'draft-contract-gap' | 'needs-triage';
  why: string;
}

export const KNOWN_TEXT_MISMATCH: Readonly<Record<string, KnownTextMismatch>> = {
  // Seeded from this lane's own first full run (2026-08-27) — every entry investigated before excusal.
  'hero:xerox': {
    taxonomy: 'plain-vs-exact-copy',
    kind: 'confirmed-defect-pending-fix',
    why: 'the slice\'s verified-text-defect, rediscovered mechanically: the APPROVED contract rules the copy EXACT (gilding + counters ride — reducer-proven) while the printed "Summon a copy" reads plain under R-COPY-01. The wording fix (say "exact copy") is a content edit for its own PR; LG-COPY-01 carries the rule.',
  },
  kennel: {
    taxonomy: 'wrong-trigger',
    kind: 'draft-contract-gap',
    why: 'the text\'s "Start of Combat:" leg is REAL (kennel buffs Beasts at SC); the curated slice contract states only the Avenge-improve leg it was written to pin. The contract is incomplete, not the text — completed at contract review, and this pin deletes.',
  },
  // The Choose One family: the WP B extractor walks def.effects only, so choose-one payloads parse to
  // ZERO effects while the draft still stamps confidence \'high\' — an extractor honesty gap this lane
  // caught. The texts are right; the drafts are incomplete. Each pin deletes when the extractor learns
  // choose-one payloads (queued for the WP B/H extraction follow-up).
  shaper: { taxonomy: 'text-promises-absent-effect', kind: 'draft-contract-gap', why: 'Choose One card — extractor parses no choose-one payloads; text is right, draft incomplete (confidence over-claimed as high)' },
  godfodder: { taxonomy: 'text-promises-absent-effect', kind: 'draft-contract-gap', why: 'Choose One card — same extractor choose-one blind spot as shaper' },
  contractimp: { taxonomy: 'text-promises-absent-effect', kind: 'draft-contract-gap', why: 'Choose One token — same extractor choose-one blind spot as shaper' },
  crestclimb: { taxonomy: 'text-promises-absent-effect', kind: 'draft-contract-gap', why: 'Choose One spell — same extractor choose-one blind spot as shaper' },
  k_veinbreaker: { taxonomy: 'text-promises-absent-effect', kind: 'draft-contract-gap', why: 'Choose One card — same extractor choose-one blind spot as shaper' },
  // Gemsmith is k_veinbreaker's mechanic (both branches are rubyStatGain), so it reproduces the
  // pin directly above it rather than being a new class of miss.
  k3_forkvein: { taxonomy: 'text-promises-absent-effect', kind: 'draft-contract-gap', why: 'Choose One card — same extractor choose-one blind spot as shaper' },
  n2_spellsword: { taxonomy: 'text-promises-absent-effect', kind: 'draft-contract-gap', why: 'Choose One card — same extractor choose-one blind spot as shaper' },
  betterbot: {
    taxonomy: 'text-promises-absent-effect',
    kind: 'draft-contract-gap',
    why: 'its Rally buff is implemented through the Magnetic weld path, not a def.effects entry, so the extractor parsed no effects (and stamped high confidence). The text is right; the draft is incomplete.',
  },
};

// ── comparison helpers ───────────────────────────────────────────────────────────────────────────────────

/** The exact {attack, health} const pair of one effect — the corroboration lane's attribution guard,
 *  kept verbatim: composite params make first-buff attribution unsafe. */
function attackHealthOf(e: NonNullable<ContentContract['effects']>[number]): { attack: number; health: number } | null {
  if (e.amount?.kind !== 'const' || typeof e.amount.plain !== 'object' || e.amount.plain === null || Array.isArray(e.amount.plain)) return null;
  const o = e.amount.plain as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  if (keys.length !== 2 || keys[0] !== 'attack' || keys[1] !== 'health') return null;
  if (typeof o.attack === 'number' && typeof o.health === 'number') return { attack: o.attack, health: o.health };
  return null;
}

/** Parsed prefix-trigger events that are directly comparable to contract trigger events. Conditional
 *  clauses and unmapped events never enter the comparison (guard, not silence — they stay in the parse). */
const COMPARABLE_TRIGGERS = new Set(['onPlay', 'onDeath', 'startOfCombat', 'endOfTurn', 'avenge', 'onSell', 'onKill', 'onAttack']);

function compareOne(c: ContentContract, t: TextObject, p: ParsedTextContract, pg: ParsedTextContract | null): TextMismatch[] {
  const out: TextMismatch[] = [];
  const mism = (taxonomy: MismatchTaxonomyId, expected: string, observed: string, detail: string): void => {
    out.push({ contentId: c.contentId, taxonomy, expected, observed, detail });
  };
  const cardLike = c.contentType === 'minion' || c.contentType === 'spell' || c.contentType === 'token'
    || c.contentType === 'gift' || c.contentType === 'henchman';
  const effs = c.effects ?? [];

  // 1. wrong-amount — single-effect exact-pair guard (the corroboration lane's attribution rule).
  const firstBuff = p.effects.find((e) => e.kind === 'stat-buff');
  if (firstBuff?.amount && effs.length === 1) {
    const pair = attackHealthOf(effs[0]!);
    if (pair && (pair.attack !== (firstBuff.amount.attack ?? 0) || pair.health !== (firstBuff.amount.health ?? 0))) {
      mism('wrong-amount', `+${pair.attack}/+${pair.health}`, `+${firstBuff.amount.attack ?? 0}/+${firstBuff.amount.health ?? 0}`,
        'text prints one stat pair; the contract\'s single effect states another');
    }
  }

  // 2. summons — named tokens only (the T2 guard).
  const summonClaims = effs.map((e) => e.summons).filter((s): s is NonNullable<typeof s> => !!s);
  const printedSummon = p.effects.find((e) => e.kind === 'summon' && e.refId);
  if (printedSummon?.refId && summonClaims.length > 0) {
    const match = summonClaims.find((s) => s.cardId === printedSummon.refId);
    if (!match) {
      mism('wrong-generated-card', summonClaims.map((s) => s.cardId).join(','), printedSummon.refId,
        'text names a summoned token the contract\'s summon claims do not carry');
    } else if (printedSummon.summonCount !== undefined && match.count.plain !== printedSummon.summonCount) {
      mism('wrong-summon-count', String(match.count.plain), String(printedSummon.summonCount),
        `text promises ${printedSummon.summonCount} × '${match.cardId}', the contract states ${match.count.plain}`);
    }
  }

  // 3. wrong-trigger + 4. wrong-threshold — prefix triggers against contract trigger events. Spells and
  // gifts are OUT: their one contract trigger is 'cast' and any printed trigger word describes the
  // delayed payload, not the cast (fleetingvigor's "Start of combat:" is correct text). Display events
  // that map to more than one engine event compare against the alias set ("Sell:" is onSell OR
  // minionSold depending on the factory).
  const EVENT_ALIASES: Record<string, string[]> = { onSell: ['onSell', 'minionSold'] };
  const contractEvents = new Set((c.triggers ?? []).map((x) => x.event));
  const triggerComparable = cardLike && c.contentType !== 'spell' && c.contentType !== 'gift';
  if (contractEvents.size > 0 && triggerComparable) {
    for (const trig of p.triggers) {
      if (!COMPARABLE_TRIGGERS.has(trig.event)) continue;
      const accepted = EVENT_ALIASES[trig.event] ?? [trig.event];
      if (!accepted.some((ev) => contractEvents.has(ev))) {
        mism('wrong-trigger', [...contractEvents].join(','), trig.event,
          `text prints a '${trig.display}' trigger but the contract states no '${trig.event}' trigger`);
        continue;
      }
      if (trig.event === 'avenge' && trig.threshold !== undefined) {
        const claim = (c.triggers ?? []).find((x) => x.event === 'avenge');
        if (claim?.threshold !== undefined && claim.threshold !== trig.threshold) {
          mism('wrong-threshold', String(claim.threshold), String(trig.threshold),
            `text prints Avenge (${trig.threshold}) but the contract threshold is ${claim.threshold}`);
        }
      }
    }
  }

  // 5. plain-vs-exact copy — only when the contract states a policy (R-COPY-01: unmarked means plain).
  const copyEff = p.effects.find((e) => e.kind === 'copy');
  if (copyEff && c.copyPolicy) {
    const printedMode = copyEff.copyMode === 'unmarked' ? 'plain' : copyEff.copyMode;
    if (printedMode !== c.copyPolicy.mode) {
      mism('plain-vs-exact-copy', c.copyPolicy.mode, `${copyEff.copyMode} (reads as ${printedMode})`,
        'R-COPY-01: an unmarked "copy" reads as plain; the contract\'s ruled mode disagrees with the printed wording');
    }
  }

  // 6. gilded-delta shape consistency + 7. gilded amounts/counts (the gilded-text verification leg).
  if (cardLike && c.gildedDelta) {
    // A card MAY carry authored gilded text under a 'multiply' contract — the authored text can simply
    // WRITE OUT the ×N doubling (wolvesden: 3 → 6 Crypt Wolves). The honest check is therefore the
    // amounts themselves, where both parses support a comparison; where they don't, no claim is made
    // (first run's structural "goldenText ⇒ reshape" alarm was investigated and found wrong — curated
    // contracts legitimately declare multiply beside written-out gilded text).
    // The declared shape decides which printed-number relation (if any) the golden text must satisfy —
    // the owner's 2026-08-28 vocabulary: 'multiply' ×factor, 'extra-proc' ×(1 + extra) (Gemstorm prints its
    // extra proc as a doubled Ruby count), 'gilded-token' / 'reshape' / 'not-applicable' state no relation.
    const printedFactor = c.gildedDelta.kind === 'multiply'
      ? c.gildedDelta.factor
      : c.gildedDelta.kind === 'extra-proc' ? 1 + c.gildedDelta.extra : null;
    if (t.goldenText && printedFactor !== null) {
      const factor = printedFactor;
      const plainPair = p.effects.find((e) => e.kind === 'stat-buff')?.amount;
      const goldPair = pg?.effects.find((e) => e.kind === 'stat-buff')?.amount;
      if (plainPair && goldPair && p.fullyParsed && pg?.fullyParsed) {
        if ((goldPair.attack ?? 0) !== (plainPair.attack ?? 0) * factor || (goldPair.health ?? 0) !== (plainPair.health ?? 0) * factor) {
          mism('wrong-gilded-amount',
            `+${(plainPair.attack ?? 0) * factor}/+${(plainPair.health ?? 0) * factor}`,
            `+${goldPair.attack ?? 0}/+${goldPair.health ?? 0}`,
            `contract declares gild = ×${factor} but the authored gilded text prints a different pair`);
        }
      }
      const plainSummon = p.effects.find((e) => e.kind === 'summon' && e.refId);
      const goldSummonM = pg?.effects.find((e) => e.kind === 'summon' && e.refId === plainSummon?.refId);
      if (plainSummon?.summonCount !== undefined && goldSummonM?.summonCount !== undefined
        && goldSummonM.summonCount !== plainSummon.summonCount * factor) {
        mism('wrong-gilded-amount', `${plainSummon.summonCount * factor} × '${plainSummon.refId}'`,
          `${goldSummonM.summonCount} × '${goldSummonM.refId}'`,
          `contract declares gild = ×${factor} but the gilded text's summon count is not plain × ${factor}`);
      }
    }
    if (!t.goldenText && c.gildedDelta.kind === 'reshape' && t.contentType !== 'spell') {
      mism('missing-gilded-delta', 'authored gilded text (contract: reshape)', 'no goldenText on the def',
        'the contract claims a shape-changing gild but the card carries no authored gilded text');
    }
    // 'not-applicable' (R-GILD-02 — owner 2026-08-28: "spells cannot be gilded") is a claim the printed
    // text can contradict: an object that can never BE gilded must not carry an authored gilded body.
    if (t.goldenText && c.gildedDelta.kind === 'not-applicable') {
      mism('missing-gilded-delta', 'no gilded text (contract: not-applicable)', 'the def carries goldenText',
        `the contract rules gilding inapplicable (${c.gildedDelta.reason}) but the card authors a gilded body — one of the two is wrong`);
    }
    // 'gilded-token': the gild changes the token's IDENTITY, not the count. The IDENTITY half is verified by
    // the engine (contractOracle's gilded-shape driver reads the summon events' golden flag), which is a
    // stronger check than any keyword search — a card may legitimately describe the gilded token by its
    // stats instead of the word "Gilded" (Void Panther: "two 0/2 Void Cubs" → "two 0/4 Void Cubs"). What the
    // TEXT can honestly own is the count: a gilded-token gild must not print a different number.
    if (t.goldenText && c.gildedDelta.kind === 'gilded-token') {
      const plainS = p.effects.find((e) => e.kind === 'summon' && e.refId);
      const goldS = pg?.effects.find((e) => e.kind === 'summon' && e.refId);
      if (plainS?.summonCount !== undefined && goldS?.summonCount !== undefined && goldS.summonCount !== plainS.summonCount) {
        mism('wrong-summon-count', `gilded ${plainS.summonCount} (unchanged — 'gilded-token')`, `gilded text prints ${goldS.summonCount}`,
          'a gilded-token gild changes the token\'s identity, not the count — but the gilded text prints a different number');
      }
    }
    const gildedSummon = summonClaims.find((s) => s.count.gilded !== undefined);
    const goldSummon = pg?.effects.find((e) => e.kind === 'summon' && e.refId);
    if (gildedSummon && goldSummon?.refId === gildedSummon.cardId && goldSummon.summonCount !== undefined
      && goldSummon.summonCount !== gildedSummon.count.gilded) {
      mism('wrong-summon-count', `gilded ${gildedSummon.count.gilded}`, `gilded text prints ${goldSummon.summonCount}`,
        `gilded text promises ${goldSummon.summonCount} × '${gildedSummon.cardId}' but the contract's gilded count is ${gildedSummon.count.gilded}`);
    }
  }

  // 8. runtime-effect-absent-from-text — the object acts but prints nothing.
  if (cardLike && effs.length > 0 && t.textless) {
    mism('runtime-effect-absent-from-text', `${effs.length} contract effect(s)`, 'blank printed text',
      'the contract states effects but the object prints no text at all');
  }

  // 9. text-promises-absent-effect — a high-confidence printed promise with zero contract effects.
  const promises = p.effects.filter((e) => e.kind === 'stat-buff' || e.kind === 'summon');
  if (cardLike && promises.length > 0 && effs.length === 0 && p.triggers.length > 0) {
    mism('text-promises-absent-effect', 'a contract effect backing the printed promise', 'contract states no effects',
      `text promises ${promises.map((e) => e.kind).join('+')} under a printed trigger but the contract carries no effect claims`);
  }

  return out;
}

// ── the sweep ────────────────────────────────────────────────────────────────────────────────────────────

export interface TextObjectRow {
  contentId: string;
  contentType: ContentContract['contentType'];
  bucket: TextBucket;
  textless: boolean;
  unresolvedCount: number;
  /** The unresolved spans, verbatim (the visible queue — §11.1). */
  unresolved: string[];
  mismatches: TextMismatch[];
  /** Present when the mismatch/exception is registry-pinned. */
  pinned?: string;
}

export interface TextSweepOptions {
  contracts: readonly ContentContract[];
  /** Injectable parses (sabotage — §4.5). Defaults to the real parser over the index-resolved text. */
  parseOf?: (t: TextObject) => ParsedTextContract;
  goldenParseOf?: (t: TextObject) => ParsedTextContract | null;
  /** Which contract ids carry §6.1 authority (approved/exception, or runtime-corroborated when the
   *  caller supplies corroboration rows). Defaults to stored approved/exception. */
  approvedLike?: (c: ContentContract) => boolean;
  /** The owner-sanctioned wording exceptions (defaults to TEXT_EXCEPTIONS; injectable for tests). */
  exceptions?: Readonly<Record<string, { why: string }>>;
  semanticRevision?: string;
}

export interface TextSweepReport {
  total: number;
  buckets: Record<TextBucket, number>;
  byType: Record<string, Record<TextBucket, number>>;
  textless: number;
  rows: TextObjectRow[];
  mismatches: TextMismatch[];
  /** Mismatch ids the KNOWN_TEXT_MISMATCH registry does NOT carry — must be empty in the gate. */
  unpinnedMismatchIds: string[];
  /** Registry entries whose object no longer mismatches (stale pins — must be empty in the gate). */
  staleKnownIds: string[];
  findings: DocbotFinding[];
}

const emptyBuckets = (): Record<TextBucket, number> =>
  ({ 'parsed-equivalent': 0, 'verified-mismatch': 0, 'approved-exception': 0, 'unresolved-parse': 0 });

export function runTextSweep(opts: TextSweepOptions): TextSweepReport {
  const parseOf = opts.parseOf ?? ((t: TextObject) => parseObjectText(t.text));
  const goldenParseOf = opts.goldenParseOf ?? ((t: TextObject) => (t.goldenText ? parseObjectText(t.goldenText) : null));
  const approvedLike = opts.approvedLike ?? ((c: ContentContract) => c.reviewStatus === 'approved' || c.reviewStatus === 'exception');
  const exceptions = opts.exceptions ?? TEXT_EXCEPTIONS;
  const semanticRevision = opts.semanticRevision ?? 'dev';

  const rows: TextObjectRow[] = [];
  const allMismatches: TextMismatch[] = [];
  const findings: DocbotFinding[] = [];
  const buckets = emptyBuckets();
  const byType: Record<string, Record<TextBucket, number>> = {};
  let textless = 0;

  for (const c of opts.contracts) {
    const t = textObjectOf(c);
    const p = parseOf(t);
    const pg = goldenParseOf(t);
    const mismatches = compareOne(c, t, p, pg);
    const exception = exceptions[c.contentId];
    const unresolvedSpans = [...p.unresolvedPhrases, ...(pg?.unresolvedPhrases ?? [])];

    // One bucket per object — precedence: exception > mismatch > unresolved > equivalent (§18-E; an
    // object with BOTH a mismatch and unresolved spans is a mismatch — the disagreement stands — and can
    // never be 'parsed-equivalent' either way).
    const bucket: TextBucket = exception
      ? 'approved-exception'
      : mismatches.length > 0
        ? 'verified-mismatch'
        : unresolvedSpans.length > 0
          ? 'unresolved-parse'
          : 'parsed-equivalent';

    if (t.textless) textless += 1;
    buckets[bucket] += 1;
    byType[c.contentType] = byType[c.contentType] ?? emptyBuckets();
    byType[c.contentType]![bucket] += 1;
    allMismatches.push(...mismatches);

    const known = KNOWN_TEXT_MISMATCH[c.contentId];
    rows.push({
      contentId: c.contentId, contentType: c.contentType, bucket, textless: t.textless,
      unresolvedCount: unresolvedSpans.length,
      unresolved: unresolvedSpans.map((s) => s.text),
      mismatches,
      ...(exception ? { pinned: `exception: ${exception.why}` } : known && mismatches.length ? { pinned: `${known.kind}: ${known.why}` } : {}),
    });

    for (const m of mismatches) {
      const authoritative = approvedLike(c);
      findings.push(makeFinding({
        lane: TEXT_LANE,
        contentIds: [c.contentId],
        ruleIds: c.relatedRuleIds ?? [],
        expectationKind: `text:${m.taxonomy}`,
        expected: m.expected,
        observed: m.observed,
        severity: authoritative ? 'error' : 'question',
        confidence: authoritative ? 'strong' : 'uncertain',
        status: 'needs-ruling',
        title: authoritative
          ? `text defect: ${c.contentId} · ${m.taxonomy}`
          : `text vs draft contract disagree: ${c.contentId} · ${m.taxonomy}`,
        summary: `${m.detail}. `
          + (authoritative
            ? 'The contract side is owner-authoritative (§6.1) — this is a verified text defect.'
            : 'The contract side is an unreviewed draft — this queues BOTH readings for review; it convicts neither the text nor the engine (§6.1).'),
        class: authoritative ? 'verified-text-defect' : 'questionable-interaction',
        provenance: { lane: TEXT_LANE },
        semanticRevision,
        contractIds: [c.contentId],
      }));
    }
  }

  const mismatchIds = new Set(allMismatches.map((m) => m.contentId));
  const unpinnedMismatchIds = [...mismatchIds].filter((id) => !KNOWN_TEXT_MISMATCH[id]).sort();
  const staleKnownIds = Object.keys(KNOWN_TEXT_MISMATCH).filter((id) => !mismatchIds.has(id)).sort();

  return {
    total: opts.contracts.length,
    buckets, byType, textless, rows,
    mismatches: allMismatches,
    unpinnedMismatchIds,
    staleKnownIds,
    findings,
  };
}
