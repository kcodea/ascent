/**
 * `npm run bugs:list` — table of the PULLED reports (offline: reads `.local/bug-reports/index.json`).
 * Respects the owner Bug Board's `work-order.json` ordering when present (re-applied live, so an order
 * dropped in AFTER the pull still takes effect without re-pulling).
 */
import { readIndex, readWorkOrder, renderList, buildIndex, readReport } from './bug-inbox.lib';
import type { BugReportRow } from '@game/sim';

const index = readIndex();
if (!index) {
  console.error('no local inbox — run `npm run bugs:pull` first.');
  process.exit(1);
}

// Re-apply the current work order (the Bug Board may have written it after the last pull).
const workOrder = readWorkOrder();
const rows = index.reports.map((r) => readReport(r.id).row) as BugReportRow[];
console.log(renderList(buildIndex(rows, workOrder)));
