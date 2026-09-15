/**
 * `npm run balance:manifest -- <path.json>` — load + validate an `ExperimentManifest`, apply its defaults, compute
 * the job's `ExperimentIdentity` from THIS checkout, and print both as a table (B0).
 *
 * The roadmap's exit gate for B0: "every run names its actual mode, pool, policy, rules and termination". This is
 * the naming half — the runner (B1) and the recorder (B5) stamp the resolved manifest + identity onto every
 * `LobbyRecord`. Validation is strict (unknown keys fail) so a typo'd option can never silently fall back to a
 * default.
 *
 * Example manifests live beside this file in `manifests/`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { resolveManifest, type ExperimentIdentity, type ExperimentManifest, type ResolvedManifest } from '@game/sim';
import { SETS } from '@game/content';
import { computeNodeIdentity } from './identity';

const SET_IDS = Object.keys(SETS) as [keyof typeof SETS, ...(keyof typeof SETS)[]];

export const PilotBudgetSchema = z.object({
  depth: z.number().int().min(1),
  beam: z.number().int().min(1),
  maxNodes: z.number().int().min(1),
  positionCandidates: z.number().int().min(1),
  // Scouting (2026-09-15, `productionBots/scout.ts`): off / inert unless the manifest says so.
  scouting: z.boolean().optional(),
  survivalWeight: z.number().min(0).optional(),
  // B4: the strategist's dials (ignored by other pilots).
  priorWeight: z.number().min(0).optional(),
  valueWeight: z.number().min(0).optional(),
  imitationWeight: z.number().min(0).optional(),
  imitationLineWeight: z.number().min(0).optional(),
  imitationVariant: z.string().optional(),
  growthWeight: z.number().min(0).optional(),
  horizonWeight: z.number().min(0).optional(),
  horizonFightWeight: z.number().min(0).optional(),
  horizonTop: z.number().int().min(1).max(10).optional(),
}).strict();

export const ExperimentManifestSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  mode: z.enum(['selfPlayLobby', 'pinnedLobby', 'scenario', 'legacyCourse']),
  setId: z.enum(SET_IDS),
  heroes: z.array(z.string().min(1)).optional(),
  policy: z.object({ id: z.string().min(1), budget: PilotBudgetSchema }).strict(),
  seeds: z.object({ start: z.number().int().min(0), count: z.number().int().min(1) }).strict(),
  maxRounds: z.number().int().min(1).optional(),
  maxActionsPerTurn: z.number().int().min(1).optional(),
  opponentPool: z.object({ name: z.string().min(1), digest: z.string().min(1) }).strict().optional(),
  corpus: z.object({ name: z.string().min(1), digest: z.string().min(1) }).strict().optional(),
  fightRules: z.enum(['corrected', 'shipped']).optional(),
  overlay: z.record(z.string(), z.object({ attack: z.number().optional(), health: z.number().optional(), tier: z.number().optional(), cost: z.number().optional(), params: z.record(z.string(), z.record(z.string(), z.union([z.number(), z.string(), z.boolean()]))).optional() }).strict()).optional(),
  pinnedHero: z.string().min(1).optional(),
  exploration: z.number().int().min(0).optional(),
  matrix: z.object({ runsPerHero: z.number().int().min(1), heroes: z.array(z.string().min(1)), explorationK: z.number().int().min(1).optional() }).strict().optional(),
  notes: z.string().optional(),
}).strict();

/** Parse + validate a manifest object (throws a readable ZodError on the first problem). */
export function parseManifest(raw: unknown): ExperimentManifest {
  return ExperimentManifestSchema.parse(raw) as ExperimentManifest;
}

/** Load a manifest JSON file, validate it, and apply the defaults. */
export function loadManifest(path: string): ResolvedManifest {
  const text = readFileSync(resolve(path), 'utf8');
  return resolveManifest(parseManifest(JSON.parse(text)));
}

function table(rows: [string, string][]): string {
  const w = Math.max(...rows.map(([k]) => k.length));
  return rows.map(([k, v]) => `  ${k.padEnd(w)}  ${v}`).join('\n');
}

export function describeManifest(m: ResolvedManifest): string {
  return table([
    ['name', m.name],
    ['mode', m.mode],
    ['setId', m.setId],
    ['heroes', m.heroes.length ? m.heroes.join(', ') : '(every enabled hero eligible in the set)'],
    ['policy', `${m.policy.id}  depth=${m.policy.budget.depth} beam=${m.policy.budget.beam} maxNodes=${m.policy.budget.maxNodes} positionCandidates=${m.policy.budget.positionCandidates}${m.policy.budget.scouting ? ` scouting survivalWeight=${m.policy.budget.survivalWeight ?? 0}` : ''}${m.policy.budget.priorWeight !== undefined ? ` priorWeight=${m.policy.budget.priorWeight}` : ''}${m.policy.budget.valueWeight !== undefined ? ` valueWeight=${m.policy.budget.valueWeight}` : ''}${m.policy.budget.imitationWeight !== undefined ? ` imitationWeight=${m.policy.budget.imitationWeight}` : ''}${m.policy.budget.imitationLineWeight !== undefined ? ` imitationLineWeight=${m.policy.budget.imitationLineWeight}` : ''}${m.policy.budget.imitationVariant ? ` imitationVariant=${m.policy.budget.imitationVariant}` : ''}${m.policy.budget.growthWeight !== undefined ? ` growthWeight=${m.policy.budget.growthWeight}` : ''}${m.policy.budget.horizonWeight !== undefined ? ` horizonWeight=${m.policy.budget.horizonWeight}` : ''}${m.policy.budget.horizonFightWeight !== undefined ? ` horizonFightWeight=${m.policy.budget.horizonFightWeight}` : ''}${m.policy.budget.horizonTop !== undefined ? ` horizonTop=${m.policy.budget.horizonTop}` : ''}`],
    ['seeds', `${m.seeds.start} … ${m.seeds.start + m.seeds.count - 1}  (${m.seeds.count})`],
    ['maxRounds', String(m.maxRounds)],
    ['maxActionsPerTurn', String(m.maxActionsPerTurn)],
    ['opponentPool', m.opponentPool ? `${m.opponentPool.name} @ ${m.opponentPool.digest}` : '(none — procedural panel)'],
    ['corpus', m.corpus ? `${m.corpus.name} @ ${m.corpus.digest}` : m.mode === 'pinnedLobby' ? '(MISSING — a pinned lobby must name its corpus)' : '(n/a)'],
    ['fightRules', m.fightRules ?? (m.mode === 'pinnedLobby' ? 'shipped (by definition)' : 'corrected (default)')],
    ['notes', m.notes ?? ''],
  ]);
}

export function describeIdentity(id: ExperimentIdentity): string {
  return table([
    ['engineRevision', id.engineRevision],
    ['dirtyDigest', id.dirtyDigest || '(clean)'],
    ['contentDigest', id.contentDigest],
    ['poolDigest', id.poolDigest],
    ['effectDigest', id.effectDigest],
    ['manifestDigest', id.manifestDigest],
  ]);
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: npm run balance:manifest -- <manifest.json>');
    process.exit(2);
  }
  const manifest = loadManifest(path);
  const identity = computeNodeIdentity(manifest);
  console.log(`Experiment manifest  ${resolve(path)}`);
  console.log(describeManifest(manifest));
  console.log('\nIdentity');
  console.log(describeIdentity(identity));
  if (identity.dirtyDigest) console.log('\n  ! working tree is DIRTY — this identity is not reproducible from the revision alone');
}

// Run as a CLI only when executed directly (tests import the helpers).
if (process.argv[1] && /manifest\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
