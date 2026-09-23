/**
 * APPROVED RULES — domain `copying`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';
import { HANDOFF, AVWIN_HANDOFF } from './shared';

export const COPYING_RULES: GameRule[] = [
  {
    id: 'R-COPY-01',
    title: 'Plain copies',
    statement:
      'A plain copy is a fresh base copy: no copied buffs or instance modifications; it does not inherit '
      + 'attachments, granted keywords, learned effects, improved values or counters; it is non-Gilded unless '
      + 'the effect says otherwise. Applicable Auras still affect it, because Auras are global and were not '
      + 'copied from the source.',
    domain: 'copying',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: HANDOFF, quote: 'A plain copy is a fresh base copy of that card.' }],
    // Pinned by the Bellringer Voss cases: "the copy is PLAIN — buffs on the original are not carried"
    // (base stats asserted, golden=false). One representative probe; broader plain-copy sweep is future work.
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set2Neutral.test.ts'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-COPY-02',
    title: 'Exact copies',
    statement:
      'An exact copy is literally an exact copy of the current card instance: it retains all buffs, effects, '
      + 'attachments, granted keywords, improved values, learned effects, counters and other card-owned state. '
      + 'Engine-owned pending events, callbacks and queue bookkeeping are NOT part of the card instance and '
      + 'must not be duplicated. Any uncertain field boundary is surfaced for an owner ruling.',
    domain: 'copying',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: HANDOFF, quote: 'An exact copy is literally an exact copy of the current card instance.' }],
    // Pinned by the Copycat suite: stats, keywords, gilding and accrued per-instance improvements all copy
    // ("exactly means exactly"); the engine-owned-state boundary is the suite's deliberate exclusion list.
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/copycat.test.ts'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-AVWIN-03',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'Exact copies inherit progress',
    statement:
      'An exact copy inherits accrued Avenge progress and used/unused once-per-combat state from the '
      + 'copied instance.',
    domain: 'copying',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'Exact copies inherit progress.' }],
    currentBehaviour:
      'Recruit-phase exact copies (Xerox\'s Copy Machine, owner ruling 2026-08-15) spread every '
      + 'per-instance field including permanent progression (`summonBonus`) — conforms. No effect creates '
      + 'an exact copy of a source with ACCRUED mid-combat window progress or a SPENT once-per-combat '
      + 'latch headlessly today, so the in-combat halves are approved-but-unenforced (no reachable '
      + 'scenario; see the PR-3 devlog).',
  },
  {
    id: 'R-AVWIN-04',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'Plain copies reset progress',
    statement:
      'A plain copy begins with zero accrued counters and all instance-scoped triggers unused.',
    domain: 'copying',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'Plain copies reset progress.' }],
    currentBehaviour:
      'Conforms: plain copies are minted fresh from the card index (Bellringer Voss, Re-Pete\'s rule), '
      + 'so no per-instance counter can ride along.',
  },
  {
    id: 'R-AVWIN-08',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'Used state is part of an exact copy',
    statement:
      'If the source has already spent a once-per-combat effect, an exact copy also has that effect '
      + 'marked used.',
    domain: 'copying',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'Used state is part of an exact copy.' }],
    currentBehaviour:
      'Approved-but-unenforced: no effect creates an exact copy of a body mid-combat AFTER a '
      + 'once-per-combat latch was spent (the only reachable exact copies are recruit-phase, where combat '
      + 'latches do not exist). Becomes enforceable the day such an effect ships.',
  },
];
