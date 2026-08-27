/**
 * DOC BOT 2.0 VERTICAL SLICE — the four §1 output classes, each emitted ONCE from a real observation
 * (blueprint §19: "The slice must demonstrate all four output classes"). Every finding here is built from
 * measurements the contract oracle actually took this run — never hard-coded observations.
 *
 *  1. verified-mechanical-bug   — the R-AVWIN-10 violation (approved rule, deterministic double repro,
 *                                 first divergence named, minimized scenario graduated).
 *  2. verified-text-defect      — Xerox's Copy Machine prints "a copy" where the approved contract
 *                                 (owner rulings 2026-08-14/15; R-COPY-02) establishes an EXACT copy.
 *  3. wording-recommendation    — Zyff's non-stacker "an additional time" (owner-flagged terminology,
 *                                 decisions.json q-interact-nonstack-best-of; R-MULT-01).
 *  4. questionable-interaction  — a Rise minion's own Echo fires on BOTH its deaths (no governing rule).
 */
import { makeFinding, type DocbotFinding } from '../findings';
import type { SliceProbeReport } from './contractOracle';

export const SLICE_LANE = 'slice-contract-oracle';

export function buildSliceFindings(report: SliceProbeReport, semanticRevision: string): DocbotFinding[] {
  const findings: DocbotFinding[] = [];

  // ── 1. VERIFIED MECHANICAL BUG (§12.1: approved rule violated · reproduced twice · first divergence
  //       identified · minimized scenario produced) ──────────────────────────────────────────────────────
  const { avwin10 } = report;
  const doublyReproduced = avwin10.fires === avwin10.firesSecondRun && avwin10.scenarioDeterministic;
  if (avwin10.fires > 0) {
    findings.push(makeFinding({
      lane: SLICE_LANE,
      contentIds: ['stuntdrake'],
      ruleIds: ['R-AVWIN-10'],
      expectationKind: 'temporal-window',
      expected: 0,
      observed: avwin10.fires,
      severity: 'error',
      // 'proven' ONLY on the §4.4 double reproduction; anything less caps at 'strong'.
      confidence: doublyReproduced ? 'proven' : 'strong',
      status: 'known', // pinned in temporalWindow KNOWN_VIOLATIONS + the graduated fixture
      title: 'A source dying in a simultaneous batch observes its batch-mates and fires while dying (R-AVWIN-10)',
      summary: 'In the minimized cleave-batch fixture the mortally-wounded Obsidian Drake observes the two '
        + 'batch-mates resolved before it, reaches Avenge (3), and fires one grant while itself dying. '
        + `Ruled behaviour (R-AVWIN-10, approved): zero fires. Observed: ${avwin10.fires}, identically on `
        + 'a second run of the same capsule. The engine dispatch guard checks only `minion.dead` while '
        + 'clash deaths resolve sequentially — the diagnosis pinned in temporalWindow KNOWN_VIOLATIONS.',
      scenarioId: 'avenge-dying-source-batch-pin',
      reproduction: 'npm run docbot:scenario -- avenge-dying-source-batch-pin',
      class: 'verified-mechanical-bug',
      firstDivergence: { step: avwin10.firstDivergenceStep, expected: 'no avenge-stamped grant by the dying source', observed: 'avenge-stamped buff by the dying drake' },
      minimizationStatus: 'complete',
      provenance: { lane: SLICE_LANE, scenarioIds: ['avenge-dying-source-batch-pin'] },
      semanticRevision,
      contractIds: ['stuntdrake'],
    }));
  }

  // ── 2. VERIFIED TEXT DEFECT (§12.1: approved contract + verified runtime establish behaviour; the
  //       displayed text omits the required plain/exact discriminator) ───────────────────────────────────
  if (report.xerox.copyGolden) {
    findings.push(makeFinding({
      lane: SLICE_LANE,
      contentIds: ['hero:xerox'],
      ruleIds: ['R-COPY-01', 'R-COPY-02'],
      expectationKind: 'text-copy-discriminator',
      expected: 'text names the copy mode (exact)',
      observed: 'text says only "a copy"; runtime copies gilding + accrued counters (exact)',
      severity: 'warning',
      confidence: 'strong',
      title: 'Copy Machine says "a copy" but performs an EXACT copy — the required plain/exact term is missing',
      summary: 'The approved contract (owner ruling 2026-08-15; R-COPY-02, cited by R-AVWIN-03\'s conforming '
        + 'behaviour note) makes Copy Machine an EXACT copy, and the runtime proves it: copying a gilded '
        + `Kennelmaster with summonBonus 2 yielded a copy with golden=true and summonBonus ${report.xerox.copySummonBonus}. `
        + 'The printed text — "Summon a copy of a friendly minion." — omits the discriminator that the '
        + 'R-COPY-01/02 vocabulary makes load-bearing (Bellringer Voss prints "plain copy"; the Dwarf '
        + 'echo-twin prints "exact copy"): an unmarked copy reads as R-COPY-01\'s fresh base copy, which '
        + 'conflicts with what the power actually summons.',
      class: 'verified-text-defect',
      suggestedText: 'Summon an exact copy of a friendly minion. Needs a free board slot. Once per game.',
      provenance: { lane: SLICE_LANE },
      semanticRevision,
      contractIds: ['hero:xerox'],
    }));
  }

  // ── 3. WORDING RECOMMENDATION (§11.4: mechanically correct, owner-flagged terminology; the multiplier
  //       measurement above proves the mechanics are right, so this is wording only) ─────────────────────
  findings.push(makeFinding({
    lane: SLICE_LANE,
    contentIds: ['zyff'],
    ruleIds: ['R-MULT-01'],
    expectationKind: 'wording-nonstacker-terminology',
    expected: '"Twice" (the owner\'s non-stacker signal)',
    observed: '"trigger an additional time" (reads as stackable)',
    severity: 'info',
    confidence: 'strong',
    status: 'needs-ruling', // the terminology pass is the owner's declared future work — advice, not a defect
    title: 'Zyff (non-stacking) says "an additional time" — the owner\'s ruled non-stacker wording is "Twice"',
    summary: 'Zyff\'s multiplier is mechanically correct (the slice measured one extra Echo resolution) and '
      + 'non-stacking per R-MULT-01 (Drakko + Zyff collapse to best-of). The owner ruled the terminology '
      + 'direction on 2026-08-27 (decisions.json q-interact-nonstack-best-of, verbatim): "We will probably '
      + 'change our text/terminology to better reflect non stackers. i.e. using \'Twice\' instead of \'an '
      + 'additional time.\'" This flags the concrete member for that pass — never auto-applied (§23).',
    class: 'wording-recommendation',
    suggestedText: 'Your **Battlecries** and **Deathrattles** trigger **twice**.',
    provenance: { lane: SLICE_LANE },
    semanticRevision,
    contractIds: ['zyff'],
  }));

  // ── 4. QUESTIONABLE INTERACTION (§12.1: reproducible, no approved rule proves it wrong, competing
  //       interpretations presented; §9.7 caps it at questionable until a ruling exists) ─────────────────
  const { anubis } = report;
  if (anubis.rebornHappened && anubis.deathsOfAnubis >= 2) {
    findings.push(makeFinding({
      lane: SLICE_LANE,
      contentIds: ['anubis'],
      ruleIds: [], // deliberately empty: NO approved rule governs Echo-fire count across a Rise
      expectationKind: 'echo-fires-across-rise',
      expected: 'unruled',
      observed: anubis.lanternCasts,
      severity: 'question',
      confidence: 'strong',
      status: 'needs-ruling',
      title: 'A Rise minion\'s own Echo fires on BOTH its deaths — double value per card, unruled',
      summary: `Anubis (Rise + Echo) died ${anubis.deathsOfAnubis} times in one fight (rise-death, then final `
        + `death) and its Echo resolved on each: Lantern of Souls was cast ${anubis.lanternCasts} times from one `
        + `body (reborn at ${anubis.rebornAttack}/${anubis.rebornHp}, per R-AVWIN-11). R-AVWIN-09/11 govern the `
        + 'Avenge window and the return stats across a Rise; NO rule states whether the rise-death itself '
        + 'fires the dying minion\'s Echo. Deterministically reproducible from the slice fixture.',
      class: 'questionable-interaction',
      competingInterpretations: [
        {
          interpretation: 'Every death is a death: the rise-death fires the Echo, so Rise+Echo legitimately pays twice.',
          evidence: [
            'owner lean on forced triggers: "an echo trigger is an echo trigger" (q-interact-forced-echo-first-bonus, 2026-08-27)',
            'current engine behaviour: 2 Lantern casts observed from one Anubis',
          ],
        },
        {
          interpretation: 'Rise interrupts the death: only the final death should Echo, otherwise every Rise+Echo body gets its Echo doubled for free.',
          evidence: [
            'R-AVWIN-09 treats the risen body as a FRESH window ("its rise-death excluded") — the same death is treated as not-fully-counted elsewhere',
            'balance surface: Rise effectively doubles any Echo it is granted onto (Anubis grants Rise board-wide)',
          ],
        },
      ],
      provenance: { lane: SLICE_LANE },
      semanticRevision,
      contractIds: ['anubis'],
    }));
  }

  return findings;
}
