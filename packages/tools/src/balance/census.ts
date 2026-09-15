/**
 * `npm run balance:census [-- set2 set3]` — the per-set content census + mechanic-coverage inventory (B0).
 *
 * For every set (default: all): counts of drawable minions by tribe × tier, spells, tokens reachable from the
 * pool, runes (basic / epic) eligible under the same `sets` + `tribes` scoping the Runeforge applies, quests
 * eligible under the quest offer's scoping, heroes PLAY mode may seat (production `playableHeroes` under the
 * set's tribe roster), henchmen those heroes bring, and equipment any pool card grants. Then, for EVERY
 * `EffectFactoryId` the content schema admits, whether ANY drawable card in the set (minion, spell, Choose One
 * branch) uses it — the roadmap's "explicit set/mode manifests and mechanic coverage" requirement: a factory no
 * drawable card reaches cannot be exercised by any pilot, so a report must not claim coverage of it.
 *
 * Prints a markdown table per set and writes `packages/tools/src/balance/out/census-<set>.json` (gitignored).
 *
 * ELIGIBILITY IS SET-LEVEL. A run rolls a SUBSET of the set's tribes (`selectRunTribes`), so a per-run census
 * is narrower than this one: this answers "could a run of this set ever draw / be offered X", not "does this
 * run". The per-run view is the runner's job (B1), stamped per seat.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CARD_INDEX, EPIC_RUNES, EffectFactoryIdSchema, HENCHMEN, QUEST_DEFS, RUNES, SETS, equipmentOf, poolFor,
  referencedCardIds, type SetId,
} from '@game/content';
import type { CardDef, Tribe } from '@game/core';
import type { EquipmentDefinition } from '@game/content';
import { playableHeroes } from '@game/sim';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out');

export interface SetCensus {
  setId: SetId;
  tribes: readonly Tribe[];
  poolSize: number;
  minions: number;
  /** minions[tribe][tier] — dual-tribe minions count under BOTH tribes; `neutral` is its own row. */
  minionsByTribeTier: Record<string, Record<string, number>>;
  minionsByTier: Record<string, number>;
  spells: number;
  spellIds: string[];
  /** Tokens / minted cards reachable from the pool through effect references (transitive closure). */
  tokens: number;
  tokenIds: string[];
  runesBasic: number;
  runesEpic: number;
  runeIds: string[];
  quests: number;
  questIds: string[];
  heroes: number;
  heroIds: string[];
  henchmen: number;
  equipment: number;
  equipmentIds: string[];
  /** factoryId → number of DRAWABLE cards in the set using it (0 = no pilot can draft it in this set). */
  effectCoverage: Record<string, number>;
  /** factoryId → drawable cards + reachable tokens + granted equipment using it (what a run can EVER fire). */
  effectCoverageReachable: Record<string, number>;
  /** The factories no drawable card in this set uses. */
  uncoveredEffects: string[];
  /** The factories nothing in the set — drawable, token or equipment — uses. */
  unreachableEffects: string[];
  coveredEffects: number;
  reachableEffects: number;
  totalEffects: number;
}

const effectIdsOf = (c: CardDef): string[] => [
  ...c.effects.map((e) => e.do),
  ...(c.chooseOne ?? []).flatMap((o) => o.effects.map((e) => e.do)),
];

export function censusFor(setId: SetId): SetCensus {
  const set = SETS[setId];
  const pool = poolFor(setId);
  const tribes = set.tribes;
  const tribeSet = new Set<Tribe>([...tribes, 'neutral']);

  // Minions by tribe × tier.
  const byTribeTier: Record<string, Record<string, number>> = {};
  const byTier: Record<string, number> = {};
  for (const c of pool.buyable) {
    byTier[c.tier] = (byTier[c.tier] ?? 0) + 1;
    for (const t of [c.tribe, c.tribe2]) {
      if (!t) continue;
      const row = (byTribeTier[t] ??= {});
      row[c.tier] = (row[c.tier] ?? 0) + 1;
    }
  }

  // Tokens: the transitive closure of every card the pool names through its effects (summons, grants, mints).
  const drawable = new Set(pool.all.map((c) => c.id));
  const tokens = new Set<string>();
  const queue = [...pool.all];
  while (queue.length) {
    const c = queue.pop()!;
    for (const id of referencedCardIds(c)) {
      if (drawable.has(id) || tokens.has(id)) continue;
      const def = CARD_INDEX[id];
      if (!def) continue;
      tokens.add(id);
      queue.push(def);
    }
  }

  // Runes: the Runeforge's own scoping (`runeforgePool`): `sets` absent = everywhere; `tribes` = any is a run tribe.
  const runeOk = (r: { sets?: readonly string[]; tribes?: readonly Tribe[] }): boolean =>
    (!r.sets || r.sets.includes(setId)) && (!r.tribes || r.tribes.some((t) => tribes.includes(t)));
  const basic = RUNES.filter(runeOk);
  const epic = EPIC_RUNES.filter(runeOk);

  // Quests: the offer's scoping (`rollQuestOffer`): set-scoped, tribe must be a run tribe or neutral, no hero quests.
  const quests = QUEST_DEFS.filter((q) => !q.heroQuest && (!q.sets || q.sets.includes(setId)) && tribeSet.has(q.tribe));

  // Heroes: PLAY mode's rule under the set's whole tribe roster.
  const heroes = playableHeroes(tribes);
  const henchmen = heroes.filter((h) => h.henchman && HENCHMEN.some((c) => c.id === h.henchman!.cardId));

  // Equipment: whatever any pool card grants.
  const equipment = new Map<string, EquipmentDefinition>();
  for (const c of pool.all) { const eq = equipmentOf(c); if (eq) equipment.set(eq.id, eq); }

  // Mechanic coverage over DRAWABLE cards only (tokens are reachable, not draftable — reported separately).
  const coverage: Record<string, number> = {};
  const reachable: Record<string, number> = {};
  for (const id of EffectFactoryIdSchema.options) { coverage[id] = 0; reachable[id] = 0; }
  for (const c of pool.all) for (const id of new Set(effectIdsOf(c))) { coverage[id] = (coverage[id] ?? 0) + 1; reachable[id] = (reachable[id] ?? 0) + 1; }
  for (const id of tokens) for (const e of new Set(effectIdsOf(CARD_INDEX[id]!))) reachable[e] = (reachable[e] ?? 0) + 1;
  for (const eq of equipment.values()) {
    const legs = [eq.effectId, ...(eq.chooseOne ?? []).map((o) => o.effectId)];
    for (const e of new Set(legs)) reachable[e] = (reachable[e] ?? 0) + 1;
  }
  const uncovered = Object.keys(coverage).filter((id) => coverage[id] === 0).sort();
  const unreachable = Object.keys(reachable).filter((id) => reachable[id] === 0).sort();

  return {
    setId,
    tribes,
    poolSize: pool.all.length,
    minions: pool.buyable.length,
    minionsByTribeTier: byTribeTier,
    minionsByTier: byTier,
    spells: pool.spells.length,
    spellIds: pool.spells.map((c) => c.id),
    tokens: tokens.size,
    tokenIds: [...tokens].sort(),
    runesBasic: basic.length,
    runesEpic: epic.length,
    runeIds: [...basic, ...epic].map((r) => r.id),
    quests: quests.length,
    questIds: quests.map((q) => q.id),
    heroes: heroes.length,
    heroIds: heroes.map((h) => h.id),
    henchmen: henchmen.length,
    equipment: equipment.size,
    equipmentIds: [...equipment.keys()].sort(),
    effectCoverage: coverage,
    effectCoverageReachable: reachable,
    uncoveredEffects: uncovered,
    unreachableEffects: unreachable,
    coveredEffects: Object.keys(coverage).length - uncovered.length,
    reachableEffects: Object.keys(reachable).length - unreachable.length,
    totalEffects: Object.keys(coverage).length,
  };
}

export function censusMarkdown(c: SetCensus): string {
  const tiers = [1, 2, 3, 4, 5, 6, 7];
  const lines: string[] = [];
  lines.push(`## ${c.setId} — ${SETS[c.setId].name}${SETS[c.setId].enabled ? ' (LIVE)' : ''}`);
  lines.push('');
  lines.push(`| Category | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| Drawable pool | ${c.poolSize} |`);
  lines.push(`| Minions | ${c.minions} |`);
  lines.push(`| Spells | ${c.spells} |`);
  lines.push(`| Tokens reachable | ${c.tokens} |`);
  lines.push(`| Runes (basic / epic) | ${c.runesBasic} / ${c.runesEpic} |`);
  lines.push(`| Quests | ${c.quests} |`);
  lines.push(`| Heroes (PLAY) | ${c.heroes} |`);
  lines.push(`| Henchmen | ${c.henchmen} |`);
  lines.push(`| Equipment | ${c.equipment} (${c.equipmentIds.join(', ') || '—'}) |`);
  lines.push(`| Effect factories used by a DRAWABLE card | ${c.coveredEffects} / ${c.totalEffects} |`);
  lines.push(`| Effect factories REACHABLE (drawable + tokens + equipment) | ${c.reachableEffects} / ${c.totalEffects} |`);
  lines.push('');
  lines.push(`Tribes: ${c.tribes.join(', ')}`);
  lines.push('');
  lines.push(`| Minions by tribe | ${tiers.map((t) => `T${t}`).join(' | ')} | Total |`);
  lines.push(`|---|${tiers.map(() => '---:').join('|')}|---:|`);
  const rows = ['neutral', ...c.tribes, ...Object.keys(c.minionsByTribeTier).filter((t) => t !== 'neutral' && !c.tribes.includes(t as Tribe))];
  for (const t of rows) {
    const row = c.minionsByTribeTier[t] ?? {};
    const total = Object.values(row).reduce((a, b) => a + b, 0);
    const tag = !c.tribes.includes(t as Tribe) && t !== 'neutral' ? ' (not a run tribe)' : '';
    lines.push(`| ${t}${tag} | ${tiers.map((n) => row[n] ?? 0).join(' | ')} | ${total} |`);
  }
  lines.push(`| **all** | ${tiers.map((n) => c.minionsByTier[n] ?? 0).join(' | ')} | ${c.minions} |`);
  lines.push('');
  lines.push(`Effect factories NO drawable card uses (${c.uncoveredEffects.length}) — a pilot cannot draft them in this set:`);
  lines.push(c.uncoveredEffects.join(', ') || 'none');
  lines.push('');
  const tokenOnly = c.uncoveredEffects.filter((id) => !c.unreachableEffects.includes(id));
  lines.push(`…of which reachable only through a token / equipment (${tokenOnly.length}): ${tokenOnly.join(', ') || 'none'}`);
  return lines.join('\n');
}

export function writeCensus(c: SetCensus): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `census-${c.setId}.json`);
  writeFileSync(path, JSON.stringify(c, null, 2) + '\n');
  return path;
}

function main(): void {
  const asked = process.argv.slice(2).filter((a) => !a.startsWith('--')) as SetId[];
  const ids = asked.length ? asked : (Object.keys(SETS) as SetId[]);
  for (const id of ids) {
    if (!SETS[id]) { console.error(`unknown set '${id}' (known: ${Object.keys(SETS).join(', ')})`); process.exit(2); }
    const c = censusFor(id);
    console.log(censusMarkdown(c));
    console.log(`\n→ ${writeCensus(c)}\n`);
  }
}

if (process.argv[1] && /census\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) main();
