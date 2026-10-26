/**
 * `npm run versus:parity` — the Phase 0 resolver parity proof (blueprint 4.1).
 *
 * The fixture (`packages/sim/src/versus/fixtures/parity.v1.json`) holds real prepared sides: pairs of greedy
 * self-play seats, each turn ended through `faceOmen { deferFight: true }`, captured across early, mid and late
 * rounds and across sets. Every check re-resolves each case in NODE from source (never a stored digest, so a content
 * change cannot make the fixture "stale": the proof is always same-commit Node vs the other runtime) and compares
 * the canonical result text against:
 *
 *   npm run versus:parity -- generate                 rebuild the fixture (only when its INPUTS should change)
 *   npm run versus:parity -- bundle                   the local esbuild bundle (`npm run versus:bundle` first)
 *   npm run versus:parity -- remote <functionUrl>     the DEPLOYED function, e.g.
 *       npm run versus:parity -- remote https://<project>.supabase.co/functions/v1/versus-resolve
 *
 * VERSUS GROUP (owner 2026-10-24): every check also resolves GROUP rounds (3-4 seats, one simulate per fight, a copy
 * fight when three are alive, a ghost of a seat that went out mid-round), derived from the same fixture sides
 * (`groupParityCases`, so the fixture file is unchanged), through the `parity_group` action remotely.
 *
 * VERSUS DUOS (owner 2026-10-25): every check also resolves DUOS rounds (the 2v2 tag-team fight: four seats from two
 * consecutive fixture cases, at the case's seed and at a second seed (the seeded 50/50 fight order lands differently), and
 * one empty first board), `duosParityCases`, through
 * the `parity_duos` action remotely.
 *
 * HEALTH AND ARMOR (owner 2026-10-26, R-VERSUS-HEALTH-01): every mode is checked twice, the fixture's cases as they are
 * (no pools: the hearts-era inputs still resolve, damage stamped) and again with each seat's (Duos: team's) Health and
 * Armor going in (`healthParityCases`: full, low, armor-only and lethal pools, so the knockout arithmetic is digested
 * too). The fixture file is unchanged; the pools are derived from the case index.
 *
 * `remote` sends the publishable key from apps/web/.env as `apikey` (never printed), or `VERSUS_PARITY_TOKEN`
 * (a user access token) as the bearer when set. It exits non-zero on any mismatch and prints the first differing
 * offset with context.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contentRevision } from '@game/content';
import { createRun, reduce, duosRandomFirst, resolveVersusDuosRound, resolveVersusFight, resolveVersusGroupRound, VERSUS_PROTOCOL, type PreparedCombatSide, type RunState } from '@game/sim';
import { parityDuosRecord, parityGroupRecord, parityRecord } from '@game/sim/versus/server';
import type { VersusDuosTeam, VersusGroupEliminations, VersusGroupSeat, VersusSeat, VersusVitals } from '@game/sim';
import { GREEDY_PILOT } from '@game/sim/balance/pilots';
import { playRecruitTurn } from '@game/sim/balance/seatRunner';
import { NOOP_RECORDER } from '@game/sim/balance/types';
import { VERSUS_BUNDLE_PATH } from './versus-bundle';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const FIXTURE = join(root, 'packages/sim/src/versus/fixtures/parity.v1.json');

export interface ParityCase {
  name: string;
  matchSeed: number;
  round: number;
  p1: PreparedCombatSide;
  p2: PreparedCombatSide;
  /** Each seat's pools going in (the health cases only). */
  vitals?: Partial<Record<VersusSeat, VersusVitals>>;
}
interface ParityFixture {
  version: 1;
  note: string;
  generatedAtContent: string;
  cases: ParityCase[];
}

/** One greedy self-play match; captures the parked sides at the listed rounds. */
function playMatch(name: string, seed: number, heroes: [string, string], setId: 'set1' | 'set2' | 'set3', captureAt: number[], rounds: number): ParityCase[] {
  let a: RunState = createRun(seed * 2 + 1, heroes[0], 'lobby', undefined, setId);
  let b: RunState = createRun(seed * 2 + 2, heroes[1], 'lobby', undefined, setId);
  const out: ParityCase[] = [];
  for (let round = 1; round <= rounds; round++) {
    const ta = playRecruitTurn(a, GREEDY_PILOT, { seatId: 'p1', round, scoutedOpponent: null }, NOOP_RECORDER, { maxActionsPerTurn: 120, lobbyId: name });
    const tb = playRecruitTurn(b, GREEDY_PILOT, { seatId: 'p2', round, scoutedOpponent: null }, NOOP_RECORDER, { maxActionsPerTurn: 120, lobbyId: name });
    if (ta.failure || tb.failure) throw new Error(`${name} round ${round}: ${ta.failure ?? tb.failure}`);
    const p1 = ta.run.pendingCombatSide!;
    const p2 = tb.run.pendingCombatSide!;
    if (captureAt.includes(round)) out.push({ name: `${name} r${round}`, matchSeed: seed, round, p1: structuredClone(p1), p2: structuredClone(p2) });
    const fight = resolveVersusFight({ matchSeed: seed, round, p1, p2 });
    a = reduce(ta.run, { type: 'resolveCombat', fight: { result: fight.p1, damageTaken: 0 } });
    b = reduce(tb.run, { type: 'resolveCombat', fight: { result: fight.p2, damageTaken: 0 } });
  }
  return out;
}

function generate(): void {
  const cases = [
    ...playMatch('set2 warden-vs-indy', 1001, ['warden', 'indy'], 'set2', [1, 4, 8, 12], 12),
    ...playMatch('set2 keshi-vs-warden', 2002, ['keshi', 'warden'], 'set2', [3, 7, 11], 11),
    ...playMatch('set3 indy-vs-keshi', 3003, ['indy', 'keshi'], 'set3', [2, 6, 10, 14], 14),
    ...playMatch('set1 warden-vs-warden', 4004, ['warden', 'warden'], 'set1', [5, 9], 9),
  ];
  const fixture: ParityFixture = {
    version: 1,
    note: 'Versus resolver parity inputs (packages/tools/src/versus-parity.ts). Inputs only: every check re-resolves in Node from source.',
    generatedAtContent: contentRevision(),
    cases,
  };
  mkdirSync(dirname(FIXTURE), { recursive: true });
  writeFileSync(FIXTURE, JSON.stringify(fixture) + '\n', 'utf8');
  console.log(`wrote ${cases.length} cases to ${FIXTURE} (${Math.round(JSON.stringify(fixture).length / 1024)} KB)`);
}

export function loadParityFixture(): ParityFixture {
  return JSON.parse(readFileSync(FIXTURE, 'utf8')) as ParityFixture;
}

/** A pool for case `i`, seat `k`: full, low, armor-only and lethal shapes in rotation (a 1-Health pool loses to any hit). */
export function parityVitals(i: number, k: number): VersusVitals {
  const shapes: VersusVitals[] = [{ health: 30, armor: 12 }, { health: 6, armor: 0 }, { health: 30, armor: 25 }, { health: 1, armor: 0 }, { health: 17, armor: 3 }];
  return { ...shapes[(i + k) % shapes.length]! };
}

/** The fixture's duel cases again, each seat on a pool (the health digests). */
export function healthParityCases(cases: ParityCase[]): ParityCase[] {
  return cases.map((c, i) => ({ ...c, name: `health ${c.name}`, vitals: { p1: parityVitals(i, 0), p2: parityVitals(i, 1) } }));
}

export interface GroupParityCase {
  name: string;
  matchSeed: number;
  round: number;
  seats: VersusGroupSeat[];
  eliminated: VersusGroupEliminations;
  sides: Partial<Record<VersusGroupSeat, PreparedCombatSide>>;
  /** Each seat still in's pools going in (the health cases only). */
  vitals?: Partial<Record<VersusGroupSeat, VersusVitals>>;
}

/**
 * Group rounds built from consecutive fixture cases: four seats (two fights), four seats with one out before the round
 * (three alive: a fight + a COPY), and four seats with one going out DURING the round (a ghost).
 */
export function groupParityCases(cases: ParityCase[]): GroupParityCase[] {
  const out: GroupParityCase[] = [];
  const seats: VersusGroupSeat[] = ['p1', 'p2', 'p3', 'p4'];
  for (let i = 0; i + 1 < cases.length; i += 2) {
    const x = cases[i]!;
    const y = cases[i + 1]!;
    const sides = { p1: x.p1, p2: x.p2, p3: y.p1, p4: y.p2 };
    const base = { matchSeed: x.matchSeed, round: x.round, seats, sides };
    out.push({ ...base, name: `group4 ${x.name} + ${y.name}`, eliminated: {} });
    out.push({ ...base, name: `group3-copy ${x.name} + ${y.name}`, eliminated: { p4: Math.max(0, x.round - 1) } });
    out.push({ ...base, name: `group-ghost ${x.name} + ${y.name}`, eliminated: { p2: x.round } });
  }
  // HEALTH: every shape again with each seat still in on a pool.
  return [...out, ...out.map((c, i) => {
    const vitals: Partial<Record<VersusGroupSeat, VersusVitals>> = {};
    seats.forEach((s, k) => { if (c.eliminated[s] == null) vitals[s] = parityVitals(i, k); });
    return { ...c, name: `health ${c.name}`, vitals };
  })];
}

function nodeGroupRecord(c: GroupParityCase): { digest: string; canonical: string } {
  return parityGroupRecord(resolveVersusGroupRound({ matchSeed: c.matchSeed, round: c.round, seats: c.seats, eliminated: c.eliminated, sides: structuredClone(c.sides), ...(c.vitals ? { vitals: c.vitals } : {}) }));
}

export interface DuosParityCase {
  name: string;
  matchSeed: number;
  round: number;
  sides: Partial<Record<VersusGroupSeat, PreparedCombatSide>>;
  /** Each team's shared pool going in (the health cases only). */
  vitals?: Partial<Record<VersusDuosTeam, VersusVitals>>;
}

/** Duos rounds from consecutive fixture cases: the case's seed, a second seed (the seeded 50/50 fight order,
 *  R-DUOS-ORDER-01, draws again), and team A's picked first board emptied (it hands straight over). */
export function duosParityCases(cases: ParityCase[]): DuosParityCase[] {
  const out: DuosParityCase[] = [];
  for (let i = 0; i + 1 < cases.length; i += 2) {
    const x = cases[i]!;
    const y = cases[i + 1]!;
    const sides = { p1: x.p1, p2: x.p2, p3: y.p1, p4: y.p2 };
    const base = { matchSeed: x.matchSeed, round: x.round };
    out.push({ ...base, name: `duos ${x.name} + ${y.name}`, sides });
    out.push({ ...base, name: `duos-reseeded ${x.name} + ${y.name}`, matchSeed: (x.matchSeed + 0x9e37) | 0, sides });
    out.push({ ...base, name: `duos-empty-first ${x.name} + ${y.name}`, sides: { ...sides, [duosRandomFirst(x.matchSeed, x.round).a]: { ...x.p1, board: [] } } });
  }
  // HEALTH: every shape again with each team on a shared pool (30 + both Armors, or a low / lethal one).
  return [...out, ...out.map((c, i) => ({ ...c, name: `health ${c.name}`, vitals: { a: parityVitals(i, 0), b: parityVitals(i, 3) } }))];
}

function nodeDuosRecord(c: DuosParityCase): { digest: string; canonical: string } {
  return parityDuosRecord(resolveVersusDuosRound({ matchSeed: c.matchSeed, round: c.round, sides: structuredClone(c.sides), ...(c.vitals ? { vitals: c.vitals } : {}) }));
}

function nodeRecord(c: ParityCase): { digest: string; canonical: string } {
  return parityRecord(resolveVersusFight({ matchSeed: c.matchSeed, round: c.round, p1: structuredClone(c.p1), p2: structuredClone(c.p2), ...(c.vitals ? { vitals: c.vitals } : {}) }));
}

function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `offset ${i}: node …${a.slice(Math.max(0, i - 60), i + 60)}… vs other …${b.slice(Math.max(0, i - 60), i + 60)}…`;
}

function report(rows: { name: string; ok: boolean; detail?: string }[]): void {
  for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  ${r.detail}` : ''}`);
  const failed = rows.filter((r) => !r.ok).length;
  console.log(`${rows.length - failed}/${rows.length} cases byte-identical`);
  if (failed) process.exitCode = 1;
}

async function checkBundle(): Promise<void> {
  const mod = (await import(pathToFileURL(VERSUS_BUNDLE_PATH).href)) as typeof import('@game/sim/versus/server');
  const { cases } = loadParityFixture();
  if (mod.engineContentRevision() !== contentRevision()) console.warn(`bundle content ${mod.engineContentRevision()} != source ${contentRevision()} (rebuild with npm run versus:bundle)`);
  const duel = [...cases, ...healthParityCases(cases)].map((c) => {
    const node = nodeRecord(c);
    const other = mod.parityRecord(mod.resolveVersusFight({ matchSeed: c.matchSeed, round: c.round, p1: structuredClone(c.p1), p2: structuredClone(c.p2), ...(c.vitals ? { vitals: c.vitals } : {}) }));
    return node.canonical === other.canonical ? { name: c.name, ok: true, detail: node.digest } : { name: c.name, ok: false, detail: firstDiff(node.canonical, other.canonical) };
  });
  const group = groupParityCases(cases).map((c) => {
    const node = nodeGroupRecord(c);
    const other = mod.parityGroupRecord(mod.resolveVersusGroupRound({ matchSeed: c.matchSeed, round: c.round, seats: c.seats, eliminated: c.eliminated, sides: structuredClone(c.sides), ...(c.vitals ? { vitals: c.vitals } : {}) }));
    return node.canonical === other.canonical ? { name: c.name, ok: true, detail: node.digest } : { name: c.name, ok: false, detail: firstDiff(node.canonical, other.canonical) };
  });
  const duos = duosParityCases(cases).map((c) => {
    const node = nodeDuosRecord(c);
    const other = mod.parityDuosRecord(mod.resolveVersusDuosRound({ matchSeed: c.matchSeed, round: c.round, sides: structuredClone(c.sides), ...(c.vitals ? { vitals: c.vitals } : {}) }));
    return node.canonical === other.canonical ? { name: c.name, ok: true, detail: node.digest } : { name: c.name, ok: false, detail: firstDiff(node.canonical, other.canonical) };
  });
  report([...duel, ...group, ...duos]);
}

function publishableKey(): string {
  const env = readFileSync(join(root, 'apps/web/.env'), 'utf8');
  const m = /^VITE_SUPABASE_ANON_KEY=(.+)$/m.exec(env);
  if (!m) throw new Error('VITE_SUPABASE_ANON_KEY missing from apps/web/.env');
  return m[1]!.trim();
}

async function checkRemote(url: string): Promise<void> {
  const key = publishableKey();
  const token = process.env.VERSUS_PARITY_TOKEN;
  const { cases } = loadParityFixture();
  const rows: { name: string; ok: boolean; detail?: string }[] = [];
  for (const c of [...cases, ...healthParityCases(cases)]) {
    const node = nodeRecord(c);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${token ?? key}` },
      body: JSON.stringify({ action: 'parity', protocol: VERSUS_PROTOCOL, contentRevision: contentRevision(), matchSeed: c.matchSeed, round: c.round, p1: c.p1, p2: c.p2, ...(c.vitals ? { vitals: c.vitals } : {}) }),
    });
    const body = (await res.json().catch(() => null)) as { digest?: string; canonical?: string; contentRevision?: string; error?: string } | null;
    if (!res.ok || !body?.canonical) {
      rows.push({ name: c.name, ok: false, detail: `HTTP ${res.status} ${body?.error ?? ''}${body?.contentRevision ? ` (server content ${body.contentRevision}, local ${contentRevision()})` : ''}` });
      continue;
    }
    rows.push(body.canonical === node.canonical
      ? { name: c.name, ok: true, detail: `${node.digest} (server ${body.digest})` }
      : { name: c.name, ok: false, detail: firstDiff(node.canonical, body.canonical) });
  }
  for (const c of groupParityCases(cases)) {
    const node = nodeGroupRecord(c);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${token ?? key}` },
      body: JSON.stringify({ action: 'parity_group', protocol: VERSUS_PROTOCOL, contentRevision: contentRevision(), matchSeed: c.matchSeed, round: c.round, seats: c.seats, eliminated: c.eliminated, sides: c.sides, ...(c.vitals ? { vitals: c.vitals } : {}) }),
    });
    const body = (await res.json().catch(() => null)) as { digest?: string; canonical?: string; contentRevision?: string; error?: string } | null;
    if (!res.ok || !body?.canonical) {
      rows.push({ name: c.name, ok: false, detail: `HTTP ${res.status} ${body?.error ?? ''}${body?.contentRevision ? ` (server content ${body.contentRevision}, local ${contentRevision()})` : ''}` });
      continue;
    }
    rows.push(body.canonical === node.canonical
      ? { name: c.name, ok: true, detail: `${node.digest} (server ${body.digest})` }
      : { name: c.name, ok: false, detail: firstDiff(node.canonical, body.canonical) });
  }
  for (const c of duosParityCases(cases)) {
    const node = nodeDuosRecord(c);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${token ?? key}` },
      body: JSON.stringify({ action: 'parity_duos', protocol: VERSUS_PROTOCOL, contentRevision: contentRevision(), matchSeed: c.matchSeed, round: c.round, sides: c.sides, ...(c.vitals ? { vitals: c.vitals } : {}) }),
    });
    const body = (await res.json().catch(() => null)) as { digest?: string; canonical?: string; contentRevision?: string; error?: string } | null;
    if (!res.ok || !body?.canonical) {
      rows.push({ name: c.name, ok: false, detail: `HTTP ${res.status} ${body?.error ?? ''}${body?.contentRevision ? ` (server content ${body.contentRevision}, local ${contentRevision()})` : ''}` });
      continue;
    }
    rows.push(body.canonical === node.canonical
      ? { name: c.name, ok: true, detail: `${node.digest} (server ${body.digest})` }
      : { name: c.name, ok: false, detail: firstDiff(node.canonical, body.canonical) });
  }
  report(rows);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'generate') generate();
else if (cmd === 'bundle') await checkBundle();
else if (cmd === 'remote' && arg) await checkRemote(arg);
else {
  console.log('usage: npm run versus:parity -- generate | bundle | remote <functionUrl>');
  process.exitCode = 2;
}
