import { defineConfig, type Connect, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { fixtureBreakdown, fixtureOverview, type FixtureIds } from './src/fixture';

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
    if (url.pathname !== '/api/overview' && url.pathname !== '/api/breakdown') return next();
    const body =
      url.pathname === '/api/overview'
        ? fixtureOverview()
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
