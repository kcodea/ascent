import { CARD_INDEX } from '@game/content';
import type { CardDef, GameEvent, Tribe } from '@game/core';
import { CONFIG } from './config';
import { lineResult, metLine, runRecord, type RunState } from './state';

/**
 * Build-tag classifier (A5, expanded). Reads a run's FINAL board + run signals (history, triples, buffs,
 * record vs line) and emits up to 4 build tags — the language that gives an emergent build an identity
 * ("Carry Stack · Gilded Carry · Late Bloom").
 * Pure + deterministic, so it's testable and reusable by the post-run summary (A6) and career (A7).
 *
 * Heuristic + thresholded: every candidate tag scores off real board/run signals; the top few above their
 * bar are returned, strongest first. A tribal board that clears no other bar still gets its tribe tag, so a
 * run almost always has at least one label; a genuinely mixed board returns [].
 *
 * NOTE: tag names lead with the intended flavor terms (Shout/Echo/Ward/Toxin/Flurry/Attachment) even though
 * the in-game mechanic tooltips aren't renamed yet (that's the B3 pass) — tags are build labels, not rules.
 */

/** One-line, mechanical descriptions for every build tag — shown as a hover tooltip on the end/Career
 *  screens so a tag ("Fortress Board") explains what it read off your board. Keep terse. */
export const TAG_INFO: Record<string, string> = {
  'Beast Swarm': 'A board built mostly of Beasts.',
  'Dragon Scaling': 'A Dragon-heavy board leaning on scaling stats.',
  'Undead Army': 'An Undead-heavy board.',
  'Mech Battalion': 'A Mech-heavy board.',
  'Demon Legion': 'A Demon-heavy board.',
  'Echo Web': '3+ Deathrattle minions — value chains as they die.',
  'Shout Chain': '3+ Battlecry minions — a payoff on every play.',
  'End-of-Turn Engine': 'Several end-of-turn triggers stacking each round.',
  'Summon Overflow': 'Multiple minions that summon extra bodies.',
  'Ward Wall': '2+ Divine Shields soaking the first hits.',
  'Toxin Control': 'Poison on board — trades up into anything.',
  'Flurry Finish': 'A high-attack Windfury unit swinging twice.',
  'Gilded Carry': 'Golden (tripled) minions anchoring the board.',
  'Spell Engine': 'Lots of spells cast, or a spell-power carrier.',
  'Fodder Economy': 'A Demon fodder/imp engine feeding buffs.',
  'Attachment Carry': 'Mechs welded into one oversized body.',
  'Carry Stack': "One unit holds most of the board's stats.",
  'Wide Board': 'Many bodies, no single carry.',
  'Glass Cannon': 'Attack-heavy and aggressive — hits hard, dies fast.',
  'Fortress Board': 'Health-heavy and defensive — hard to break.',
  'Token Flood': 'A swarm of small bodies.',
  'Keyword Soup': 'Five or more distinct keywords across the board.',
  'Menagerie': 'Four or more tribes sharing the board.',
  'Triple Hunter': 'Chased triples and golden upgrades.',
  'Scaling Engine': 'Big permanent, run-wide stat growth.',
  'Tempo Climber': 'Strong early, faded late.',
  'Late Bloom': 'Slow start, powered up late.',
  'Underdog Line': 'A bad start, but still covered par.',
  'Low Roll Survivor': 'Covered par without triples or goldens.',
};

const TRIBE_TAG: Partial<Record<Tribe, string>> = {
  beast: 'Beast Swarm', dragon: 'Dragon Scaling', undead: 'Undead Army', mech: 'Mech Battalion', demon: 'Demon Legion',
};

const SPELL_POWER_DOS = ['onKillBuffSpellPower', 'deathrattleBuffSpellPower', 'battlecryBuffSpellPower'];
const FODDER_DOS = ['addTavernFodder', 'buffFodderEverywhere', 'goldSpentBuffFodderImps', 'deathrattleBuffImps', 'onKillBuffFodderImps', 'scGainFodderStats', 'deathrattleAddFodder', 'avengeBuffImps'];
const SUMMON_DOS = ['deathrattleSummon', 'onFriendDeathSummon', 'deathrattleSummonOverflowBuff'];

const hasTrigger = (def: CardDef, on: GameEvent): boolean => def.effects.some((e) => e.on === on);
const hasDo = (def: CardDef, dos: string[]): boolean => def.effects.some((e) => dos.includes(e.do));

export function buildTags(state: RunState): string[] {
  const rows = state.board.map((m) => ({ m, def: CARD_INDEX[m.cardId] })).filter((x): x is { m: typeof x.m; def: CardDef } => !!x.def);
  if (rows.length === 0) return [];
  const n = rows.length;

  const tribeCount = new Map<Tribe, number>();
  for (const { def } of rows) {
    for (const t of [def.tribe, def.tribe2].filter((t): t is Tribe => !!t)) tribeCount.set(t, (tribeCount.get(t) ?? 0) + 1);
  }

  const scored: { tag: string; score: number }[] = [];
  const add = (tag: string, score: number): void => { if (score > 0) scored.push({ tag, score }); };

  // Tribe archetype — the dominant non-neutral tribe (a clear majority of the board).
  const tribeThreshold = Math.max(3, Math.ceil(n * 0.55));
  let topTribe: { tribe: Tribe; count: number } | null = null;
  for (const [t, c] of tribeCount) {
    if (t === 'neutral') continue;
    if (!topTribe || c > topTribe.count) topTribe = { tribe: t, count: c };
    if (c >= tribeThreshold && TRIBE_TAG[t]) add(TRIBE_TAG[t]!, c);
  }

  // Trigger-density archetypes.
  const deathrattles = rows.filter((x) => hasTrigger(x.def, 'onDeath')).length;
  const battlecries = rows.filter((x) => hasTrigger(x.def, 'onPlay')).length;
  const endOfTurns = rows.filter((x) => hasTrigger(x.def, 'endOfTurn')).length;
  const summons = rows.filter((x) => hasDo(x.def, SUMMON_DOS) || hasTrigger(x.def, 'onSummon')).length;
  if (deathrattles >= 3) add('Echo Web', deathrattles);
  if (battlecries >= 3) add('Shout Chain', battlecries);
  if (endOfTurns >= 2) add('End-of-Turn Engine', endOfTurns + 1);
  if (summons >= 2) add('Summon Overflow', summons);

  // Keyword walls / finishers (live instance keywords — granted keywords count).
  const ward = rows.filter((x) => x.m.keywords.includes('DS')).length;
  const venom = rows.filter((x) => x.m.keywords.includes('V')).length;
  if (ward >= 2) add('Ward Wall', ward + 1);
  if (venom >= 1) add('Toxin Control', venom + 2);
  const flurry = rows.find((x) => x.m.keywords.includes('W') && x.m.attack >= 15);
  if (flurry) add('Flurry Finish', 3 + Math.floor(flurry.m.attack / 15));

  // Gilded — a golden-heavy board, or one big golden carry.
  const goldens = state.board.filter((m) => m.golden);
  if (goldens.length >= 2 || goldens.some((m) => m.attack >= 25)) add('Gilded Carry', goldens.length + 2);

  // Spell engine — lots of spells cast, or a spell-power / spell-aura carrier on board.
  const spellCarrier = rows.some((x) => hasDo(x.def, SPELL_POWER_DOS) || !!x.def.spellAura || (x.m.spellAuraBonus ?? 0) > 0);
  if (state.spellsCast >= 8 || spellCarrier) add('Spell Engine', Math.min(10, state.spellsCast) + (spellCarrier ? 3 : 0));

  // Fodder economy — a Demon fodder/imp engine (a card that feeds it, or run-wide Imp scaling).
  const impScale = (state.impBuff?.attack ?? 0) + (state.impBuff?.health ?? 0);
  const fodderCard = rows.some((x) => hasDo(x.def, FODDER_DOS) || x.m.keywords.includes('FD') || x.m.keywords.includes('CN'));
  if (fodderCard || impScale > 0) add('Fodder Economy', 3 + (impScale > 0 ? 2 : 0));

  // Attachment carry — a Mech-heavy board welded into a fat single body.
  const bigWeld = rows.find((x) => (x.def.tribe === 'mech' || x.def.tribe2 === 'mech') && (x.m.attack >= 25 || (x.m.rallyMechAtk ?? 0) > 0 || (x.m.spellAuraBonus ?? 0) > 0));
  if ((tribeCount.get('mech') ?? 0) >= 3 && bigWeld) add('Attachment Carry', 5);

  // ── Board shape ─────────────────────────────────────────────────────────────
  const statOf = (m: { attack: number; health: number }): number => m.attack + m.health;
  const totalStats = rows.reduce((s, x) => s + statOf(x.m), 0);
  const totalAtk = rows.reduce((s, x) => s + x.m.attack, 0);
  const totalHp = rows.reduce((s, x) => s + x.m.health, 0);
  const top = rows.reduce((best, x) => (statOf(x.m) > statOf(best.m) ? x : best), rows[0]!);
  const topShare = totalStats > 0 ? statOf(top.m) / totalStats : 0;
  // Carry Stack — one unit holds most of the board's stats (you made one monster).
  if (n >= 3 && topShare >= 0.5 && statOf(top.m) >= 24) add('Carry Stack', Math.round(topShare * 10) + 4);
  // Wide Board — many bodies, no dominant carry (the opposite shape).
  else if (n >= 6 && topShare <= 0.34) add('Wide Board', n);

  // Glass Cannon — attack-heavy with aggressive keywords (Flurry / Toxin pressure).
  const aggressive = rows.some((x) => x.m.keywords.includes('W') || x.m.keywords.includes('V'));
  if (totalAtk >= totalHp * 1.5 && totalAtk >= 30 && aggressive) add('Glass Cannon', 6);
  // Fortress Board — health-heavy + defensive keywords (Ward / Taunt).
  const defensive = rows.filter((x) => x.m.keywords.includes('DS') || x.m.keywords.includes('T')).length;
  if (totalHp >= totalAtk * 1.4 && totalHp >= 30 && defensive >= 2) add('Fortress Board', 6);

  // Token Flood — lots of small bodies.
  const smalls = rows.filter((x) => statOf(x.m) <= 6).length;
  if (smalls >= 4) add('Token Flood', smalls);

  // Keyword Soup — many distinct keywords across the board (messy-but-powerful).
  const kwSet = new Set<string>();
  for (const x of rows) for (const k of x.m.keywords) kwSet.add(k);
  if (kwSet.size >= 5) add('Keyword Soup', kwSet.size);

  // Menagerie — several non-neutral tribes sharing the board.
  const distinctTribes = [...tribeCount.keys()].filter((t) => t !== 'neutral').length;
  if (distinctTribes >= 4) add('Menagerie', distinctTribes);

  // Triple Hunter — chased upgrades (many triples / gilded units).
  if (state.triplesMade >= 3 || goldens.length >= 3) add('Triple Hunter', state.triplesMade + goldens.length);

  // Scaling Engine — big permanent run-wide growth, or a heavily-enchanted board.
  const buffSum = rows.reduce((s, x) => s + (x.m.buffs?.reduce((a, b) => a + b.attack + b.health, 0) ?? 0), 0);
  const runWideScale = (state.spellBonus?.attack ?? 0) + (state.spellBonus?.health ?? 0) + (state.undeadBuyAtk ?? 0) + impScale;
  if (buffSum >= 40 || runWideScale >= 8) add('Scaling Engine', Math.min(10, Math.round(buffSum / 12) + runWideScale));

  // ── Record / history narrative (needs enough scored rounds to read the arc) ──
  const scoredResults = state.history.slice(CONFIG.calibrationRounds);
  if (scoredResults.length >= 6) {
    const half = Math.floor(scoredResults.length / 2);
    const winRate = (arr: string[]): number => (arr.length ? arr.filter((r) => r === 'win').length / arr.length : 0);
    const early = winRate(scoredResults.slice(0, half));
    const late = winRate(scoredResults.slice(half));
    if (early - late >= 0.34) add('Tempo Climber', 4);
    else if (late - early >= 0.34) add('Late Bloom', 5);
    const lr = lineResult(state);
    if (metLine(lr.status) && early <= 0.34) add('Underdog Line', 6); // bad start, still covered the line
    const rec = runRecord(state);
    if (rec.wins >= state.line && state.triplesMade <= 1 && goldens.length <= 1) add('Low Roll Survivor', 4);
  }

  scored.sort((a, b) => b.score - a.score);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { tag } of scored) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 4) break;
  }
  // Fallback: a tribal board that cleared no bar still gets its plurality tribe tag, so identity is rarely blank.
  if (out.length === 0 && topTribe && topTribe.count >= 3 && TRIBE_TAG[topTribe.tribe]) out.push(TRIBE_TAG[topTribe.tribe]!);
  return out;
}
