/**
 * `npm run boards:fetch` — pull the shared player board pool down to a local JSON cache.
 *
 * The committed `OPPONENT_POOL_DATA` is 160 boards and every one of them is `origin: 'synthetic'` — generated
 * from the card set and banded to the tuned enemy curve. Real boards, the ones people actually built, live in
 * the Supabase `boards` table (and in each player's localStorage). Neither is reachable from a headless tool,
 * which is why every bot measurement so far has been against synthetic opposition.
 *
 * This caches them to disk so `bot:ladder --human` can fight them. Read-only; it writes nothing to the backend.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = 'packages/tools/.cache/player-boards.json';

// The web app reads these from Vite's env; a plain node process has to parse the committed file itself.
const env = Object.fromEntries(
  readFileSync('apps/web/.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) { console.error('no backend configured in apps/web/.env'); process.exit(1); }

const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const rows: unknown[] = [];
for (let wave = 1; wave <= 20; wave++) {
  const { data, error } = await c.from('boards').select('snapshot, origin, author, patch').eq('wave', wave).limit(500);
  if (error) { console.error(`wave ${wave}:`, error.message); continue; }
  rows.push(...(data ?? []));
}

const boards = rows
  .map((r) => (r as { snapshot: unknown }).snapshot)
  .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object' && Array.isArray((b as { minions?: unknown }).minions));

const byOrigin = new Map<string, number>();
for (const b of boards) {
  const o = String(b.origin ?? 'unknown');
  byOrigin.set(o, (byOrigin.get(o) ?? 0) + 1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(boards));
console.log(`fetched ${boards.length} boards → ${OUT}`);
console.log('by origin:', Object.fromEntries(byOrigin));
const authors = new Set(rows.map((r) => (r as { author?: string }).author).filter(Boolean));
console.log(`distinct authors: ${authors.size}`, [...authors].slice(0, 12));
