import type { Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';

/** How many of `playedThisTurn` (card ids) belong to any of `tribes` (dual-types count). */
function countPlayed(playedThisTurn: string[] | undefined, tribes: Tribe[]): number {
  return (playedThisTurn ?? []).filter((id) => {
    const d = CARD_INDEX[id];
    return !!d && tribes.some((t) => d.tribe === t || d.tribe2 === t);
  }).length;
}

/**
 * A summon-buff card (Kennelmaster / Bristleback Matron) shows its *current* buff magnitude
 * (the card's base buff + its accrued `summonBonus` from Avenge / triple-combine). The boosted
 * number is wrapped in a `{{…}}` marker so the Card renders it green (a modified value) and
 * leaves it out of the golden `doubleNums` doubling. Returns null when there's nothing to change
 * (no summon buff, or no bonus) so callers fall back to the card's printed text.
 *
 * Shared by the recruit board (`instView`) and combat units (`Unit`) so a Kennelmaster reads the
 * same boosted value in the shop, the warband, and mid-fight (where `summonBonus` can climb).
 */
export function summonBuffText(cardId: string, summonBonus: number): string | null {
  if (summonBonus <= 0) return null;
  const def = CARD_INDEX[cardId];
  // `buffOnSummon` (legacy summon-buff) or Kennelmaster's `scBeastAura` (Start-of-Combat Beast aura). Both
  // grant `base + summonBonus`, so the same live magnitude injects into the printed "+N/+N".
  const eff = def?.effects.find((e) => e.do === 'buffOnSummon' || e.do === 'scBeastAura' || e.do === 'rallyTribeAuraGrowing');
  if (!def || !eff) return null;
  const base = Number((eff.params as { attack?: number })?.attack ?? 1);
  const m = base + summonBonus;
  return def.text.replace(/\*\*\+\d+\/\+\d+\*\*/, `{{+${m}/+${m}}}`);
}

/**
 * Mama Bear (`summonBuffTribeImprove`) hands out a buff that GROWS: the grant is (base + accrued) × golden,
 * and the accrued (`summonBonus`) climbs by base each summon. Surface the *current* grant magnitude (green)
 * in place of the printed "+N/+N" — the first number (the grant) only; the second (the per-summon improve
 * step) stays printed. Golden reads from goldenText and doubles the live grant. Returns null with no accrual
 * (falls back to the printed text), matching `summonBuffText`'s contract.
 */
export function summonImproveText(cardId: string, summonBonus: number, golden: boolean): string | null {
  if (summonBonus <= 0) return null;
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'summonBuffTribeImprove');
  if (!def || !eff) return null;
  const base = Number((eff.params as { attack?: number })?.attack ?? 3);
  const m = (base + summonBonus) * (golden ? 2 : 1);
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  return src.replace(/\*\*\+\d+\/\+\d+\*\*/, `{{+${m}/+${m}}}`);
}

/**
 * Hunter (`onGainAttackBuffImproving`) — its board-wide grant GROWS: each Attack gain gives your minions
 * (base + accrued `summonBonus`) × golden, then the accrual climbs by base. Surface the CURRENT grant (green) in
 * place of the first printed "+N/+N"; the "+step/+step" improve rate stays. Null with no accrual yet (printed base
 * is accurate), matching the sibling contracts.
 */
export function hunterText(cardId: string, summonBonus: number, golden: boolean): string | null {
  if (summonBonus <= 0) return null;
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'onGainAttackBuffImproving');
  if (!def || !eff) return null;
  const base = Number((eff.params as { attack?: number })?.attack ?? 1);
  const m = (base + summonBonus) * (golden ? 2 : 1);
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  let done = false;
  return src.replace(/\+\d+\/\+\d+/g, (mt) => (done ? mt : ((done = true), `{{+${m}/+${m}}}`)));
}

/**
 * A transform card (Spirit Pup) appends its live "N to go" countdown (highlighted green) so the
 * player sees how many spells remain before it transforms. `spellProgress` is the per-instance
 * tally; returns null for non-transform cards so callers fall back to the printed text.
 */
export function transformProgressText(cardId: string, spellProgress: number): string | null {
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'spellCastTransform');
  if (!def || !eff) return null;
  const at = Number((eff.params as { at?: number })?.at ?? 10);
  return `${def.text} {{${Math.max(0, at - spellProgress)} to go}}`;
}

/**
 * Tara's ascend countdown: once she accumulates `ascendAt` stat-grants in combat she becomes Taragosa.
 * When `ascendProgress > 0` appends a green "{{N to go}}" so the player can watch the threshold approach.
 * Returns null when there's no progress yet (falls back to printed text) or once the threshold is met
 * (she's ascending this combat settle — no countdown needed).
 */
export function ascendProgressText(cardId: string, ascendProgress: number): string | null {
  if (ascendProgress <= 0) return null;
  const def = CARD_INDEX[cardId];
  if (!def?.ascendAt || !def.ascendInto) return null;
  const remaining = Math.max(0, def.ascendAt - ascendProgress);
  if (remaining <= 0) return null;
  return `${def.text} {{${remaining} to go}}`;
}

/**
 * Frontdrake's cadence ("Every N turns, get a Dragon") appends a live countdown (green), where
 * M = every − (eotTick mod every) and `eotTick` advances once per End of Turn. When M === 1 the cadence
 * lands at THIS turn's End of Turn (eotTick is one shy of a multiple), so it reads "End of this turn."
 * instead of a count. Returns null for non-cadence cards so callers fall back to the printed text.
 */
export function cadenceProgressText(cardId: string, eotTick: number): string | null {
  const def = CARD_INDEX[cardId];
  // Any "every N turns" End-of-Turn effect: Frontdrake's Dragon conjure or Money Maker's card grant.
  const eff = def?.effects.find((e) => e.on === 'endOfTurn' && (e.params as { every?: number } | undefined)?.every !== undefined);
  if (!def || !eff) return null;
  const every = Math.max(1, Number((eff.params as { every?: number })?.every ?? 3));
  const toNext = every - (eotTick % every);
  const note = toNext === 1 ? 'End of this turn.' : `Next in ${toNext} turns.`;
  return `${def.text} {{${note}}}`;
}

/**
 * Spirit Worgen's on-play per-Beast/Dragon gain (+base/+base each time you play a Beast or Dragon) is improved
 * by another full `base` for every spell cast this turn — so the current per-play value is base × (1 + spells).
 * Fold that live "+X/+X" (green) into the first printed grant once a spell's been cast this turn; null otherwise
 * (the printed text is already accurate). Golden-aware: reads the golden text + doubled base for a golden copy.
 */
export function summonScalingText(cardId: string, spellsThisTurn: number, golden: boolean): string | null {
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'summonBuffSelfTribe');
  if (!def || !eff) return null;
  if (spellsThisTurn <= 0) return null; // nothing live → printed text is accurate
  const base = Number((eff.params as { attack?: number })?.attack ?? 3) * (golden ? 2 : 1);
  const per = base * (1 + spellsThisTurn);
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  return src.replace(`+${base}/+${base}`, `{{+${per}/+${per}}}`); // first "+base/+base" = the per-play grant
}

/**
 * Pack Leader (`scTribeBuffPerPlayed`) — Start of Combat buff that scales +perPlayed for each Beast you PLAYED
 * this turn. Surface the current grant (green) — (base + perPlayed × played) × golden — in place of the first
 * printed "+A/+B" (the grant), leaving the "+step/+step" improve rate. Null before any qualifying play.
 */
export function scTribeBuffPerPlayedText(cardId: string, golden: boolean, playedThisTurn: string[] | number | undefined): string | null {
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'scTribeBuffPerPlayed');
  if (!def || !eff) return null;
  const tribe = String((eff.params as { tribe?: string })?.tribe ?? 'beast') as Tribe;
  // Player: count the qualifying plays from the card-id array. Enemy (served board): the count is pre-computed
  // in its snapshot (`beastsPlayed`) — the card ids aren't carried — so a number passes straight through.
  const played = typeof playedThisTurn === 'number' ? playedThisTurn : countPlayed(playedThisTurn, [tribe]);
  if (played <= 0) return null;
  const base = Number((eff.params as { attack?: number })?.attack ?? 2);
  const per = Number((eff.params as { perPlayed?: number })?.perPlayed ?? 2);
  const x = (base + per * played) * (golden ? 2 : 1);
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  let done = false;
  return src.replace(/\+\d+\/\+\d+/g, (m) => (done ? m : ((done = true), `{{+${x}/+${x}}}`)));
}

/**
 * Pack Leader (`scTribeBuffImproving`, step 0) — Start of Combat spends its permanent per-instance tally
 * (`summonBonus`, accrued +step per Beast played WHILE on board) as a +X/+X Beast buff, where X = tally ×
 * golden. Surface the CURRENT total grant (green) alongside the per-Beast rate. Returns null before any Beast
 * has been witnessed (the printed "+step/+step per Beast" text is accurate), matching the sibling contracts.
 */
export function packLeaderText(cardId: string, summonBonus: number, golden: boolean): string | null {
  if (summonBonus <= 0) return null;
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'scTribeBuffImproving');
  const countEff = def?.effects.find((e) => e.do === 'countTribeSummon');
  if (!def || !eff || !countEff) return null;
  const step = Number((countEff.params as { step?: number })?.step ?? 3);
  const mult = golden ? 2 : 1;
  const x = summonBonus * mult; // total grant right now (tally already holds `step` per Beast)
  const per = step * mult; // per-Beast rate, golden-aware
  return `**Start of Combat:** Give your **Beasts** {{+${x}/+${x}}} — **+${per}/+${per}** per **Beast** played while on the board.`;
}

/**
 * Runescale Drake's Start-of-Combat Dragon buff = base + the spells cast while THIS instance has been on the
 * board (per-instance `spellProgress`; non-retroactive, persistent). Surface the CURRENT grant (green) —
 * (base + spellProgress) × golden — by replacing ONLY the first "+A/+B" group (the grant), leaving the "+1/+1"
 * improve rate that follows. Returns null before any spell has been cast on board (the printed base is accurate).
 */
export function runescaleText(cardId: string, golden: boolean, spellProgress: number): string | null {
  if (spellProgress <= 0) return null;
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'scTribeBuffPerProgress');
  if (!def || !eff) return null;
  const base = Number((eff.params as { attack?: number })?.attack ?? 1);
  const x = (base + spellProgress) * (golden ? 2 : 1);
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  let done = false;
  return src.replace(/\+\d+\/\+\d+/g, (m) => (done ? m : ((done = true), `{{+${x}/+${x}}}`)));
}

/**
 * Vineweaver Drake casts an escalating spell (Growth) each End of Turn — the Nth End of Turn fires N casts
 * (golden doubles). Surface BOTH live values green: how much each cast grants right now (the spell's base
 * grant + current spell power) and how many casts land at the NEXT End of Turn ((eotTick+1)×, golden ×2), so
 * the payoff is legible before it fires. Returns null for non-matching cards (falls back to printed text).
 */
export function escalatingCastText(
  cardId: string, golden: boolean, eotTick: number, spellBonus: number, spellBonusH: number,
): string | null {
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'endOfTurnCastSpellEscalating');
  if (!def || !eff) return null;
  const spell = CARD_INDEX[String((eff.params as { spellId?: string })?.spellId ?? '')];
  const buff = spell?.effects.find((e) => e.do === 'spellBuffAll')?.params as { attack?: number; health?: number } | undefined;
  if (!spell || !buff) return null;
  const atk = (buff.attack ?? 0) + spellBonus;
  const hp = (buff.health ?? 0) + spellBonusH;
  const casts = Math.max(1, eotTick + 1) * (golden ? 2 : 1); // the NEXT End of Turn's cast count
  const times = casts === 1 ? '' : ` {{${casts}×}}`;
  return `**End of Turn:** Cast **${spell.name}** {{+${atk}/+${hp}}}${times}. Repeats +1 each End of Turn.`;
}

/**
 * Cling Drone grows +1/+1 every time a Cling is magnetized (the run-wide `cling` enchant). Surface its
 * *current* accumulated bonus (green) so the player can see it climbing — the printed rule alone doesn't
 * show how big your Clings have become. Returns null with no accumulated buff (falls back to printed text).
 */
export function clingProgressText(cardId: string, enchant: { attack: number; health: number } | undefined): string | null {
  if (cardId !== 'cling' || !enchant || (enchant.attack <= 0 && enchant.health <= 0)) return null;
  const def = CARD_INDEX[cardId];
  if (!def) return null;
  return `${def.text} {{Now +${enchant.attack}/+${enchant.health}.}}`;
}

/**
 * Archmagus Guel scales PER-INSTANCE with spells cast while HE is on the board (`spellProgress`, the
 * Spirit Pup counter — owner ruling 2026-07-05: no improvement unless he's on board, so a fresh shop /
 * hand copy reads at base): the grant is +X/+X where X = base + floor(spellProgress / 4) (×2 golden),
 * stepping up every 4 on-board spells. Show the live current grant AND the countdown to the next step —
 * both green ({{…}}) — plus the per-step size (golden-aware). Null for non-Guel cards (printed text).
 */
export function guelProgressText(cardId: string, golden: boolean, spellProgress: number): string | null {
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'spellCastBuffOthers');
  if (!def || !eff) return null;
  const p = eff.params as { attack?: number; count?: number } | undefined;
  const base = Number(p?.attack ?? 1);
  const count = Number(p?.count ?? 2);
  const mult = golden ? 2 : 1;
  const cur = (base + Math.floor(spellProgress / 4)) * mult; // the current grant size
  const per = base * mult; // the per-4-spells improvement size (golden ×2)
  const toNext = 4 - (spellProgress % 4); // on-board spells until the next step
  return `After a spell is cast (shop or combat), give ${count} other friendly minions {{+${cur}/+${cur}}} (improves **+${per}/+${per}** per 4 spells with this on board — {{${toNext} to go}}).`;
}

/**
 * Flowing Monk scales with overflows seen: each overflow Engraves `count` friends +X/+X where X = base ×
 * (1 + floor(overflows / every)) (×2 golden) — the tally rides in `summonBonus`. Show the live current
 * grant AND the countdown to the next step (both green), so the card always states its current value.
 * Generic over the `overflowBuffRandom` effect; null for other cards (fall back to printed text).
 */
export function monkProgressText(cardId: string, golden: boolean, summonBonus: number, overflowBonus = 0): string | null {
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'overflowBuffRandom');
  if (!def || !eff) return null;
  const p = eff.params as { attack?: number; count?: number; improveEvery?: number } | undefined;
  const base = Number(p?.attack ?? 2);
  const count = Number(p?.count ?? 2);
  const every = Math.max(1, Number(p?.improveEvery ?? 5));
  const mult = golden ? 2 : 1;
  // Current grant = the stepped magnitude + the flat triple top-up (golden combine of the two highest copies).
  const cur = base * (1 + Math.floor(summonBonus / every)) * mult + overflowBonus;
  const per = base * mult; // the per-step improvement size (golden ×2)
  const toNext = every - (summonBonus % every); // overflows until the next step
  return `When you summon a minion that doesn't fit, Engrave ${count} friendly minions {{+${cur}/+${cur}}} (kept after combat). Improves **+${per}/+${per}** every ${every} overflows — {{${toNext} to go}}.`;
}

/**
 * Crypt Drake: "Every N ally attacks, give your minions +X/+X." — appends the live countdown to the next
 * proc. The buff is flat (no improvement), so the magnitude in the printed text is already correct. Returns
 * null when no attacks have been seen yet (falls back to printed text).
 */
export function cryptDrakeText(cardId: string, golden: boolean, attackSeen: number): string | null {
  if (attackSeen <= 0) return null;
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'onAllyAttackBuffAll');
  if (!def || !eff) return null;
  const every = Math.max(1, Number((eff.params as { every?: number } | undefined)?.every ?? 2));
  const toNext = every - (attackSeen % every); // attacks until the next proc (= `every` right after a proc)
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  return `${src} {{${toNext} to go}}`;
}

/**
 * Abhorrent Horror gains, at the next Start of Combat, +Attack/+Health equal to all Fodder consumed this
 * turn. Surface that pending gain live (green) in the shop so the player watches it climb as they consume
 * more Fodder — golden doubles it. Returns null with nothing consumed yet (falls back to the printed text).
 */
export function abhorrentHorrorText(
  cardId: string,
  fodderConsumed: { attack: number; health: number } | undefined,
  golden: boolean,
): string | null {
  if (cardId !== 'abhorrenthorror' || !fodderConsumed) return null;
  const m = golden ? 2 : 1;
  const a = fodderConsumed.attack * m;
  const h = fodderConsumed.health * m;
  if (a <= 0 && h <= 0) return null;
  const def = CARD_INDEX[cardId];
  if (!def) return null;
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  return `${src} {{+${a}/+${h} next combat}}`;
}

/**
 * Sergeant's Deathrattle gives "+N Health" where N grows each time Sergeant gains Attack in combat.
 * Shows the *current* HP grant (base + hpGrantBonus) highlighted green once it starts climbing.
 * Returns null until it has actually improved (no bonus → falls back to printed text).
 */
export function sergeantText(cardId: string, golden: boolean, hpGrantBonus: number): string | null {
  if (hpGrantBonus <= 0) return null;
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'deathrattleBuffAllHealth');
  if (!def || !eff) return null;
  const base = Number((eff.params as { health?: number })?.health ?? 2) * (golden ? 2 : 1);
  const total = base + hpGrantBonus;
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  return src.replace(/\*\*\+\d+ Health\*\*/, `{{+${total} Health}}`);
}

/**
 * Ritualist's End-of-Turn Fodder/Imp buff climbs by `step` every trigger (`eotBonus` accumulates on the instance).
 * Shows the live value it will give NEXT tick — `eotBonus + step` — with the changed number green. Returns null
 * until it has triggered at least once (the printed +step/+step is already accurate). Works in the shop (reads the
 * BoardCard's `eotBonus`) and in combat (reads the seeded MinionSnapshot `eotBonus`).
 */
export function ritualistText(cardId: string, golden: boolean, eotBonus: number): string | null {
  if (eotBonus <= 0) return null;
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'buffFodderImpsImproving');
  if (!def || !eff) return null;
  const step = Number((eff.params as { step?: number })?.step ?? 3) * (golden ? 2 : 1);
  const next = eotBonus + step; // eotBonus climbs by `step` each trigger, then buffs Fodder/Imps by the new total
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  return src.replace(/\*\*\+\d+\/\+\d+\*\*/, `{{+${next}/+${next}}}`); // only the FIRST magnitude (the grant, not the step)
}

/**
 * Watcher casts Lantern of Souls on Rally — your Undead get +(base + spell power)/+(spell power) for the rest
 * of the run, folding the run's spell power into BOTH stats exactly like a shop-cast Lantern (+3/+0 base,
 * +5/+2 with +2/+2). Its printed "+3/+0" becomes the live value (highlighted green), so the card always
 * states the current Lantern buff. Golden casts it twice (the buff doubles). Returns null for other cards or
 * a zero bonus (the printed +3/+0 — golden +6/+0 — is already accurate).
 */
export function watcherText(cardId: string, golden: boolean, spellBonusAttack: number, spellBonusHealth: number): string | null {
  if (spellBonusAttack <= 0 && spellBonusHealth <= 0) return null;
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'rallyCastTribeAttack');
  if (!def || !eff) return null;
  const base = Number((eff.params as { amount?: number })?.amount ?? 3);
  const mult = golden ? 2 : 1;
  const a = (base + spellBonusAttack) * mult;
  const h = spellBonusHealth * mult;
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  return src.replace(/\*\*\+\d+\/\+\d+\*\*/, `{{+${a}/+${h}}}`);
}

/**
 * Thundering Abomination (Engraved): shows how many permanent stats it has gained mid-combat.
 * Appends "{{+A/+H so far}}" (green) once it starts accumulating. Returns null with no accrual.
 */
export function engraveTallyText(cardId: string, permaGain: { attack: number; health: number } | undefined): string | null {
  if (!permaGain || (permaGain.attack <= 0 && permaGain.health <= 0)) return null;
  const def = CARD_INDEX[cardId];
  if (!def?.keywords.includes('EG')) return null;
  const { attack: a, health: h } = permaGain;
  const parts: string[] = [];
  if (a > 0) parts.push(`+${a} Attack`);
  if (h > 0) parts.push(`+${h} Health`);
  return `${def.text} {{${parts.join(', ')} so far}}`;
}

/**
 * Trail Forager's sell value climbs +1 per Beast played (the per-instance `sellBonus`). Surface the CURRENT
 * sell value (green) in place of the printed "2g", so the card always states what it'll sell for right now.
 * Returns null with no accrual (the printed base is accurate). Golden doubles the base (bonus is pre-doubled).
 */
export function trailForagerText(cardId: string, golden: boolean, sellBonus: number): string | null {
  if (cardId !== 'trailforager' || sellBonus <= 0) return null;
  const def = CARD_INDEX[cardId];
  if (!def) return null;
  const value = 3 * (golden ? 2 : 1) + sellBonus;
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  return src.replace(/\*\*\d+g\*\*/, `{{${value}g}}`);
}

/** Steward of Spells — name the ACTUAL spell it will copy at End of Turn (the run's most recent spell cast,
 *  `lastSpellCastId` → its name), so mousing over it shows exactly what you'll get. Null until a spell has been
 *  cast this run (then the printed "…the most recent spell cast" is the honest fallback). */
export function stewardText(cardId: string, golden: boolean, lastSpellName: string | undefined): string | null {
  if (cardId !== 'stewardofspells' || !lastSpellName) return null;
  const name = `{{${lastSpellName}}}`;
  return golden ? `**End of Turn:** get **2** copies of ${name}.` : `**End of Turn:** get a copy of ${name}.`;
}

/**
 * Squirl Scout's grant snowballs: each played raises the run-wide `squirlScoutBuff` by 3 (×2 golden). Surface
 * the grant a play NOW would make — (squirlScoutBuff + step) — green, in place of the FIRST printed "+N/+N"
 * (the grant); the second (the per-play improve) stays. Null before any accrual (printed base is accurate).
 */
export function squirlScoutText(cardId: string, golden: boolean, squirlScoutBuff: number): string | null {
  if (cardId !== 'squirlscout' || squirlScoutBuff <= 0) return null;
  const def = CARD_INDEX[cardId];
  if (!def) return null;
  const step = Number((def.effects.find((e) => e.do === 'battlecryScoutSpread')?.params as { step?: number })?.step ?? 3);
  const next = squirlScoutBuff + step * (golden ? 2 : 1); // what playing this one now would grant per Beast
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  let done = false;
  return src.replace(/\+\d+\/\+\d+/g, (m) => (done ? m : ((done = true), `{{+${next}/+${next}}}`)));
}

/** The minions that stack the run-wide Undead buy-time Attack bonus (`undeadBuyAtk`) — used to surface it. */
const UNDEAD_BUY_CONTRIBUTORS = new Set(['deathswarmer', 'forsakenweaver', 'karthus']);

/**
 * Live run-wide metric suffixes — a small green `{{…}}` tag APPENDED to a card's rule text (golden-independent,
 * so the same suffix rides on both the normal and golden text). Each returns null when there's nothing to show.
 *
 * - `soulsmanText`: how much max Gold Soulsman has earned this run (a running "gained X" total).
 * - `undeadBuyAtkText`: the current run-wide Undead buy-bonus a freshly-acquired Undead will inherit — shown on
 *    the cards that stack it (Deathswarmer / Forsaken Weaver / Karthus), since it has no other on-screen home.
 * - `cardTypeTallyText`: a run-wide card-type enchant accrued from deaths (Eternal Knight's +A/+H stack).
 */
export function soulsmanText(cardId: string, goldGained: number): string | null {
  return cardId === 'soulsman' && goldGained > 0 ? ` {{Gained ${goldGained} Gold this run.}}` : null;
}
export function undeadBuyAtkText(cardId: string, undeadBuyAtk: number): string | null {
  return UNDEAD_BUY_CONTRIBUTORS.has(cardId) && undeadBuyAtk > 0
    ? ` {{New Undead arrive +${undeadBuyAtk} Attack.}}`
    : null;
}
export function cardTypeTallyText(cardId: string, enchant: { attack: number; health: number } | undefined): string | null {
  if (cardId !== 'knit' || !enchant || (enchant.attack <= 0 && enchant.health <= 0)) return null;
  return ` {{Now +${enchant.attack}/+${enchant.health} this run.}}`;
}

/**
 * Grim's Deathrattle ("+1/+1 per Deathrattle triggered this game") shows its *current* magnitude from
 * the live run tally — the printed "+1/+1" becomes the real "+N/+N" (N = tally × per), highlighted
 * green. Returns null for non-tally cards or a zero tally (falls back to the printed "+1/+1").
 */
export function tallyBuffText(cardId: string, deathrattlesTriggered: number): string | null {
  if (deathrattlesTriggered <= 0) return null;
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'deathrattleBuffTribeByTally');
  if (!def || !eff) return null;
  const per = Number((eff.params as { per?: number })?.per ?? 1);
  const n = deathrattlesTriggered * per;
  return def.text.replace(/\*\*\+\d+\/\+\d+\*\*/, `{{+${n}/+${n}}}`);
}

export interface StepProgress { current: number; total: number; }

/**
 * Discrete "X/N toward the next step / transform / proc" for the STEP-BASED scalers only — the cards whose
 * *ProgressText helpers above compute a countdown: Guel (per 4 spells), Flowing Monk (every N overflows),
 * Crypt Drake (every N attacks), Frontdrake / Money Maker (every N turns), Spirit Pup (transform at N spells),
 * Tara (ascend at N). Cyclic scalers count 1..N then wrap (matching Guel's "1/4 → 2/4 → 4/4 → 1/4"); the
 * one-time transform / ascend count up to and clamp at the threshold. Continuous accumulators (Kennelmaster,
 * Mama Bear, Sergeant, Grim, Squirl Scout, Trail Forager, …) have no threshold → null (no counter). Keys off
 * effect `do` names so it stays in lock-step with the text helpers and needs no per-id list.
 */
export function stepProgress(
  cardId: string,
  p: { spellProgress?: number; summonBonus?: number; ascendProgress?: number; eotTick?: number; attackSeen?: number; avengeSeen?: number; bleedAttacks?: number; goldTick?: number },
): StepProgress | null {
  const def = CARD_INDEX[cardId];
  if (!def) return null;
  const n = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);
  const cyc = (v: number, total: number): StepProgress => ({ current: v <= 0 ? 0 : ((v - 1) % total) + 1, total });

  if (def.effects.some((e) => e.do === 'spellCastBuffOthers')) return cyc(p.spellProgress ?? 0, 4); // Guel
  const monk = def.effects.find((e) => e.do === 'overflowBuffRandom');
  if (monk) return cyc(p.summonBonus ?? 0, Math.max(1, n((monk.params as { improveEvery?: number })?.improveEvery, 5)));
  const crypt = def.effects.find((e) => e.do === 'onAllyAttackBuffAll');
  if (crypt) return cyc(p.attackSeen ?? 0, Math.max(1, n((crypt.params as { every?: number })?.every, 2)));
  // Frontdrake / Money Maker / Vineweaver: cadence ticks at END OF TURN, so it's a SHOP-phase counter —
  // `eotTick` is undefined in combat (Unit.tsx passes no eotTick), where the cadence is irrelevant, so we
  // return null there (no combat counter), mirroring `goldSpent` below. The recruit path always passes it.
  const cadence = def.effects.find((e) => e.on === 'endOfTurn' && (e.params as { every?: number } | undefined)?.every !== undefined);
  if (cadence) return p.eotTick === undefined ? null : cyc(p.eotTick, Math.max(1, n((cadence.params as { every?: number })?.every, 3)));
  // Avenge (Solaris, Soulsman, Bone Taxer, Brood Matron, …): the Avenge re-fires every N FRIENDLY deaths (the sim
  // gates on `count % threshold === 0`), so it's a cyclic 1..N counter driven by that side's running death tally.
  // Shows on the board too (`avengeSeen` is undefined outside a fight → 0/N), so a shop unit advertises its Avenge
  // threshold; it ticks up in combat as your units die.
  const avenge = def.effects.find((e) => e.on === 'avenge');
  if (avenge) return cyc(p.avengeSeen ?? 0, Math.max(1, n((avenge.params as { count?: number })?.count, 2)));
  // Bloodbinder: the armed Bleed fires every N GLOBAL combat attack swings (either side). Shows 0/N on the board, ticks in combat.
  const bleed = def.effects.find((e) => e.do === 'scArmBleed');
  if (bleed) return cyc(p.bleedAttacks ?? 0, Math.max(1, n((bleed.params as { every?: number })?.every, 4)));
  // Koron / Banksly: their payoff re-fires every N Gold SPENT while on the board (the `goldTick` meter). SHOP-phase —
  // `goldTick` is a recruit accrual (undefined in combat, where no Gold is spent), so it shows on the shop board.
  const goldSpent = def.effects.find((e) => e.on === 'goldSpent' && (e.params as { every?: number } | undefined)?.every !== undefined);
  if (goldSpent) return p.goldTick === undefined ? null : cyc(p.goldTick, Math.max(1, n((goldSpent.params as { every?: number })?.every, 7)));
  const pup = def.effects.find((e) => e.do === 'spellCastTransform');
  if (pup) { const at = Math.max(1, n((pup.params as { at?: number })?.at, 10)); return { current: Math.min(p.spellProgress ?? 0, at), total: at }; }
  if (def.ascendAt && def.ascendInto) { const at = def.ascendAt; return { current: Math.min(p.ascendProgress ?? 0, at), total: at }; }
  return null;
}
