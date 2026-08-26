/**
 * `npm run rules:seed` — regenerate the rulebook's PENDING backlog from Doc Bot's live queues.
 *
 * The blueprint's Phase 1 extraction, resequenced per the owner's chain (2026-08-26): instead of a
 * full-source sweep, the first triage backlog IS Doc Bot's measured queues — every entry already carries a
 * verified-reachable scenario and an evidence trail, so nothing here asks the owner to rule on speculation.
 *
 * Output: `packages/rules/src/registry/pending.generated.ts` (committed — the board and the tests import it)
 * plus `docs/rulebook/TRIAGE.md` (the human-readable snapshot). Deterministic: same code + content → same
 * file. Owner DECISIONS live separately in `decisions.json` and survive re-seeding: a decided id that
 * re-seeds keeps its decision; a decided id that no longer seeds is reported as resolved.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import {
  HEROES, PHASE_EXCUSED, PLAY_EXCUSED, SPELL_POWER_EXCUSED, WATCHER_EXCUSED,
  combatModScan, combatScan, heroScan, playScan, runeSwallowScan,
} from '@game/sim';

interface Pending {
  id: string; title: string; statement: string; domain: string; sourceQueue: string;
  currentBehaviour: string; recommendation?: string; contentIds?: string[];
}

const name = (id: string): string => CARD_INDEX[id]?.name ?? RUNE_INDEX?.[id]?.name ?? id;
const rows: Pending[] = [];

// ── 1. phase-registry needs-triage: factories silent in a phase where their trigger fires ──
for (const [factory, ex] of Object.entries(PHASE_EXCUSED)) {
  if (ex.kind !== 'needs-triage') continue;
  rows.push({
    id: `q-phase-${factory}`,
    title: `${factory}: silent in ${ex.phase}`,
    statement: `Should \`${factory}\` act in the ${ex.phase} phase? Its trigger fires there and the factory does nothing.`,
    domain: 'triggers', sourceQueue: 'factoryPhase',
    currentBehaviour: `Silent no-op in ${ex.phase}.`,
    recommendation: ex.why,
  });
}

// ── 2. spell-power folding questions ──
for (const [factory, ex] of Object.entries(SPELL_POWER_EXCUSED)) {
  if (ex.kind !== 'needs-triage') continue;
  rows.push({
    id: `q-spellpower-${factory}`,
    title: `${factory}: fold spell power?`,
    statement: `Should \`${factory}\` fold spell power into its grant, like the rest of the stat-spell family?`,
    domain: 'economy', sourceQueue: 'spellPowerFolding',
    currentBehaviour: 'Does not fold spell power.',
    recommendation: ex.why,
  });
}

// ── 3. rune second copies that change nothing (the duplicate-policy queue, #900's descendants) ──
const rune = runeSwallowScan();
for (const id of rune.secondSwallowed) {
  rows.push({
    id: `q-rune2-${id}`,
    title: `${name(id)}: second copy does nothing`,
    statement: `A second copy of ${name(id)} is purchasable (the forge never excludes owned runes; Duplication doubles any Epic) and currently changes nothing. Should it stack, record a copy, or is it ruled deliberately idempotent?`,
    domain: 'runes', sourceQueue: 'runeRewardDifferential',
    currentBehaviour: 'The player pays; the state does not change.',
    contentIds: [id],
  });
}

// ── 4. combat: inert + golden-flat ──
const combat = combatScan();
for (const id of combat.inert) {
  rows.push({
    id: `q-combatinert-${id}`,
    title: `${name(id)}: combat effect never acted`,
    statement: `${name(id)}'s combat effect changed nothing in any of the seven staged fight variants. Is its trigger condition rarer than the variants stage, or is it a real no-op?`,
    domain: 'combat', sourceQueue: 'combatDifferential',
    currentBehaviour: 'Indistinguishable from a stat-clone control across every variant.',
    contentIds: [id],
  });
}
for (const id of combat.goldenFlat) {
  rows.push({
    id: `q-goldenflat-${id}`,
    title: `${name(id)}: golden combat = plain`,
    statement: `Gilded ${name(id)} fights identically to plain (at equal stats) in its proving variant. Is the gild supposed to change this effect in combat?`,
    domain: 'gilding', sourceQueue: 'combatDifferential.golden',
    currentBehaviour: 'Golden and plain produce byte-identical fights.',
    contentIds: [id],
  });
}

// ── 5. combat mods that changed nothing in the staged fight ──
const src = readFileSync('packages/core/src/types.ts', 'utf8');
const i0 = src.indexOf('interface QuestCombatMods');
const modKeys = [...src.slice(i0, src.indexOf('\n}', i0)).matchAll(/\n {2}([a-zA-Z0-9]+)\??:/g)].map((m) => m[1]!);
for (const key of combatModScan(modKeys).inert) {
  rows.push({
    id: `q-mod-${key}`,
    title: `combat mod ${key}: no observable effect`,
    statement: `Arming the quest/rune combat mod \`${key}\` changed nothing about the staged fight. Condition-gated beyond the fixture, or a silent no-op (the Soulbind class, #832)?`,
    domain: 'runes', sourceQueue: 'combatModLane',
    currentBehaviour: 'Armed vs unarmed fights are identical.',
  });
}

// ── 6. hero powers that fired nothing ──
for (const row of heroScan().filter((r) => !r.active)) {
  rows.push({
    id: `q-hero-${row.heroId}`,
    title: `${HEROES.find((h) => h.id === row.heroId)?.name ?? row.heroId}: power fired nothing`,
    statement: `Firing ${row.heroId}'s power (kind \`${row.kind}\`) under the fixture changed nothing. Passive/scheduled by design, or the §13.5 silent-routing class?`,
    domain: 'heroes', sourceQueue: 'heroPowerLane',
    currentBehaviour: 'No state change through the real heroPower action.',
    recommendation: 'Likely passive/scheduled by design — confirm the kind and it becomes a staging task, not a bug.',
  });
}

// ── 7. play-lane residue: conditional plays, silent watchers, refused spells ──
const play = playScan();
for (const [id, why] of Object.entries(PLAY_EXCUSED)) {
  rows.push({
    id: `q-play-${id}`, title: `${name(id)}: play inert under fixture`,
    statement: `Playing ${name(id)} was indistinguishable from a vanilla body under the clean fixture. Claude's reading of the condition: ${why}. Confirm?`,
    domain: 'actions', sourceQueue: 'playDifferential', currentBehaviour: 'Inert under the clean fixture.', recommendation: why, contentIds: [id],
  });
}
for (const [id, why] of Object.entries(WATCHER_EXCUSED)) {
  rows.push({
    id: `q-watch-${id}`, title: `${name(id)}: watcher silent in shop`,
    statement: `${name(id)} reacted to no tribe subject played past it in the shop. Claude's reading: ${why}. Confirm?`,
    domain: 'triggers', sourceQueue: 'playDifferential.watchers', currentBehaviour: 'Silent for every staged subject.', recommendation: why, contentIds: [id],
  });
}
for (const id of play.refusedSpells) {
  rows.push({
    id: `q-refused-${id}`, title: `${name(id)}: uncastable under fixture`,
    statement: `${name(id)} refuses to cast under the differential fixture, so its behaviour ships untested by that lane. Is the refusal condition as intended?`,
    domain: 'actions', sourceQueue: 'playDifferential.refused', currentBehaviour: 'Cast refused (kept in hand, no Gold spent).', contentIds: [id],
  });
}

// ── emit ──
rows.sort((a, b) => (a.id < b.id ? -1 : 1));
const header = `/**
 * GENERATED by \`npm run rules:seed\` — do not hand-edit. ${rows.length} pending rulings, seeded from Doc
 * Bot's live queues (every entry verified-reachable by a scan; see sourceQueue). Owner decisions live in
 * decisions.json and survive re-seeding.
 */
import type { GameRule } from '../schema';

export const PENDING_RULES: GameRule[] = `;
const body = JSON.stringify(rows.map((r) => ({
  id: r.id, title: r.title, statement: r.statement, domain: r.domain, status: 'needs-ruling',
  evidence: [{ kind: 'docbot-scan', ref: r.sourceQueue }],
  currentBehaviour: r.currentBehaviour,
  ...(r.recommendation ? { recommendation: r.recommendation } : {}),
  ...(r.contentIds ? { contentIds: r.contentIds } : {}),
  sourceQueue: r.sourceQueue,
})), null, 2);
writeFileSync('packages/rules/src/registry/pending.generated.ts', `${header}${body} as GameRule[];\n`);

// TRIAGE.md — the human-readable snapshot
mkdirSync('docs/rulebook', { recursive: true });
const byQueue = new Map<string, Pending[]>();
for (const r of rows) {
  if (!byQueue.has(r.sourceQueue)) byQueue.set(r.sourceQueue, []);
  byQueue.get(r.sourceQueue)!.push(r);
}
let md = `# Rulebook triage backlog\n\nGenerated by \`npm run rules:seed\` — ${rows.length} pending rulings from Doc Bot's queues.\nDecide them in the DEV MENU → Rulebook board (clicks write to decisions.json), or by telling Claude in chat.\n\n`;
for (const [q, items] of [...byQueue.entries()].sort()) {
  md += `## ${q} (${items.length})\n\n`;
  for (const r of items) md += `- **${r.id}** — ${r.title}\n`;
  md += '\n';
}
writeFileSync('docs/rulebook/TRIAGE.md', md);
console.log(`seeded ${rows.length} pending rulings across ${byQueue.size} queues → pending.generated.ts + docs/rulebook/TRIAGE.md`);
