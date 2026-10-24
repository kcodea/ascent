/**
 * VERSUS — the server bundle's entry (`npm run versus:bundle` → `supabase/functions/versus-resolve/engine.generated.js`).
 *
 * Everything the authoritative resolver needs and nothing else: the one-fight resolver, the shape check, the
 * canonical digest the parity proof compares, and the identity stamps a client must match (protocol + content
 * revision). Imports only core + content + pure siblings, so the Deno bundle never drags in the reducer, the
 * shop or any UI code.
 */
import { contentRevision } from '@game/content';
import { canonicalDigest, canonicalJson, digestOf } from './canonical';
import { emptyVersusSide, preparedSideError, resolveVersusFight, versusChair, versusCombatSeed, versusSideOrEmpty, type VersusFightInput, type VersusFightResult } from './combat';
import { VERSUS_HEARTS, VERSUS_LIMITS, VERSUS_PROTOCOL } from './constants';
import { handleVersusFinalize, type VersusFinalizeStore } from './finalize';
import { resolveVersusGroupRound, versusGroupPairings, type VersusGroupRoundInput, type VersusGroupRoundResult } from './group';
import { groupFightsPayload, groupRoundDigest, handleVersusGroupFinalize, type VersusGroupFinalizeStore } from './groupFinalize';
import { normalizeVersusOptions, versusOptionsError } from './options';

export { canonicalDigest, canonicalJson, digestOf, emptyVersusSide, preparedSideError, versusSideOrEmpty, resolveVersusFight, versusChair, versusCombatSeed, VERSUS_HEARTS, VERSUS_LIMITS, VERSUS_PROTOCOL };
export { handleVersusFinalize };
export type { VersusFightInput, VersusFightResult, VersusFinalizeStore };
// VERSUS GROUP (owner 2026-10-24): the 3-4 player round's resolver, its finalize handler and the room options check.
export { handleVersusGroupFinalize, resolveVersusGroupRound, versusGroupPairings, normalizeVersusOptions, versusOptionsError };
export type { VersusGroupFinalizeStore, VersusGroupRoundInput, VersusGroupRoundResult };

/** The content identity this engine was built from (FNV over every card, rune and quest definition). */
export function engineContentRevision(): string {
  return contentRevision();
}

/**
 * The parity view of one resolution: the canonical text of everything a client lands (both perspectives, the
 * chair, the outcome) and its digest. Node and the deployed bundle must agree byte for byte.
 */
export function parityRecord(out: VersusFightResult): { digest: string; canonical: string } {
  const canonical = canonicalJson({ chair: out.chair, outcome: out.outcome, heartLostBy: out.heartLostBy, p1: out.p1, p2: out.p2 });
  return { digest: digestOf(canonical), canonical };
}

/** The parity view of one GROUP round: the canonical text of every fight (both perspectives) and its digest. */
export function parityGroupRecord(out: VersusGroupRoundResult): { digest: string; canonical: string } {
  const canonical = canonicalJson({ round: out.round, fights: groupFightsPayload(out) });
  const digest = digestOf(canonical);
  if (digest !== groupRoundDigest(out)) throw new Error('group digest drift');
  return { digest, canonical };
}
