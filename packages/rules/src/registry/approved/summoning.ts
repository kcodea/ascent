/**
 * APPROVED RULES — domain `summoning`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';

export const SUMMONING_RULES: GameRule[] = [
  /* ── 2026-09-09 / 2026-09-10 — the Set 3 Spirits rulings and the owner's bug-report rulings of 2026-09-10 ── */
  {
    id: 'R-HAND-03',
    title: 'A locked hand card can be buffed, but never summoned from hand',
    statement:
      'A card locked in hand — Disco Dan\'s Setlist tier lock, Brackus\'s Gold-spent lock, the Hourglass Reserve\'s '
      + 'next-turn lock — cannot reach the board by ANY route while the lock holds: not by playing it, not by a '
      + 'summon-from-hand copy (the Set 3 Spirits, in the shop or in combat), not by Rope Wrangler. It can still be '
      + 'buffed in hand and still counts for effects that only READ the hand (Handbound Titan, Flamebanner Marshal). '
      + 'A summoner that would have taken it takes the next candidate instead.',
    domain: 'summoning',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (bug report)', quote: 'a locked minion (like disco dan for example) cannot be summoned from hand. they can be buffed but not summoned.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts handCardLocked (the one predicate; play / summonCopyFromHandShop / the shop pickers); packages/core/src/combat/simulate.ts summonCopyFromHand + takeRandomHandMinion refuse a `locked` hand card; the combat hand carries `locked` from the run and the snapshot' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-10 (PR #1398). Before it, only the play action checked the lock; the Spirit summon-from-hand '
      + 'paths picked straight from the hand.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Spirits.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-HAND-04',
    title: 'Summon from hand: an exact copy, once per combat, the card stays in hand',
    statement:
      'A "summon a minion from your hand" effect (Set 3 Spirits: Tide Caller, Dreaming Deep, Seedling Spirit) puts '
      + 'an EXACT copy of the hand card on the board — its stats, keywords and gilding at that moment — beside the '
      + 'summoner. The card itself is NOT consumed: it stays in hand, greyed for the fight, keeps receiving buffs '
      + '(which never reach the copy retroactively), and may be summoned only once per combat; a second summoner must '
      + 'pick a different card, or nothing. The shop twin (an Echo re-fired in the shop) summons the copy once per '
      + 'card per turn. Rope Wrangler\'s older "summon and consume" shape is unchanged and a card it took is no '
      + 'longer a candidate.',
    domain: 'summoning',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-09 (Spirit roster answers)', quote: 'the card is not consumed; an exact copy is summoned; once per combat; the card greys in hand so it cannot be summoned again; another summoner must pick a different card' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts summonCopyFromHand (handCopiedUids; `fromHandUid` stamped on the summon event); packages/sim/src/recruit.ts summonCopyFromHandShop (handCopiedThisTurn)' },
    ],
    contentIds: ['sp3_dreamtide', 'sp3_dreamingdeep', 'sp3_seedling', 'sp3_handboundtitan', 'sp3_flamebanner', 'sp3_hearthwhisperer', 'sp3_slumbering'],
    currentBehaviour:
      'Conforms (built with the ruling, 2026-09-09, PR #1394): one combat primitive and one shop twin; the replay '
      + 'greys the hand card off `fromHandUid`. Refined 2026-09-10 by R-HAND-03 (a locked card is never a candidate).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Spirits.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
];
