/**
 * DOC BOT — the QUEST/RUNE COMBAT-MOD differential (the `combatModLane` lane), shared by `combatModLane.test.ts` and the
 * CLI.
 *
 * Found by RETRO-VALIDATION (2026-08-26): reinjecting seven out-of-sample historical bugs showed Doc Bot
 * caught NONE of them, and three of the seven lived in one uncovered surface — `QuestCombatMods`, the 135
 * flags/objects a run's quests and runes thread into `simulate()`. No lane exercised ANY of them: Rune of
 * Aftershocks over-firing per watcher (#941), Sable's Soulbind matching the wrong uid and doing nothing
 * (#832), and Rune of the Undertow warding unbounded (#932) were all invisible.
 *
 * The lane: for every mod key, run the same staged fight WITH the mod armed and WITHOUT, and demand the
 * fight change. Arm values come from a small shape table (booleans, counts, and the handful of object
 * shapes); a mod the scenario can't reach lands in the INERT queue with the others — verified-reachable
 * questions, never silence. Two magnitude RIDERS cover the shipped cap/count classes:
 *   · Undertow: warded bodies ≤ its cap.
 *   · Aftershocks: pays once per Echo TRIGGER (one dying echo body ⇒ one pulse), not per watcher.
 * And one CLASS rider over every mod key:
 *   · Summon-return parity (R-SUMMON-RETURN-01): a mod that changes the body of a plain combat SUMMON must change
 *     a Rise / Rebirth RETURN of the same card too — a return IS a summon. Rune of the Undertow (and Hatchery,
 *     Packcraft) shipped deaf to returns because their grants lived on the summon-only path (owner 2026-10-06).
 */
import { CARD_INDEX, EPIC_RUNES, QUEST_DEFS, RUNES } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type QuestCombatMods } from '@game/core';

const bm = (cardId: string, uid: string, attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords } as unknown as BoardMinion);

/** A rich fight: an echo body that dies, a beast that attacks and kills, deaths on both sides, summons,
 *  multiple tribes — so trigger-keyed mods have something to key on. */
function fight(mods: QuestCombatMods): string { return fightCore([], mods); }

function fightCore(extras: BoardMinion[], mods: QuestCombatMods): string {
  const echoer = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token
    && c.effects.some((e) => e.on === 'onDeath' && e.do === 'deathrattleSummon' && !(e.params as { fixed?: boolean }).fixed))!;
  // A RALLY body (real on-attack effect, so rally-repeat mods have a subject), a SLAUGHTER body (on-kill),
  // and a self-buffing attacker (so Soulbind has a stat GAIN to mirror across pS1/pS2).
  const rally = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token
    && c.effects.some((e) => e.on === 'onAttack'))!;
  const slaughterer = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token
    && c.effects.some((e) => e.on === 'onKill'))!;
  const selfBuff = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token
    && c.effects.some((e) => e.on === 'onAttack' && /Self|self/.test(e.do)))!;
  const player: BoardMinion[] = [
    bm(echoer.id, 'pS0', 1, 1),
    bm(selfBuff.id, 'pS1', 3, 5, [...selfBuff.keywords]),
    bm('cryptwolf', 'pS2', 3, 4),
    bm(rally.id, 'pS3', 3, 5, [...rally.keywords]),
    bm(slaughterer.id, 'pS4', 4, 4, [...slaughterer.keywords]),
    ...extras,
  ];
  const enemy: BoardMinion[] = [
    bm('pup', 'e0', 1, 1),
    bm('nanobot', 'e1', 4, 5),
    bm('cryptwolf', 'e2', 5, 7),
  ];
  const r = simulate(player, enemy, makeRng(0x30d5), CARD_INDEX,
    combatSide({ tier: 5, tribes: ['beast', 'demon', 'dragon', 'dwarf', 'kobold'] as never, questMods: mods }),
    combatSide({ tier: 5 }));
  return JSON.stringify({ events: r.events, result: r.result, playerDamage: r.playerDamage, rest: { ...r, events: undefined, initial: undefined } });
}

/** Arm values for the object-shaped mods; everything else tries `true` then a small number. */
const OBJECT_ARMS: Record<string, unknown> = {
  beastSummonScale: { per: 1, stepAttack: 2, stepHealth: 2, progress: 0 },
  bladeMastery: { attacks: 0 },
  hoard: { attack: 2, health: 2 },
  soulbind: { a: 'pS1', b: 'pS2' }, // sourceUids of two fixture bodies — the #832 matching rule
  flashPick: 'first',
  tribeRallySlaughterExtra: 'beast',
  flagCopies: { runeGemstorm: 2 },
  solidGroundStat: 2,
  beastialSwarmLevel: 1,
  packcraftLevel: { attack: 2, health: 1 },
  runeHatchery: { attack: 5, health: 5 },        // the summon-body grant (owner balance 2026-09-23); `true` armed it as NaN       // Rune of Packcraft's live per-summon grant (owner rework 2026-09-23)
  runeReinvestment: { attack: 3, health: 4 },    // the per-summon Shop buff (owner balance 2026-09-23; was a number)
  warDrumExtra: 2,       // the unspent War Drum charge's multiplier (a count, not a flag)
  shoutDoubleCharges: 2, // remaining Warm Embers charges (a count, not a flag)
  encoreExtra: 1,        // Demand an Encore's turn-long Shout extras (R-TURN-01; a count, not a flag)
  shoutExtraAlways: 1,   // Rune of the Choir & co.: the permanent Shout extras (R-SHOUT-TRIGGER-01; a count)
  warmEmbersFirst: 1,    // Warm Embers / Opening Act: this fight's own first-Shout double (R-SHOUT-01; a count)
  shoutEdgeBuff: { attack: 2, health: 2 },                    // Twin Sun Oath on a combat Shout (R-SHOUT-TRIGGER-01)
  shoutEdgeTribeBuff: { tribe: 'beast', attack: 2, health: 2 }, // Drake Skull on a combat Shout (the fixture's Pennycat is a Beast)
  runeHeldStrength: { attack: 3, health: 3, copies: 1 }, // the captured left-most-hand-card stats (owner rework 2026-08-27)
  shoutMeters: [{ sourceId: 'rune_chorus', per: 1, tick: 0, grantSpell: 1 }], // balance 9/23: the cross-phase Shout tally — pays a hand grant on a combat Shout
  ancientUndying: { uids: ['pS1'], war: true, regainRise: true, label: 'Ancient of War' }, // Risen x Death / War: the Undying body by sourceUid
  ancientSummonExtra: 1, // Risen x Genesis: extra copies per combat summon (a count, not a flag)
  ancientXeroxAvenge: { every: 1, tick: 0, label: 'Ancient of Death' }, // Xerox x Death: Avenge (1) so the staged deaths copy
  ancientXeroxBond: { a: 'pS1', b: 'pS2', label: 'Ancient of Bonds' }, // Xerox x Bonds: the Soulbind fixture pair (sourceUids)
  ancientRefreshAvenge: { every: 1, tick: 0, flag: 'ancientRefreshAvenge', label: 'Ancient of Death' }, // Tradesman x Death: Avenge (1) so the staged deaths bank Refreshes
  ancientRallyGold: { gold: 1 }, // Tradesman x War: the Rally graft for bodies summoned mid-fight
  ancientSummonGain: { attack: 3, health: 2, label: 'Ancient of Death' }, // Robin x Death: the per-summon gain (staged Echo summons take it)
  ancientLastDeathCopy: { label: 'Ancient of Death' }, // Re-Pete x Death: the staged fight's last friendly death comes home as a toHand
  ancientGorrAvenge: { every: 1, tick: 0, ids: ['pup'], label: 'Ancient of Death' }, // Gorr x Death: Avenge (1) so the staged deaths each send a last-turn buy to hand
  ancientPummelCopy: { every: 1, dealt: 0, label: 'Ancient of War' }, // Gorr x War: Pummel (1) so the staged hits send copies to hand
  ancientBramDeaths: { every: 1, tick: 0, label: 'Ancient of Death' }, // Braum x Death: every (1) staged death sends a random (gilded-at-settle) minion to hand
  ancientSocBuffAll: { attack: 8, health: 8, label: 'Ancient of War' }, // Braum x War: the pre-multiplied Start-of-Combat grant to every friendly minion
  ancientPummelCharge: { every: 1, dealt: 0, flag: 'ancientSwapCharge', label: 'Ancient of War' }, // Darah x War: Pummel (1) so the first staged hit pays a flagged Swap charge
  ancientMaxGoldAvenge: { every: 1, tick: 0, gold: 1, flag: 'ancientMaxGoldAvenge', label: 'Ancient of Death' }, // Nadja x Death: Avenge (1) so each staged death floats +1 max Gold
  ancientSocRally: { attack: 3, label: 'Ancient of War' }, // Nadja x War: the left-most staged body gains the Rally graft
  ancientBrackusAvenge: { every: 1, tick: 0, attack: 6, health: 6, flag: 'ancientSummitAvenge', label: 'Ancient of Death' }, // Brackus x Death: Avenge (1) so the staged deaths pulse (the hand / Shop payout flag)
  ancientSummitCopy: { label: 'Ancient of War' }, // Brackus x War: needs a Tier 7 on the board (staged via TIER7_STAGE_KEYS)
  ancientSummonsAttack: { count: 3, label: 'Ancient of War' }, // Rayse x War: the staged Echo's summons strike on landing
  ancientSummonBuffOthers: { count: 2, attack: 3, health: 3, label: 'Ancient of Bonds' }, // Rayse x Bonds: each staged summon buffs 2 others
  ancientSproutAvenge: { every: 1, tick: 0, cardId: 'raysesprout', size: 1, flag: 'ancientSprout', label: 'Ancient of Death' }, // Rayse x Death: Avenge (1) so each staged death summons a Sprout
  ancientAvengePulse: { every: 1, tick: 0, flag: 'ancientCommissionAdvance', label: 'Ancient of Death' }, // Cassen x Death: Avenge (1) so each staged death pulses
  ancientSocRandomBuffs: { reps: 2, attack: 1, health: 1, label: 'Ancient of War' }, // Drakko x War: two Start-of-Combat steps
  ancientShoutBuffsCard: { cardId: 'alley', attack: 2, health: 2, label: 'Ancient of Bonds' }, // Drakko x Bonds: the staged Shout body stands in for Drakko (SHOUT_STAGE_KEYS)
  ancientFlash: { second: true, soc: true, exact: true, pummel: { every: 1, dealt: 0 }, label: 'Ancient of Time' }, // Flash: the Start-of-Combat copy acts on any fight
  ancientReclaim: { echoExtra: 1, copies: 2, gain: 10, bonds: true, label: 'Ancient of Death' }, // Soren x Death / Time / War / Bonds: acts only on a Reclaim-marked body (none staged: inert)
  // The next-combat banks that became per-side mods on 2026-10-07 (Fleeting Vigor, the banked keywords, Open the Gates):
  fleetingVigor: { attack: 2, health: 2 },
  bankedKeywords: [{ index: 0, keyword: 'DS' }],
  bankedImps: 2,
};

export interface ModScanResult { changed: string[]; inert: string[]; errored: string[]; stagedActive: string[] }

/** Cards the mod's OWNING rune/quest names in its printed text — matched against CARD_INDEX names, so a mod
 *  like `runeSylus` ("your Sylus double their Health…") gets a Sylus staged before it is called inert.
 *  Born from the owner audit 2026-08-26: the first cut queued 63 "inert" mods, most of which simply needed
 *  the card their rune is ABOUT. */
export function namedCardsFor(key: string): string[] {
  const all = [...RUNES, ...EPIC_RUNES, ...QUEST_DEFS] as { id: string; reward?: unknown; text?: string }[];
  const owner = all.find((r) => JSON.stringify(r.reward ?? {}).includes(`"${key}"`))
    ?? all.find((r) => r.id.replace(/^rune_/, '').replace(/_/g, '').toLowerCase() === key.replace(/^rune/, '').toLowerCase());
  if (!owner?.text) return [];
  const text = owner.text.replace(/\*\*/g, '');
  const ids: string[] = [];
  for (const c of Object.values(CARD_INDEX)) {
    if (!c || c.spell || !c.name || c.name.length < 4) continue;
    if (text.includes(c.name) && !ids.includes(c.id)) ids.push(c.id);
  }
  return ids.slice(0, 2);
}

/** Mods that only act when a Shout is TRIGGERED IN COMBAT — the generic fight stages none. The pair: a tanky
 *  Pennycat (Battlecry: summon a Stray) beside a fragile Ryme (Echo: re-fire neighbours' Battlecries), so the
 *  carried War Drum / Warm Embers charges (owner ruling 2026-08-26) have a combat Shout to land on. */
const SHOUT_STAGE_KEYS = new Set(['ancientShoutBuffsCard', 'warDrumExtra', 'shoutDoubleCharges', 'encoreExtra', 'shoutExtraAlways', 'warmEmbersFirst', 'shoutEdgeBuff', 'shoutEdgeTribeBuff', 'shoutMeters']);
const shoutStageBodies = (): BoardMinion[] => [bm('alley', 'pW0', 1, 30), bm('ryme', 'pW1', 1, 1, ['T'])];

/** Mods that only act on a TIER 7 minion (Brackus × War copies one); the generic fight has none. Stages one sturdy
 *  Tier 7 body (the first in card order, so the pick is stable). */
const TIER7_STAGE_KEYS = new Set(['ancientSummitCopy']);
const tier7StageBodies = (): BoardMinion[] => {
  const t7 = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby && c.tier === 7);
  return t7 ? [bm(t7.id, 'pT7', Math.max(1, t7.attack), Math.max(10, t7.health))] : [];
};

export function combatModScan(keys: readonly string[]): ModScanResult {
  const baseline = fight({});
  const changed: string[] = [];
  const inert: string[] = [];
  const errored: string[] = [];
  const stagedActive: string[] = [];
  for (const key of keys) {
    const arms: unknown[] = key in OBJECT_ARMS ? [OBJECT_ARMS[key]] : [true, 4];
    let verdict: 'changed' | 'inert' | 'errored' | 'staged' = 'inert';
    for (const arm of arms) {
      try {
        if (fight({ [key]: arm } as QuestCombatMods) !== baseline) { verdict = 'changed'; break; }
      } catch {
        verdict = 'errored';
      }
    }
    if (verdict === 'inert') {
      // Second chance: stage the trigger the mod needs — a combat-triggered Shout for the carry-over pair,
      // else the cards the mod's own rune names — then re-test.
      const named = SHOUT_STAGE_KEYS.has(key) || TIER7_STAGE_KEYS.has(key) ? [] : namedCardsFor(key);
      if (TIER7_STAGE_KEYS.has(key)) {
        try {
          const armedArm = key in OBJECT_ARMS ? OBJECT_ARMS[key] : true;
          if (fightWith(tier7StageBodies(), { [key]: armedArm } as QuestCombatMods) !== fightWith(tier7StageBodies(), {})) verdict = 'staged';
        } catch { /* keep inert */ }
      }
      if (SHOUT_STAGE_KEYS.has(key)) {
        try {
          const armedArm = key in OBJECT_ARMS ? OBJECT_ARMS[key] : true;
          if (fightWith(shoutStageBodies(), { [key]: armedArm } as QuestCombatMods) !== fightWith(shoutStageBodies(), {})) verdict = 'staged';
        } catch { /* keep inert */ }
      }
      if (named.length) {
        const extras = named.map((id, n) => {
          const d = CARD_INDEX[id]!;
          return bm(id, `pN${n}`, Math.max(1, d.attack), Math.max(4, d.health));
        });
        try {
          const armedArm = key in OBJECT_ARMS ? OBJECT_ARMS[key] : true;
          if (fightWith(extras, { [key]: armedArm } as QuestCombatMods) !== fightWith(extras, {})) verdict = 'staged';
        } catch { /* keep inert */ }
      }
    }
    (verdict === 'changed' ? changed : verdict === 'staged' ? stagedActive : verdict === 'errored' ? errored : inert).push(key);
  }
  return { changed, inert, errored, stagedActive };
}

/** The staged fight with extra named bodies appended to the player side. */
function fightWith(extras: BoardMinion[], mods: QuestCombatMods): string {
  return fightCore(extras, mods);
}

/** The mod keys, parsed from the QuestCombatMods interface source by the TEST (node-side) and passed in —
 *  the scan itself stays fs-free so it can ride the public entrypoint for the CLI. The CLI re-derives keys
 *  the same way. */
export function undertowRider(): { warded: number; cap: number } {
  const echoer = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token
    && c.effects.some((e) => e.on === 'onDeath' && e.do === 'deathrattleSummon'))!;
  // A summon cascade under Undertow: many tokens arrive; the cap must hold.
  const player: BoardMinion[] = [bm(echoer.id, 'p0', 1, 1), bm(echoer.id, 'p1', 1, 1), bm(echoer.id, 'p2', 1, 1), bm(echoer.id, 'p3', 1, 1)];
  const enemy: BoardMinion[] = [bm('cryptwolf', 'e0', 6, 40)];
  const r = simulate(player, enemy, makeRng(7), CARD_INDEX,
    combatSide({ tier: 5, questMods: { runeUndertow: true } as QuestCombatMods }),
    combatSide({ tier: 5 }));
  // Warded = summon events whose minion arrives with a shield (the Undertow grant path).
  const warded = r.events.filter((e) => {
    const ev = e as { type?: string; minion?: { keywords?: string[]; divineShield?: boolean } };
    return ev.type === 'summon' && (ev.minion?.divineShield || ev.minion?.keywords?.includes('DS'));
  }).length;
  return { warded, cap: 4 };
}

/** #941's exact shape: a PLAIN body dies while rattle-bodies stay alive. Their Echoes did not trigger, so
 *  Aftershocks must pay nothing — the shipped bug paid once per living rattle-WATCHER per death. Measured as
 *  the attack delta on a surviving sentinel between armed and unarmed runs. */
export function aftershocksRider(): { survivorAttackDelta: number } {
  const echoer = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token
    && c.effects.some((e) => e.on === 'onDeath' && e.do === 'deathrattleSummon'))!;
  const run = (armed: boolean): number => {
    const player: BoardMinion[] = [
      bm('pup', 'p0', 1, 1),               // the plain body that dies
      bm(echoer.id, 'p1', 1, 25),          // living rattle-watchers — their Echo must NOT count as triggered
      bm(echoer.id, 'p2', 1, 25),
      bm('cryptwolf', 'p3', 2, 30),        // the sentinel whose attack we read
    ];
    const enemy: BoardMinion[] = [bm('nanobot', 'e0', 3, 3)];
    const r = simulate(player, enemy, makeRng(11), CARD_INDEX,
      combatSide({ tier: 5, questMods: armed ? ({ runeAftershocks: true } as QuestCombatMods) : {} }),
      combatSide({ tier: 5 }));
    // Count Aftershocks pulses by their attributed events — proven detection: the reinjected #941 bug
    // (wrap per WATCHER) produced a delta of 16 here where the correct engine produces 0.
    return r.events.filter((e) => /aftershock/i.test(JSON.stringify(e))).length;
  };
  return { survivorAttackDelta: run(true) - run(false) };
}

/** The body a summon / return arrives as — what a "summoned in combat" grant writes to. */
type Arrival = { attack: number; health: number; keywords: string[] } | null;
const arrivalOf = (r: { events: readonly unknown[]; initial: { player: readonly { uid: string }[] } }, type: 'summon' | 'reborn'): Arrival => {
  const mine = new Set(r.initial.player.map((m) => m.uid));
  for (const e of r.events) {
    const ev = e as { type?: string; side?: string; source?: string; target?: string; minion?: { attack: number; health: number; keywords?: string[] }; attack?: number; hp?: number; keywords?: string[] };
    // The summon the fixture's OWN Echo made (sourced to the dying starter) — not a token some mod adds itself.
    if (type === 'summon' && ev.type === 'summon' && ev.side === 'player' && ev.minion && !!ev.source && mine.has(ev.source)) {
      return { attack: ev.minion.attack, health: ev.minion.health, keywords: [...(ev.minion.keywords ?? [])].sort() };
    }
    if (type === 'reborn' && ev.type === 'reborn' && !!ev.target && mine.has(ev.target)) {
      return { attack: ev.attack ?? 0, health: ev.hp ?? 0, keywords: [...(ev.keywords ?? [])].sort() };
    }
  }
  return null;
};

/**
 * Mods that change a SUMMONED body but rightly leave a Rise / Rebirth return alone — each with its reason. A mod
 * belongs here only when its own text scopes it to something a return is not (an Echo's summons, a named token).
 */
export const SUMMON_RETURN_EXEMPT: Record<string, string> = {
  ancientRallyGold: 'Tradesman x War grafts its Rally onto bodies summoned mid-fight; a RETURNING body was on the board, '
    + 'so it already carries the graft from the Shop (`grantedEffects`) and keeps its effects through the return. The '
    + 'fixture body has no Shop graft, which is all this rider sees.',
};

/**
 * R-SUMMON-RETURN-01 — the summon-return PARITY rider. For every mod key: arm it, and compare (a) the body of a
 * plain combat summon (Burial Imp dies; its Imp lands) and (b) the body of an Imp that RISES and one that is
 * REBORN, each against the unarmed fight. A mod that changes (a) but leaves (b) untouched is a "summoned in combat"
 * listener that cannot hear a return: the exact shape of the Undertow report (owner 2026-10-06).
 */
export function summonReturnRider(keys: readonly string[]): { violations: string[]; summonGrants: string[] } {
  const enemy = (): BoardMinion[] => [bm('cryptwolf', 'e0', 1, 60)];
  const run = (player: BoardMinion[], mods: QuestCombatMods) => simulate(player, enemy(), makeRng(0x5e7), CARD_INDEX,
    combatSide({ tier: 5, tribes: ['beast', 'demon', 'dragon', 'dwarf', 'kobold'] as never, questMods: mods }),
    combatSide({ tier: 5 }));
  // Burial Imp's Echo summons a plain Imp; the returns are that same Imp card. (Not a Beast: a Beast DEATH feeds
  // Beastial Swarm into later summons, which would blur a summon-grant read with a death-trigger one.)
  const summonFight = (mods: QuestCombatMods) => arrivalOf(run([bm('burialimp', 'p0', 1, 1)], mods), 'summon');
  const riseFight = (mods: QuestCombatMods) => arrivalOf(run([bm('impscrap', 'p0', 1, 1, ['R'])], mods), 'reborn');
  const rebirthFight = (mods: QuestCombatMods) => arrivalOf(run([bm('impscrap', 'p0', 1, 1, ['RB'])], mods), 'reborn');
  const same = (a: Arrival, b: Arrival) => JSON.stringify(a) === JSON.stringify(b);
  const base = { summon: summonFight({}), rise: riseFight({}), rebirth: rebirthFight({}) };
  const violations: string[] = [];
  const summonGrants: string[] = [];
  for (const key of keys) {
    if (key in SUMMON_RETURN_EXEMPT) continue;
    // A FRESH arm per fight: some mods are spent by mutating the mods object (Solid Ground counts down in place).
    const mods = (): QuestCombatMods => ({ [key]: key in OBJECT_ARMS ? structuredClone(OBJECT_ARMS[key]) : true }) as QuestCombatMods;
    try {
      if (same(summonFight(mods()), base.summon)) continue;
      summonGrants.push(key);
      const deaf: string[] = [];
      if (same(riseFight(mods()), base.rise)) deaf.push('Rise');
      if (same(rebirthFight(mods()), base.rebirth)) deaf.push('Rebirth');
      if (deaf.length) violations.push(`${key} (deaf to ${deaf.join(' + ')})`);
    } catch { /* an arming crash is the main scan's `errored` finding, not this rider's */ }
  }
  return { violations, summonGrants };
}

/**
 * Mods that act on a TRUE death but rightly stay quiet on a Rise / Rebirth death — each with its reason. Only a
 * mod whose own text scopes it to something a returning body is not (a graveyard, an emptied board) belongs here.
 * Also here: mods that move the fixture's window itself rather than listen to the death. (The fixture keeps two
 * sturdy allies alive, so the board-wipe mods never fire in it.)
 */
export const DEATH_RETURN_EXEMPT: Record<string, string> = {
  runeRisingGraves: 'Not a death listener: it grants Rise at Start of Combat, and the fixture body counts as every '
    + 'tribe (so Undead), which turns the "true death" into a Rise death. An already-rising body is skipped, so the '
    + 'return windows read the same.',
  stolenInitiative: 'Not a death listener: the spell inserts an out-of-turn swing after the first enemy attack, '
    + 'which changes the swing that closes the true-death window, not what the death triggers.',
};

/**
 * R-DEATH-RETURN-01 — the death-return PARITY rider, the death side of `summonReturnRider`. For every mod key: arm
 * it, and compare the events between a body's death and the next swing (a TRUE death) against the unarmed fight;
 * then the events between the same body's death and its return when it RISES, and when it is REBORN. A mod that
 * changes the true-death window but neither return window is a death listener that cannot hear a returning death:
 * the exact shape of the Rune of Beastial Swarm report (owner 2026-10-06: "a minion that rises/rebirths should get
 * benefits from beastial swarm"). The dying body counts as every tribe so tribe-gated listeners have a subject.
 */
export function deathReturnRider(keys: readonly string[]): { violations: string[]; deathListeners: string[] } {
  const enemy = (): BoardMinion[] => [bm('sandbag', 'e0', 3, 90000)];
  const body = (kw: string[]): BoardMinion[] => [
    { ...bm('alley', 'p0', 1, 1, kw), universalTribe: true } as BoardMinion,
    bm('alley', 'p1', 0, 9000),
    bm('impscrap', 'p2', 0, 9000),
  ];
  const window = (kw: string[], mods: QuestCombatMods): string => {
    const r = simulate(body(kw), enemy(), makeRng(0xdea7), CARD_INDEX,
      combatSide({ tier: 5, tribes: ['beast', 'demon', 'dragon', 'dwarf', 'kobold'] as never, questMods: mods }),
      combatSide({ tier: 5 }));
    const uid = r.initial.player[0]!.uid;
    const evs = r.events as readonly { type?: string; target?: string }[];
    const d = evs.findIndex((e) => e.type === 'death' && e.target === uid);
    if (d < 0) return '';
    const stop = kw.length === 0
      ? evs.findIndex((e, i) => i > d && e.type === 'attack')
      : evs.findIndex((e, i) => i > d && e.type === 'reborn' && e.target === uid);
    return JSON.stringify(evs.slice(d, stop < 0 ? undefined : stop));
  };
  const base = { die: window([], {}), rise: window(['R'], {}), rebirth: window(['RB'], {}) };
  const violations: string[] = [];
  const deathListeners: string[] = [];
  for (const key of keys) {
    if (key in DEATH_RETURN_EXEMPT) continue;
    const mods = (): QuestCombatMods => ({ [key]: key in OBJECT_ARMS ? structuredClone(OBJECT_ARMS[key]) : true }) as QuestCombatMods;
    try {
      if (window([], mods()) === base.die) continue;
      deathListeners.push(key);
      const deaf: string[] = [];
      if (window(['R'], mods()) === base.rise) deaf.push('Rise');
      if (window(['RB'], mods()) === base.rebirth) deaf.push('Rebirth');
      if (deaf.length) violations.push(`${key} (deaf to ${deaf.join(' + ')})`);
    } catch { /* an arming crash is the main scan's `errored` finding, not this rider's */ }
  }
  return { violations, deathListeners };
}
