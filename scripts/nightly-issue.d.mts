/** Types for the plain-node tracking-issue script, so `packages/tools/src/nightlyIssue.test.ts` typechecks. */
export interface NightlyIssueAck { fingerprint: string; date: string; reason: string }
export interface NightlyIssueFinding {
  fingerprint: string; id: string; lane: string; title: string; summary: string; reproduction?: string; ack?: NightlyIssueAck;
}
export interface NightlyIssueStatus {
  schemaVersion: 1;
  verdict: 'green' | 'red';
  at: string;
  crashed?: boolean;
  config: { runs: number; seedBase: number; lobbies: number };
  elapsedSeconds: number;
  reproCommand: string;
  red: NightlyIssueFinding[];
  known: NightlyIssueFinding[];
  notes: string[];
}
export interface RunContext { runId?: string; runUrl?: string; artifactName?: string }
export interface ExistingIssue { number: number; title: string }
export type IssueAction =
  | { op: 'create'; title: string; body: string; label: string }
  | { op: 'pin' }
  | { op: 'edit'; number: number; body: string }
  | { op: 'comment'; number: number; body: string }
  | { op: 'close'; number: number };

export const ISSUE_TITLE: string;
export const ISSUE_LABEL: string;
export function runContext(env?: Record<string, string | undefined>): RunContext;
export function loadStatus(path: string): NightlyIssueStatus;
export function renderSummary(status: NightlyIssueStatus, ctx: RunContext): string;
export function renderBody(status: NightlyIssueStatus, ctx: RunContext): string;
export function planActions(status: NightlyIssueStatus, existing: ExistingIssue | null, ctx: RunContext): IssueAction[];
export function findOpenIssue(): ExistingIssue | null;
export function execute(actions: IssueAction[], opts?: { dryRun?: boolean }): void;
export function main(argv?: string[]): void;
