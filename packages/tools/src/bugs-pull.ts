/**
 * `npm run bugs:pull` — fetch open bug reports into the ignored local inbox (blueprint §8.2).
 *
 * Writes `.local/bug-reports/index.json` plus one directory per report (report.json, summary.md with the
 * player text delimited as UNTRUSTED quoted input, scenario.json, combat-events.json). Default statuses:
 * new/triaged/needs_info; pass `--status a,b` to override. Reads the service-role key from an untracked
 * root `.env` (SUPABASE_SERVICE_ROLE_KEY). Never commit the pulled reports — they contain player text and
 * account/machine identifiers, and `.local/` is gitignored on purpose.
 */
import {
  DEFAULT_PULL_STATUSES,
  INBOX_DIR,
  createSupabaseBackend,
  readWorkOrder,
  renderList,
  resolveSupabaseConfig,
  writeInbox,
} from './bug-inbox.lib';

const args = process.argv.slice(2);
const statusFlag = args.indexOf('--status');
const statuses = statusFlag >= 0 && args[statusFlag + 1] ? args[statusFlag + 1]!.split(',') : [...DEFAULT_PULL_STATUSES];

try {
  const backend = createSupabaseBackend(resolveSupabaseConfig());
  const rows = await backend.fetchReports(statuses);
  const workOrder = readWorkOrder();
  const index = writeInbox(rows, workOrder);
  console.log(`pulled ${rows.length} report(s) [status: ${statuses.join(', ')}] → ${INBOX_DIR}/`);
  if (workOrder) console.log(`work order applied: ${workOrder.orderedReportIds.length} ranked ids (Bug Board)`);
  console.log('');
  console.log(renderList(index));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
