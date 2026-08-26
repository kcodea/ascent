/**
 * `npm run docbot` — Doc Bot's full report.
 *
 * The four tripwires GATE (they run in `npm test`); this command NARRATES: the coverage the gates enforce,
 * plus the backlogs they tolerate-but-track — the needs-triage phase gaps awaiting an owner ruling, and the
 * raw-tribe-comparison debt behind the ratchet. Read docs/docbot.md for the doctrine.
 *
 * Everything here is derived live from content + source. Nothing is hand-maintained; if a number here
 * disagrees with a doc, this number wins (the CONTENT.md lesson).
 */
import { CARD_INDEX, RUNES, EPIC_RUNES } from '@game/content';
import { FACTORIES, combatCastable } from '@game/core';
import { readFileSync } from 'node:fs';
import {
  COMBAT_CASTING_FACTORIES, HEROES, PHASE_EXCUSED, PREDICATE_FILES, RAW_TRIBE_COMPARE_SOURCE,
  RECRUIT_FACTORY_IDS, SPELL_POWER_EXCUSED, TRIBE_RATCHET, TRIGGER_PHASES, combatScan, playScan, runeSwallowScan,
} from '@game/sim';

/** The ratchet scan, done locally: the registry is pure data (it rides the public sim entrypoint into the
 *  web bundle), so each node-only consumer builds its own fs-backed scanner from the shared pattern. */
function ratchetScan(): { file: string; count: number; unguarded: number; pinned: number }[] {
  const raw = new RegExp(RAW_TRIBE_COMPARE_SOURCE);
  return PREDICATE_FILES.map((file) => {
    const lines = readFileSync(file, 'utf8').split('\n').filter((l) => raw.test(l));
    return { file, count: lines.length, unguarded: lines.filter((l) => !/universalTribe|allTribes|isTribe/.test(l)).length, pinned: TRIBE_RATCHET[file]! };
  });
}

const cards = Object.values(CARD_INDEX).filter((c): c is NonNullable<typeof c> => !!c);
const combatIds = new Set(Object.keys(FACTORIES));

// ── inventory ──────────────────────────────────────────────────────────────────────────────────────────────
const spells = cards.filter((c) => c.spell).length;
const tokens = cards.filter((c) => c.token).length;
const factories = new Set(cards.flatMap((c) => c.effects.map((e) => e.do)));
console.log('\n══ DOC BOT ═════════════════════════════════════════════════════════════');
console.log(`content: ${cards.length} cards (${spells} spells, ${tokens} tokens) · ${HEROES.length} heroes · ${RUNES.length}+${EPIC_RUNES.length} runes · ${factories.size} effect factories in use`);

// ── 1. factory × phase ─────────────────────────────────────────────────────────────────────────────────────
const pairs = new Map<string, Set<string>>();
for (const c of cards) for (const e of c.effects) {
  if (!pairs.has(e.on)) pairs.set(e.on, new Set());
  pairs.get(e.on)!.add(e.do);
}
let dualPairs = 0, covered = 0, excused = 0;
for (const [on, dos] of pairs) {
  if (TRIGGER_PHASES[on] !== 'both') continue;
  for (const d of dos) {
    dualPairs++;
    if (RECRUIT_FACTORY_IDS.has(d) && combatIds.has(d)) covered++;
    else if (PHASE_EXCUSED[d]) excused++;
  }
}
console.log('\n── 1. factory × phase (the silent-dispatch tripwire) ──');
console.log(`dual-phase (trigger, factory) pairs: ${dualPairs} · implemented both sides: ${covered} · excused: ${excused}`);
const byKind = new Map<string, string[]>();
for (const [d, e] of Object.entries(PHASE_EXCUSED)) {
  if (!byKind.has(e.kind)) byKind.set(e.kind, []);
  byKind.get(e.kind)!.push(d);
}
for (const [kind, ds] of [...byKind.entries()].sort()) console.log(`  ${kind}: ${ds.length}`);
const triage = Object.entries(PHASE_EXCUSED).filter(([, e]) => e.kind === 'needs-triage');
if (triage.length) {
  console.log(`\n  ⚠ NEEDS-TRIAGE (${triage.length}) — the owner's ruling queue. Each is a factory that is SILENT in one`);
  console.log('    phase where its trigger fires; play it there and either implement or upgrade the excuse:');
  for (const [d, e] of triage) console.log(`    · ${d} — silent in ${e.phase}: ${e.why}`);
}

// ── cast lane ──
const fizzleChecked: string[] = [];
for (const c of cards) for (const e of c.effects) {
  if (!COMBAT_CASTING_FACTORIES.has(e.do)) continue;
  const id = typeof e.params?.spellId === 'string' ? e.params.spellId : undefined;
  if (id) fizzleChecked.push(`${c.id}→${id}${combatCastable(CARD_INDEX[id]!) ? '' : ' ⚠FIZZLES'}`);
}
console.log(`\n  cast lane (combatCastable gate): ${fizzleChecked.length} named casts checked — ${fizzleChecked.join(', ')}`);

// ── 3. tribe predicate ratchet ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 3. raw tribe comparisons (frozen debt; ratcheted, may only shrink) ──');
for (const r of ratchetScan()) {
  const flag = r.file.endsWith('arena.ts') ? '  ⚠ serves BOTH phases; top burn-down priority' : '';
  console.log(`  ${r.file}: ${r.count}/${r.pinned} pinned · ${r.unguarded} with no all-types guard on the line${flag}`);
}

// ── 2 + 4 pointers (they gate in npm test; nothing to narrate beyond their existence) ──
console.log('\n── 2. dual-stat live text — gated in packages/ui/src/docbotLiveText.test.ts (the Kringle class)');
console.log('── 4. derivation pairs — gated in docbot/derivations.test.ts + snapshotFidelity.test.ts (the Chorus class)');
console.log('── 5. reference integrity — gated in docbot/refIntegrity.test.ts (#719 crash class; all ids resolve today)');
console.log('── 6. turn-scoped resets — gated in docbot/turnScopedReset.test.ts (39 fields, all reset today)');

// ── 7. rune reward differential — the duplicate-policy triage queue ──
const { firstNoops, secondSwallowed } = runeSwallowScan();
console.log('\n── 7. rune reward differential (the #900 class) ──');
console.log(`first-copy silent no-ops: ${firstNoops.length ? firstNoops.join(', ') : 'none — every rune reward does something'}`);
console.log(`\n  ⚠ SECOND-COPY SWALLOWS (${secondSwallowed.length}, ratcheted) — each is a REACHABLE purchase that pays`);
console.log('    nothing (the forge never excludes owned runes; Duplication doubles any Epic). Per-rune owner');
console.log('    ruling wanted: stack it, record a copy, or bless it idempotent (→ RUNE_DIFF_EXCUSED):');
console.log(`    ${secondSwallowed.join(', ')}`);

// ── 9 + 10: runtime differentials (plays, casts, watchers, combat presence) ──
const play = playScan();
console.log('\n── 9. play differential — onPlay/spells/watchers through the real reducer ──');
console.log(`inert onPlay (excused-conditional): ${play.inertMinions.join(', ') || 'none'} · golden-flat: ${play.goldenFlat.join(', ') || 'none'} · inert spells: ${play.inertSpells.join(', ') || 'none'}`);
console.log(`refused spells (fixture can't cast): ${play.refusedSpells.join(', ')}`);
console.log(`silent watchers: ${play.silentWatchers.join(', ') || 'none'}`);
const combat = combatScan();
console.log('\n── 10. combat presence differential — every combat effect vs a stat-clone control ──');
console.log(`verified ACTIVE in the staged fight: ${combat.activeCount}`);
console.log(`\n  ⚠ SCENARIO-CONDITIONAL (${combat.inert.length}, pinned) — their combat effect changed nothing about the`);
console.log('    staged fight. Most are condition-gated (Ryme needs adjacent Battlecries; Moe needs its own');
console.log('    kills) — each is a per-card verification wanted, and a NEW card landing here trips the pin:');
console.log(`    ${combat.inert.join(', ')}`);
console.log(`\n  ⚠ GOLDEN-FLAT in combat (${combat.goldenFlat.length}, pinned): ${combat.goldenFlat.join(', ')}`);
console.log('\n── 11. printed numbers — gated in docbot/textNumbers.test.ts (292 params + golden lane, 0 misses)');
console.log('── 12. invariant fuzz — gated in docbot/invariantFuzz.test.ts (invariants, determinism, identity-independence)');

// ── 8. spell-power folding ──
console.log('\n── 8. spell-power folding (#817/#731 class) — gated in docbot/spellPowerFolding.test.ts ──');
for (const [name, e] of Object.entries(SPELL_POWER_EXCUSED)) console.log(`  ${e.kind === 'needs-triage' ? '⚠ ' : '· '}${name} [${e.kind}]: ${e.why}`);

console.log('\nDoctrine + how to extend: docs/docbot.md\n');
