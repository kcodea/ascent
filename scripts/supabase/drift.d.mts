/** Types for the plain-node drift check, so `packages/tools/src/dbOps.test.ts` typechecks. */
export interface RepoDefinition { name: string; kind: 'create' | 'drop'; at: number; md5?: string }
export interface RepoIndex { defs: Map<string, { file: string; md5: string }[]>; dropped: Set<string> }
export interface LiveFunction { proname: string; args: string; md5: string }
export interface DriftFinding {
  verdict: 'OLDER' | 'NOMATCH' | 'NOREPO' | 'NOTLIVE';
  name: string; args?: string; live?: string; repoLast?: string; defs?: number;
}
export function normalizeBody(s: string): string;
export function repoDefinitions(text: string): RepoDefinition[];
export function repoIndex(files: string[]): RepoIndex;
export function classify(live: LiveFunction[], index: RepoIndex): { ok: number; findings: DriftFinding[] };
