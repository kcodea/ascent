import { CARD_INDEX } from '@game/content';
import type { CardDef, GameEvent, Tribe } from '@game/core';
import type { RunState } from './state';

/**
 * Build-tag classifier (A5). Reads a run's FINAL board (+ a few run signals) and emits up to 3 build tags
 * — the language that gives an emergent build an identity ("Spell Engine · Gilded Carry · Flurry Finish").
 * Pure + deterministic, so it's testable and reusable by the post-run summary (A6) and career (A7).
 *
 * Heuristic + thresholded: every candidate tag scores off real board/run signals; the top few above their
 * bar are returned, strongest first. A tribal board that clears no other bar still gets its tribe tag, so a
 * run almost always has at least one label; a genuinely mixed board returns [].
 *
 * NOTE: tag names lead with the intended flavor terms (Shout/Echo/Ward/Toxin/Flurry/Attachment) even though
 * the in-game mechanic tooltips aren't renamed yet (that's the B3 pass) — tags are build labels, not rules.
 */

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

  scored.sort((a, b) => b.score - a.score);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { tag } of scored) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 3) break;
  }
  // Fallback: a tribal board that cleared no bar still gets its plurality tribe tag, so identity is rarely blank.
  if (out.length === 0 && topTribe && topTribe.count >= 3 && TRIBE_TAG[topTribe.tribe]) out.push(TRIBE_TAG[topTribe.tribe]!);
  return out;
}
