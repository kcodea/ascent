import { combatSide, makeRng, simulate, type BoardMinion, type Keyword } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { buildEnemyBoard, THREAT_IDS } from '../threats';
import type { BotVisibleState } from './types';

/**
 * SCORE A BOARD BY FIGHTING WITH IT.
 *
 * Every hand-written proxy in `evaluate.ts` — stat sums, a keyword value table, a board-width curve — is an
 * attempt to guess the answer to one question: *does this board win?* The engine can answer that question
 * directly, and the measurement says it is cheap enough to just ask:
 *
 *     one full combat   0.017 ms
 *     one reduce()      0.047 ms   ← a single search node already costs 2.7× a fight
 *
 * So a board is scored by playing it against a panel of wave-appropriate opponents and reading the win rate.
 * That replaces the proxies with the thing they were proxying for, and it is why re-weighting them kept
 * failing: a Ward 3/3 beating a vanilla 3/3, a Kennelmaster being worth more beside Beasts, a wide board
 * beating a tall one — none of that has to be encoded, because combat already knows.
 *
 * FAIRNESS. The panel is built from `buildEnemyBoard`, the procedural threat curve — a published rule, the same
 * information the opponent frame shows a player. The bot never fights its ACTUAL pinned opponent, which is
 * hidden and would be reading the future.
 */

/** Threat archetypes to fight, in order. Fewer = faster and noisier. */
const PANEL = THREAT_IDS;

/** Turn the bot's view of its board into combat bodies. */
function toCombatBoard(v: BotVisibleState): BoardMinion[] {
  return v.board.map((c) => ({
    cardId: c.cardId,
    attack: c.attack,
    health: c.health,
    keywords: [...c.keywords] as Keyword[],
    golden: c.golden,
  })) as BoardMinion[];
}

/**
 * A seed derived from the BOARD, not from a call counter.
 *
 * Two evaluations of the same board must produce the same score — otherwise identical search nodes get
 * different utilities, dedup stops working, and the bot's decisions stop being reproducible. Hashing the board
 * gives that for free, and different boards get independent panels rather than all sharing one lucky roll.
 */
function boardSeed(board: readonly BoardMinion[], wave: number): number {
  let h = 2166136261 >>> 0;
  const feed = (n: number): void => { h ^= n >>> 0; h = Math.imul(h, 16777619) >>> 0; };
  feed(wave);
  for (const m of board) {
    feed(m.attack);
    feed(m.health);
    feed(m.cardId.length);
    for (const k of m.keywords ?? []) feed(k.charCodeAt(0));
  }
  return h;
}

export interface FightResult {
  /** Wins ÷ fights, with draws at half. [0, 1]. */
  winRate: number;
  /**
   * The GRADIENT. Average per-fight margin in surviving board power, signed and normalized to [-1, 1]:
   * positive means your side was left standing, negative means theirs was.
   *
   * Win rate alone is unusable as a search signal because it saturates. Measured at wave 7: the bot's full
   * 7-minion board and a deliberately crippled 2-card board BOTH scored 0.00 — every archetype beat both, so
   * the two were indistinguishable and search had nothing to climb. Margin still separates a narrow loss from
   * a rout, which is exactly the information needed to improve a losing board into a winning one.
   */
  margin: number;
  /** Average damage taken per fight, normalized against the round's cap — what losing actually costs. */
  averageDamage: number;
  fights: number;
}

/**
 * Fight this board against `panelSize` wave-appropriate threats.
 *
 * An empty board is an automatic loss and skips the simulation entirely — the common case early in a turn, and
 * worth short-circuiting because it is also the cheapest thing to get right.
 */
export function fightScore(v: BotVisibleState, panelSize = PANEL.length): FightResult {
  const mine = toCombatBoard(v);
  if (mine.length === 0) return { winRate: 0, margin: -1, averageDamage: 1, fights: 0 };

  const seed = boardSeed(mine, v.wave);
  let wins = 0;
  let draws = 0;
  let damage = 0;
  let marginSum = 0;
  const n = Math.max(1, Math.min(panelSize, PANEL.length));
  for (let i = 0; i < n; i++) {
    const threat = PANEL[i % PANEL.length]!;
    const enemy = buildEnemyBoard(threat, v.wave, makeRng(seed + i * 7919));
    const r = simulate(
      mine, enemy, makeRng(seed + i * 104_729), CARD_INDEX,
      combatSide({ tier: v.economy.tier }), combatSide({ tier: v.economy.tier }),
    );
    if (r.result === 'win') wins++;
    else if (r.result === 'draw') draws++;
    damage += r.playerDamage;
    // Surviving power on each side, from the authoritative event log's final state. The difference is how
    // CLOSE the fight was — the signal that survives when every outcome is a loss.
    const survivors = (side: 'player' | 'enemy'): number => {
      const start = side === 'player' ? r.initial.player : r.initial.enemy;
      // A `death` event names its victim by UID (`target`), not by carrying the minion.
      const dead = new Set<string>();
      for (const e of r.events) if (e.type === 'death') dead.add(e.target);
      return start.filter((m) => !dead.has(m.uid)).reduce((n, m) => n + m.attack + m.health, 0);
    };
    const mineLeft = survivors('player');
    const theirsLeft = survivors('enemy');
    marginSum += (mineLeft - theirsLeft) / Math.max(1, mineLeft + theirsLeft);
  }
  // Damage is normalized against a rough per-round cap so it stays on the same scale as the win rate; the exact
  // cap matters less than that a heavy loss reads worse than a narrow one.
  const capish = 6 + v.wave * 1.5;
  return {
    winRate: (wins + draws * 0.5) / n,
    margin: Math.max(-1, Math.min(1, marginSum / n)),
    averageDamage: Math.min(1, damage / n / capish),
    fights: n,
  };
}
