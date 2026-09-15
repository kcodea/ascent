/**
 * BALANCE BOT B5 — render an `Aggregate` as markdown (the designer's page) or JSON (the machine's).
 *
 * Order is the roadmap's: header (manifest + identity digests) → COVERAGE FIRST → likely problems (evidence level 1,
 * ranked by effect size) → Heroes → Runes → Minions → Spells → Pacing. Every number carries its count; a row under
 * `minSupport` is printed with a `(sparse)` label and never appears in the problems list.
 */
import type { Aggregate, HeroRow, MinionRow, RuneRow, SpellRow } from './aggregate';
import type { CI } from './stats';
import type { ExperimentIdentity, ExperimentManifest } from './deps';
import { fmt } from './aggregate';

export interface ReportOptions {
  format: 'md' | 'json';
  /** Print at most this many rows per table (sorted by support). Default 60. */
  maxRows?: number;
  /** The job's manifest + identity for the header (the aggregate only carries digests). */
  manifest?: ExperimentManifest;
  identity?: ExperimentIdentity;
  jobId?: string;
}

export function renderReport(agg: Aggregate, opts: ReportOptions): string {
  if (opts.format === 'json') return JSON.stringify({ jobId: opts.jobId, manifest: opts.manifest, identity: opts.identity, aggregate: agg }, null, 2);
  const maxRows = opts.maxRows ?? 60;
  const out: string[] = [];
  const c = agg.coverage;

  out.push(`# Balance report${opts.jobId ? ` — job \`${opts.jobId}\`` : ''}`);
  out.push('');
  out.push(renderHeader(agg, opts));
  out.push('');

  // ── coverage ────────────────────────────────────────────────────────────────────────────────────────────────
  out.push('## Coverage (read this first)');
  out.push('');
  out.push('| Lobbies | planned | started | complete | failed | censored | capped |');
  out.push('|---|---|---|---|---|---|---|');
  out.push(`| | ${c.lobbies.planned} | ${c.lobbies.started} | ${c.lobbies.complete} | ${c.lobbies.failed} | ${c.lobbies.censored} | ${c.lobbies.capped} |`);
  out.push('');
  out.push('| Runs | started | placed | capped | failed |');
  out.push('|---|---|---|---|---|');
  out.push(`| | ${c.runs.started} | ${c.runs.placed} | ${c.runs.capped} | ${c.runs.failed} |`);
  out.push('');
  out.push(`Rounds played: mean ${fmt(c.roundsPlayed.mean, 1)} (min ${c.roundsPlayed.min}, max ${c.roundsPlayed.max}). Modes: ${c.modes.join(', ') || '—'}. Sets: ${c.setIds.join(', ') || '—'}. Policies: ${c.policies.join(', ') || '—'}.`);
  if (c.refusedModes.length) out.push(`\n> **Refused:** records in mode(s) ${c.refusedModes.map((m) => `\`${m}\``).join(', ')} are excluded — those modes are not pooled with lobby placement (roadmap: "Do not pool course victory with lobby placement").`);
  if (c.identityDigests.length > 1) out.push(`\n> **Mixed identities:** ${c.identityDigests.length} distinct rules/content identities in one job — the tables below pool them. Split the job before drawing a conclusion.`);
  const failHeroes = Object.entries(c.failureByHero).filter(([, v]) => v.failed > 0);
  const failPolicies = Object.entries(c.failureByPolicy).filter(([, v]) => v.failed > 0);
  if (failHeroes.length || failPolicies.length) {
    out.push('');
    out.push('Failure rate (runs the runner could not advance — never counted as losses):');
    out.push('');
    out.push('| scope | id | runs | failed | rate |');
    out.push('|---|---|---|---|---|');
    for (const [id, v] of failHeroes) out.push(`| hero | ${id} | ${v.runs} | ${v.failed} | ${pct(v.rate)} |`);
    for (const [id, v] of failPolicies) out.push(`| policy | ${id} | ${v.runs} | ${v.failed} | ${pct(v.rate)} |`);
  } else {
    out.push('');
    out.push('No failed runs.');
  }
  out.push('');
  if (agg.recorded) out.push(`Pilot mean placement: ${ciText(agg.populationPlacement)} — against a FROZEN recorded population (below); 4.5 would be "as good as the field", lower is better.`);
  else out.push(`Population mean placement: ${ciText(agg.populationPlacement)} (symmetric self-play is mechanically 4.5; hero-specific rows carry the signal).`);
  out.push('');

  // ── the recorded population (pinned lobbies) ─────────────────────────────────────────────────────────────────
  if (agg.recorded) {
    const r = agg.recorded;
    out.push('## Recorded population (the field the pilot sat in — not decisions, not ranked)');
    out.push('');
    out.push(`${r.seats} recorded seats from ${r.runs} distinct player runs by ${r.authors} authors; ${fmt(r.wavesPerRun, 1)} recorded waves per run. Recordings do not adapt: a pinned job measures the pilot against this population as it was recorded.`);
    out.push('');
    out.push(`Recordings' mean placement: ${ciText(r.recordingsPlacement)} · pilot: ${ciText(r.pilotPlacement)}. Pilot rounds: ${Object.entries(r.pilotResults).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
    out.push('');
    out.push('| patch | seats |');
    out.push('|---|---|');
    for (const [p, n] of Object.entries(r.patches)) out.push(`| ${p} | ${n} |`);
    out.push('');
    out.push('| recorded hero | seats |');
    out.push('|---|---|');
    for (const [h, n] of Object.entries(r.heroes).sort(([, a], [, b]) => b - a)) out.push(`| ${h} | ${n} |`);
    out.push('');
  }

  // ── likely problems ─────────────────────────────────────────────────────────────────────────────────────────
  out.push('## Likely problems (evidence level 1 — descriptive; co-occurrence, not causation)');
  out.push('');
  if (!agg.problems.length) out.push('_No entity\'s 95% interval excludes the population mean at the current support. An inconclusive interval means inconclusive, not balanced._');
  else {
    out.push('| # | kind | entity | effect (placement) | 95% CI | runs | lobbies | evidence | note |');
    out.push('|---|---|---|---|---|---|---|---|---|');
    agg.problems.forEach((p, i) => out.push(`| ${i + 1} | ${p.kind} | ${p.name} (\`${p.id}\`) | ${signed(p.effect)} | [${fmt(p.ci.lo)}, ${fmt(p.ci.hi)}] | ${p.ci.n} | ${p.ci.lobbies} | L1 | ${p.note} |`));
    out.push('');
    out.push(`_${agg.problems.length} of ${agg.heroes.length + agg.runes.length + agg.minions.length + agg.spells.length} entities flagged; scanning many entities inflates false discoveries — treat this as a lead list for a level-3 patch experiment (\`balance:compare\`)._`);
  }
  out.push('');

  // ── heroes ──────────────────────────────────────────────────────────────────────────────────────────────────
  out.push('## Heroes');
  out.push('');
  out.push('| hero | eligible | assigned | placed | mean placement [95% CI] | top-half [95% CI] | elimination rounds | power uses (per run) | |');
  out.push('|---|---|---|---|---|---|---|---|---|');
  for (const h of top(agg.heroes, (x) => x.placement.n, maxRows)) out.push(heroLine(h));
  out.push('');

  // ── runes ───────────────────────────────────────────────────────────────────────────────────────────────────
  out.push('## Runes');
  out.push('');
  out.push('| rune | offered | picked | skipped | pick rate | acq. round | owner runs | owners placement [CI] | non-owners [CI] | lift [CI] | |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of top(agg.runes, (x) => x.offered + x.owners, maxRows)) out.push(runeLine(r));
  out.push('');

  // ── minions ─────────────────────────────────────────────────────────────────────────────────────────────────
  out.push('## Minions');
  out.push('');
  out.push('| minion | T | offered → bought → played | buy% | sold | triples | final-board rate | acq. round / tier | held (rounds) | runs held | placement held [CI] | not held [CI] | shrunk | |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const m of top(agg.minions, (x) => x.offered, maxRows)) out.push(minionLine(m));
  out.push('');

  // ── spells ──────────────────────────────────────────────────────────────────────────────────────────────────
  out.push('## Spells');
  out.push('');
  out.push('| spell | T | offered → bought → cast | buy% | casts shop / generated / other | repeats | held unused (rate) | runs cast | placement cast [CI] | not cast [CI] | shrunk | |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of top(agg.spells, (x) => x.offered, maxRows)) out.push(spellLine(s));
  out.push('');

  // ── pacing ──────────────────────────────────────────────────────────────────────────────────────────────────
  out.push('## Pacing');
  out.push('');
  out.push(`Actions per recruit turn: ${fmt(agg.pacing.actionsPerTurn, 1)}. Round results: ${Object.entries(agg.pacing.results).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  out.push(`Winner hero concentration (Herfindahl): ${fmt(agg.pacing.winnerHeroConcentration, 3)}. Final-board diversity: ${fmt(agg.pacing.finalBoardDiversity, 3)}. Early-card (T1–2) retention on final boards: ${pct(agg.pacing.earlyCardRetention)}.`);
  out.push('');
  out.push('| round | mean tier (n) | unspent Gold (n) | board turnover (n) |');
  out.push('|---|---|---|---|');
  for (let i = 0; i < agg.pacing.tierByRound.length; i++) {
    const t = agg.pacing.tierByRound[i], u = agg.pacing.unspentByRound[i], b = agg.pacing.turnoverByRound[i];
    out.push(`| ${t.round} | ${fmt(t.mean)} (${t.n}) | ${fmt(u.mean)} (${u.n}) | ${pct(b.mean)} (${b.n}) |`);
  }
  out.push('');
  out.push(`_Aggregate options: minSupport ${agg.options.minSupport}, bootstrap ${agg.options.bootstrapReps} reps (seed ${agg.options.seed}), shrinkage k ${agg.options.shrinkK}. Records digest \`${agg.recordsDigest}\`._`);
  return out.join('\n');
}

export function renderHeader(agg: Aggregate, opts: Pick<ReportOptions, 'manifest' | 'identity'>): string {
  const m = opts.manifest; const id = opts.identity;
  const lines: string[] = [];
  if (m) lines.push(`**Manifest:** ${m.name} · mode \`${m.mode}\` · set \`${m.setId}\` · policy \`${m.policy.id}\` (depth ${m.policy.budget.depth}, beam ${m.policy.budget.beam}, ${m.policy.budget.maxNodes} nodes, ${m.policy.budget.positionCandidates} positions) · seeds ${m.seeds.start}…${m.seeds.start + m.seeds.count - 1}${m.maxRounds ? ` · maxRounds ${m.maxRounds}` : ''}${m.heroes?.length ? ` · heroes [${m.heroes.join(', ')}]` : ''}${m.notes ? ` · _${m.notes}_` : ''}`);
  else lines.push(`**Manifest digests:** ${agg.coverage.manifestDigests.map((d) => `\`${d}\``).join(', ') || '—'}`);
  if (id) lines.push(`**Identity:** engine \`${id.engineRevision}\`${id.dirtyDigest ? ` (dirty \`${id.dirtyDigest}\`)` : ' (clean)'} · content \`${id.contentDigest}\` · pool \`${id.poolDigest}\` · effects \`${id.effectDigest}\` · manifest \`${id.manifestDigest}\``);
  else lines.push(`**Identity digests:** ${agg.coverage.identityDigests.map((d) => `\`${d}\``).join(', ') || '—'}`);
  return lines.join('\n');
}

// ── row renderers ─────────────────────────────────────────────────────────────────────────────────────────────

const top = <T>(rows: T[], support: (r: T) => number, n: number): T[] => [...rows].sort((a, b) => support(b) - support(a)).slice(0, n);
export const pct = (x: number | undefined): string => (x === undefined || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(0)}%`);
export const signed = (x: number | undefined, dp = 2): string => (x === undefined ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(dp)}`);
export const ciText = (c: CI, dp = 2): string => (c.est === undefined ? `— (n=${c.n})` : c.lobbies < 2 ? `${fmt(c.est, dp)} [single lobby] (n=${c.n})` : `${fmt(c.est, dp)} [${fmt(c.lo, dp)}, ${fmt(c.hi, dp)}] (n=${c.n}, ${c.lobbies} lobbies)`);
const sparse = (s: boolean): string => (s ? '(sparse)' : '');

function heroLine(h: HeroRow): string {
  const elim = Object.entries(h.eliminationRounds).map(([r, n]) => `r${r}:${n}`).join(' ') || '—';
  return `| ${h.name} (\`${h.heroId}\`) | ${h.eligible} | ${h.assigned} | ${h.placement.n} | ${ciText(h.placement)} | ${pctCi(h.topHalf)} | ${elim} | ${h.heroPowerUses} (${fmt(h.powerUsesPerRun, 1)}) | ${sparse(h.suppressed)} |`;
}
function runeLine(r: RuneRow): string {
  return `| ${r.name} (\`${r.runeId}\`) | ${r.offered} | ${r.picked} | ${r.skipped} | ${pct(r.pickRate)} | ${fmt(r.acquisitionRound, 1)} | ${r.owners} | ${ciText(r.ownersPlacement)} | ${ciText(r.nonOwnersPlacement)} | ${signed(r.lift.est)} [${fmt(r.lift.lo)}, ${fmt(r.lift.hi)}] | ${sparse(r.suppressed)} |`;
}
function minionLine(m: MinionRow): string {
  return `| ${m.name} (\`${m.cardId}\`) | ${m.tier} | ${m.offered} → ${m.bought} → ${m.played} | ${pct(m.buyRate)} | ${m.sold} | ${m.tripled} | ${pct(m.finalBoardRate)} (${m.finalBoard}) | ${fmt(m.acquisitionRound, 1)} / ${fmt(m.acquisitionTier, 1)} | ${fmt(m.heldRounds, 1)} | ${m.runsHeld} | ${ciText(m.placementHeld)} | ${ciText(m.placementNotHeld)} | ${fmt(m.shrunkPlacement)} | ${sparse(m.suppressed)} |`;
}
function spellLine(s: SpellRow): string {
  return `| ${s.name} (\`${s.cardId}\`) | ${s.tier} | ${s.offered} → ${s.bought} → ${s.cast} | ${pct(s.buyRate)} | ${s.castShop} / ${s.castGenerated} / ${s.castOther} | ${s.repeats} | ${s.heldUnused} (${pct(s.heldRate)}) | ${s.runsCast} | ${ciText(s.placementCast)} | ${ciText(s.placementNotCast)} | ${fmt(s.shrunkPlacement)} | ${sparse(s.suppressed)} |`;
}
function pctCi(c: CI): string {
  return c.est === undefined ? `— (n=${c.n})` : c.lobbies < 2 ? `${pct(c.est)} [single lobby] (n=${c.n})` : `${pct(c.est)} [${pct(c.lo)}, ${pct(c.hi)}] (n=${c.n})`;
}
