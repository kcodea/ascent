/**
 * QA WORKBENCH DEV-SERVER PLUGIN (Doc Bot 2.0 WP G · blueprint §15).
 *
 * The workbench reads three kinds of thing the browser cannot reach on its own: the findings LEDGER
 * (`.local/docbot/ledger.json`, gitignored), the sweep ARTIFACTS under `artifacts/` (gitignored), and
 * the curated SCENARIO fixtures. This plugin serves exactly those, read-only, from FIXED paths.
 *
 * It follows `rulebookPlugin.ts` to the letter, for the same reasons:
 *  · `apply: 'serve'` — it exists only under `npm run dev`; the production bundle never contains it.
 *  · every path is decided SERVER-SIDE from a small closed key set; nothing from the request is ever
 *    joined into a path except a scenario id that must first match a strict slug regex.
 *  · all resolution lives in exported pure functions (`resolveArtifact`, `resolveScenarioPath`) so the
 *    tests exercise the decisions without a server.
 *  · GET only; a missing artifact answers `{ missing: true, path, hint }` rather than 404-ing, because
 *    "you have not run that sweep yet" is information the surface should show, not an error to swallow.
 *
 * The workbench NEVER writes through this plugin. Its one write — accepting a wording recommendation —
 * goes through the EXISTING `/__rulebook/decide` endpoint, so an owner decision made in the workbench is
 * byte-identical to one made on the triage board, and content files are never touched (§23).
 */
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The closed set of artifacts the workbench may read, and where each one comes from. */
export const WORKBENCH_ARTIFACTS = {
  ledger: {
    file: '.local/docbot/ledger.json',
    hint: 'run `npm run docbot:ledger` (after a sweep with `--out artifacts/…`) to build the findings ledger',
  },
  contracts: {
    file: 'artifacts/docbot-contracts/contract-sweep-report.json',
    hint: 'run `npm run docbot:contracts -- --out artifacts/docbot-contracts`',
  },
  'contract-findings': {
    file: 'artifacts/docbot-contracts/findings.json',
    hint: 'run `npm run docbot:contracts -- --out artifacts/docbot-contracts`',
  },
  interactions: {
    file: 'artifacts/docbot-interactions/interaction-report.json',
    hint: 'run `npm run docbot:interactions -- --out artifacts/docbot-interactions`',
  },
  text: {
    file: 'artifacts/docbot-text/text-review.json',
    hint: 'run `npm run docbot:text -- --out artifacts/docbot-text`',
  },
  graduations: {
    file: 'packages/sim/src/docbot/bugTaxonomy.graduated.json',
    hint: 'graduate a report with `npm run bugs:graduate -- <report-id>`',
  },
} as const;

export type WorkbenchArtifactKey = keyof typeof WORKBENCH_ARTIFACTS;

/** Pure: which absolute path does this key name? `null` for anything not in the closed set. */
export function resolveArtifact(key: string): { path: string; hint: string } | null {
  if (!Object.prototype.hasOwnProperty.call(WORKBENCH_ARTIFACTS, key)) return null;
  const entry = WORKBENCH_ARTIFACTS[key as WorkbenchArtifactKey];
  return { path: path.join(ROOT, entry.file), hint: entry.hint };
}

/** Scenario ids are filename stems by convention — a strict slug, never a path fragment. */
export const SCENARIO_ID_RE = /^[a-z0-9][a-z0-9-]{0,120}$/;

/**
 * Pure: the two directories a scenario id may live in, in lookup order. Curated regressions first, because
 * a graduated fixture is the one the workbench is most often asked to replay.
 */
export function resolveScenarioPath(id: string): string[] | null {
  if (!SCENARIO_ID_RE.test(id)) return null;
  return [
    path.join(ROOT, 'packages/sim/src/docbot/scenarios/regressions', `${id}.json`),
    path.join(ROOT, 'packages/sim/src/docbot/scenarios', `${id}.json`),
  ];
}

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};

export function workbenchPlugin(): Plugin {
  return {
    name: 'qa-workbench',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__workbench/artifact', (req: IncomingMessage, res: ServerResponse) => {
        void (async () => {
          if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; }
          const key = new URL(req.url ?? '/', 'http://localhost').searchParams.get('key') ?? '';
          const resolved = resolveArtifact(key);
          if (!resolved) { sendJson(res, 400, { error: `unknown artifact key '${key}'` }); return; }
          try {
            res.setHeader('content-type', 'application/json');
            res.end(await readFile(resolved.path, 'utf8'));
          } catch {
            // Not an error: the sweep simply has not been run in this checkout yet. Say so, with the command.
            sendJson(res, 200, { missing: true, key, hint: resolved.hint });
          }
        })();
      });

      server.middlewares.use('/__workbench/scenario', (req: IncomingMessage, res: ServerResponse) => {
        void (async () => {
          if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; }
          const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id') ?? '';
          const candidates = resolveScenarioPath(id);
          if (!candidates) { sendJson(res, 400, { error: 'bad scenario id' }); return; }
          for (const p of candidates) {
            try {
              const text = await readFile(p, 'utf8');
              res.setHeader('content-type', 'application/json');
              res.end(text);
              return;
            } catch { /* try the next directory */ }
          }
          sendJson(res, 200, { missing: true, id, hint: `no scenario '${id}.json' in scenarios/ or scenarios/regressions/` });
        })();
      });
    },
  };
}
