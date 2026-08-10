import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOBBY_PLACEMENT_DELTAS, resolveLobbyRating, initialProfile } from '@game/sim';

/**
 * ACCOUNTS C3 — server ↔ client rating PARITY.
 *
 * The `submit-rating` Edge Function computes the authoritative rating from its OWN copy of the placement-delta
 * table (`supabase/functions/_shared/lobbyRating.ts`), because it can't import the sim package at the Deno
 * runtime. That copy MUST equal the sim's `LOBBY_PLACEMENT_DELTAS`, or the number the server lands on diverges
 * from the optimistic one the client showed at the end screen.
 *
 * This test is the guard: it reads the function's shared file as text, extracts its delta array, and asserts
 * it matches the sim — and that the function's `max(0, before + delta)` formula reproduces
 * `resolveLobbyRating(...).ratingAfter` exactly, for every placement. If someone re-tunes the ladder in one
 * place and not the other, CI fails here rather than the two silently disagreeing in production.
 */
const sharedPath = join(__dirname, '../../../supabase/functions/_shared/lobbyRating.ts');
const sharedSrc = readFileSync(sharedPath, 'utf8');

/** Pull the `LOBBY_PLACEMENT_DELTAS = [ … ]` literal out of the Deno file and parse it. */
function serverDeltas(): number[] {
  const m = /LOBBY_PLACEMENT_DELTAS[^=]*=\s*(\[[^\]]*\])/.exec(sharedSrc);
  if (!m) throw new Error('could not find LOBBY_PLACEMENT_DELTAS in the Edge Function shared file');
  return JSON.parse(m[1]!) as number[];
}

describe('C3 server/client rating parity', () => {
  it('the Edge Function delta table equals the sim’s', () => {
    expect(serverDeltas(), 'the ladder was re-tuned in one place only — server and client will disagree')
      .toEqual([...LOBBY_PLACEMENT_DELTAS]);
  });

  it('the server formula reproduces resolveLobbyRating for every placement', () => {
    // `lobbyRatingAfter(before, placement) = max(0, before + delta)` — the exact thing the function does. We
    // recompute it here from the sim's own constant and check it against the client's full resolver.
    const deltas = [...LOBBY_PLACEMENT_DELTAS];
    for (const before of [0, 300, 1000, 2500]) {
      for (let placement = 1; placement <= 8; placement++) {
        const serverAfter = Math.max(0, before + deltas[placement - 1]!);
        const clientAfter = resolveLobbyRating({ ...initialProfile(), rating: before }, placement).ratingAfter;
        expect(serverAfter, `placement ${placement} from rating ${before}`).toBe(clientAfter);
      }
    }
  });

  it('the shared file names the placement table so the regex can’t silently miss it', () => {
    expect(sharedSrc).toContain('LOBBY_PLACEMENT_DELTAS');
    expect(serverDeltas()).toHaveLength(8);
  });
});
