// The JSON the moderation RPCs return (supabase/migrations/2026-11-28-moderation.sql). The Pages Functions pass it
// through unchanged, so this file is the Moderation tab's contract with that SQL.

/** A player as the SQL names them (`moderation.who`). `name` / `tag` are null for an account with no profile row. */
export interface Who { id: string; name: string | null; tag: string | null }

export interface ContextLine { id: string; by: 'reported' | 'reporter'; body: string; at: string }

export interface DmReport {
  id: string;
  createdAt: string;
  reason: 'abuse' | 'spam' | 'cheating' | 'other';
  status: 'open' | 'reviewed' | 'actioned' | 'dismissed';
  reviewedAt: string | null;
  reviewedBy: string | null;
  note: string | null;
  messageId: string;
  body: string;
  sentAt: string;
  reporter: Who | null;
  sender: Who | null;
  /** Every report ever made against this sender (this one included), and how many are still open. */
  senderReports: number;
  senderOpen: number;
  context: ContextLine[];
}

export type FlagKind = 'account' | 'team' | 'room';

export interface NameFlag {
  id: string;
  kind: FlagKind;
  targetId: string;
  name: string;
  term: string | null;
  /** 'block' only for a name stored before the filter existed (the filter refuses new ones). */
  severity: 'flag' | 'block';
  status: 'open' | 'cleared' | 'reset' | 'closed';
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  note: string | null;
  owner: Who | null;
  current: { exists: boolean; name?: string | null; tag?: string | null; members?: Array<Who | null> };
  canReset: boolean;
}

export interface LogEntry {
  id: number;
  at: string;
  actor: string;
  action: 'review_report' | 'clear_flag' | 'reset_name';
  kind: string | null;
  targetId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string | null;
}

export interface ModQueue {
  counts: { reports: number; names: number };
  reports: DmReport[];
  names: NameFlag[];
  log: LogEntry[];
}

export interface Verdict { verdict: 'ok' | 'flag' | 'block'; term: string | null }
export interface SearchAccount { id: string; name: string | null; tag: string | null; verdict: Verdict; openFlag: boolean }
export interface SearchTeam { id: string; name: string | null; members: Array<Who | null>; verdict: Verdict; openFlag: boolean }
export interface ModSearch { q: string; accounts: SearchAccount[]; teams: SearchTeam[] }

export type ReportsFilter = 'open' | 'reviewed' | 'all';
export type NamesFilter = 'open' | 'done' | 'all';

/** The POST /api/moderation/action bodies (src/server/moderation.ts `actionCall` is the server's allow-list). */
export type ModAction =
  | { action: 'review'; reportId: string; note?: string }
  | { action: 'clear'; flagId: string; note?: string }
  | { action: 'reset'; kind: 'account' | 'team'; targetId: string; note?: string };
