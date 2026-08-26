/**
 * DOC BOT — ASCENT's standing correctness auditor.
 *
 * Not a play bot. Doc Bot never decides what is GOOD; it decides what is WIRED. It re-derives, from live
 * content and live source, the questions that keep producing owner-reported bugs, and fails CI when the
 * answer changed under someone's feet:
 *
 *   1. factoryPhase   — every (trigger, factory) pair implemented wherever its trigger dispatches (silent
 *                       `MAP[do]?.()` no-ops: the Conductor / Funeral-on-Loan / Beefy class).
 *   2. liveText       — every dual-stat scaling card's live text renders BOTH halves (the Kringle class)
 *                       (lives in packages/ui, beside the helpers it audits).
 *   3. tribePredicates— raw `.tribe ===` comparisons frozen behind a ratchet; new code goes through
 *                       isTribe/defIsTribe (the all-types class).
 *   4. derivations    — declared "these two code paths must agree" pairs, fuzzed (the Merchant's-Chorus /
 *                       snapshot-drift class).
 *
 * `npm run docbot` prints the full report, including the needs-triage backlog the tests tolerate but track.
 * Doctrine and the ledger of what each tripwire has caught: docs/docbot.md.
 */
export { TRIGGER_PHASES, PHASE_EXCUSED, COMBAT_CASTING_FACTORIES, type PhaseExcuse } from './phaseRegistry';
export { TRIBE_RATCHET, PREDICATE_FILES, RAW_TRIBE_COMPARE_SOURCE } from './tribeRatchet';
