/**
 * ACCOUNT STARTUP GATE (Supabase cleanup P1.1, 2026-10-28).
 *
 * Supabase fires `onAuthStateChange` far more often than the account actually changes: INITIAL_SESSION on
 * subscribe, TOKEN_REFRESHED about once an hour, and again when a hidden tab becomes visible. The login startup
 * work (progression probe, guides, queue flushes, handle claim, cloud saves) used to run on EVERY fire, which
 * measured ~87,000 fan-outs in 16 days for a handful of players. This gate lets that work run only when the
 * account really changes: a different user id, the anonymous -> email upgrade, a new email, or a sign-out.
 *
 * Pure and dependency-free so the decision is testable on its own; `store.ts` owns one instance.
 */

/** The parts of an identity whose change means "a different account is now signed in". */
export interface AccountKeyFields { userId: string; anonymous: boolean; email: string | null }

/** `null` = signed out / no session. */
export function accountKey(id: AccountKeyFields | null): string {
  return id ? `${id.userId}|${id.anonymous ? 'anon' : 'account'}|${id.email ?? ''}` : 'none';
}

/** DEV counters: `authEvents` is every identity report (what used to run the startup work), `startups` is how
 *  many times it now runs. Read them in the console as `window.__ascentAuthStartup`. */
export interface AccountStartupCounters { authEvents: number; startups: number; skipped: number }

export interface AccountStartupGate {
  /** Report an identity (the boot restore or an auth event). True = the account changed: run the startup work. */
  claim(id: AccountKeyFields | null): boolean;
  readonly counters: AccountStartupCounters;
}

export function createAccountStartupGate(): AccountStartupGate {
  let last: string | undefined;
  const counters: AccountStartupCounters = { authEvents: 0, startups: 0, skipped: 0 };
  return {
    counters,
    claim(id) {
      counters.authEvents++;
      const key = accountKey(id);
      if (key === last) { counters.skipped++; return false; }
      last = key;
      counters.startups++;
      return true;
    },
  };
}
