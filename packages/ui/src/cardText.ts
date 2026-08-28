import type { Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';

/** Effect `do` names that summon a fresh Imp (the `impscrap` token) — the gate for the live "(X/Y)" Imp-stat
 *  annotation below. `deathrattleSummon` / `onFriendDeathSummon` are generic summoners, so they only count when
 *  their `tokenId` is the Imp. */
const IMP_SUMMON_DOS = new Set(['summonImps', 'rallySummonImpBuffImps', 'deathrattleImpsOverflowGrant', 'spellSummonImpsNextCombat']);

/** Runes whose reward SUMMONS Imps in combat (base 1/1 + the run's Imp Aura) — the same "(X/Y)" annotation as
 *  imp-summoning minions, but on the rune's forge text. */
const RUNE_IMP_SUMMONERS = new Set(['rune_brood', 'rune_broodpit', 'rune_finality']);

/** Does this card/rune SUMMON an Imp (not merely mention or buff Imps)? */
export function cardSummonsImp(id: string): boolean {
  if (RUNE_IMP_SUMMONERS.has(id)) return true;
  const def = CARD_INDEX[id];
  if (!def) return false;
  return def.effects.some((e) =>
    IMP_SUMMON_DOS.has(e.do)
    || ((e.do === 'deathrattleSummon' || e.do === 'onFriendDeathSummon') && (e.params as { tokenId?: string } | undefined)?.tokenId === 'impscrap'));
}

/**
 * Live Imp-stat annotation (owner ask 2026-08-11): any card/rune that SUMMONS an Imp should print the Imp's
 * CURRENT stats — base 1/1 plus the run-wide Imp Aura — updating in real time. This injects "(X/Y)" right after
 * the Imp in the `summon … Imp(s)` phrase (anchored to "summon" so a mention like "give your Imps +1/+1" is left
 * alone), wrapped in `{{…}}` so the Card paints it green AND excludes it from the golden `doubleNums` pass (Imp
 * tokens are never golden — the golden effect scales the COUNT/buffs, not the token's own body).
 *
 * A no-op for non-summoners and when the text has no `summon … Imp` phrase, so it's safe to run over any text.
 */
export function withImpStats(id: string, text: string, impAura?: { attack: number; health: number }, wrap = true): string {
  if (!cardSummonsImp(id)) return text;
  const x = 1 + (impAura?.attack ?? 0);
  const y = 1 + (impAura?.health ?? 0);
  // `wrap` emits the green {{…}} marker (Card renders it); rune text goes through plain `mdBold`, which doesn't
  // process {{…}}, so runes pass wrap=false for a plain "(X/Y)". Anchor to "summon … Imp(s)" within one sentence;
  // only the first match (the summoned body) is annotated.
  const stat = wrap ? `{{(${x}/${y})}}` : `(${x}/${y})`;
  return text.replace(/(\bsummons?\b[^.]*?\b)(Imps?)\b/i, `$1$2 ${stat}`);
}

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
/**
 * Beardsley under Rune of the Zoo (combat): the flat summon grant scales with the running combat-summon
 * count — the NEXT summon gets base × golden × (summons so far + 1). The live value is the hard rule: the
 * combat card must print what the next trigger will actually grant, not the flat base. `zooSummons` is the
 * player's combat-summon tally at the current beat (null/undefined = no rune / not in combat → printed text).
 */
export function summonFlatZooText(cardId: string, golden: boolean, zooSummons: number | null | undefined): string | null {
  if (zooSummons == null) return null;
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'onSummonTribeBuffFlat');
  if (!def || !eff) return null;
  const p = eff.params as { attack?: number; health?: number };
  const reps = Math.max(1, zooSummons + 1); // the NEXT summon's ordinal
  const m = Number(p?.attack ?? 6) * (golden ? 2 : 1) * reps;
  const h = Number(p?.health ?? 6) * (golden ? 2 : 1) * reps;
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  return src.replace(/\*\*\+\d+\/\+\d+\*\*/, `{{+${m}/+${h}}}`);
}

/**
 * Beardsley's escalating summon buff: the per-Beast grant is base + improve × ⌊summonBonus / every⌋ (× golden),
 * where `summonBonus` is Beasts summoned so far with this on board. Injects the current grant into the FIRST
 * +N/+N (leaving the "Improves +N/+N" step as printed) and appends the countdown to the next step. Only for the
 * escalating shape (an `improve` param); returns null otherwise so the flat/zoo helpers handle their cases.
 */
export function summonEscalatingText(cardId: string, golden: boolean, summonBonus: number | null | undefined): string | null {
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'onSummonTribeBuffFlat' && (e.params as { improve?: number } | undefined)?.improve);
  if (!def || !eff) return null;
  const p = eff.params as { attack?: number; improve?: number; every?: number };
  const seen = Math.max(0, summonBonus ?? 0);
  const base = Number(p?.attack ?? 3);
  const improve = Number(p?.improve ?? 3);
  const every = Math.max(1, Number(p?.every ?? 3));
  const cur = (base + improve * Math.floor(seen / every)) * (golden ? 2 : 1);
  const toNext = every - (seen % every);
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  return src.replace(/\*\*\+\d+\/\+\d+\*\*/, `{{+${cur}/+${cur}}}`) + ` {{${toNext} to next step}}`;
}

export function summonBuffText(cardId: string, summonBonus: number, golden = false): string | null {
  if (summonBonus <= 0) return null; // baseline: fall back to printed text (golden's `doubleNums` handles it)
  const def = CARD_INDEX[cardId];
  // `buffOnSummon` (legacy summon-buff) or Kennelmaster's `scBeastAura` (Start-of-Combat Beast aura) or Trophy
  // Stalker's `rallyTribeAuraGrowing`. All grant `(base + summonBonus) × golden`, so the same live magnitude
  // injects into the printed "+N/+N". Golden must be folded in here: the injected value is wrapped in `{{…}}`,
  // which the Card EXCLUDES from its generic golden `doubleNums` pass — so an un-doubled inject under-showed a
  // golden copy's real grant (owner-caught on golden Trophy Stalker: effect gave +10/+10, text read +5/+5).
  const eff = def?.effects.find((e) => e.do === 'buffOnSummon' || e.do === 'scBeastAura' || e.do === 'rallyTribeAuraGrowing');
  if (!def || !eff) return null;
  const p = eff.params as { attack?: number; health?: number; stepAttack?: number; stepHealth?: number };
  const base = Number(p?.attack ?? 1);
  // The accrual applies per stat (`scBeastAura`'s stepAttack/stepHealth, default 1 = the symmetric shape).
  const m = (base + summonBonus * Number(p?.stepAttack ?? 1)) * (golden ? 2 : 1);
  // Golden-aware template (same fix as cadenceProgressText, 2026-07-31): a golden card's tail text can differ
  // ("twice as much"), so the injection must start from the golden line, not the plain one.
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  // Attack-only cards (Kennelmaster since 2026-07-21) print "**+N Attack**", not "**+N/+N**" — inject into
  // whichever shape the card actually uses, or the live value silently goes stale.
  if (Number(p?.stepHealth ?? 1) === 0 || Number(p?.health ?? 1) === 0) {
    return src.replace(/\*\*\+\d+ Attack\*\*/, `{{+${m} Attack}}`);
  }
  const h = (Number(p?.health ?? base) + summonBonus * Number(p?.stepHealth ?? 1)) * (golden ? 2 : 1);
  return src.replace(/\*\*\+\d+\/\+\d+\*\*/, `{{+${m}/+${h}}}`);
}

/**
 * Mama Bear (`summonBuffTribeImprove`) hands out a buff that GROWS: the grant is (base + accrued) × golden,
 * and the accrued (`summonBonus`) climbs by base each summon. Surface the *current* grant magnitude (green)
 * in place of the printed "+N/+N" — the first number (the grant) only; the second (the per-summon improve
 * step) stays printed. Golden reads from goldenText and doubles the live grant. Returns null with no accrual
 * (falls back to the printed text), matching `summonBuffText`'s contract.
 */
/**
 * Soul Defiler — its Shop buff CLIMBS every trigger, so the printed "+1/+1" goes stale on the first End of
 * Turn. Prints the magnitude it will actually give next (owner ask 2026-07-29: show the current value, on every
 * card that has one).
 *
 * The accrual rides `summonBonus`, the same field `summonBuffTribeImprove` uses — hence the shared shape here.
 */
export function shopBuffImproveText(cardId: string, summonBonus: number, golden = false): string | null {
  if (summonBonus <= 0) return null; // not yet climbed — the printed base is still accurate
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'buffShopPermanent' && (e.params as { improve?: number } | undefined)?.improve);
  if (!def || !eff) return null;
  const params = eff.params as { attack?: number; alternate?: boolean };
  const base = Number(params?.attack ?? 1);
  const m = (base + summonBonus) * (golden ? 2 : 1);
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  // Soul Defiler (owner balance 2026-08-18): a SINGLE-stat buff that alternates Attack (even triggers) /
  // Health (odd) each round, printed as "**+N Attack**". Fold in the live magnitude AND the stat it will hit
  // next, so the printed value never goes stale (the hard live-text rule).
  if (params?.alternate) {
    const stat = summonBonus % 2 === 0 ? 'Attack' : 'Health';
    return src.replace(/\*\*\+\d+ (?:Attack|Health)\*\*/, `{{+${m} ${stat}}}`);
  }
  // Replace only the FIRST magnitude — the second is the "improves by" step, which does not change.
  return src.replace(/\*\*\+\d+\/\+\d+\*\*/, `{{+${m}/+${m}}}`);
}

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
 * Beyond the Summit — the "(up to Tier 7)" clause is a PROMISE, and most runs can't keep it. Tier 7 needs the
 * Summit rift or a hero/quest that grants access (`hasTier7Access`), so the printed text says only "one tier
 * higher" and this appends the Tier-7 clause when — and only when — the run actually qualifies
 * (owner 2026-07-28: "the tooltip should say (Up to tier 7) ONLY if the criteria is met").
 */
export function summitTierText(cardId: string, tier7Access: boolean): string | null {
  if (cardId !== 'beyondsummit' || !tier7Access) return null;
  const def = CARD_INDEX[cardId];
  if (!def) return null;
  return `${def.text.replace(/\.$/, '')} {{(up to Tier 7)}}`;
}

/**
 * SKYBOUND ASCENDANT — its "(up to Tier 7)" is the same PROMISE Beyond the Summit makes, and the transform
 * is clamped to the run's real ceiling (`hasTier7Access`), so on an ordinary run the honest number is SIX.
 * Printed live on both chains rather than left as a static 7 (the hard live-value rule + owner 2026-08-20:
 * text says what the card does).
 */
export function ascendantTierText(cardId: string, golden: boolean, tier7Access: boolean): string | null {
  if (cardId !== 'd2_ascendant' || tier7Access) return null; // with access the printed "Tier 7" is already true
  const def = CARD_INDEX[cardId];
  if (!def) return null;
  const base = (golden && def.goldenText) || def.text;
  return base.replace('**Tier 7**', '**{{Tier 6}}**');
}

/**
 * Menagerie Mammoth (`onSummonTribeBuffImproveSelf`) — an Attack-only grant that climbs by `step` every time it
 * pays out, permanently. Same contract as `summonImproveText`, but the printed magnitude is "**+N Attack**"
 * rather than a "+N/+N" pair, so it needs its own replace.
 */
export function attackGrantImproveText(cardId: string, summonBonus: number, golden: boolean, mammothHealth = false): string | null {
  // With the Rune of the Mammoth the text must go live even at ZERO procs — the printed "+3 Attack" is
  // under-selling a grant that is actually +3/+3 (the hard live-text rule).
  if (summonBonus <= 0 && !mammothHealth) return null;
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'onSummonTribeBuffImproveSelf');
  if (!def || !eff) return null;
  // Attack-only since the 2026-08-02 third pass; `summonBonus` counts PROCS. The Rune of the Mammoth makes
  // the grant 1:1 symmetric, so BOTH printed magnitudes (the grant and the improve step) switch shape.
  const p = eff.params as { attack?: number; stepAttack?: number };
  const g = golden ? 2 : 1;
  const a = (Number(p?.attack ?? 3) + summonBonus * Number(p?.stepAttack ?? 3)) * g;
  const step = Number(p?.stepAttack ?? 3) * g;
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  if (mammothHealth) {
    // "+N Attack" → "+N/+N", grant first then the improve step.
    return src
      .replace(/\*\*\+\d+ Attack\*\*/, `{{+${a}/+${a}}}`)
      .replace(/\*\*\+\d+ Attack\*\*/, `{{+${step}/+${step}}}`);
  }
  return src.replace(/\*\*\+\d+ Attack\*\*/, `{{+${a} Attack}}`);
}

/**
 * Runic Archivist (`minionSoldGrantSpell`) — an every-N SELL meter. The threshold never changes, so what has to
 * be live is the COUNTDOWN: print how many more sales are owed rather than the bare "5 minions", which reads as
 * a fresh requirement whether you're 0 or 4 in.
 */
export function soldProgressText(cardId: string, soldProgress: number): string | null {
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'minionSoldGrantSpell');
  if (!def || !eff) return null;
  const every = Math.max(1, Number((eff.params as { count?: number })?.count ?? 5));
  const left = every - (soldProgress % every);
  if (left === every) return null; // no progress yet — the printed threshold is already accurate
  return def.text.replace(/\*\*\d+ minions\*\*/, `{{${left} more minion${left === 1 ? '' : 's'}}}`);
}

/**
 * Hunter (`onGainAttackBuffImproving`) — its board-wide grant GROWS in steps: each Attack gain gives your minions
 * base × (1 + ⌊fires/every⌋) × golden, where `summonBonus` counts how many times it has FIRED (every = 3 for
 * Hunter). Surface the CURRENT grant (green) in place of the first printed "+N/+N"; the "+step/+step every N"
 * improve clause stays. Null until the grant has actually stepped up (printed base is accurate until then).
 */
export function hunterText(cardId: string, summonBonus: number, golden: boolean): string | null {
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'onGainAttackBuffImproving');
  if (!def || !eff) return null;
  const p = eff.params as { attack?: number; every?: number };
  const base = Number(p?.attack ?? 1);
  const every = Math.max(1, Number(p?.every ?? 1));
  const steps = Math.floor(Math.max(0, summonBonus) / every);
  if (steps <= 0) return null; // not stepped up yet → the printed base grant is accurate
  const m = base * (1 + steps) * (golden ? 2 : 1);
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
/**
 * Groveweaver's summon grant GROWS with every spell cast while it's on board (`summonBonus`), but its printed
 * "+2/+4" never moved — so the card advertised its base rate forever (owner report 2026-07-25). Fold the live
 * value in, the same way `summonBuffText` does for the Start-of-Combat auras.
 *
 * Deliberately shaped as its own helper rather than folded into `summonBuffText`: that one injects into an
 * Attack-only or symmetric "+N/+N", while this grant is ASYMMETRIC (+2/+4) and each stat picks up the bonus.
 */
export function asymSummonBuffText(cardId: string, summonBonus: number, golden = false): string | null {
  if (summonBonus <= 0) return null; // at base the printed text is already accurate
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'summonBuffTribeAsym');
  if (!def || !eff) return null;
  const p = eff.params as { attack?: number; health?: number } | undefined;
  const g = golden ? 2 : 1;
  const a = (Number(p?.attack ?? 2) + summonBonus) * g;
  const h = (Number(p?.health ?? 4) + summonBonus) * g;
  const base = golden ? (def.goldenText ?? def.text) : def.text;
  return base.replace(/\*\*\+\d+\/\+\d+\*\*/, `{{+${a}/+${h}}}`);
}

/**
 * Cards whose BEHAVIOUR a rune changes must say so on the card (owner rule 2026-08-02, following the Rune of
 * the Mammoth pattern): the printed rule is inaccurate the moment the rune is owned. Applied as a POST-pass
 * over whatever live text the chain resolved, so it composes with every value-injecting helper. Green-marked,
 * like every live value.
 */
export interface RuneTextFlags { matriarch?: boolean; brokerage?: boolean; livingTreasure?: boolean }
export function runeModifiedNote(cardId: string, flags: RuneTextFlags | undefined): string | null {
  if (!flags) return null;
  if (flags.matriarch && cardId === 'b2_runebloom') return '{{Triggers twice (Rune of the Matriarch).}}';
  if (flags.brokerage && cardId === 'k_rubybroker') return '{{No per-turn limit (Rune of Brokerage).}}';
  if (flags.livingTreasure && cardId === 'gemheart-shard') return '{{Echo: summon an exact copy of this without Echo (Rune of Living Treasure).}}';
  // (Facetwright's "gives both effects" note used to live here. It is now the general (Both) rendering below,
  // which every "does both branches" source shares — a card that does both must READ as doing both, not carry
  // a footnote under a "Choose One:" label that is no longer true.)
  return null;
}

/**
 * (BOTH) — the printed text for a Choose One whose branches are ALL enabled (see `chooseBothActive` in
 * `@game/sim`, the single predicate every consumer reads). The leading "Choose One:" label is replaced by a
 * coloured **(Both)** and BOTH option texts print after it, so the card says exactly what it will do rather
 * than offering a choice it will not ask for (owner ruling 2026-08-28).
 *
 * Golden-aware, like every other live-text helper: a golden instance reads each option's `goldenText`, which
 * is where the doubled magnitude lives. Returns null for a card with no Choose One.
 */
export function chooseBothText(cardId: string, golden: boolean): string | null {
  const opts = CARD_INDEX[cardId]?.chooseOne;
  if (!opts?.length) return null;
  return `{{(Both)}} ${opts.map((o) => (golden ? (o.goldenText ?? o.text) : o.text)).join(' ')}`;
}

export function cadenceProgressText(cardId: string, eotTick: number, golden = false): string | null {
  const def = CARD_INDEX[cardId];
  // Any "every N turns" End-of-Turn effect: Frontdrake's Dragon conjure, Money Maker's card grant, or
  // Bellringer Voss's neighbour copy.
  const eff = def?.effects.find((e) => e.on === 'endOfTurn' && (e.params as { every?: number } | undefined)?.every !== undefined);
  if (!def || !eff) return null;
  const every = Math.max(1, Number((eff.params as { every?: number })?.every ?? 3));
  const toNext = every - (eotTick % every);
  const note = toNext === 1 ? 'End of this turn.' : `Next in ${toNext} turns.`;
  // Golden-aware: a gilded Bellringer copies ADJACENT minions, not just the left one — reading `def.text`
  // here erased that difference on every surface (owner report 2026-07-31).
  const base = golden ? (def.goldenText ?? def.text) : def.text;
  return `${base} {{${note}}}`;
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
 * DRUNKEN OAF (`scBuffRandomTribePerAle`) — Start of Combat gives a Dwarf +A/+H, repeated once more for every
 * Dwarven Ale cast this turn, so the reps are `1 + ales`. Spell out what it will ACTUALLY do right now: the rep
 * count and the total stats it's about to hand out, alongside the unchanged per-rep rate. Returns null on a dry
 * turn (0 Ales → one rep → the printed text is already exact), matching every sibling helper's contract.
 */
export function drunkenOafText(cardId: string, golden: boolean, alesThisTurn: number | undefined): string | null {
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'scBuffRandomTribePerAle');
  if (!def || !eff) return null;
  const ales = alesThisTurn ?? 0;
  if (ales <= 0) return null; // no Ales yet → the printed "give a Dwarf +2/+2. Repeat for…" stands
  const mult = golden ? 2 : 1;
  const a = Number((eff.params as { attack?: number })?.attack ?? 2) * mult;
  const h = Number((eff.params as { health?: number })?.health ?? 2) * mult;
  const reps = 1 + ales;
  const tribe = String((eff.params as { tribe?: string })?.tribe ?? 'dwarf');
  const label = tribe.charAt(0).toUpperCase() + tribe.slice(1);
  // Each rep re-rolls its target, so the honest headline is "N times", not one fat number on one body.
  return `**Start of Combat:** give a **${label}** **+${a}/+${h}**, {{${reps} times}} (**${ales}** Ale${ales === 1 ? '' : 's'} cast this turn).`;
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
 * Chef Raag's Echo buffs your whole board by your run-wide **Imp Aura**, FLOORED at +1/+1 (so a fresh Raag with
 * no Imp buffs still pays a baseline) and doubled when golden. Surface the CURRENT grant (green) in place of the
 * first printed "+N/+N"; the "Improve your Imps by +2/+2" clause that follows is left alone. Mirrors the
 * `deathrattleBuffAllByImpAura` factory exactly — keep the two in step. Returns null for other cards, or when the
 * live value already equals the printed base (no aura yet), so the printed text stands.
 */
export function chefRaagText(cardId: string, golden: boolean, impAura?: { attack: number; health: number }): string | null {
  const def = CARD_INDEX[cardId];
  if (!def?.effects.some((e) => e.do === 'deathrattleBuffAllByImpAura')) return null;
  const mult = golden ? 2 : 1;
  const a = Math.max(1, impAura?.attack ?? 0) * mult;
  const h = Math.max(1, impAura?.health ?? 0) * mult;
  if (a === mult && h === mult) return null; // still the floor → the printed +1/+1 (golden +2/+2) is accurate
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  let done = false;
  return src.replace(/\*\*\+\d+\/\+\d+\*\*/g, (m) => (done ? m : ((done = true), `{{+${a}/+${h}}}`)));
}

/**
 * Runescale Drake's Start-of-Combat Dragon buff is a PER-SPELL rate applied to every spell cast this turn. The
 * rate = base + `step` for every `every` (4) spells cast while THIS instance has been on the board (per-instance
 * `spellProgress`). Surface the CURRENT per-spell rate (green) — (base + step·⌊progress/every⌋) × golden — by
 * replacing ONLY the first "+A/+B" group (the per-spell rate), leaving the "+1/+1 every 4" improve clause. Returns
 * null until the rate has actually improved (before then the printed base rate is already accurate).
 */
export function runescaleText(cardId: string, golden: boolean, spellProgress: number): string | null {
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'scTribeBuffPerSpellImproving');
  if (!def || !eff) return null;
  const p = eff.params as { attack?: number; step?: number; every?: number };
  const base = Number(p?.attack ?? 2);
  const step = Number(p?.step ?? 1);
  const every = Math.max(1, Number(p?.every ?? 4));
  const mult = golden ? 2 : 1;
  const rate = (base + step * Math.floor(Math.max(0, spellProgress) / every)) * mult;
  if (rate === base * mult) return null; // no improvement yet → printed base rate is accurate
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  let done = false;
  return src.replace(/\+\d+\/\+\d+/g, (m) => (done ? m : ((done = true), `{{+${rate}/+${rate}}}`)));
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
/**
 * High King Mykel — a COUNTDOWN, because the card is a threshold and a bare "when you cast 8" tells you nothing
 * about where you are (owner ask 2026-07-29). `spellProgress` is the per-instance meter the factory advances.
 */
/**
 * ANCIENT WANDERER — "Has +1/+1 for every 3 Gold you have spent this run".
 *
 * The hardest case of the live-text rule in this batch, because the number IS the card: a Wanderer's printed
 * "+1/+1" is a RATE, and what the player needs to read is the stat block it is actually carrying right now.
 * So the printed magnitude is replaced with the live total (green) and the rate moves into a parenthetical,
 * followed by the countdown to the next step — the same shape `perGoldSpentText` uses for Baby Gastrid.
 *
 * `goldSpentRun` is the RUN total (`RunState.goldSpent`), NOT the per-turn `goldSpent` every other helper here
 * reads: the card says "this run". At 0 spent there is nothing live to fold, so the printed text stands.
 */
export function ancientWandererText(cardId: string, goldSpentRun: number, golden = false): string | null {
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'goldSpentScaleSelf');
  if (!def || !eff) return null;
  const p = eff.params as { per?: number; attack?: number; health?: number } | undefined;
  const per = Math.max(1, Number(p?.per ?? 3));
  const g = Math.max(0, goldSpentRun);
  const mul = golden ? 2 : 1;
  const a = Math.floor(g / per) * Number(p?.attack ?? 1) * mul;
  const h = Math.floor(g / per) * Number(p?.health ?? 1) * mul;
  if (a === 0 && h === 0) return null; // nothing spent yet — the printed rate is already the whole truth
  const toNext = per - (g % per);
  // Plain parentheses, no `_italics_` — the Card renderer only knows **bold** and the {{…}} / ((…)) markers.
  return `Has **{{+${a}/+${h}}}** (+${Number(p?.attack ?? 1) * mul}/+${Number(p?.health ?? 1) * mul} per **${per} Gold** spent this run; {{${toNext} more}} to the next).`;
}

/**
 * MUSTER GENERAL — its Trooper is a 1/1 only until the first Avenge fires; after that the printed "1/1" is a
 * stale number, which the live-text rule calls a defect. `summonBonus` is the permanent per-instance accrual
 * (carried back after each combat), so fold it into BOTH the summoned line and the improve step.
 */
export function musterTrooperText(cardId: string, summonBonus: number, golden = false): string | null {
  if (summonBonus <= 0) return null; // no Avenge has fired — the printed 1/1 is accurate
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'avengeSummonAttackImproving');
  if (!def || !eff) return null;
  const n = 1 + summonBonus;
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  return src.replace('**1/1 Trooper**', `**{{${n}/${n}}} Trooper**`);
}

export function spellThresholdText(cardId: string, golden: boolean, spellProgress: number): string | null {
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'spellCastTriggerAdjacentShouts');
  if (!def || !eff) return null;
  const every = Math.max(1, Number((eff.params as { every?: number })?.every ?? 8));
  const toNext = every - (spellProgress % every);
  const base = (golden && def.goldenText) || def.text;
  // Replace the printed threshold with the countdown; the rest of the sentence still explains what happens.
  // PLAIN-string replace, deliberately: this used to be `new RegExp(`\*\*${every}...`)`, and in a template
  // literal `\*` is just `*` — the pattern began with `**` and threw "Nothing to repeat", crashing the whole
  // shop the moment a Mykel rendered (Mike's crash report 2026-08-01). Nothing here needs a regex.
  return base.replace(`**${every} Shop spells**`, `**{{${toNext} more Shop spell${toNext === 1 ? '' : 's'}}}**`);
}

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
 * Herzog's per-Dragon grant SCALES with the run's lifetime Shop-Spell count: +N/+N where N = base +
 * floor(spellsCast / per), read live (retroactive). Injects the current per-Dragon grant into the printed
 * "Gain +X/+X" (the FIRST +A/+H in the text — the "Improves" step is left as the base rate) and appends the
 * countdown to the next step. `{{…}}` renders green + is excluded from the golden doubling, so golden is folded
 * in here (see the note at the top of this file).
 */
export function herzogText(cardId: string, golden: boolean, spellsCast: number): string | null {
  // `spellsCast` here is the UMBRELLA (Shop Spells + Rubies) the effect actually reads — see the factory.
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'onTribePlayedBuffSelfPerSpell');
  if (!def || !eff) return null;
  const per = Math.max(1, Number((eff.params as { per?: number } | undefined)?.per ?? 4));
  const base = Number((eff.params as { base?: number } | undefined)?.base ?? 1);
  // Match the FACTORY exactly: grant = base × (1 + step) (not base + step) — so a base-2 Vaultkeeper improves
  // +2/+2 per step (2 → 4 → 6), gilded 4 → 8 → 12. The old `base + step` printed a +1/+1 climb (owner report).
  const cur = base * (1 + Math.floor(spellsCast / per)) * (golden ? 2 : 1);
  const toNext = per - (spellsCast % per);
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  return src.replace(/\*\*\+\d+\/\+\d+\*\*/, `{{+${cur}/+${cur}}}`) + ` {{${toNext} spells to next step}}`;
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
 * Crypt Drake: "Every N ally attacks, give your minions +X/+X. Improves every M attacks." — folds the
 * CURRENT grant (base + the accrued permanent improvement, riding `summonBonus`) into the printed number,
 * and appends the live countdown to the next proc in combat. Returns null when neither is live yet
 * (fresh copy in the shop → the printed base is already correct).
 */
export function cryptDrakeText(cardId: string, golden: boolean, attackSeen: number, bonus = 0): string | null {
  if (attackSeen <= 0 && bonus <= 0) return null;
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'onAllyAttackBuffAll');
  if (!def || !eff) return null;
  const every = Math.max(1, Number((eff.params as { every?: number } | undefined)?.every ?? 2));
  let src = golden ? (def.goldenText ?? def.text) : def.text;
  if (bonus > 0) {
    // The grant magnitude climbed — print the CURRENT value green (first occurrence = the grant; the
    // trailing "Improves +X/+X" keeps the printed step, which stays correct).
    const base = Number((eff.params as { step?: number } | undefined)?.step ?? 2) * (golden ? 2 : 1);
    const cur = base + bonus;
    src = src.replace(/\*\*\+\d+\/\+\d+\*\*/, `{{+${cur}/+${cur}}}`);
  }
  if (attackSeen <= 0) return src; // shop view after combats: live magnitude, no countdown
  const toNext = every - (attackSeen % every); // attacks until the next proc (= `every` right after a proc)
  return `${src} {{${toNext} to go}}`;
}

/**
 * Karthus: "Slaughter: give your Undead +N Attack permanently. Improves +step each Slaughter." — folds the
 * CURRENT grant (base + the accrued improvement, riding `summonBonus`) into the printed number once it has
 * climbed. Returns null until then (the printed base is already correct).
 */
export function karthusText(cardId: string, golden: boolean, bonus: number): string | null {
  if (bonus <= 0) return null;
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'onKillBuffUndeadAttack');
  if (!def || !eff) return null;
  const base = Number((eff.params as { attack?: number } | undefined)?.attack ?? 3) * (golden ? 2 : 1);
  const total = base + bonus;
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  return src.replace(/\*\*\+\d+ Attack\*\*/, `{{+${total} Attack}}`);
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
  const def = CARD_INDEX[cardId];
  if (!def || sellBonus <= 0) return null;
  if (cardId === 'trailforager') {
    const value = 3 * (golden ? 2 : 1) + sellBonus;
    const src = golden ? (def.goldenText ?? def.text) : def.text;
    return src.replace(/\*\*\d+g\*\*/, `{{${value}g}}`);
  }
  // Starpath Vendor (audit 2026-08-06): the same `sellBonus` accrual, capped — show the accrued value in
  // place of the printed "+1", so "gain +1 sell value, up to +3" reads "{{+2}} sell value, up to +3" as it
  // climbs. Gated on the effect rather than a new id so a future sell-value Orbit card is covered for free.
  if (def.effects.some((e) => e.do === 'orbitSellValue')) {
    const src = golden ? (def.goldenText ?? def.text) : def.text;
    return src.replace(/\*\*\+\d+ sell value\*\*/, `{{+${sellBonus} sell value}}`);
  }
  return null;
}

/** Thundeer — its per-proc grant IMPROVES by `step` each fire (`onAllyTribeAttackBuffSelf`'s accrual rides
 *  `summonBonus`). Audit find 2026-08-06: the text printed a permanent "+10/+10" while the real grant climbed.
 *  Null until it has climbed, so the printed base stays authoritative; then the CURRENT grant, green. */
export function thundeerText(cardId: string, summonBonus: number, golden: boolean): string | null {
  if (summonBonus <= 0) return null;
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'onAllyTribeAttackBuffSelf');
  if (!def || !eff) return null;
  const base = ((eff.params as { attack?: number })?.attack ?? 10) * (golden ? 2 : 1);
  const cur = base + summonBonus;
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  return src.replace(/gain \*\*\+\d+\/\+\d+\*\*/, `gain {{+${cur}/+${cur}}}`);
}

/** Steward of Spells — name the ACTUAL spell it will copy at End of Turn (the run's most recent spell cast,
 *  `lastSpellCastId` → its name), so mousing over it shows exactly what you'll get. Null until a spell has been
 *  cast this run (then the printed "…the most recent spell cast" is the honest fallback). */
/**
 * King Oona / Broodwright — a summon-buff whose base magnitude IMPROVES on Avenge. Same contract as
 * `summonBuffText` (which covers the other summon-buff shapes): null until the bonus has actually climbed, so
 * the printed base stays authoritative; then the CURRENT grant, green, in place of the first printed "+N/+N".
 * Found by the 2026-07-31 audit — both cards' Avenge had been silently outgrowing their printed number.
 */
export function improvingSummonText(cardId: string, summonBonus: number, golden = false): string | null {
  if (summonBonus <= 0) return null;
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'onSummonTribeBuffThenDouble' || e.do === 'onSummonImpBuff');
  if (!def || !eff) return null;
  // Per-stat steps (Oona improves +1/+2 per Avenge since 2026-08-02; defaults keep Broodwright's +1/+1).
  const p = eff.params as { attack?: number; health?: number; stepAttack?: number; stepHealth?: number };
  const a = (Number(p?.attack ?? 1) + summonBonus * Number(p?.stepAttack ?? 1)) * (golden ? 2 : 1);
  const h = (Number(p?.health ?? 1) + summonBonus * Number(p?.stepHealth ?? 1)) * (golden ? 2 : 1);
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  return src.replace(/\*\*\+\d+\/\+\d+\*\*/, `{{+${a}/+${h}}}`);
}

/**
 * Rouge Rogue — its per-Imp-attack grant escalates DURING a fight (per-combat `summonBonus`; the improvement
 * deliberately does not persist — see the carry-back exclusion in `simulate`). Combat-only in practice: in the
 * shop the bonus is always 0 and the printed base stands.
 */
export function rougeRogueText(cardId: string, golden: boolean, summonBonus: number): string | null {
  if (summonBonus <= 0) return null;
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'onImpAttackBuffImps');
  if (!def || !eff) return null;
  const base = Number((eff.params as { attack?: number })?.attack ?? 3);
  const m = (base + summonBonus) * (golden ? 2 : 1);
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  return src.replace(/\*\*\+\d+\/\+\d+\*\*/, `{{+${m}/+${m}}}`);
}

/**
 * The Dragon spell-copiers name the ACTUAL spell they will hand over (owner ask 2026-07-31: a card whose grant
 * shifts with cards played must say what it is giving). Three cards, three sources: Recaller reads the last
 * Shop spell cast this turn, Spellvault Drake the first this turn, Spell Warden its own since-placed record.
 * Null (printed text) until the spell exists — before any cast there is nothing to name.
 */
export function copyCastSpellText(cardId: string, golden: boolean, names: {
  firstThisTurn?: string; lastThisTurn?: string; keeperFirst?: string;
}): string | null {
  if (cardId === 'd2_recaller' && names.lastThisTurn) {
    const n = `{{${names.lastThisTurn}}}`;
    return golden
      ? `**Shout:** get **2** copies of ${n} — the last **Shop spell** you cast this turn.`
      : `**Shout:** get a copy of ${n} — the last **Shop spell** you cast this turn.`;
  }
  if (cardId === 'd2_runefire' && names.lastThisTurn) {
    const n = `{{${names.lastThisTurn}}}`;
    return golden
      ? `**End of Turn:** cast ${n} — the last **Shop spell** you cast this turn — **2 additional** times.`
      : `**End of Turn:** cast ${n} — the last **Shop spell** you cast this turn — again.`;
  }
  if (cardId === 'd2_spellvault' && names.firstThisTurn) {
    const n = `{{${names.firstThisTurn}}}`;
    return golden
      ? `**End of Turn:** get **2** copies of ${n} — the first **Shop spell** you cast this turn.`
      : `**End of Turn:** get a copy of ${n} — the first **Shop spell** you cast this turn.`;
  }
  if (cardId === 'd2_spellkeeper' && names.keeperFirst) {
    const n = `{{${names.keeperFirst}}}`;
    return golden
      ? `After you cast your **second Shop spell** each turn, get **2** copies of the first (${n}).`
      : `After you cast your **second Shop spell** each turn, get a copy of the first (${n}).`;
  }
  return null;
}

export function stewardText(cardId: string, golden: boolean, lastSpellName: string | undefined): string | null {
  if (cardId !== 'stewardofspells' || !lastSpellName) return null;
  const name = `{{${lastSpellName}}}`;
  return golden ? `**End of Turn:** get **2** copies of ${name}.` : `**End of Turn:** get a copy of ${name}.`;
}

/** Sporebat (rework 2026-08-07) stores the run's last-cast spell — its printed text must NAME what it will
 *  actually cast (owner ask), the same live rule Steward of Spells follows. Base text when nothing stored. */
export function sporebatText(cardId: string, golden: boolean, lastSpellName: string | undefined): string | null {
  if (cardId !== 'sporebat' || !lastSpellName) return null;
  const name = `{{${lastSpellName}}}`;
  return golden
    ? `**Taunt.** Store the last spell you cast. **Echo:** cast ${name} on a random friendly Beast **twice**.`
    : `**Taunt.** Store the last spell you cast. **Echo:** cast ${name} on a random friendly Beast.`;
}

/** RUNESNOUT ARCHIVIST — its Echo casts the WHOLE journal, so the text has to name what is actually in it
 *  right now (the live-value rule), not the abstract "every remembered spell". Base text while the journal is
 *  empty, since then the printed line is already accurate. */
export function archivistText(cardId: string, golden: boolean, remembered: readonly string[] | undefined): string | null {
  if (cardId !== 'runesnout_archivist' || !remembered || remembered.length === 0) return null;
  const names = remembered.map((n) => `{{${n}}}`).join(', ');
  const twice = golden ? ' **twice**' : '';
  return `Remember the first **Shop spell** you cast each turn. **Echo:** cast ${names} on random friendly **Beasts**${twice}.`;
}

/** ASHEN HEIR — the bank is the whole card, so print what the next Imp would actually inherit. Combat-only
 *  (the bank is per-fight), and null at zero so the shop shows the printed rule. */
export function ashenHeirText(cardId: string, bank: { attack: number; health: number } | undefined): string | null {
  if (cardId !== 'ashen_heir' || !bank || (bank.attack <= 0 && bank.health <= 0)) return null;
  // A non-empty bank only exists when the Imps have been wiped out — so the live line says what the NEXT Imp
  // to arrive would inherit, which is the only thing the bank can still do.
  return `Whenever an **Imp** dies, another friendly Imp gains its stats. Waiting for the next Imp: **+${bank.attack}/+${bank.health}**.`;
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

/**
 * Conductor's grant snowballs like Squirl Scout's, positionally: `conductorBuff` counts weighted Shouts
 * (×2 gilded, ×2 Mastery) and the grant is +(2×N)/+(3×N). Surface what a play NOW would give — (buff + this
 * play's step) — green, in place of the FIRST printed "+A/+B"; the per-play improve clause stays printed.
 * Null before any accrual (the printed base is accurate).
 */
export function conductorText(cardId: string, golden: boolean, conductorBuff: number, improveReps = 1, onBoard = false): string | null {
  if (cardId !== 'n2_conductor' || conductorBuff <= 0) return null;
  const def = CARD_INDEX[cardId];
  if (!def) return null;
  const params = (def.effects.find((e) => e.do === 'battlecryConductorAdjacent')?.params ?? {}) as { attack?: number; health?: number };
  const stepA = Number(params.attack ?? 2);
  const stepH = Number(params.health ?? 3);
  // TWO FRAMINGS, and using the wrong one misprints the card by a full step.
  //
  //   In the SHOP / hand, this Conductor has NOT been played yet, so the number that matters is what playing
  //   it right now would grant — N advances first, then the Shout fires. Hence the +1 (+2 golden, ×improves).
  //
  //   ON THE BOARD (and therefore all through COMBAT) it has already been played: N already counts it. The
  //   grant of any re-fire — a Parting Cry, Ryme, Dawnclaw, Rune of Shared Scripture — is the CURRENT N,
  //   which is exactly what the arena body applies. Adding a step there printed one increment too many
  //   (owner report 2026-08-26: the combat text doesn't track what it actually does).
  //
  // Floored at 1 to match the arena body, so a body that never went through the shop's play path (summoned,
  // Discovered straight onto the board) prints the printed +2/+3 it really pays rather than nothing.
  const next = onBoard ? Math.max(1, conductorBuff) : conductorBuff + (golden ? 2 : 1) * improveReps;
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  let done = false;
  return src.replace(/\+\d+\/\+\d+/g, (m) => (done ? m : ((done = true), `{{+${stepA * next}/+${stepH * next}}}`)));
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
 * Grim's Deathrattle ("+2/+2 per Deathrattle triggered this game") shows its *current* magnitude from
 * the live run tally — the printed "+2/+2" becomes the real "+N/+N" (N = tally × per × golden), highlighted
 * green. Returns null for non-tally cards or a zero tally (falls back to the printed value).
 *
 * `golden` matters because the factory multiplies by `mul(self)` — a Gilded Grim really does grant double,
 * and rewriting the GOLDEN text keeps the live number honest on a gilded copy (the hard live-text rule).
 */
export function tallyBuffText(cardId: string, deathrattlesTriggered: number, golden = false): string | null {
  if (deathrattlesTriggered <= 0) return null;
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'deathrattleBuffTribeByTally');
  if (!def || !eff) return null;
  const per = Number((eff.params as { per?: number })?.per ?? 1);
  const n = deathrattlesTriggered * per * (golden ? 2 : 1);
  const base = (golden && def.goldenText) || def.text;
  return base.replace(/\*\*\+\d+\/\+\d+\*\*/, `{{+${n}/+${n}}}`);
}

/**
 * Baby Gastrid (ex-Quartermaster Dorrin) — "+N Health per Gold spent this turn" folded into the ACTUAL Health it will grant now.
 *
 * The hard rule (CLAUDE.md): a card whose magnitude depends on live run state prints the number it will really
 * produce, not the rate. At 0 Gold spent the rate is all there is to say, so the printed text stands; once you
 * have spent anything, the total replaces it and the rate moves into the parenthetical so the card still explains
 * itself.
 */
/**
 * Kringle (ex-Closing-Time Foreman) — "+N Attack per card played this turn" folded into the Attack it will really give.
 *
 * Same rule as `perGoldSpentText`: a live magnitude prints the number it produces, not the rate. Nothing played
 * yet means the rate IS the answer, so the printed text stands.
 */
export function perCardPlayedText(cardId: string, cardsPlayedThisTurn: number, golden = false): string | null {
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'endOfTurnBuffLeftmostTribePerCard');
  if (!def || !eff) return null;
  if (cardsPlayedThisTurn <= 0) return null;
  const params = (eff.params ?? {}) as { attack?: number; health?: number };
  const mult = golden ? 2 : 1;
  const perA = Number(params.attack ?? 1) * mult;
  const perH = Number(params.health ?? 0) * mult;
  // BOTH halves. Kringle was rebalanced +1 Attack → +1/+1 → +1/+2 (owner 2026-08-04 / 2026-08-15), but this
  // helper was written for the Attack-only version and never grew a Health term — so the moment you played a
  // card the live text replaced the printed "+1/+2" with "+1 Attack" and the Health silently vanished from the
  // card (owner report 2026-08-26). It reads the effect's params now, so a future reprice needs no edit here.
  const rate = perH > 0 ? `+${perA}/+${perH}` : `+${perA} Attack`;
  const grant = perH > 0 ? `+${perA * cardsPlayedThisTurn}/+${perH * cardsPlayedThisTurn}` : `+${perA * cardsPlayedThisTurn} Attack`;
  // Plain parentheses, no `_italics_` — the Card renderer only knows **bold**, so underscores print literally.
  return `**End of Turn:** give your **left-most Dwarf {{${grant}}}** (${rate} per card played this turn).`;
}

export function perGoldSpentText(cardId: string, goldSpentThisTurn: number, golden = false): string | null {
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'battlecryBuffTargetPerGoldSpent');
  if (!def || !eff) return null;
  if (goldSpentThisTurn <= 0) return null; // nothing spent yet — the printed rate is already accurate
  const per = Number((eff.params as { health?: number })?.health ?? 1) * (golden ? 2 : 1);
  const total = per * goldSpentThisTurn;
  return `**Shout:** give a friendly minion **{{+${total} Health}}** (+${per} per Gold spent this turn).`;
}

/**
 * Rope Wrangler: End of Turn casts its spell 1 + ⌊Gold spent this turn / perGold⌋ times (× golden), capped at
 * `maxCasts`. The count depends on live turn state (Gold spent this turn is on the text-rule list), so append
 * the current cast count in green. Generic over the `castSpell` effect with a `perGold` param.
 */
export function castSpellPerGoldText(cardId: string, goldSpentThisTurn: number, golden = false): string | null {
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'castSpell' && (e.params as { perGold?: number } | undefined)?.perGold);
  if (!def || !eff) return null;
  const p = eff.params as { perGold?: number; maxCasts?: number } | undefined;
  const perGold = Math.max(1, Number(p?.perGold ?? 6));
  const maxCasts = Number(p?.maxCasts ?? 0);
  let n = (1 + Math.floor(Math.max(0, goldSpentThisTurn) / perGold)) * (golden ? 2 : 1);
  if (maxCasts > 0) n = Math.min(maxCasts, n);
  const src = golden ? (def.goldenText ?? def.text) : def.text;
  return `${src} {{Casts ${n}× now.}}`;
}

export interface StepProgress {
  current: number;
  total: number;
  /** When set, the counter renders THIS text instead of "current/total" (e.g. cadence → "2 Turns"). `current`
   *  still drives the keyed re-bump + the shop hide-at-0 gate, so keep it the value that changes per tick. */
  label?: string;
}

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
  p: { spellProgress?: number; summonBonus?: number; ascendProgress?: number; eotTick?: number; attackSeen?: number; avengeSeen?: number; bleedAttacks?: number; goldTick?: number; buyTick?: number; playTick?: number; shoutTick?: number; soldProgress?: number; grimoireCharged?: boolean; orbitTick?: number; rubyCastTick?: number },
): StepProgress | null {
  const def = CARD_INDEX[cardId];
  if (!def) return null;
  const n = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);
  const cyc = (v: number, total: number): StepProgress => ({ current: v <= 0 ? 0 : ((v - 1) % total) + 1, total });

  // Living Grimoire: the Shout meter toward its next charge (owner ask 2026-07-24 — 0/3 once SPENT, counting up
  // to 3). While CHARGED there is no counter at all (owner correction: a 3/3 read as a meter you still had to
  // fill, when in fact the card was ready) — the meter appears only once the charge is used, which is exactly
  // when it carries information.
  //
  // Because the counter now UNMOUNTS on recharge rather than landing on `total`, it can't drive Card's built-in
  // step-proc burst; the "ready again" flourish is fired separately in `Card` off the counter disappearing.
  const rearm = def.effects.find((e) => e.do === 'onBattlecryRearmGrimoire');
  if (rearm) {
    if (p.grimoireCharged) return null; // charged = ready = nothing to show
    const total = Math.max(1, n((rearm.params as { every?: number })?.every, 3));
    return { current: Math.min(p.shoutTick ?? 0, total), total };
  }

  if (def.effects.some((e) => e.do === 'spellCastBuffOthers')) return cyc(p.spellProgress ?? 0, 4); // Guel
  const monk = def.effects.find((e) => e.do === 'overflowBuffRandom');
  if (monk) return cyc(p.summonBonus ?? 0, Math.max(1, n((monk.params as { improveEvery?: number })?.improveEvery, 5)));
  const crypt = def.effects.find((e) => e.do === 'onAllyAttackBuffAll');
  if (crypt) return cyc(p.attackSeen ?? 0, Math.max(1, n((crypt.params as { every?: number })?.every, 2)));
  // Frontdrake / Money Maker / Vineweaver: cadence ticks at END OF TURN, so it's a SHOP-phase counter —
  // `eotTick` is undefined in combat (Unit.tsx passes no eotTick), where the cadence is irrelevant, so we
  // return null there (no combat counter), mirroring `goldSpent` below. The recruit path always passes it.
  const cadence = def.effects.find((e) => e.on === 'endOfTurn' && (e.params as { every?: number } | undefined)?.every !== undefined);
  if (cadence) {
    if (p.eotTick === undefined) return null; // combat: cadence is irrelevant, no counter
    const every = Math.max(1, n((cadence.params as { every?: number })?.every, 3));
    // Countdown of TURNS until the effect next fires (not an X/N progress bar): every=2 reads "2 Turns" fresh,
    // ticks to "1 Turn" at end of turn, fires, resets to "2 Turns". `toNext` is 1..every (never 0), so the shop
    // hide-at-0 gate always shows it. Keyed re-bump rides `current = toNext` (flips each turn).
    const toNext = every - (p.eotTick % every);
    return { current: toNext, total: every, label: `${toNext} Turn${toNext === 1 ? '' : 's'}` };
  }
  // CELESTIAL Orbit (N) / "after N Orbits" (audit 2026-08-06 — Star Cartographer, Worldseed Gardener,
  // Orrery, Astral Shopkeeper shipped with a bare cadence and no counter). `orbitTick` is the per-instance
  // meter the sim keeps (0..N-1, reset on payout), a SHOP-phase accrual: undefined in combat (nothing is
  // played there), where we show no counter — same rule as the End-of-Turn cadences below.
  const orbit = def.effects.find((e) => (e.on === 'orbit' || e.on === 'orbitFired') && (e.params as { every?: number } | undefined)?.every !== undefined);
  if (orbit) {
    if (p.orbitTick === undefined) return null;
    return cyc(p.orbitTick, Math.max(1, n((orbit.params as { every?: number }).every, 3)));
  }
  // Avenge (Solaris, Soulsman, Bone Taxer, Brood Matron, …): the Avenge re-fires every N FRIENDLY deaths (the sim
  // gates on `count % threshold === 0`), so it's a cyclic 1..N counter driven by that side's running death tally.
  // Shows on the board too (`avengeSeen` is undefined outside a fight → 0/N), so a shop unit advertises its Avenge
  // threshold; it ticks up in combat as your units die.
  const avenge = def.effects.find((e) => e.on === 'avenge');
  if (avenge) return cyc(p.avengeSeen ?? 0, Math.max(1, n((avenge.params as { count?: number })?.count, 2)));
  // Bloodbinder: the armed Bleed fires every N GLOBAL combat attack swings (either side). Shows 0/N on the board, ticks in combat.
  const bleed = def.effects.find((e) => e.do === 'scArmBleed');
  if (bleed) return cyc(p.bleedAttacks ?? 0, Math.max(1, n((bleed.params as { every?: number })?.every, 4)));
  // Gold-meter payoffs re-fire every N Gold SPENT while on the board (the `goldTick` meter). SHOP-phase —
  // `goldTick` is a recruit accrual (undefined in combat, where no Gold is spent), so it shows on the shop board.
  const goldSpent = def.effects.find((e) => e.on === 'goldSpent' && (e.params as { every?: number } | undefined)?.every !== undefined);
  if (goldSpent) return p.goldTick === undefined ? null : cyc(p.goldTick, Math.max(1, n((goldSpent.params as { every?: number })?.every, 7)));
  // Gemgorge Fiend: its Consume re-fires every N spell+Ruby casts witnessed WHILE ON THE BOARD — a
  // per-instance meter (`rubyCastTick`), so a freshly bought copy reads 0/3 instead of inheriting the run.
  const rubyCast = def.effects.find((e) => e.on === 'rubyCast');
  if (rubyCast) return cyc(p.rubyCastTick ?? 0, Math.max(1, n((rubyCast.params as { every?: number })?.every, 3)));
  // Korok / Banksly: their payoff re-fires every N cards BOUGHT while on the board (the `buyTick` meter) —
  // the buy-count sibling of the Gold meter, likewise a shop-phase accrual (undefined in combat).
  const bought = def.effects.find((e) => e.on === 'cardsBought' && (e.params as { every?: number } | undefined)?.every !== undefined);
  if (bought) return p.buyTick === undefined ? null : cyc(p.buyTick, Math.max(1, n((bought.params as { every?: number })?.every, 4)));
  // Hellrider: the REFRESH meter. Its tally rides `eotTick` (see `onShopRefreshGainRightmostShopStats`), so this branch
  // must come before the End-of-Turn cadence one would otherwise claim that field — the two are different
  // triggers sharing one counter.
  const refreshed = def.effects.find((e) => e.on === 'shopRefreshed' && (e.params as { every?: number } | undefined)?.every !== undefined);
  if (refreshed) {
    if (p.eotTick === undefined) return null; // combat: refreshes are irrelevant
    const every = Math.max(1, n((refreshed.params as { every?: number })?.every, 4));
    const toNext = every - (p.eotTick % every);
    return { current: toNext, total: every, label: `${toNext} Refresh${toNext === 1 ? '' : 'es'}` };
  }
  // Runic Archivist: the minions-SOLD meter. Its tally already rides the card as `soldProgress`, and the
  // printed text already counts down — but with no counter the card gave no at-a-glance read of how close the
  // payoff was, which every other every-N card on the board has (owner ask 2026-08-04).
  //
  // Unlike the meters above, `soldProgress` is stored ALREADY REDUCED (`% every`, see `minionSoldGrantSpell`),
  // so it is used directly rather than through `cyc` — wrapping a pre-wrapped value would turn a fresh 0 into
  // a phantom reading. A shop-phase accrual, so no counter in combat, matching the gold/buy/play meters.
  const sold = def.effects.find((e) => e.on === 'minionSold' && (e.params as { count?: number } | undefined)?.count !== undefined);
  if (sold) {
    if (p.soldProgress === undefined) return null; // combat: you cannot sell mid-fight
    const total = Math.max(1, n((sold.params as { count?: number })?.count, 5));
    return { current: p.soldProgress % total, total };
  }
  // Mountainbond: the cards-PLAYED meter (`playTick`), the twin of the buy meter above. Added with the
  // `cardsPlayed` event (2026-07-29) — without this branch its "after you play 8 cards" printed a static 8 with
  // no indication of progress, which is exactly what the live-value rule forbids.
  const played = def.effects.find((e) => e.on === 'cardsPlayed' && (e.params as { every?: number } | undefined)?.every !== undefined);
  if (played) return p.playTick === undefined ? null : cyc(p.playTick, Math.max(1, n((played.params as { every?: number })?.every, 8)));
  // Any "every N SPELLS" card — Baal's Demon consume (every 2), High King Mykel's adjacent-Shout trigger
  // (every 8). Rides the per-instance `spellProgress` meter the factories tick. Written GENERICALLY, keyed on
  // the trigger + an `every` param rather than on a card id, so the next every-N-spells card gets its counter
  // for free; before this branch existed BOTH of these printed a static threshold with no sign of progress,
  // which is exactly what the live-value rule forbids. Guel is unaffected — its own `spellCastBuffOthers`
  // branch is matched earlier.
  const perSpell = def.effects.find((e) => e.on === 'spellCast' && (e.params as { every?: number } | undefined)?.every !== undefined);
  if (perSpell) return cyc(p.spellProgress ?? 0, Math.max(1, n((perSpell.params as { every?: number })?.every, 2)));
  const pup = def.effects.find((e) => e.do === 'spellCastTransform');
  if (pup) { const at = Math.max(1, n((pup.params as { at?: number })?.at, 10)); return { current: Math.min(p.spellProgress ?? 0, at), total: at }; }
  if (def.ascendAt && def.ascendInto) { const at = def.ascendAt; return { current: Math.min(p.ascendProgress ?? 0, at), total: at }; }
  return null;
}

/**
 * Mage-Pup: its Shout casts whatever spell Moonhowl Mentor TAUGHT it, so the printed line must name that
 * spell's actual rule rather than the placeholder "cast the spell this was taught" — which tells the player
 * nothing about what clicking it will do (owner 2026-07-24). The spell id rides on the instance
 * (`taughtSpellId`), so this can only resolve for a real Pup in hand / on the board; an untaught token (or a
 * Compendium preview, which has no instance) falls back to the printed text.
 *
 * `spellText` is the taught spell's OWN live text, passed in already resolved — the Pup inherits the spell's
 * scaling (spell power, per-turn escalation, …) rather than restating a stale base, per the live-text rule.
 */
export function taughtSpellText(cardId: string, taughtSpellId: string | undefined, spellText: string): string | null {
  if (cardId !== 'b2_magepup' || !taughtSpellId) return null;
  const spell = CARD_INDEX[taughtSpellId];
  if (!spell?.spell) return null;
  // Name the spell as well as its rule: the name is how the player recognises what they bought, and the rule
  // is what it does. Mirrors how the shop reads a spell.
  return `**Shout:** cast **${spell.name}** — ${spellText}`;
}

/**
 * Sunmane Herald: a rally carrier grants its printed base PLUS everything it has accumulated, so the printed
 * "+3" understates it the moment the buff has spread. Prints what this body will actually grant next, green via
 * `{{…}}` once it exceeds the base — the live-text rule applied to a value that lives on the combat instance.
 *
 * Returns null in the shop (nothing accumulated yet), so that falls back to the printed text.
 */
export function rallySpreadText(cardId: string, golden: boolean, rallySpreadAtk?: number): string | null {
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'rallySpreadTribeBuff');
  if (!eff || !rallySpreadAtk) return null;
  const base = ((eff.params as { attack?: number } | undefined)?.attack ?? 3) * (golden ? 2 : 1);
  const grant = base + rallySpreadAtk; // what the next rally attack actually hands out
  const src = golden ? (def!.goldenText ?? def!.text) : def!.text;
  return src.replace(`+${base} Attack`, `{{+${grant} Attack}}`);
}
