import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * QA SCENARIO SAVE — DEV-ONLY middleware behind the Scene Builder's "save as regression fixture" button
 * (Docbot handoff §4.5, PR 2). It writes an exported `QaScenarioV1` JSON into the checked-in fixture
 * directory `packages/sim/src/docbot/scenarios/`, where the CLI (`npm run docbot:scenario -- <id>`) and the
 * contract tests resolve bare ids.
 *
 * `apply: 'serve'` — never part of a production build (§4.6: no production code path loads or writes local
 * scenario files). Mirrors `rulebookPlugin.ts`: the whole validation surface is one pure function
 * (`planScenarioSave`) unit-tested without a server; the middleware is a thin shell. The destination
 * DIRECTORY is fixed by the plugin and the FILENAME is derived server-side from the scenario's own id after
 * a strict slug check — never from any client-supplied path. Deep semantic validation (content ids, seeds,
 * expectations) is @game/sim's `validateQaScenario`, which the client runs before posting and CI runs on
 * every checked-in fixture — this endpoint only guards the filesystem.
 */

export const MAX_SCENARIO_BYTES = 4 * 1024 * 1024; // serialized runs are large (pool + boards); 4MB is roomy
/** Filename-stem discipline for scenario ids — kept in sync with `qaScenarioBridge.ts` (client side). */
export const SCENARIO_ID_RE = /^[a-z0-9][a-z0-9_-]{0,80}$/;
const SOURCES: readonly string[] = ['generated', 'scene-builder', 'bug-report', 'regression', 'retro'];

export interface ScenarioSaveRequest { scenario: unknown; overwrite?: boolean }

/** Validate a save request + produce the write plan. Pure — the whole testable surface. `exists` is whether
 *  the target file is already on disk (the middleware checks; overwriting demands an explicit flag). */
export function planScenarioSave(
  body: unknown,
  exists: boolean,
): { error: string } | { fileName: string; text: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'body must be an object' };
  const { scenario, overwrite } = body as ScenarioSaveRequest;
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) return { error: 'scenario must be an object' };
  const s = scenario as Record<string, unknown>;
  if (s.schemaVersion !== 1) return { error: `scenario.schemaVersion must be 1 (got ${JSON.stringify(s.schemaVersion)})` };
  if (typeof s.id !== 'string' || !SCENARIO_ID_RE.test(s.id)) {
    return { error: 'scenario.id must be a lowercase slug ([a-z0-9_-], ≤ 81 chars) — it becomes the fixture filename' };
  }
  if (typeof s.title !== 'string' || s.title.length === 0) return { error: 'scenario.title must be a non-empty string' };
  if (typeof s.source !== 'string' || !SOURCES.includes(s.source)) return { error: `scenario.source must be one of ${SOURCES.join('/')}` };
  if (typeof s.state !== 'string' || s.state.length === 0) return { error: 'scenario.state must be the serialized run-state string' };
  if (overwrite !== undefined && typeof overwrite !== 'boolean') return { error: 'overwrite must be a boolean' };
  if (exists && overwrite !== true) {
    return { error: `a fixture named '${s.id}.json' already exists — pass overwrite: true to replace it` };
  }
  const text = `${JSON.stringify(scenario, null, 2)}\n`;
  if (Buffer.byteLength(text, 'utf8') > MAX_SCENARIO_BYTES) return { error: 'scenario too large' };
  return { fileName: `${s.id}.json`, text };
}

const SCENARIO_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../packages/sim/src/docbot/scenarios',
);

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_SCENARIO_BYTES) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

export function qaScenarioPlugin(): Plugin {
  return {
    name: 'qa-scenario-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__qa-scenario/save', (req: IncomingMessage, res: ServerResponse) => {
        void (async () => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
          try {
            const body = await readBody(req);
            // Probe existence with the PLANNED filename: derive it from the id via the same pure path, on a
            // throwaway no-exists plan, so a bad id errors before any fs access.
            const dry = planScenarioSave(body, false);
            if ('error' in dry) { res.statusCode = 400; res.end(JSON.stringify({ error: dry.error })); return; }
            const target = path.join(SCENARIO_DIR, dry.fileName);
            const plan = planScenarioSave(body, existsSync(target));
            if ('error' in plan) { res.statusCode = 409; res.end(JSON.stringify({ error: plan.error })); return; }
            await writeFile(target, plan.text);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: `packages/sim/src/docbot/scenarios/${plan.fileName}` }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: (e as Error).message }));
          }
        })();
      });
    },
  };
}
