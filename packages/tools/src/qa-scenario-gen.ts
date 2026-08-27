/**
 * Regenerate the checked-in QaScenarioV1 fixtures in `packages/sim/src/docbot/scenarios/`.
 *
 * Run with: `npx tsx packages/tools/src/qa-scenario-gen.ts` (no npm script — this is a rare, deliberate act:
 * regenerate ONLY when content drift invalidates a fixture, and read the resulting diff before committing;
 * a fixture whose expectations changed under regeneration is a behaviour change to explain, not to absorb).
 *
 * The two fixtures convert the two classic Docbot harness shapes (handoff §14 PR 1):
 *   · recruit-cleric-buff — a recruit stat-buff play (the playScan differential's home turf): Hoard
 *     Cleric's Battlecry gives your OTHER Dragons +3/+3, exactly as printed. (Untargeted by design — a
 *     targeted Battlecry pauses in `pendingTarget` for a follow-up `battlecryTarget` action, and the V1
 *     envelope carries ONE action; multi-action scenarios are future work.)
 *   · combat-generic-wave1  — a seeded combat against a pinned opponent snapshot (the combatScan shape),
 *     resolved through the REAL faceOmen path; its outcome/event expectations are pinned from the engine.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createRun, runQaScenario, serialize,
  type BoardCard, type BoardSnapshot, type QaScenarioV1, type RunState,
} from '@game/sim';
import { CARD_INDEX } from '@game/content';

const OUT_DIR = join(process.cwd(), 'packages', 'sim', 'src', 'docbot', 'scenarios');

const body = (uid: string, cardId: string, attack?: number, health?: number): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return {
    uid, cardId, tribe: d.tribe,
    attack: attack ?? d.attack, health: health ?? d.health,
    keywords: [...d.keywords], golden: false,
  } as BoardCard;
};

// ── 1. recruit-cleric-buff ─────────────────────────────────────────────────────────────────────────────────
function recruitScenario(): QaScenarioV1 {
  const base = createRun(0x51ab, 'aster', 'ascent', undefined, 'set1');
  const state: RunState = {
    ...base,
    embers: 10,
    board: [body('tgt0', 'emissary')],
    hand: [body('playMe', 'cleric')],
  };
  return {
    schemaVersion: 1,
    id: 'recruit-cleric-buff',
    title: "Hoard Cleric's Battlecry gives your other Dragons exactly its printed +3/+3",
    source: 'regression',
    seed: 0x51ab,
    setId: 'set1',
    mode: 'recruit',
    state: serialize(state),
    action: { type: 'play', uid: 'playMe' },
    expectations: [
      { kind: 'card-delta', selector: { cardId: 'emissary', zone: 'board', index: 0 }, attack: 3, health: 3 },
      { kind: 'state-delta', path: 'board.1.cardId', equals: 'cleric' }, // the played body arrived on board…
      { kind: 'state-delta', path: 'board.1.attack', equals: 2 }, // …at its printed 2/2 ("other" excludes self)
      { kind: 'state-delta', path: 'board.1.health', equals: 2 },
      { kind: 'summon-count', count: 0 }, // a buff, not a summon
      { kind: 'invariant', id: 'embers-non-negative' },
      { kind: 'invariant', id: 'board-within-cap' },
      { kind: 'invariant', id: 'stats-finite' },
    ],
    contentIds: ['cleric', 'emissary'],
    metadata: { notes: 'Converted from the playScan differential harness shape (docbot handoff §14, PR 1 parity fixture).' },
  };
}

// ── 2. combat-generic-wave1 ────────────────────────────────────────────────────────────────────────────────
function combatScenario(): QaScenarioV1 {
  const base = createRun(0xc04b, 'aster', 'ascent', undefined, 'set1');
  const state: RunState = {
    ...base,
    embers: 3,
    board: [body('a0', 'pup', 2, 2), body('a1', 'cryptwolf', 3, 3), body('a2', 'nanobot', 2, 4)],
    hand: [],
  };
  const minions = [
    { cardId: 'pup', attack: 1, health: 1, keywords: [], golden: false },
    { cardId: 'nanobot', attack: 4, health: 5, keywords: [], golden: false },
    { cardId: 'cryptwolf', attack: 3, health: 2, keywords: [], golden: false },
  ];
  const opponent: BoardSnapshot = {
    v: 1,
    wave: 1,
    heroId: 'aster',
    resolve: 30,
    tier: 1,
    triples: 0,
    tribes: [],
    threat: 'iron',
    power: minions.reduce((n, m) => n + m.attack + m.health, 0),
    minions: minions as BoardSnapshot['minions'],
    seed: 1,
    origin: 'house',
  };
  const scenario: QaScenarioV1 = {
    schemaVersion: 1,
    id: 'combat-generic-wave1',
    title: 'A seeded wave-1 fight against a pinned opponent board resolves deterministically through faceOmen',
    source: 'regression',
    seed: 0xc04b,
    setId: 'set1',
    mode: 'combat',
    state: serialize(state),
    combat: { opponent },
    expectations: [
      { kind: 'invariant', id: 'embers-non-negative' },
      { kind: 'invariant', id: 'stats-finite' },
    ],
    contentIds: ['pup', 'cryptwolf', 'nanobot'],
    metadata: { notes: 'Converted from the combatScan seeded-fight harness shape (docbot handoff §14, PR 1 parity fixture). Outcome/event expectations pinned from the engine at generation time — a change is a behaviour change.' },
  };
  // Pin the observed outcome + event counts as GOLDEN expectations (the engine is the oracle for this shape,
  // exactly as the combat differential's serialized-result goldens are).
  const probe = runQaScenario(scenario);
  if (probe.validationErrors.length > 0) throw new Error(`combat fixture invalid: ${probe.validationErrors.join(' · ')}`);
  const deaths = (probe.combatLog ?? []).filter((e) => e.type === 'death').length;
  scenario.expectations = [
    { kind: 'state-delta', path: 'lastCombat.result', equals: probe.combatOutcome ?? null },
    { kind: 'event-count', event: 'death', count: deaths },
    { kind: 'summon-count', count: 0 },
    ...scenario.expectations!,
  ];
  return scenario;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const scenario of [recruitScenario(), combatScenario()]) {
  const path = join(OUT_DIR, `${scenario.id}.json`);
  writeFileSync(path, `${JSON.stringify(scenario, null, 2)}\n`, 'utf8');
  const result = runQaScenario(scenario);
  console.log(`\nwrote ${path}`);
  console.log(result.summary);
  if (!result.ok) {
    console.error('FIXTURE DOES NOT PASS ITS OWN EXPECTATIONS — not committing this would be wise.');
    process.exitCode = 1;
  }
}
