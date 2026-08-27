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

export const MANUAL_PENDING: GameRule[] = [];
