/**
 * `npm run guides:pull`: rewrite packages/ui/src/guides/guides.bundled.ts from the LIVE Team Ascent guides, so the
 * offline fallback matches what players see online. Read-only against the server: one anonymous GET of public rows
 * (official guides are readable by everyone). Run it before a release, then run `npm test` and commit the file.
 *
 * It refuses to write, and says why, when the server answers no guides (a project with no import yet), when the answer
 * is short (the server's own total differs from the rows it sent), when a row cannot be read, when a Team Ascent
 * guide is in no set, or when there are more Team Ascent guides than one press of the Import button can add
 * (`GUIDE_LIMITS.importBatch`: the file is also what that button sends). A mistake therefore cannot empty the
 * fallback, drop a guide from it unheard, or write a file the team could not import.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentRangeTotal, pullProblems, recordsToBundled, renderBundledGuides } from '../../guides/src/bundledSource';
import { parseGuideRecord, type GuideRecord } from '../../guides/src/types';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const COLUMNS = 'id,slug,author_id,byline,official,published,published_at,hidden,sets,tribes,pairs_with,icon_card,title,tagline,body,core,enablers,mentions,aliases,forked_from,forked_title,forked_byline,bookmark_count,sort_order,revision,created_at,updated_at';
/** Official guides are few (the team writes them). One bounded request; more than this is a mistake worth stopping on. */
const LIMIT = 1000;
/** A hung connection must not hang the release. */
const TIMEOUT_MS = 15000;

function env(): { url: string; key: string } {
  const e = Object.fromEntries(
    readFileSync(join(root, 'apps/web/.env'), 'utf8').split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );
  if (!e.VITE_SUPABASE_URL || !e.VITE_SUPABASE_ANON_KEY) throw new Error('no backend configured in apps/web/.env');
  return { url: e.VITE_SUPABASE_URL, key: e.VITE_SUPABASE_ANON_KEY };
}

async function main(): Promise<void> {
  const { url, key } = env();
  let res: Response;
  let rows: unknown;
  try {
    res = await fetch(`${url}/rest/v1/guides?select=${COLUMNS}&official=eq.true&order=sort_order.asc,id.asc&limit=${LIMIT}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) rows = await res.json(); // inside the try: the timeout also covers reading the body
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') throw new Error(`the server did not answer within ${TIMEOUT_MS / 1000} seconds`);
    throw e;
  }
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
  if (!Array.isArray(rows)) throw new Error('the server did not answer a list');
  if (rows.length >= LIMIT) throw new Error(`${rows.length} official guides: more than this script reads in one request`);
  // The server's own count, so an answer cut short (a lower row cap than expected) is never taken for the whole list.
  const total = contentRangeTotal(res.headers.get('content-range'));
  if (total === null) throw new Error('the server did not say how many Team Ascent guides there are (no readable Content-Range). Nothing was written.');
  if (total !== rows.length) throw new Error(`the server has ${total} Team Ascent guides but sent ${rows.length}. Nothing was written.`);
  const records = rows.map(parseGuideRecord).filter((g): g is GuideRecord => g !== null);
  const problems = pullProblems(rows, records);
  if (problems.length > 0) throw new Error(`${problems.join('; ')}. Nothing was written.`);
  const guides = recordsToBundled(records);
  if (guides.length === 0) throw new Error('the server has no Team Ascent guides (has the import run?). Nothing was written.');
  const out = join(root, 'packages/ui/src/guides/guides.bundled.ts');
  writeFileSync(out, renderBundledGuides(guides), 'utf8');
  console.log(`wrote ${guides.length} guides to ${out}`);
  console.log('now run: npx vitest run packages/ui/src/guides   (every card must resolve), then commit the file');
}

main().catch((e) => { console.error(`guides:pull failed: ${(e as Error).message}`); process.exit(1); });
