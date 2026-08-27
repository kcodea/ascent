/**
 * `npm run bugs:close -- <report-id> --status fixed|closed|duplicate|needs_info [--note "..."]`
 * Service-role status update + a `resolution` jsonb note on one report. The id may be a short prefix of a
 * PULLED report (resolved locally) or a full uuid (works without a pull).
 */
import { createSupabaseBackend, resolveReportDir, resolveSupabaseConfig } from './bug-inbox.lib';

const CLOSABLE = ['fixed', 'closed', 'duplicate', 'needs_info'] as const;

const args = process.argv.slice(2);
const reportArg = args.find((a) => !a.startsWith('--'));
const statusIdx = args.indexOf('--status');
const noteIdx = args.indexOf('--note');
const status = statusIdx >= 0 ? args[statusIdx + 1] : undefined;
const note = noteIdx >= 0 ? args[noteIdx + 1] : undefined;

if (!reportArg || !status || !(CLOSABLE as readonly string[]).includes(status)) {
  console.error('usage: npm run bugs:close -- <report-id> --status fixed|closed|duplicate|needs_info [--note "..."]');
  process.exit(1);
}

// A full uuid works directly; anything shorter resolves against the pulled inbox.
const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reportArg);
let id: string;
try {
  id = isUuid ? reportArg : resolveReportDir(reportArg).id;
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

try {
  const backend = createSupabaseBackend(resolveSupabaseConfig());
  const updated = await backend.updateReport(id, {
    status,
    resolution: {
      status,
      note: note ?? null,
      resolvedAt: new Date().toISOString(),
      by: 'bugs:close',
    },
  });
  if (updated.length === 0) {
    console.error(`no row updated — is ${id} a real report id?`);
    process.exit(1);
  }
  console.log(`report ${id} → status ${status}${note ? ` (note: ${note})` : ''}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
