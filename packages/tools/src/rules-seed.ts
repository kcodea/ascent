/**
 * `npm run rules:seed` — regenerate the rulebook's PENDING backlog from Doc Bot's live queues.
 *
 * OWNER FEEDBACK 2026-08-26 shaped the card format: every entry must stand alone — the printed text of the
 * card/rune/power in question (nobody should have to look up what Rune of the Aftermarket does), what the
 * scan concretely observed, a concrete example, a REAL question, and explicit click semantics
 * ("Approve = …") so a click is never ambiguous.
 *
 * Output: `packages/rules/src/registry/pending.generated.ts` (committed) + `docs/rulebook/TRIAGE.md`.
 * Deterministic. Owner decisions live in decisions.json and survive re-seeding.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { CARD_INDEX, EPIC_RUNES, QUEST_DEFS, RUNES, RUNE_INDEX } from '@game/content';
import {
  AUTO_RETIRED_RULES, DECISIONS, PENDING_RULES as PREVIOUS_PENDING, RETIRED_IDS,
  applySeedHygiene, type GameRule, type RetiredRule,
} from '@game/rules';
import {
  HEROES, PHASE_EXCUSED, PLAY_EXCUSED, SPELL_POWER_EXCUSED, WATCHER_EXCUSED,
  combatModScan, combatScan, createRun, heroPowerText, heroScan, playScan, runeSwallowScan,
} from '@game/sim';

interface Pending {
  id: string; title: string; statement: string; domain: string; sourceQueue: string;
  currentBehaviour: string; recommendation?: string; contentIds?: string[];
  cardText?: string; example?: string;
}

const plain = (t?: string): string => (t ?? '').replace(/\*\*/g, '');
const cname = (id: string): string => CARD_INDEX[id]?.name ?? RUNE_INDEX[id]?.name ?? id;
const ctext = (id: string): string => plain(CARD_INDEX[id]?.text ?? (RUNE_INDEX[id] as { text?: string } | undefined)?.text);
const effectsOf = (id: string): string => (CARD_INDEX[id]?.effects ?? []).map((e) => `${e.on}:${e.do}`).join(', ');
/** Cards that carry a given effect factory — so a factory-level question names the cards it decides. */
const usersOf = (factory: string): string[] =>
  Object.values(CARD_INDEX).filter((c) => c?.effects.some((e) => e.do === factory)).map((c) => c!.id);
const withTexts = (ids: string[]): string => ids.slice(0, 4).map((id) => `${cname(id)} ("${ctext(id)}")`).join('; ')
  + (ids.length > 4 ? ` — and ${ids.length - 4} more` : '');

/** The QuestCombatMods interface's own doc comments, per key — written beside the code, naming real cards. */
function modDocs(): Record<string, string> {
  const src = readFileSync('packages/core/src/types.ts', 'utf8');
  const i = src.indexOf('interface QuestCombatMods');
  const body = src.slice(i, src.indexOf('\n}', i));
  const out: Record<string, string> = {};
  const re = /\/\*\*([\s\S]*?)\*\/\s*\n\s{2}([a-zA-Z0-9]+)\??:/g;
  for (const m of body.matchAll(re)) {
    out[m[2]!] = m[1]!.replace(/\n\s*\*\s?/g, ' ').trim().replace(/\s+/g, ' ');
  }
  return out;
}

/** The rune or quest whose reward arms a given combat-mod key — its printed text is the player-facing rule. */
function modOwner(key: string): { name: string; text: string } | undefined {
  const all = [...RUNES, ...EPIC_RUNES, ...QUEST_DEFS] as { id: string; name: string; text?: string; reward?: unknown }[];
  const hit = all.find((r) => JSON.stringify(r.reward ?? {}).includes(`"${key}"`))
    ?? all.find((r) => r.id.replace(/^rune_/, '').replace(/_/g, '').toLowerCase() === key.replace(/^rune/, '').toLowerCase());
  return hit ? { name: hit.name, text: plain(hit.text) } : undefined;
}

const rows: Pending[] = [];
const CLICKS = (approve: string, reject: string): string =>
  ` — ✓ Approve = ${approve}. ✎ Revise = your ruling, in a sentence. ✕ Reject = ${reject}.`;

// ── 1. phase-registry needs-triage: factories silent in a phase where their trigger fires ──
for (const [factory, ex] of Object.entries(PHASE_EXCUSED)) {
  if (ex.kind !== 'needs-triage') continue;
  const users = usersOf(factory);
  rows.push({
    id: `q-phase-${factory}`,
    title: `${users.map(cname).join(' / ') || factory}: does nothing in the ${ex.phase} phase`,
    statement: `When the trigger fires in the ${ex.phase} phase, nothing happens — the effect has no ${ex.phase} implementation. `
      + `Doc Bot's reading: ${ex.why}. Should the printed text hold in the ${ex.phase} phase too?`
      + CLICKS(`correct as-is — the effect is ${ex.phase === 'combat' ? 'shop' : 'combat'}-only by design (texts may need a clarifying word)`,
        'this is a bug — implement it in that phase'),
    domain: 'triggers', sourceQueue: 'factoryPhase',
    currentBehaviour: `Silent no-op whenever the trigger fires in ${ex.phase}.`,
    recommendation: ex.why,
    cardText: withTexts(users) || `(factory ${factory} — no live cards currently use it)`,
    example: users[0] ? `Example: ${cname(users[0])} is in play; its trigger fires during the ${ex.phase} phase; the printed effect does not happen.` : undefined,
    contentIds: users,
  });
}

// ── 2. spell-power folding questions ──
for (const [factory, ex] of Object.entries(SPELL_POWER_EXCUSED)) {
  if (ex.kind !== 'needs-triage') continue;
  const users = usersOf(factory);
  rows.push({
    id: `q-spellpower-${factory}`,
    title: `${users.map(cname).join(' / ') || factory}: ignores spell power`,
    statement: `Every other stat-granting Shop spell adds your spell power to its numbers (a +2/+2 under +1/+1 spell power grants +3/+3). `
      + `This one grants its printed numbers flat. Doc Bot's reading: ${ex.why}. Should spell power apply here too?`
      + CLICKS('flat is correct — spell power deliberately does not apply', 'bug — fold spell power in like the rest of the family'),
    domain: 'economy', sourceQueue: 'spellPowerFolding',
    currentBehaviour: 'Grants printed numbers only; spell power ignored.',
    recommendation: ex.why,
    cardText: withTexts(users),
    example: users[0] ? `Example: with +2/+2 spell power, ${cname(users[0])} still grants only its printed numbers.` : undefined,
    contentIds: users,
  });
}

// ── 3. RUNE DUPLICATES — ONE policy question, not 80 (owner audit 2026-08-26: per-rune cards were noise).
const rune = runeSwallowScan();
{
  const list = rune.secondSwallowed.map((id) => {
    const r = RUNE_INDEX[id] as { name: string; cost: number; text?: string };
    return `${r.name} (${r.cost}g): "${plain(r.text)}"`;
  });
  rows.push({
    id: 'q-policy-rune-duplicates',
    title: `Rune duplicate policy: ${rune.secondSwallowed.length} runes whose second copy does nothing`,
    statement: `The forge can offer a rune you already own, and Rune of Duplication copies any Epic — so a SECOND copy of `
      + `${rune.secondSwallowed.length} different runes is purchasable today and does nothing at all (you pay, nothing changes). `
      + `This needs ONE policy: what should a duplicate of a one-shot/boolean rune do by default?`
      + CLICKS('duplicates of these runes deliberately do nothing (and Claude filters owned one-shot runes from the forge so the dead buy cannot happen)',
        'duplicates must always do SOMETHING — Claude proposes a stacking rule per rune family for your review'),
    domain: 'runes', sourceQueue: 'runeRewardDifferential',
    currentBehaviour: 'A second copy: Gold spent, zero effect, for every rune listed.',
    recommendation: 'Filter owned one-shot runes from forge offers; treat amount-carrying runes as stacking (they already do).',
    cardText: list.join(' · '),
    example: 'Example: you own Rune of the Aftermarket (4g); the forge offers it again; you pay 4 Gold; nothing changes.',
  });
}

// ── 4. combat lane residue — after the audit fixes (align stamps, living echo, stored spell, excused-skip)
//    only genuinely unstageable cards remain, and they are DOC BOT VERIFICATION BACKLOG, not owner questions.
//    They are reported in docs/rulebook/TRIAGE.md but NOT queued on the board.
const combat = combatScan();
const docBotBacklog: string[] = combat.inert.map((id) => `${cname(id)} ("${ctext(id)}") — needs a staged scenario Doc Bot cannot build yet`);

// ── 5. combat mods — the un-staged remainder is likewise Doc Bot backlog, not rulings.
const docs = modDocs();
const src = readFileSync('packages/core/src/types.ts', 'utf8');
const i0 = src.indexOf('interface QuestCombatMods');
const modKeys = [...src.slice(i0, src.indexOf('\n}', i0)).matchAll(/\n {2}([a-zA-Z0-9]+)\??:/g)].map((m) => m[1]!);
const modScan = combatModScan(modKeys);
for (const key of modScan.inert) {
  const owner = modOwner(key);
  docBotBacklog.push(`combat mod ${key}${owner ? ` (${owner.name}: "${owner.text}")` : ''}${docs[key] ? ` — ${docs[key]}` : ''}`);
}

// ── 6. HERO POWERS — one confirmation card for the whole passive/scheduled set.
{
  const silent = heroScan().filter((r) => !r.active);
  const lines = silent.map((row) => {
    const hero = HEROES.find((h) => h.id === row.heroId)!;
    let t = ''; try { t = plain(heroPowerText(createRun(1, hero.id))); } catch { /* fixture-less powers */ }
    return `${hero.name} — ${hero.power.name} [${row.kind}]: "${t || row.kind}"`;
  });
  rows.push({
    id: 'q-policy-passive-hero-powers',
    title: `${silent.length} hero powers do nothing when pressed — confirm they are passive/scheduled by design`,
    statement: `Pressing these powers (Gold, board and targets available) changes nothing. Doc Bot reads each as passive, scheduled, `
      + `or condition-gated by its kind. Confirm the LIST is all working-as-designed; name any exception in Revise and Doc Bot chases it as a bug.`
      + CLICKS('all of these are passive/scheduled by design', 'at least one should act on press — name it in Revise'),
    domain: 'heroes', sourceQueue: 'heroPowerLane',
    currentBehaviour: 'No state change through the real heroPower action for any of them.',
    cardText: lines.join(' · '),
    example: 'Example: turn 6, 40 Gold, minions everywhere — pressing Commission does nothing (its choices resolve on later turns).',
  });
}

// ── 7. play-lane: the five conditionals were STAGED AND VERIFIED WORKING in the owner audit (Ironlung with
//    Dwarves, Relay beside an Orbit Celestial, Recaller after a cast, Cleric per its "other Dragons" text,
//    Mage-Pup by mechanism) — they leave the board. The watcher reading and ONE refused-spells confirmation stay.
const play = playScan();
for (const [id, why] of Object.entries(WATCHER_EXCUSED)) {
  rows.push({
    id: `q-watch-${id}`,
    title: `${cname(id)}: never reacts to things played past it — confirm the reading`,
    statement: `With ${cname(id)} on the board, playing a minion of every tribe past it changed nothing. Doc Bot's reading: ${why}.`
      + CLICKS('the reading is right', 'wrong — it should react in the shop; say when'),
    domain: 'triggers', sourceQueue: 'playDifferential.watchers',
    currentBehaviour: 'Silent for every staged subject.',
    recommendation: why,
    cardText: `${cname(id)}: "${ctext(id)}"`,
    example: `Example: a Beast, a Demon, a Dragon, a Dwarf and a Kobold are each played beside ${cname(id)} — it never reacts.`,
    contentIds: [id],
  });
}
{
  const list = play.refusedSpells.map((id) => `${cname(id)} (${CARD_INDEX[id]?.cost ?? 0}g): "${ctext(id)}"`);
  rows.push({
    id: 'q-policy-refused-spells',
    title: `${play.refusedSpells.length} spells refuse to cast on a plain board — confirm the refusal guards`,
    statement: `Each of these refuses to cast when it would accomplish nothing (the #847 audit rule: an unusable spell is refused, `
      + `not consumed). Doc Bot cannot distinguish a CORRECT guard from an over-eager one. Skim the list: does any refusal look wrong?`
      + CLICKS('all refusal guards are correct', 'one is over-eager — name it in Revise'),
    domain: 'actions', sourceQueue: 'playDifferential.refused',
    currentBehaviour: 'Cast refused; card kept, no Gold spent — for every spell listed.',
    cardText: list.join(' · '),
    example: 'Example: a board of plain tokens, offers in the shop, 60 Gold — Mend refuses (nothing is damaged).',
  });
}

// ── seed hygiene (§10.4, unit-tested in @game/rules seedSupport): rejected questions leave the active
//    set with an audit tombstone; stale questions (vanished content) auto-retire; tombstoned ids never
//    resurrect. Owner approve/revise decisions leave their questions in place — decisions survive reseeding.
rows.sort((a, b) => (a.id < b.id ? -1 : 1));
const fresh: GameRule[] = rows.map((r) => ({
  id: r.id, title: r.title, statement: r.statement, domain: r.domain as GameRule['domain'], status: 'needs-ruling',
  evidence: [{ kind: 'docbot-scan', ref: r.sourceQueue }],
  currentBehaviour: r.currentBehaviour,
  ...(r.recommendation ? { recommendation: r.recommendation } : {}),
  ...(r.cardText ? { cardText: r.cardText } : {}),
  ...(r.example ? { example: r.example } : {}),
  ...(r.contentIds?.length ? { contentIds: r.contentIds } : {}),
  sourceQueue: r.sourceQueue,
} as GameRule));
const priorAutoIds = new Set(AUTO_RETIRED_RULES.map((t) => t.id));
const hygiene = applySeedHygiene({
  fresh,
  previous: PREVIOUS_PENDING,
  decisions: DECISIONS,
  retiredIds: new Set([...RETIRED_IDS, ...priorAutoIds]),
  contentResolves: (id) => !!CARD_INDEX[id] || !!RUNE_INDEX[id],
  today: new Date().toISOString().slice(0, 10),
});
const emitted = hygiene.pending;
const emittedIds = new Set(emitted.map((r) => r.id));

// ── emit pending.generated.ts ──
const header = `/**
 * GENERATED by \`npm run rules:seed\` — do not hand-edit. ${emitted.length} pending rulings, seeded from Doc
 * Bot's live queues (every entry verified-reachable by a scan; see sourceQueue). Every card is
 * self-contained: printed text, observed behaviour, a concrete example, and explicit click semantics
 * (owner format feedback 2026-08-26). Owner decisions live in decisions.json and survive re-seeding;
 * rejected/stale questions are tombstoned into retired.generated.ts by the seed-hygiene pass.
 */
import type { GameRule } from '../schema';

export const PENDING_RULES: GameRule[] = `;
const body = JSON.stringify(emitted, null, 2);
writeFileSync('packages/rules/src/registry/pending.generated.ts', `${header}${body} as GameRule[];\n`);

// ── emit retired.generated.ts (append-only: prior tombstones survive verbatim) ──
const allTombstones: RetiredRule[] = [...AUTO_RETIRED_RULES, ...hygiene.newTombstones];
const retiredHeader = `/**
 * GENERATED by \`npm run rules:seed\` — do not hand-edit. AUTO-retired tombstones: pending questions that
 * left the board mechanically (owner REJECTED the recommendation, or the question's content ids vanished),
 * each with an audit record. Entries are append-only — the seeder merges, never drops. Ids here are never
 * recycled as new pending ids (tested in rules.test.ts).
 */
import type { RetiredRule } from './retired';

export const AUTO_RETIRED_RULES: RetiredRule[] = `;
writeFileSync(
  'packages/rules/src/registry/retired.generated.ts',
  `${retiredHeader}${JSON.stringify(allTombstones, null, 2)} as RetiredRule[];\n\n`
  + 'export const AUTO_RETIRED_IDS: ReadonlySet<string> = new Set(AUTO_RETIRED_RULES.map((r) => r.id));\n',
);

mkdirSync('docs/rulebook', { recursive: true });
const byQueue = new Map<string, Pending[]>();
for (const r of rows.filter((p) => emittedIds.has(p.id))) {
  if (!byQueue.has(r.sourceQueue)) byQueue.set(r.sourceQueue, []);
  byQueue.get(r.sourceQueue)!.push(r);
}
let md = `# Rulebook triage backlog\n\nGenerated by \`npm run rules:seed\` — ${emitted.length} pending rulings from Doc Bot's queues.\nDecide them in the DEV MENU → Rulebook board (clicks write to decisions.json), or by telling Claude in chat.\n\n`;
for (const [q, items] of [...byQueue.entries()].sort()) {
  md += `## ${q} (${items.length})\n\n`;
  for (const r of items) md += `- **${r.id}** — ${r.title}\n`;
  md += '\n';
}
md += `## Doc Bot verification backlog (${docBotBacklog.length}) — NOT owner questions\n\n`
  + 'Items Doc Bot could not yet verify with a staged scenario. Claude works these; they reach the board only if a\n'
  + 'staged scenario CONFIRMS a mismatch or exposes a genuine design fork.\n\n';
for (const b of docBotBacklog) md += `- ${b}\n`;
writeFileSync('docs/rulebook/TRIAGE.md', md);
console.log(
  `seeded ${emitted.length} pending rulings across ${byQueue.size} queues (rich format) → pending.generated.ts + docs/rulebook/TRIAGE.md`
  + (hygiene.newTombstones.length
    ? `; auto-retired ${hygiene.newTombstones.length} (${hygiene.newTombstones.map((t) => t.id).join(', ')}) → retired.generated.ts`
    : ''),
);
