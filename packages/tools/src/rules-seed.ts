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

// ── 3. rune second copies that change nothing (the duplicate-policy queue, #900's descendants) ──
const rune = runeSwallowScan();
for (const id of rune.secondSwallowed) {
  const r = RUNE_INDEX[id] as { name: string; cost: number; text?: string };
  rows.push({
    id: `q-rune2-${id}`,
    title: `${r.name}: a second copy does nothing`,
    statement: `You can be offered a rune you already own (the forge never filters owned runes, and Rune of Duplication copies any Epic). `
      + `Buying the second ${r.name} costs ${r.cost} Gold and changes nothing at all — it does not stack, does not record a copy, and shows no second badge effect.`
      + ` Should two copies do MORE than one, or is a dead second buy acceptable?`
      + CLICKS('a second copy deliberately does nothing (a dead buy — consider filtering it from the forge)',
        'bug — a second copy must stack or repeat'),
    domain: 'runes', sourceQueue: 'runeRewardDifferential',
    currentBehaviour: `Second purchase: ${r.cost} Gold spent, zero effect.`,
    cardText: `${r.name} (${r.cost} Gold): "${plain(r.text)}"`,
    example: `Example: you own ${r.name}; the forge offers it again; you pay ${r.cost} Gold; nothing about your run changes.`,
    contentIds: [id],
  });
}

// ── 4. combat: inert + golden-flat ──
const combat = combatScan();
const VARIANTS_DESC = 'tribal boards, Echo/Shout neighbours, mass friendly deaths, guaranteed kills, summon overflow, Celestial pairs, and a combat spellcaster';
for (const id of combat.inert) {
  rows.push({
    id: `q-combatinert-${id}`,
    title: `${cname(id)}: printed effect never influenced a fight`,
    statement: `Across seven staged fights (${VARIANTS_DESC}), the battle with ${cname(id)} was byte-identical to the same battle with a `
      + `stat-clone that has no effect — its printed ability contributed nothing. What condition do the fights fail to stage (so a variant can be added), `
      + `or is the ability genuinely broken?`
      + CLICKS('the trigger is real but rarer than the fights stage — name it in Revise if you can, and Doc Bot stages it',
        'suspected no-op — Doc Bot chases it as a bug'),
    domain: 'combat', sourceQueue: 'combatDifferential',
    currentBehaviour: 'Indistinguishable from an effect-less body across every staged variant.',
    cardText: `${cname(id)}: "${ctext(id)}" [${effectsOf(id)}]`,
    example: `Example: a fight where allies die, ${cname(id)} attacks, takes damage and dies — the log is identical with or without its ability.`,
    contentIds: [id],
  });
}
for (const id of combat.goldenFlat) {
  const g = CARD_INDEX[id]!;
  rows.push({
    id: `q-goldenflat-${id}`,
    title: `${cname(id)}: gilding changes nothing about its combat ability`,
    statement: `A Gilded ${cname(id)} (at the same stats) fights byte-identically to a plain one in the fight that proves its ability works — `
      + `the gild doubles its body but not its effect. Is that correct for this card, or should the Gilded ability be stronger in combat?`
      + CLICKS('correct — the gild doubles stats/other phases only for this card',
        'bug — the Gilded combat effect must double (or otherwise improve)'),
    domain: 'gilding', sourceQueue: 'combatDifferential.golden',
    currentBehaviour: 'Golden vs plain (equal stats): byte-identical fights.',
    cardText: `Plain: "${ctext(id)}"${g.goldenText ? ` ⟶ Gilded: "${plain(g.goldenText)}"` : ' (no separate Gilded text)'}`,
    example: `Example: two fights, identical boards, one ${cname(id)} plain and one Gilded at the same stats — every event matches.`,
    contentIds: [id],
  });
}

// ── 5. combat mods that changed nothing in the staged fight ──
const docs = modDocs();
const src = readFileSync('packages/core/src/types.ts', 'utf8');
const i0 = src.indexOf('interface QuestCombatMods');
const modKeys = [...src.slice(i0, src.indexOf('\n}', i0)).matchAll(/\n {2}([a-zA-Z0-9]+)\??:/g)].map((m) => m[1]!);
for (const key of combatModScan(modKeys).inert) {
  const owner = modOwner(key);
  const doc = docs[key];
  rows.push({
    id: `q-mod-${key}`,
    title: `${owner?.name ?? key}: armed in combat, changed nothing`,
    statement: `${owner ? `${owner.name} reads: "${owner.text}". ` : ''}Arming its combat flag (\`${key}\`) for a staged fight — deaths, kills, `
      + `summons, a Rally body, a Slaughter body, an Echo body — produced a battle byte-identical to the unarmed one. `
      + `Is its condition rarer than the fight stages, or is the mod silently dead (Sable's Soulbind shipped exactly this way, #832)?`
      + CLICKS('condition-gated — name the trigger in Revise if you can, and Doc Bot stages it', 'suspected dead mod — Doc Bot chases it as a bug'),
    domain: 'runes', sourceQueue: 'combatModLane',
    currentBehaviour: 'Armed vs unarmed: identical fights.',
    cardText: doc ? `Engine note on \`${key}\`: ${doc}` : owner ? `${owner.name}: "${owner.text}"` : `combat mod \`${key}\``,
    example: `Example: a run holding ${owner?.name ?? `the ${key} reward`} enters the staged combat; the fight resolves as if the reward were not held.`,
  });
}

// ── 6. hero powers that fired nothing ──
for (const row of heroScan().filter((r) => !r.active)) {
  const hero = HEROES.find((h) => h.id === row.heroId)!;
  let powerText = '';
  try { powerText = plain(heroPowerText(createRun(1, hero.id))); } catch { powerText = ''; }
  rows.push({
    id: `q-hero-${row.heroId}`,
    title: `${hero.name} — ${hero.power.name}: pressing the power does nothing`,
    statement: `${hero.name}'s power "${hero.power.name}" reads: "${powerText || hero.power.kind}". Pressing it (with Gold, a board, and targets available) `
      + `changes nothing. If the power is passive, scheduled, or condition-gated that is correct — confirm which, so Doc Bot stages its real trigger instead of flagging it.`
      + CLICKS(`correct — it is a ${row.kind}-kind power that does not fire on press`, 'bug — pressing it should do something now'),
    domain: 'heroes', sourceQueue: 'heroPowerLane',
    currentBehaviour: 'The heroPower action produces no state change under the fixture.',
    recommendation: `Likely fine: power kind \`${row.kind}\` reads as passive/scheduled.`,
    cardText: `${hero.name} — ${hero.power.name}: "${powerText || `(kind: ${row.kind})`}"`,
    example: `Example: turn 6, 40 Gold, minions on board and in the shop — pressing ${hero.power.name} changes nothing.`,
  });
}

// ── 7. play-lane residue: conditional plays, silent watchers, refused spells ──
const play = playScan();
for (const [id, why] of Object.entries(PLAY_EXCUSED)) {
  rows.push({
    id: `q-play-${id}`,
    title: `${cname(id)}: play effect needs a condition the test can't stage`,
    statement: `Playing ${cname(id)} onto a plain board did exactly what playing a blank body does — its ability needed something that wasn't there. `
      + `Doc Bot's reading of the condition: ${why}. Confirm the reading (it becomes a staged test), or correct it.`
      + CLICKS('the reading is right — Doc Bot stages that condition', 'the reading is wrong — say what actually gates it in Revise'),
    domain: 'actions', sourceQueue: 'playDifferential',
    currentBehaviour: 'Inert when played without its condition.',
    recommendation: why,
    cardText: `${cname(id)}: "${ctext(id)}"`,
    example: `Example: ${cname(id)} played onto a board of plain tokens — no effect observed.`,
    contentIds: [id],
  });
}
for (const [id, why] of Object.entries(WATCHER_EXCUSED)) {
  rows.push({
    id: `q-watch-${id}`,
    title: `${cname(id)}: never reacted to anything played past it`,
    statement: `With ${cname(id)} on the board, playing a minion of every tribe past it changed nothing. Doc Bot's reading: ${why}. Confirm or correct.`
      + CLICKS('the reading is right', 'wrong — it should react in the shop; say when'),
    domain: 'triggers', sourceQueue: 'playDifferential.watchers',
    currentBehaviour: 'Silent for every staged subject.',
    recommendation: why,
    cardText: `${cname(id)}: "${ctext(id)}"`,
    example: `Example: a Beast, a Demon, a Dragon, a Dwarf, a Kobold and an Undead are each played beside ${cname(id)} — it never reacts.`,
    contentIds: [id],
  });
}
for (const id of play.refusedSpells) {
  const sp = CARD_INDEX[id]!;
  rows.push({
    id: `q-refused-${id}`,
    title: `${cname(id)}: refuses to cast on a plain board`,
    statement: `${cname(id)} cannot be cast under the test board (plain minions, offers in the shop, Gold available) — the cast is refused and the card `
      + `stays in hand. That refusal is probably its "no valid use" guard working (audit #847: an unusable spell is refused, not consumed). Confirm the guard is right for this spell.`
      + CLICKS('correct — the refusal condition matches the card', 'wrong — it should cast in that situation'),
    domain: 'actions', sourceQueue: 'playDifferential.refused',
    currentBehaviour: 'Cast refused; card kept, no Gold spent.',
    cardText: `${cname(id)} (${sp.cost ?? 0} Gold): "${ctext(id)}"`,
    example: `Example: board of plain tokens, two shop offers, 60 Gold — ${cname(id)} refuses to cast.`,
    contentIds: [id],
  });
}

// ── emit ──
rows.sort((a, b) => (a.id < b.id ? -1 : 1));
const header = `/**
 * GENERATED by \`npm run rules:seed\` — do not hand-edit. ${rows.length} pending rulings, seeded from Doc
 * Bot's live queues (every entry verified-reachable by a scan; see sourceQueue). Every card is
 * self-contained: printed text, observed behaviour, a concrete example, and explicit click semantics
 * (owner format feedback 2026-08-26). Owner decisions live in decisions.json and survive re-seeding.
 */
import type { GameRule } from '../schema';

export const PENDING_RULES: GameRule[] = `;
const body = JSON.stringify(rows.map((r) => ({
  id: r.id, title: r.title, statement: r.statement, domain: r.domain, status: 'needs-ruling',
  evidence: [{ kind: 'docbot-scan', ref: r.sourceQueue }],
  currentBehaviour: r.currentBehaviour,
  ...(r.recommendation ? { recommendation: r.recommendation } : {}),
  ...(r.cardText ? { cardText: r.cardText } : {}),
  ...(r.example ? { example: r.example } : {}),
  ...(r.contentIds?.length ? { contentIds: r.contentIds } : {}),
  sourceQueue: r.sourceQueue,
})), null, 2);
writeFileSync('packages/rules/src/registry/pending.generated.ts', `${header}${body} as GameRule[];\n`);

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
console.log(`seeded ${rows.length} pending rulings across ${byQueue.size} queues (rich format) → pending.generated.ts + docs/rulebook/TRIAGE.md`);
