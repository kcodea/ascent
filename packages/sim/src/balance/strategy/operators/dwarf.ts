/**
 * B9 — THE DWARF ALE OPERATOR (set 2), written off the recorded end-game Dwarf runs (LEMON | robin: two Coinfire
 * Forewomen + Brunni + a Bob Blart at wave 5 → Coinfire golden 76/16 at w8 → Thane / Edward / Brakka at w10 →
 * 2,843 total stats at w12; Orangez | emeraldwarden: Standard Bearer + Wardkeeper + Gangplank + Brunni + Chef Gary
 * Toast; LazerLemon | robin: Thane ×2 + Tapkeeper ×2 + Edward + Billings).
 *
 * THE ENGINE. Dwarves pay you for SHOPPING: Gold spent and cards gained become permanent Attack and a stream of
 * ALES (five cheap Tier-3 Shop spells — Champion's +6/+6 on the LEFT-MOST minion, Bloody +4 Attack ×3, Defensive
 * +4 Health ×3, Golden Ale +2 Gold, Reinforcing Ale a body of your most common type).
 *  - Brunni (T3): an Ale at End of Turn, every turn. Tapkeeper (T6): an Ale per 10 Gold spent. Blade Thrower
 *    (T4): an Ale per Rally. Doubletap Brewer (T5): one on Shout and one on Echo.
 *  - Edward Keg-hands (T5): every Ale triggers TWICE (a golden: three times).
 *  - Coinfire Forewoman (T3): +2 Attack to every Dwarf per 5 Gold spent. Billings (T5): +5/+5 to two Dwarves
 *    per 5 Gold. Mountainbond (T5): a Ruby on every minion per 8 Gold. Gangplank (T3): +1/+2 to a Dwarf per card
 *    that reaches the hand (every Ale, every buy). Kringle (T5): the two END Dwarves +1/+2 per card played.
 *  - Lieutenant Thane (T6 Rally): gives its Attack to two friends — the late multiplier; Broad-Axe Brakka
 *    (T4 Cleave) and Anvilshade Smith (T5) are the bodies that cash the Attack.
 *
 * THE PROCEDURE.
 *  - Tier: T2 at wave 2, T3 at 4 (Brunni / Coinfire / Gangplank), T4 at 6 (Brakka / Blade Thrower), T5 at 8
 *    (Edward / Billings / Kringle), T6 at 10 (Tapkeeper / Thane / Chef).
 *  - EVERY turn: cast every Ale in hand (Golden Ale FIRST — it is Gold to spend); keep the biggest Dwarf on the
 *    LEFT for Champion's Ale; SPEND ALL THE GOLD — buy, then roll the rest away, because every 5 Gold is +2 Attack
 *    on every Dwarf under Coinfire and every 10 an Ale under Tapkeeper; play many cards under Kringle.
 *  - Buy: Brunni on sight (two is better; three is a golden Brunni brewing two); Edward whenever an Ale source is
 *    fielded; Coinfire / Gangplank / Billings as the spend converters; Brakka / Thane as the bodies.
 *  - Sell: Pimm, Orin, Chicken Brawl, Warhorn Captain (once shouted) from wave 6 when a converter needs the seat.
 *  - Hero: Robin's Spoils pays a Gold per minion sold next turn — selling filler is not a loss here.
 *  - Pivot: no Brunni / Coinfire / Gangplank / Edward / Tapkeeper by wave 7 → the strategist takes over.
 */
import { ALE_IDS } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { Action, RunState } from '../../../state';
import type { BotCardView, BotVisibleState } from '../../../productionBots/types';
import { isTribe, stats, type CardRole, type LineOperator, type TurnMemory, type Want } from './types';

const R = (want: Want, note: string, extra: Partial<CardRole> = {}): CardRole => ({ want, note, ...extra });

const ROLES: Record<string, CardRole> = {
  dw_brunni: R(3, 'an Ale at End of Turn, every turn — the brewery', { core: true }),
  dw_edward: R(3, 'every Ale triggers twice', { fromWave: 7 }),
  dw_tapkeeper: R(3, 'an Ale per 10 Gold spent', { fromWave: 9 }),
  dw_coinfire: R(3, '+2 Attack to every Dwarf per 5 Gold spent', { core: true }),
  dw_gangplank: R(3, '+1/+2 to a Dwarf per card gained (every Ale, every buy)', { core: true }),
  dw_billings: R(2, '+5/+5 to two Dwarves per 5 Gold spent', { fromWave: 8 }),
  dw_foreman: R(2, 'Kringle: the end Dwarves +1/+2 per card played', { fromWave: 8 }),
  dw_mountainbond: R(2, 'a Ruby on every minion per 8 Gold spent', { fromWave: 8 }),
  dw_thane: R(3, 'Rally: its Attack to two friends', { fromWave: 10 }),
  dw_brakka: R(2, 'Cleave — the body the Attack lands on'),
  dw_anvilshade: R(2, 'Echo: a Charging Soldier with its Attack', { fromWave: 7 }),
  dw_bladethrower: R(2, 'an Ale per Rally', { fromWave: 6 }),
  dw_brewer: R(2, 'an Ale on Shout and one on Echo', { fromWave: 8 }),
  dw_chef: R(2, 'Chef Gary Toast: +4/+4 to every Dwarf per Dwarf played', { fromWave: 10 }),
  dw_wardkeeper: R(2, 'a 6/4 body whose Shout gives Ales +1 Attack'),
  dw_dorrin: R(1, 'Baby Gastrid: +2 Health per Gold spent this turn to a Dwarf — play it LAST', { fromWave: 6 }),
  dw_ironlung: R(1, 'Warhorn Captain: +3 Attack to the other Dwarves once', { filler: true }),
  dw_pimm: R(1, 'Paymaster Pimm: 1 Gold next turn', { filler: true }),
  dw_orin: R(1, 'Oathshield Orin: a Warded 2/2', { filler: true }),
  dw_chickenbrawl: R(1, 'Chicken Brawl: a charging soldier', { filler: true }),
  dw_sharpshooter: R(1, 'a Deep Delve Writ (steal a Dwarf from the Shop)'),
  dw_runemaster: R(2, 'Gild a minion', { fromWave: 12 }),
  // Neutral engines the recorded Dwarf boards carried.
  n2_standardbearer: R(2, 'Rally +3/+3 to one of each type', { fromWave: 5 }),
  n2_lastlight: R(2, 'Echo: Ward to two bodies', { fromWave: 8 }),
  drummer: R(2, 'Drakko: Shouts twice (Brewer, Wardkeeper, Gastrid)', { fromWave: 9 }),
  chronos: R(3, 'End of Turn twice — Brunni brews twice', { fromWave: 9 }),
  n2_bellringer: R(1, 'a plain copy of its left neighbour every 2 turns', { fromWave: 8 }),
  dm_gourmand: R(2, 'Bob Blart — the recorded Dwarf boards fed one too', { fromWave: 5 }),
  n2_abomination: R(2, 'Rally: doubles itself', { fromWave: 10 }),
  d2_embermouth: R(0, 'the study: 4% survival past wave 6'),
};

const ALE_SOURCES = ['dw_brunni', 'dw_tapkeeper', 'dw_bladethrower', 'dw_brewer'];

/** The Dwarf that should hold the LEFT seat: the one the line is growing (a golden Coinfire, Brakka, Thane —
 *  the biggest non-Brunni Dwarf). Brunni is a 3/1 Taunt that would rather not be the Champion's Ale target. */
function champion(v: BotVisibleState): BotCardView | null {
  const dwarves = v.board.filter((c) => isTribe(c, 'dwarf') && c.cardId !== 'dw_brunni');
  const pool = dwarves.length ? dwarves : v.board.filter((c) => isTribe(c, 'dwarf'));
  const any = pool.length ? pool : [...v.board];
  return [...any].sort((a, b) => stats(b) - stats(a))[0] ?? null;
}

export const DWARF_OPERATOR: LineOperator = {
  id: 'dwarf',
  packages: ['ale'],
  tribe: 'dwarf',
  tierByWave: [undefined, undefined, 2, 4, 6, 8, 10],
  roles: ROLES,
  engineIds: ['dw_brunni', 'dw_coinfire', 'dw_gangplank', 'dw_edward', 'dw_tapkeeper', 'dw_billings'],
  defaultWant: (cardId, v) => {
    const d = CARD_INDEX[cardId];
    if (!d || d.spell) return 0;
    if (d.tribe === 'dwarf' || d.tribe2 === 'dwarf' || d.universalTribe) return 1;
    return v.wave <= 3 && v.board.length < 2 ? 1 : 0;
  },
  feed: (v: BotVisibleState, _run: RunState, mem: TurnMemory): Action[] => {
    const out: Action[] = [];
    // Ales in hand are cast every turn, Golden Ale first (Gold to spend) — an Edward on the board doubles them,
    // and a Brunni brews the next one at End of Turn regardless. `spells.ts` casts the others; the Ales are the
    // line's own operation because their ORDER matters (Champion's Ale after the champion is seated).
    const ales = v.hand.filter((c) => ALE_IDS.includes(c.cardId) && !mem.refused.has(`play:${c.uid}`));
    const order = ['wo_mine', 'wo_reinforcement', 'wo_attack', 'wo_health', 'wo_champion'];
    ales.sort((a, b) => order.indexOf(a.cardId) - order.indexOf(b.cardId));
    for (const a of ales) {
      if (a.cardId === 'wo_champion') {
        // Seat the champion on the left FIRST, then cast.
        const champ = champion(v);
        if (champ && v.board[0]?.uid !== champ.uid && !mem.refused.has(`seat:${champ.uid}`)) {
          out.push({ type: 'reposition', uid: champ.uid, toIndex: 0 });
          break;
        }
      }
      out.push({ type: 'play', uid: a.uid });
    }
    return out;
  },
  spellTarget: (v, spellId) => {
    if (spellId === 'resonance') return v.board.find((c) => c.cardId === 'dw_brewer') ?? v.board.find((c) => c.cardId === 'dw_wardkeeper') ?? null;
    return champion(v);
  },
  aim: (v, sourceCardId, legal) => {
    // Baby Gastrid / Auric Runemaster: the champion, else the biggest legal Dwarf.
    const champ = champion(v);
    if (champ && legal.includes(champ.uid)) return champ.uid;
    const dwarves = v.board.filter((c) => legal.includes(c.uid)).sort((a, b) => stats(b) - stats(a));
    void sourceCardId;
    return dwarves[0]?.uid ?? legal[0] ?? null;
  },
  slot: (c, v) => {
    // The champion holds the LEFT seat (Champion's Ale, Kringle's left end); Thane attacks early to hand out its
    // Attack; Brunni (a 3/1 Taunt) and the brewers sit in the back; Brakka mid.
    const champ = champion(v);
    if (champ && c.uid === champ.uid) return 0;
    if (c.cardId === 'dw_thane') return 1;
    if (c.cardId === 'dw_anvilshade') return 2;
    if (c.cardId === 'dw_brakka') return 3;
    if (c.cardId === 'dw_brunni' || c.cardId === 'dw_tapkeeper' || c.cardId === 'dw_edward' || c.cardId === 'dw_gangplank') return 8;
    return 5;
  },
  pinned: (c, v) => { const champ = champion(v); return !!champ && c.uid === champ.uid; },
  rollBudget: (v, mem) => {
    // Every 5 Gold spent is +2 Attack per Dwarf under Coinfire / +5/+5 ×2 under Billings, every 8 a Ruby under
    // Mountainbond, every 10 an Ale under Tapkeeper: leftover Gold goes into refreshes, all of it, from wave 5.
    const converters = v.board.filter((c) => ['dw_coinfire', 'dw_billings', 'dw_tapkeeper', 'dw_mountainbond'].includes(c.cardId)).length;
    if (converters === 0 || v.wave < 5) return 0;
    return mem.rolls >= 8 ? 0 : v.economy.gold;
  },
  heroPower: () => null, // Robin's Spoils is passive; other heroes fall to the generic evaluator
};

export const DWARF_ALE_SOURCES = ALE_SOURCES;
