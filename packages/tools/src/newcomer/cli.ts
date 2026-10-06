/**
 * `npm run newcomer:rate` — the real newcomer (Bronze) top-4 rate off the public `run_telemetry` table (owner
 * 2026-10-06, R-TELEMETRY-RANK-01). READ-ONLY: anon REST GETs, paged past PostgREST's 1,000-row cap (R-NET-01).
 * Nothing is ever written to the backend. The rules for which rows count live in `newcomerRate.ts`.
 *
 *   npm run newcomer:rate            the printed report
 *   npm run newcomer:rate -- --json  the report as JSON
 */
import { getAll } from '../strength/livePool';
import { DEVELOPER_AUTHORS, formatNewcomerRate, newcomerRate, type NewcomerRow } from './newcomerRate';

/** Flat columns plus three SMALL JSON paths out of `derived` (never the ~100 KB payload). */
const SELECT = 'id,created_at,author,player_key,unrated,placement,source,hero_offer,patch,rank:derived->rankAtStart,regime:derived->regime,pool:derived->lobbyPool';

async function main(): Promise<void> {
  const rows = await getAll<NewcomerRow>(`run_telemetry?select=${SELECT}&order=id.asc`);
  const report = newcomerRate(rows);
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else console.log(formatNewcomerRate(report, DEVELOPER_AUTHORS).join('\n'));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
