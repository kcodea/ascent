/**
 * DOC BOT — the QUEST/RUNE COMBAT-MOD differential (tripwire 16), shared by `combatModLane.test.ts` and the
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
  warDrumExtra: 2,       // the unspent War Drum charge's multiplier (a count, not a flag)
  shoutDoubleCharges: 2, // remaining Warm Embers charges (a count, not a flag)
  encoreExtra: 1,        // Demand an Encore's turn-long Shout extras (R-TURN-01; a count, not a flag)
  runeHeldStrength: { attack: 3, health: 3, copies: 1 }, // the captured left-most-hand-card stats (owner rework 2026-08-27)
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
const SHOUT_STAGE_KEYS = new Set(['warDrumExtra', 'shoutDoubleCharges', 'encoreExtra']);
const shoutStageBodies = (): BoardMinion[] => [bm('alley', 'pW0', 1, 30), bm('ryme', 'pW1', 1, 1, ['T'])];

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
      const named = SHOUT_STAGE_KEYS.has(key) ? [] : namedCardsFor(key);
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