import { defineConfig, type Connect, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { fixtureBreakdown, fixtureOverview, type FixtureIds } from './src/fixture';
import { fixtureAction, fixtureQueue, fixtureSearch } from './src/modFixture';
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
