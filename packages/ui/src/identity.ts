/**
 * ── PLAYER IDENTITY (accounts C1 — owner build 2026-08-03) ─────────────────────────────────────────────
 *
 * Identity used to BE the display name: a 24-character string in `localStorage` that was the `author` column
 * on every content table AND the primary key of `profiles`. Renaming yourself to someone else's name
 * inherited their leaderboard slot, and the live RLS policy (`for update to anon using (true)`) let anyone
 * with devtools rewrite anyone's rating.
 *
 * C1 replaces that with a real, server-issued `user_id`. Three properties matter:
 *
 *  1. **It is invisible.** Every install signs in ANONYMOUSLY at boot — no form, no email, no friction. The
 *     player experience is unchanged, and the board pool keeps growing (a pool that stops growing starves the
 *     lobbies, which is why "guests simply can't write" was the wrong shape for THIS game).
 *  2. **It is upgradeable in place.** Supabase converts an anonymous user to a real account without changing
 *     `user_id`, so a player's boards, runs and rating carry over when accounts land in C2. That is the whole
 *     reason to start anonymous rather than to gate writes behind a login screen.
 *  3. **It is provider-agnostic.** Everything downstream consumes `Identity`, never Supabase. Steam (C5)
 *     becomes a second `AuthProvider` — one ticket, not a second migration.
 *
 * `author` (the display name) survives on rows as a DENORMALIZED CONVENIENCE for rendering. It is no longer
 * an identity key: nothing joins on it and nothing trusts it.
 */

/** Who the player is, as far as the rest of the app is concerned. */
export interface Identity {
  /** The real identity — `auth.users.id`. Never shown to the player. */
  userId: string;
  /** Mutable, NOT unique. The `#tag` that disambiguates duplicates arrives with accounts in C2. */
  displayName: string;
  /** True while this is an anonymous (device-bound) session — i.e. it is lost if site data is cleared.
   *  C2's sign-up converts it in place, keeping `userId`. */
  anonymous: boolean;
}

/**
 * An authentication backend. One interface, several implementations:
 *
 *  - `supabaseAuthProvider` (C1, here) — anonymous now, email/password in C2.
 *  - a Steam provider (C5) — validates a Steamworks ticket in an Edge Function and mints a session; the
 *    player never sees a login form.
 */
export interface AuthProvider {
  /** Restore a persisted session, or establish an anonymous one. Runs at boot and MUST NOT block it —
   *  callers treat a null result as "play offline, upload nothing". */
  restore(): Promise<Identity | null>;
  /** Rename. Display-only in C1 (the handle/discriminator model lands with accounts in C2). */
  setDisplayName(name: string): Promise<Identity | null>;
  signOut(): Promise<void>;
}

/** The live identity, or null when there is no backend / the session could not be established (offline).
 *  Read synchronously by the upload paths — they no-op without it rather than writing an unowned row. */
let current: Identity | null = null;

export const currentIdentity = (): Identity | null => current;
export const currentUserId = (): string | null => current?.userId ?? null;

/** Set by `initIdentity`; exported for tests, which need to drive the seam without a network. */
export function setIdentity(id: Identity | null): void {
  current = id;
}

let initPromise: Promise<Identity | null> | null = null;

/**
 * Establish the session ONCE per app load, and hand back the same promise to every later caller.
 *
 * Deliberately never throws and never blocks: a failure here means uploads are skipped for the session, which
 * is exactly how every remote path in this app already behaves when Supabase is unconfigured.
 */
export function initIdentity(provider: AuthProvider, displayName: string): Promise<Identity | null> {
  initPromise ??= provider
    .restore()
    .then((id) => {
      // Carry the local display name onto a fresh session so rows still render with the player's name.
      current = id ? { ...id, displayName: id.displayName || displayName } : null;
      return current;
    })
    .catch(() => {
      current = null;
      return null;
    });
  return initPromise;
}

/** Reset the module between tests (the init promise is intentionally sticky in the app). */
export function resetIdentityForTests(): void {
  current = null;
  initPromise = null;
}
