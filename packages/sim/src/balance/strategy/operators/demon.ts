/**
 * B9 — THE DEMON CONSUME OPERATOR (set 2), written off the recorded runs that reached the end-game on it
 * (LazerLemon | darah: two Bob Blarts at wave 4 → 14/16 + 14/9 at w6 → 55/59 + 30/32 at w8 → 219/271 + 115/152
 * at w10 → 6901/9763 at w18; Demon Horse + two Right Hand Hanks beside them from wave 5).
 *
 * THE ENGINE. Bob Blart (`dm_gourmand`, T3) eats the RIGHT-MOST Shop minion at End of Turn — automatically, every
 * turn, for its full buffed stats. What makes the meal grow is everything that buffs the Shop PERMANENTLY:
 *  - Right Hand Hank (T2 3/1): its ECHO adds +3/+2 to the right-most Shop SLOT for the rest of the run, and the
 *    board persists through combat, so a Hank that dies EVERY fight is +3/+2 more per meal per fight — it goes to
 *    the FRONT of the line, to die;
 *  - Demon Horse (T3 3/3 Rally): +1/+2 to every Shop minion, permanently, every time it attacks — second in line;
 *  - Market Tormentor (T4, Shout): +4/+5 to the right-most slot, stacking; Contract Butcher (T3, Shout): +2/+1
 *    to every Shop minion; Enigma (T5): every consume buffs the Shop +2/+1; Soul Defiler (T5): an escalating
 *    End-of-Turn Shop buff.
 * Two Blarts eat two meals; a THIRD makes a golden (double stats per meal + a tier-up Discover). Chipper (T5) eats
 * whenever a Demon is played; Appetite Agent (T2, targeted) and Cupcakes (spell) feed a chosen eater.
 *
 * THE PROCEDURE.
 *  - Tier: T2 at wave 2, T3 at wave 4 (Blart / Horse / Butcher live there), T4 at 6 (Tormentor), T5 at 9, T6 at 11.
 *  - Waves 1–3: one or two cheap Demon bodies (Knocked / Leech / Imp Overseer / Hank); never a body that blocks
 *    the tier-up.
 *  - From wave 4: Blart on sight, every copy; Hank and Horse next; then the Shop-buffers.
 *  - EVERY turn: leave the RIGHT-MOST Shop minion for Blart (it carries the slot buff) — buy from the left of the
 *    row; never end a turn with an empty Shop while a Blart is fielded (roll if there is Gold); aim Agent /
 *    Cupcakes at the biggest Blart; play Demons through Chipper.
 *  - Sell: the early bodies (Knocked, Leech, Overseer, Butcher once shouted) from wave 6 when a Demon engine
 *    piece needs the seat. Never a Blart, a Hank, a Horse or a pair.
 *  - Hero: Darah's Swap trades a filler for a random Shop minion — which carries the Shop buffs.
 *  - Pivot: no Blart / Chipper / Agent by wave 7 → the strategist takes over.
 */
import { CARD_INDEX } from '@game/content';
import type { Action, RunState } from '../../../state';
import type { BotCardView, BotVisibleState } from '../../../productionBots/types';
import { countHeld, isTribe, stats, wantOf, type CardRole, type LineOperator, type TurnMemory, type Want } from './types';

const R = (want: Want, note: string, extra: Partial<CardRole> = {}): CardRole => ({ want, note, ...extra });

const ROLES: Record<string, CardRole> = {
  dm_gourmand: R(3, 'THE engine: End of Turn eats the right-most Shop minion with every Shop buff on it', { core: true }),
  dm_hank: R(3, 'Echo +3/+2 to the right-most slot, permanent, every fight it dies in — front of the line', { diesForward: true }),
  dm_hungerling: R(3, 'Rally: +1/+2 to every Shop minion, permanent, every attack'),
  dm_tormentor: R(3, 'Shout: +4/+5 to the right-most slot, permanent, stacks', { fromWave: 6 }),
  dm_glutton: R(3, 'eats whenever a Demon is played', { fromWave: 8 }),
  dm_jumbo: R(2, 'every consume buffs the Shop +2/+1', { fromWave: 8 }),
  dm_curator: R(2, 'escalating End-of-Turn Shop buff', { fromWave: 8 }),
  dm_butcher: R(2, 'Shout: +2/+1 to the Shop, permanent — bought for the Shout, sold when the seat is needed', { filler: true }),
  dm_agent: R(2, 'targeted eat — aim it at the biggest Blart'),
  dm_velvet: R(2, 'Taunt + a Staff of Guel (Shop +3/+3) on death', { fromWave: 6 }),
  dm_malphas: R(3, 'Shout and Echo: Shop +8/+8', { fromWave: 12 }),
  dm_todd: R(2, 'grows off every Demon hit', { fromWave: 10 }),
  dm_chosenfiend: R(1, 'grows off every Demon hit', { fromWave: 7 }),
  dm_felspikes: R(2, 'Taunt + 4 damage to everything but Demons on death', { fromWave: 9 }),
  dm_grobbus: R(1, 'Avenge: a Demon to hand', { fromWave: 6 }),
  dm_shepherd: R(1, 'Imp lord', { fromWave: 9 }),
  dm_maw: R(2, 'copies the right-most Shop minion every 4 refreshes', { fromWave: 11 }),
  dm_grevlin: R(1, 'sell-fed eater', { fromWave: 11 }),
  dm_knocked: R(1, 'early Taunt body', { filler: true }),
  dm_leech: R(1, 'early body that grows off Demon hits', { filler: true }),
  impoverseer: R(1, 'early Imp body', { filler: true }),
  // Neutral engines the recorded Demon boards carried.
  n2_standardbearer: R(2, 'Rally +3/+3 to one of each type', { fromWave: 5 }),
  n2_lastlight: R(2, 'Echo: Ward to two bodies', { fromWave: 8 }),
  sylus: R(2, 'Echoes twice — Hank echoes twice', { fromWave: 9 }),
  chronos: R(3, 'End of Turn twice — Blart eats twice', { fromWave: 9 }),
  n2_bellringer: R(1, 'a plain copy of its left neighbour every 2 turns', { fromWave: 8 }),
  b2_echohorn: R(1, 'Rally: the left-most Echo (Hank) again', { fromWave: 9 }),
  d2_felconjurer: R(1, 'a Quick Study every turn', { fromWave: 8 }),
  d2_embermouth: R(0, 'the study: 4% survival past wave 6'),
};

/** The biggest fielded eater (Blart first, then Chipper, then any Demon) — where a targeted eat goes. */
function bestEater(v: BotVisibleState): BotCardView | null {
  const blarts = v.board.filter((c) => c.cardId === 'dm_gourmand');
  const pool = blarts.length ? blarts : v.board.filter((c) => c.cardId === 'dm_glutton');
  const demons = pool.length ? pool : v.board.filter((c) => isTribe(c, 'demon'));
  return [...demons].sort((a, b) => stats(b) - stats(a))[0] ?? null;
}

export const DEMON_OPERATOR: LineOperator = {
  id: 'demon',
  packages: ['demonConsume'],
  tribe: 'demon',
  tierByWave: [undefined, undefined, 2, 4, 6, 9, 11],
  roles: ROLES,
  engineIds: ['dm_gourmand', 'dm_glutton', 'dm_hungerling', 'dm_hank', 'dm_tormentor'],
  defaultWant: (cardId, v) => {
    const d = CARD_INDEX[cardId];
    if (!d || d.spell) return 0;
    if (d.tribe === 'demon' || d.tribe2 === 'demon' || d.universalTribe) return v.wave <= 5 ? 1 : d.tier >= 4 ? 1 : 0;
    // An off-tribe body only while the board is being filled.
    return v.wave <= 3 && v.board.length < 2 ? 1 : 0;
  },
  feed: (v: BotVisibleState, _run: RunState, mem: TurnMemory): Action[] => {
    const out: Action[] = [];
    // Cupcakes / Appetite Agent aim at the biggest eater (the aim is answered by `aim`); the skeleton casts
    // `consume` spells through `spellTarget`, so nothing more is needed here. What IS the line's own operation:
    // a Chipper on the board wants Demons PLAYED — hand Demons go down even when a seat must be made.
    if (v.board.some((c) => c.cardId === 'dm_glutton') && v.board.length >= 7) {
      const eaterInHand = v.hand.find((c) => isTribe(c, 'demon') && stats(c) > 1 && !mem.refused.has(`play:${c.uid}`));
      const worst = [...v.board].filter((c) => !c.golden && wantOf(DEMON_OPERATOR, c.cardId, v) <= 1 && !mem.bought.has(c.cardId)).sort((a, b) => stats(a) - stats(b))[0];
      if (eaterInHand && worst) out.push({ type: 'sell', uid: worst.uid });
    }
    return out;
  },
  spellTarget: (v, spellId) => {
    if (spellId === 'cupcakes' || spellId === 'resonance') {
      if (spellId === 'resonance') {
        // Re-fire a Shop-buffing Shout: Tormentor first, then Butcher.
        return v.board.find((c) => c.cardId === 'dm_tormentor') ?? v.board.find((c) => c.cardId === 'dm_butcher') ?? null;
      }
      return bestEater(v);
    }
    // Stat spells go on the biggest Blart (it is the body that keeps growing), else the biggest Demon.
    return bestEater(v) ?? [...v.board].sort((a, b) => stats(b) - stats(a))[0] ?? null;
  },
  aim: (v, sourceCardId, legal) => {
    const eater = bestEater(v);
    if (eater && legal.includes(eater.uid)) return eater.uid;
    // Any legal Demon, biggest first.
    const demons = v.board.filter((c) => legal.includes(c.uid)).sort((a, b) => stats(b) - stats(a));
    void sourceCardId;
    return demons[0]?.uid ?? legal[0] ?? null;
  },
  slot: (c, v) => {
    // Hank dies first (0), Horse attacks next (1), Taunts and the rest in the middle, the Blarts LAST — they are
    // the run's whole value and never need to attack.
    if (c.cardId === 'dm_hank') return 0;
    if (c.cardId === 'dm_hungerling') return 1;
    if (c.cardId === 'dm_gourmand') return 9;
    if (c.cardId === 'dm_glutton') return 8;
    if (c.keywords.includes('T')) return 3;
    void v;
    return 5;
  },
  pinned: (c) => c.cardId === 'dm_hank' || c.cardId === 'dm_hungerling' || c.cardId === 'dm_gourmand',
  heroPower: (v, run, mem) => {
    if (mem.usedPower) return null;
    const p = v.hero.powers.find((x) => x.slot === 0 && x.ready);
    if (!p) return null;
    if (p.kind === 'displace') {
      // Darah: trade a filler for a random Shop minion — it arrives with the permanent Shop buffs on it. Only
      // once the Shop is actually buffed, and never a Blart / Hank / Horse / pair / golden.
      const buff = v.runCounters.tavernBuyBonus;
      if (v.wave < 5 || buff.attack + buff.health < 3) return null;
      const shopMinions = v.shop.filter((o) => !o.spell && !o.ruby);
      if (shopMinions.length < 2) return null; // keep Blart's meal in the row
      const filler = [...v.board]
        .filter((c) => !c.golden && wantOf(DEMON_OPERATOR, c.cardId, v) <= 1 && countHeld(v, c.cardId) < 2)
        .sort((a, b) => stats(a) - stats(b))[0];
      const avgShop = shopMinions.reduce((n, o) => n + stats(o), 0) / shopMinions.length;
      if (filler && stats(filler) + 2 < avgShop) return { type: 'heroPower', uid: filler.uid };
      return null;
    }
    void run;
    return null;
  },
  avoidBuying: (o, v) => {
    // Blart's meal: the right-most Shop minion carries the slot buff — leave it unless it is a core piece.
    if (!v.board.some((c) => c.cardId === 'dm_gourmand')) return false;
    if (o.spell || o.ruby) return false;
    const minions = v.shop.filter((x) => !x.spell && !x.ruby);
    const rightmost = minions[minions.length - 1];
    if (!rightmost || rightmost.uid !== o.uid) return false;
    return wantOf(DEMON_OPERATOR, o.cardId, v) < 3 && countHeld(v, o.cardId) < 2;
  },
  beforeEnd: (v, _run, mem) => {
    // A fielded Blart must have a meal: never end on an empty Shop row while Gold can roll one.
    const blarts = v.board.filter((c) => c.cardId === 'dm_gourmand').length;
    if (blarts === 0) return null;
    const meals = v.shop.filter((o) => !o.spell && !o.ruby).length;
    if (meals === 0 && (v.economy.refreshCost <= v.economy.gold || v.economy.freeRolls > 0) && mem.rolls < 6) return { type: 'roll' };
    return null;
  },
};
