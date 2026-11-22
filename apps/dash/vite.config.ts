import { defineConfig, type Connect, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { fixtureBreakdown, fixtureOverview, type FixtureIds } from './src/fixture';
import { fixtureAction, fixtureQueue, fixtureSearch } from './src/modFixture';
import { fixtureBalance, fixtureHealth, fixturePlayers, fixtureProgression, fixtureSocial, type Fixture2Ids } from './src/fixture2';

/** Round two's ids: the live set's heroes / tribes plus every rune, Ancient, achievement, cosmetic and title name. */
function realIds2(): (Fixture2Ids & { cards?: string[] }) | undefined {
  try {
    const d = JSON.parse(readFileSync(new URL('./public/game-data.json', import.meta.url), 'utf8')) as { activeHeroes: string[]; activeTribes: string[] };
    const n = JSON.parse(readFileSync(new URL('./public/game-names.json', import.meta.url), 'utf8')) as Record<string, Record<string, unknown>>;
    const keys = (k: string) => Object.keys(n[k] ?? {});
    const setCards = (n.setCards ?? {}) as Record<string, string[]>;
    const live = (d as { setId?: string }).setId ?? 'set2';
    return { cards: setCards[live] ?? [], heroes: d.activeHeroes, tribes: d.activeTribes, runes: keys('runes').filter((_, i) => i % 7 === 0), ancients: keys('ancients'), achievements: keys('achievements').filter((_, i) => i % 5 === 0), cosmetics: keys('cosmetics').filter((_, i) => i % 11 === 0), titles: keys('titles') };
  } catch {
    return undefined;
  }
}
import type { ModAction } from './src/modTypes';

/** The active set's real hero + tribe ids, from the synced game data (falls back to the fixture's own list). */
function realIds(): FixtureIds | undefined {
  try {
    const d = JSON.parse(readFileSync(new URL('./public/game-data.json', import.meta.url), 'utf8')) as { activeHeroes: string[]; activeTribes: string[] };
    return { heroes: d.activeHeroes, tribes: d.activeTribes };
  } catch {
    return undefined;
  }
}

// LOCAL ONLY: `vite` (dev) and `vite preview` answer /api/* with the made-up fixture, so the page can be worked on
// with no database, no Access and no keys. The deployed site never runs this: its /api/* are the Pages Functions in
// functions/api/, which check the Access JWT and read the real RPCs.
const fixtureApi = (): Plugin => {
  const handle: Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('x-dash-fixture', '1');
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/api/moderation/queue') return send(200, fixtureQueue({ reports: url.searchParams.get('reports'), names: url.searchParams.get('names') }));
    if (url.pathname === '/api/moderation/search') return send(200, fixtureSearch(url.searchParams.get('q') ?? ''));
    if (url.pathname === '/api/moderation/action') {
      if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      let raw = '';
      req.on('data', (c: Buffer) => { raw += c.toString('utf8'); });
      req.on('end', () => {
        try {
          const [status, body] = fixtureAction(JSON.parse(raw) as ModAction);
          send(status, body);
        } catch {
          send(400, { error: 'bad json' });
        }
      });
      return;
    }
    const range = { from: url.searchParams.get('from'), to: url.searchParams.get('to') };
    if (url.pathname === '/api/players') return send(200, fixturePlayers(range));
    if (url.pathname === '/api/social') return send(200, fixtureSocial(range));
    if (url.pathname === '/api/progression') return send(200, fixtureProgression(range, new Date(), realIds2()));
    if (url.pathname === '/api/health') return send(200, fixtureHealth(range, new Date()));
    if (url.pathname === '/api/balance') return send(200, fixtureBalance({ ...range, mode: url.searchParams.get('mode'), set: url.searchParams.get('set') }, new Date(), realIds2()));
    if (url.pathname !== '/api/overview' && url.pathname !== '/api/breakdown') return next();
    const body =
      url.pathname === '/api/overview'
        ? fixtureOverview({ from: url.searchParams.get('from'), to: url.searchParams.get('to') })
        : fixtureBreakdown({ from: url.searchParams.get('from'), to: url.searchParams.get('to'), patch: url.searchParams.get('patch') }, realIds());
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('x-dash-fixture', '1');
    res.end(JSON.stringify(body));
  };
  return {
    name: 'dash-fixture-api',
    configureServer: (server) => void server.middlewares.use(handle),
    configurePreviewServer: (server) => void server.middlewares.use(handle),
  };
};

export default defineConfig({
  base: '/',
  plugins: [fixtureApi()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5190, strictPort: false },
  preview: { port: 5191, strictPort: false },
});
