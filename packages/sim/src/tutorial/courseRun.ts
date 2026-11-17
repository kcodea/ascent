/**
 * MID-GAME COURSE RUNS (Learn Ancients, 2026-11-16).
 *
 * Learn Ascent starts on turn 1, so the store builds its run straight from `createTutorialRun`. A course with a
 * `midGame` start instead drops the player into a game already under way: a later wave, a Shop tier, a board, a
 * table with seats already out, and (for Learn Ancients) Ancients on with the meter part filled. This builds that
 * as an ORDINARY `tutorial`-mode RunState, so the reducer, the Shop script, combat and the lobby are the same paths
 * Learn Ascent uses. Nothing here changes how any other run is created.
 */
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState } from '../state';
import { CONFIG } from '../config';
import { rollShop } from '../shop';
import { enableAncients } from '../ancients';
import { createTutorialLobby } from '../lobby/tutorialSeats';
import type { TutorialCourse } from './types';

/** Build the run a `midGame` course starts on. Throws when the course has no mid-game start (a caller bug). */
export function createCourseRun(course: TutorialCourse): RunState {
  const mg = course.midGame;
  if (!mg) throw new Error(`course ${course.id} has no midGame start`);
  const base = createRun(mg.seed, course.heroId, 'tutorial', CONFIG.defaultLine, course.setId as RunState['setId']);
  let run: RunState = { ...base };
  run.tutorialCourseId = course.id;
  run.wave = mg.wave;
  run.tier = mg.tier;
  run.upgradeCost = CONFIG.upgradeCost[mg.tier + 1] ?? 10;
  run.embers = mg.gold;
  run.maxEmbers = mg.gold;
  run.resolve = mg.health;
  run.armor = mg.armor;
  run.board = mg.board.map((m): BoardCard => {
    const def = CARD_INDEX[m.cardId];
    if (!def) throw new Error(`course ${course.id}: unknown card ${m.cardId}`);
    const keywords = [...new Set([...def.keywords, ...((m.addKeywords ?? []) as BoardCard['keywords'])])];
    return { uid: `b${run.uidSeq++}`, cardId: def.id, tribe: def.tribe, attack: m.attack, health: m.health, keywords, golden: false };
  });
  // The scripted Shop is indexed by WAVE (`tutorialShopScript[wave - 1]`), so the authored turns sit at their own
  // wave and every earlier wave is empty. Same for the per-wave combat levers.
  const byWave = <T>(pick: (t: TutorialCourse['turns'][number]) => T, empty: T): T[] => {
    const out: T[] = Array.from({ length: mg.wave - 1 }, () => empty);
    for (const t of course.turns) out[t.turn - 1] = pick(t);
    return out.map((v) => v ?? empty);
  };
  run.tutorialShopScript = byWave((t) => t.shopRolls, [] as { minions: string[]; spell?: string }[]);
  run.tutorialAttackFirst = byWave((t) => !!t.playerAttacksFirst, false);
  run.tutorialForceEnemyTarget = byWave((t) => t.forceEnemyFirstTargetCard ?? '', '');
  if (course.discoverTribe) run.tutorialDiscoverTribe = course.discoverTribe;
  run.tutorialShopRoll = 0;
  run.shop = [];
  rollShop(run); // serves the authored turn-start roll (the tutorial branch of `rollShop`)
  if (mg.ancientPoints !== undefined) {
    run = enableAncients(run);
    run.ancients = { ...run.ancients!, points: Math.min(run.ancients!.cost - 1, mg.ancientPoints) };
  }
  // The table: authored seats (each fields the round's board), the lobby clock on this wave, a few seats already
  // out. `maxRounds` sits past the authored turn so the round the player fights is never the lobby's last (no
  // victory screen: the course ends on its own outro).
  const boards = byWave((t) => t.omenBoard, [] as TutorialCourse['turns'][number]['omenBoard']).map((b, i, all) => (b.length ? b : (all.find((x) => x.length) ?? b)));
  const lobby = createTutorialLobby(mg.seed, course.heroId, boards, course.opponentNames, { maxRounds: mg.wave + 2 });
  lobby.round = mg.wave;
  const me = lobby.seats[0]!;
  me.resolve = run.resolve;
  me.armor = run.armor;
  const opponents = lobby.seats.slice(1);
  const out = Math.min(mg.opponentsOut, opponents.length - 1);
  opponents.forEach((seat, i) => {
    const hero = mg.opponentHeroes?.[i];
    if (hero) seat.heroId = hero;
    const k = i - (opponents.length - out); // 0 = the first seat knocked out (the worst place)
    if (k >= 0) {
      seat.alive = false;
      seat.resolve = 0;
      seat.armor = 0;
      seat.eliminatedRound = mg.wave - out + k;
      seat.placement = lobby.seats.length - k;
      return;
    }
    seat.resolve = mg.opponentHealth[Math.min(i, mg.opponentHealth.length - 1)] ?? seat.resolve;
    seat.armor = 0;
  });
  return { ...run, lobby };
}
