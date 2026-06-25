import { CARD_INDEX } from '@game/content';

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
  const eff = def?.effects.find((e) => e.do === 'buffOnSummon');
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
  const eff = def?.effects.find((e) => e.do === 'endOfTurnGrantTribe');
  if (!def || !eff) return null;
  const every = Math.max(1, Number((eff.params as { every?: number })?.every ?? 3));
  const toNext = every - (eotTick % every);
  const note = toNext === 1 ? 'End of this turn.' : `Next in ${toNext} turns.`;
  return `${def.text} {{${note}}}`;
}

/**
 * Spirit Worgen's per-summon gain scales with spells cast this turn — the printed "+1/+1" is shown as
 * its current "+X/+X" (X = base + spellsThisTurn), highlighted green, once a spell's been cast this
 * turn. Returns null otherwise (so it falls back to the printed value).
 */
export function summonScalingText(cardId: string, spellsThisTurn: number): string | null {
  if (spellsThisTurn <= 0) return null;
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'summonBuffSelfTribe');
  if (!def || !eff) return null;
  const base = Number((eff.params as { attack?: number })?.attack ?? 1);
  const x = base + spellsThisTurn;
  return def.text.replace(`+${base}/+${base}`, `{{+${x}/+${x}}}`);
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
 * Archmagus Guel scales with spells cast this run: the grant he hands out is +X/+X where X = base +
 * floor(spellsCast / 4) (×2 golden), stepping up every 4 spells. Show the live current grant AND the
 * countdown to the next step — both green ({{…}}) — so the player can read the progress, plus the per-step
 * size (golden-aware). Returns null for non-Guel cards so callers fall back to the printed text.
 */
export function guelProgressText(cardId: string, golden: boolean, spellsCast: number): string | null {
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'spellCastBuffOthers');
  if (!def || !eff) return null;
  const p = eff.params as { attack?: number; count?: number } | undefined;
  const base = Number(p?.attack ?? 1);
  const count = Number(p?.count ?? 2);
  const mult = golden ? 2 : 1;
  const cur = (base + Math.floor(spellsCast / 4)) * mult; // the current grant size
  const per = base * mult; // the per-4-spells improvement size (golden ×2)
  const toNext = 4 - (spellsCast % 4); // spells until the next step
  return `After a spell is cast (shop or combat), give ${count} other friendly minions {{+${cur}/+${cur}}} (improves **+${per}/+${per}** per 4 spells — {{${toNext} to go}}).`;
}

/**
 * Crypt Drake: "When an ally attacks, give your minions +N/+N. Improve this every 3 attacks." —
 * highlights the *current* buff magnitude (green) and the countdown to the next step-up. Returns
 * null when no attacks have been seen yet (falls back to printed text). Golden doubles `step`.
 */
export function cryptDrakeText(cardId: string, golden: boolean, attackSeen: number): string | null {
  if (attackSeen <= 0) return null;
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'onAllyAttackBuffAll');
  if (!def || !eff) return null;
  const p = eff.params as { step?: number; every?: number } | undefined;
  const base = Number(p?.step ?? 2);
  const every = Math.max(1, Number(p?.every ?? 3));
  const step = base * (golden ? 2 : 1);
  const improvements = Math.floor((attackSeen - 1) / every);
  const cur = step * (1 + improvements);
  const nextImprovement = 1 + every * (improvements + 1);
  const toNext = nextImprovement - attackSeen;
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  const upgraded = src.replace(/\*\*\+\d+\/\+\d+\*\*/, `{{+${cur}/+${cur}}}`);
  return `${upgraded} {{${toNext} to go}}`;
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
