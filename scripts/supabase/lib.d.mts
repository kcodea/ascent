/** Types for the plain-node `db:*` plumbing, so TypeScript callers (`npm run health`) typecheck. */
export const ROOT: string;
export const PROJECT_REF: string;
export function runSql(sql: string, opts?: { readOnly?: boolean }): Record<string, unknown>[];
export function runJson(sql: string): unknown;
export function sha256(s: string): string;
