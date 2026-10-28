/**
 * SCENARIOS THAT FAIL ON `main` TODAY (scenario/mode -> the cause). Each runs as `it.fails` in versusChaos.db.test.ts,
 * so a fix that makes it pass turns the suite red until the entry is deleted HERE, in the fix's own PR.
 * Causes name the audit finding (chore/versus-reliability-audit) the failure traces to.
 */
export const KNOWN: Record<string, string> = {};
