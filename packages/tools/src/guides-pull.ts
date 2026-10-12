/**
 * `npm run guides:pull`: rewrite packages/ui/src/guides/guides.bundled.ts from the LIVE Team Ascent guides, so the
 * offline fallback matches what players see online. Read-only against the server: one anonymous GET of public rows
 * (official guides are readable by everyone). Run it before a release, then run `npm test` and commit the file.
 *
 * It refuses to write when the server answers no guides (a project with no import yet), so a mistake cannot empty
 * the fallback.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordsToBundled, renderBundledGuides } from '../../guides/src/bundledSource';
import { parseGuideRecord, type GuideRecord } from '../../guides/src/types';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const COLUMNS = 'id,slug,author_id,byline,official,published,published_at,hidden,sets,tribes,pairs_with,icon_card,title,tagline,body,core,enablers,mentions,aliases,forked_from,forked_title,forked_byline,bookmark_count,sort_order,revision,created_at,updated_at';
/** Official guides are few (the team writes them). One bounded request; more than this is a mistake worth stopping on. */
const LIMIT = 1000;

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
  const res = await fetch(`${url}/rest/v1/guides?select=${COLUMNS}&official=eq.true&order=sort_order.asc,id.asc&limit=${LIMIT}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
  const rows = (await res.json()) as unknown[];
  if (!Array.isArray(rows)) throw new Error('the server did not answer a list');
  if (rows.length >= LIMIT) throw new Error(`${rows.length} official guides: more than this script reads in one request`);
  const records = rows.map(parseGuideRecord).filter((g): g is GuideRecord => g !== null);
  const guides = recordsToBundled(records);
  if (guides.length === 0) throw new Error('the server has no Team Ascent guides (has the import run?). Nothing was written.');
  const out = join(root, 'packages/ui/src/guides/guides.bundled.ts');
  writeFileSync(out, renderBundledGuides(guides), 'utf8');
  console.log(`wrote ${guides.length} guides to ${out}`);
  console.log('now run: npx vitest run packages/ui/src/guides/guides.test.ts   (every card must resolve), then commit the file');
}

main().catch((e) => { console.error(`guides:pull failed: ${(e as Error).message}`); process.exit(1); });
