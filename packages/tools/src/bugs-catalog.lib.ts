/**
 * `npm run bugs:catalog -- <report-id>` — the pure half (2026-09-11).
 *
 * Turns a CLOSED Bug Board report into a retro-catalog STUB: id, report id + date, title from the player's
 * description (an untrusted claim — quoted, never interpreted), the fix commit(s) when given, an EMPTY patch
 * and `verifiedBy: { kind: 'pending' }`. The stub is inserted above the catalog's append marker. It is
 * deliberately not runnable: the author fills in the patch from the fix commit, runs
 * `npm run docbot:retro -- --only <id>`, and pastes the measured verdict. `retroMapErrors()` fails the PR
 * gate until the matching retroInteractionMap row exists, so a stub can never be forgotten half-done.
 *
 * Nothing here touches Supabase or the network: the report row comes from the local inbox (`bugs:pull`),
 * and the tests feed a synthetic row.
 */
import type { BugReportRow } from '@game/sim';

export const CATALOG_PATH = 'packages/sim/src/docbot/retroCatalog.ts';
/** The line the stub is inserted ABOVE. Lives inside the RETRO_CATALOG literal. */
export const CATALOG_APPEND_MARKER = '  // ── bugs:catalog appends stubs ABOVE this line';

export interface CatalogStubInput {
  /** The report's full uuid (or whatever id the inbox stores). */
  reportId: string;
  createdAt: string;
  status: string;
  description: string;
  /** Kebab slug for the id; derived from the description when absent. */
  slug?: string;
  fixCommits?: readonly string[];
  /** ISO date for the stub's "stub added" note. Injected for determinism. */
  today: string;
}

export const CLOSED_STATUSES: readonly string[] = ['fixed', 'closed'];

export function stubInputFromRow(row: BugReportRow, opts: { slug?: string; fixCommits?: readonly string[]; today: string }): CatalogStubInput {
  return {
    reportId: row.id,
    createdAt: row.report?.createdAt ?? row.player_created_at ?? row.created_at,
    status: row.status,
    description: row.description ?? '',
    slug: opts.slug,
    fixCommits: opts.fixCommits,
    today: opts.today,
  };
}

export function shortReportId(reportId: string): string {
  return reportId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
}

/** A kebab slug from the first few words of the (untrusted) description — a NAME, not a summary. */
export function slugFromDescription(description: string, words = 4): string {
  const s = description.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean).slice(0, words).join('-');
  return s || 'report';
}

/** The description's first line, quote-safe, trimmed to a title's length. Never interpreted. */
export function titleFromDescription(description: string, max = 110): string {
  const first = description.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  const flat = first.replace(/\s+/g, ' ');
  return (flat.length > max ? `${flat.slice(0, max - 1)}…` : flat) || '(no description)';
}

export interface CatalogStubPlan {
  ok: boolean;
  refusals: string[];
  id: string;
  /** The TypeScript entry text (indented for the RETRO_CATALOG literal), when ok. */
  entry: string;
  /** A retroInteractionMap row template to paste, when ok. */
  mapRow: string;
}

const tsString = (s: string): string => JSON.stringify(s).replace(/\\u2019/g, '’');

export function planCatalogStub(input: CatalogStubInput, existingIds: readonly string[]): CatalogStubPlan {
  const refusals: string[] = [];
  const short = shortReportId(input.reportId);
  const slug = input.slug ?? slugFromDescription(input.description);
  const id = `${short}-${slug}`;
  if (!CLOSED_STATUSES.includes(input.status)) refusals.push(`report ${short} is '${input.status}', not fixed/closed — a catalog entry cites a FIX; close the report first (npm run bugs:close)`);
  if (!/^\d{4}-\d{2}-\d{2}/.test(input.createdAt)) refusals.push(`report ${short} has no ISO createdAt (${input.createdAt || 'empty'})`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)+$/.test(id)) refusals.push(`derived id '${id}' is not kebab — pass --slug`);
  if (existingIds.includes(id)) refusals.push(`catalog already has '${id}'`);
  if (existingIds.some((x) => x.startsWith(`${short}-`))) refusals.push(`catalog already has an entry for report ${short} (${existingIds.filter((x) => x.startsWith(`${short}-`)).join(', ')})`);
  const reportDate = input.createdAt.slice(0, 10);
  const fixes = input.fixCommits && input.fixCommits.length > 0 ? input.fixCommits : ['TODO-fix-commit'];
  const entry = [
    `  {`,
    `    // STUB from npm run bugs:catalog (${input.today}) — fill in \`patch\` from the fix commit (run it backwards),`,
    `    // then \`npm run docbot:retro -- --only ${id}\` and paste the measured verdict. Title = the player's words, unverified.`,
    `    id: '${id}',`,
    `    title: ${tsString(titleFromDescription(input.description))},`,
    `    fixCommits: [${fixes.map((f) => `'${f}'`).join(', ')}],`,
    `    reportIds: ['${short}'],`,
    `    reportDate: '${reportDate}',`,
    `    patch: [],`,
    `    lanes: [],`,
    `    scope: { kind: 'generic' },`,
    `    verifiedBy: { kind: 'pending' },`,
    `  },`,
  ].join('\n');
  const mapRow = [
    `  {`,
    `    catalogId: '${id}',`,
    `    multiSystem: false, // TODO`,
    `    families: [],`,
    `    lanes: [], // the generic lane that SHOULD own this class`,
    `    why: 'TODO — one line: why that family/lane catches the class',`,
    `    verifiedBy: 'class-analysis',`,
    `  },`,
  ].join('\n');
  return { ok: refusals.length === 0, refusals, id, entry, mapRow };
}

/** Insert the entry above the append marker. Pure; the caller writes the file. */
export function insertCatalogStub(catalogSource: string, entry: string): string {
  const at = catalogSource.indexOf(CATALOG_APPEND_MARKER);
  if (at < 0) throw new Error(`${CATALOG_PATH} has no append marker (${CATALOG_APPEND_MARKER.trim()})`);
  return `${catalogSource.slice(0, at)}${entry}\n${catalogSource.slice(at)}`;
}

/** The ids already in the catalog source — parsed from the literal so a stub never needs the module loaded. */
export function catalogIdsInSource(catalogSource: string): string[] {
  return [...catalogSource.matchAll(/^\s{4}id: '([a-z0-9-]+)',$/gm)].map((m) => m[1]!);
}
