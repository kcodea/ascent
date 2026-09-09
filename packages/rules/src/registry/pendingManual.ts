/**
 * HAND-AUTHORED pending rulings — currently EMPTY: the 2026-08-27 triage round 2 drained the board.
 *
 * The 24 cards that lived here (q-runedup-1..8 families, q-copy-gilded-badge, q-carry-demand-encore,
 * q-carry-warm-embers-double-dip, q-snap-impbank/rallyspreadatk/one-combat-marks/granted-effects/
 * echostripped, the four q-order-* ambiguities and the four q-interact-* ambiguities) were ALL decided by
 * the owner on 2026-08-27 (decisions.json). Each is tombstoned with its full disposition in
 * registry/retired.ts; the standing rules the rulings established live in registry/approved.ts
 * (R-RUNEDUP-01..08, R-ORD-01/02, R-MULT-01, R-SHOUT-01).
 *
 * Unlike pending.generated.ts this file is NOT rewritten by `npm run rules:seed` — cards added here
 * survive every reseed untouched, and a decided card must be removed BY HAND with a hand tombstone in
 * registry/retired.ts (enforced by rules.test.ts). Same schema, same board, same decision flow as the
 * generated queue: decisions.json applies to these ids exactly as to generated ones. Every future card
 * must be self-contained (owner format feedback 2026-08-26): verbatim printed text, what the code does
 * TODAY (re-verified in source), one concrete example, and explicit click semantics.
 */
import type { GameRule } from '../schema';

export const MANUAL_PENDING: GameRule[] = [
  {
    id: 'q-gangplank-self-buff',
    title: 'Gangplank: may its hand-gain buff land on ITSELF when it is the only Dwarf?',
    statement:
      'Gangplank\'s "give a random friendly Dwarf +1/+2" picks from ALL friendly Dwarves, Gangplank included — so a lone '
      + 'Gangplank buffs itself on every card it draws. Keep that (it is a Dwarf, and "friendly" includes itself), or '
      + 'should it read "ANOTHER friendly Dwarf" and do nothing when it stands alone? — ✓ yes (keep: it may buff itself) '
      + '· ✕ no (say why — e.g. "another friendly Dwarf") · ✎ your wording',
    domain: 'targeting',
    status: 'needs-ruling',
    evidence: [{
      kind: 'owner-chat', ref: 'Bug Board 38d186a6 (round 2, 2026-09-09 — closed by design pending this question)',
      quote: 'gangplank can buff itsself if its the only dwarf on board',
    }],
    cardText: 'When a card is added to your hand, give a **random** friendly **Dwarf +1/+2**.',
    example:
      'Cassen, wave 5: Gangplank is the only Dwarf on the board; a card is added to hand; Gangplank gains +1/+2 itself. '
      + 'With a second Dwarf beside it, the +1/+2 goes to either at random.',
    currentBehaviour:
      'The random-Dwarf pick does NOT exclude the source: the pool is every living friendly Dwarf (all-types bodies '
      + 'included), Gangplank among them. Matches the printed text literally ("a random friendly Dwarf"); no other card '
      + 'in the pool prints "another" for this shape, so there is no convention to borrow.',
    recommendation: 'Keep as printed — it may buff itself. If the owner wants the exclusion, the text changes to "another friendly Dwarf" and the pick skips the source.',
    sourceQueue: 'bug-board',
    contentIds: ['dw_gangplank'],
  },
];
