/**
 * B9 — THE BEAST SUMMON / ECHO OPERATOR (set 2), written off the recorded Beast runs that reached the end-game
 * (bram | beast to wave 16: Echohorn, Hawkus, Spots, Fel Spikes, Impossible Todd, Sylus; jenkins | beast to wave 18:
 * Echohorn ×2 + Hawkus ×2 + Sylus golden + Fel Spikes golden; brackus | beast: Dawnclaw, Echohorn, Spots, Beardsley,
 * Paragon; the study: Echohorn holders at waves 8–10 survived 5.4 vs 3.4 waves, Kennelmaster +41%).
 *
 * THE ENGINE. Set-2 Beasts are an ECHO-TRIGGER line: the LEFT-MOST Echo on the board is fired again and again
 * during combat, and every summon it produces is buffed by the summon payoffs.
 *  - Echohorn (T4 Rally): trigger your left-most Echo. Hawkus (T5): trigger the left-most Echo whenever ANY Rally
 *    fires. Spots (T6 Start of Combat): trigger the two left-most Echoes. Sylus (T5): every Echo triggers once
 *    more. Elderhorn (T7): Beast Rallies or Echoes an additional time.
 *  - The Echo that goes LEFT: Menagerie Mammoth (T5: three random Beasts), Bullseye (T3: a random Beast set to
 *    7/7), Fel Spikes (T5: 4 damage to everything but Demons), T-Rex (T2: a Taunt baby), Armadiyo (T3: Beast Aura
 *    +2/+4), Wolvie (T2: the next Beast +2/+4), Dawnclaw (T4: an adjacent Shout again), Big Huggies.
 *  - The payoffs: Kennelmaster (T2: the Beast Aura at Start of Combat, improving per Avenge), Beardsley (T4: +3/+3
 *    per summon, improving), King Oona (T5: summoned Beasts double), Paragon / Standard Bearer (permanent Rally
 *    growth on one of each type — Echohorn's Rally feeds them), Impossible Todd / Axeman on the Demon side.
 *
 * THE PROCEDURE.
 *  - Tier: T2 at wave 2 (Kennelmaster / T-Rex / Wolvie), T3 at 4 (Armadiyo / Bullseye / Standard Bearer), T4 at
 *    6 (Echohorn / Beardsley / Dawnclaw), T5 at 8 (Hawkus / Mammoth / Oona / Fel Spikes / Paragon / Sylus), T6 at
 *    10 (Spots).
 *  - EVERY turn: the board is ARRANGED — the best Echo LEFT-MOST (Mammoth > Bullseye > Fel Spikes > Armadiyo >
 *    T-Rex), the Rally bodies (Echohorn, Standard Bearer) right behind it so they attack while the Echo body is
 *    still there, Hawkus / Spots / Kennelmaster / Beardsley / Oona at the back; a second Echo second from the
 *    left for Spots.
 *  - Buy: Kennelmaster and an Echo body early; Echohorn on sight (pairs → golden: the Echo twice); Hawkus,
 *    Sylus, Mammoth, Paragon as they open; Spots at T6.
 *  - Sell: Packstrider, Void Panther, Cheap Date, Sea Urchin from wave 6 when a piece needs the seat.
 *  - Hero: Jensen's Dynamite Dig is a Discover of the current tier — free the first time, +1 Gold each use: dig
 *    while the cost is at most a third of the turn's Gold and the board has a seat.
 *  - Pivot: no Echohorn / Hawkus / Kennelmaster / Beardsley / Spots by wave 7 → the strategist takes over.
 */
import { CARD_INDEX } from '@game/content';
import type { BotCardView, BotVisibleState } from '../../../productionBots/types';
import { isTribe, stats, wantOf, type CardRole, type LineOperator, type Want } from './types';

const R = (want: Want, note: string, extra: Partial<CardRole> = {}): CardRole => ({ want, note, ...extra });

const ROLES: Record<string, CardRole> = {
  b2_echohorn: R(3, 'Rally: trigger the left-most Echo', { core: true }),
  b2_hawkus: R(3, 'every Rally triggers the left-most Echo', { fromWave: 8 }),
  b2_spots: R(3, 'Start of Combat: the two left-most Echoes', { fromWave: 10 }),
  sylus: R(3, 'every Echo once more', { fromWave: 8 }),
  b2_elderhorn: R(3, 'Beast Rallies or Echoes an additional time', { fromWave: 12 }),
  kennel: R(3, 'Kennelmaster: the Beast Aura at Start of Combat, improving per Avenge'),
  b2_beardsley: R(3, 'Beardsley: +3/+3 per summon, improving', { fromWave: 6 }),
  b2_oona: R(2, 'King Oona: summoned Beasts double', { fromWave: 8 }),
  b2_mammoth: R(3, 'Echo: three random Beasts — the left-most Echo', { fromWave: 8 }),
  b2_bullseye: R(2, 'Echo: a random Beast at 7/7'),
  dm_felspikes: R(3, 'Echo: 4 damage to everything but Demons', { fromWave: 8 }),
  b2_trex: R(2, 'Echo: a Taunt T-Rex Baby'),
  b2_armadiyo: R(2, 'Taunt; Echo: Beast Aura +2/+4'),
  b2_wolvie: R(1, 'Taunt; Echo: the next Beast +2/+4', { filler: true }),
  b2_dawnclaw: R(2, 'Taunt; Echo: an adjacent Shout again', { fromWave: 6 }),
  b2_dunkey: R(1, 'Avenge: an Armadiyo', { fromWave: 6 }),
  b2_sunmane: R(2, 'Sunmane Herald: Rally +3 Attack to the Beasts, in combat', { fromWave: 8 }),
  b2_solaris: R(1, 'Avenge: Ward and an immediate attack', { fromWave: 10 }),
  b2_quil: R(1, 'casts the left-most hand spell on adjacent Beasts', { fromWave: 10 }),
  b2_moira: R(1, 'End of Turn: adjacent Shouts', { fromWave: 10 }),
  b2_voidmother: R(1, 'Echo: a Void Panther', { fromWave: 10 }),
  b2_stonehorn: R(1, 'a copy of the left-most hand card every 2 turns', { fromWave: 8 }),
  b2_moonhowl: R(1, 'a Mage-Pup per spell bought', { fromWave: 10 }),
  b2_packstrider: R(1, 'Rally body', { filler: true }),
  manasaber: R(1, 'Void Panther', { filler: true }),
  seaurchin: R(1, 'Sea Urchin', { filler: true }),
  beetle: R(1, 'Runic Beetle', { filler: true }),
  grim: R(1, 'Grim', { fromWave: 6 }),
  k_pouchpincher: R(0, 'Cheap Date: the study says no', { filler: true }),
  // Neutral engines the recorded Beast boards carried.
  n2_paragon: R(3, 'Paragon: every Rally → +4/+4 permanent to one of each type', { fromWave: 8 }),
  n2_standardbearer: R(2, 'Rally +3/+3 to one of each type', { fromWave: 5 }),
  n2_lastlight: R(2, 'Echo: Ward to two bodies', { fromWave: 8 }),
  n2_echomimic: R(1, 'gains the Echoes of dying friends', { fromWave: 8 }),
  dm_todd: R(2, 'Impossible Todd: +4/+4 per Demon hit', { fromWave: 10 }),
  dm_chosenfiend: R(1, 'Axeman', { fromWave: 8 }),
  dm_velvet: R(1, 'Big Huggies: Taunt + a Staff', { fromWave: 6 }),
  chronos: R(1, 'End of Turn twice', { fromWave: 10 }),
  drummer: R(1, 'Drakko', { fromWave: 10 }),
  d2_embermouth: R(0, 'the study: 4% survival past wave 6', { filler: true }),
};

/** How good an Echo is to sit LEFT-MOST (fired by Echohorn / Hawkus / Spots). 0 = not an Echo. */
function echoRank(c: BotCardView): number {
  const d = CARD_INDEX[c.cardId];
  if (!d?.effects.some((e) => e.on === 'onDeath')) return 0;
  const table: Record<string, number> = { b2_mammoth: 9, b2_bullseye: 8, dm_felspikes: 7, b2_armadiyo: 6, b2_dawnclaw: 5, n2_lastlight: 5, b2_trex: 4, b2_voidmother: 4, dm_velvet: 3, b2_wolvie: 3 };
  return (table[c.cardId] ?? 2) + (c.golden ? 1 : 0);
}

const RALLY_BODIES = new Set(['b2_echohorn', 'n2_standardbearer', 'b2_sunmane', 'b2_packstrider', 'n2_abomination']);

export const BEAST_OPERATOR: LineOperator = {
  id: 'beast',
  packages: ['beastSummon', 'echo'],
  tribe: 'beast',
  tierByWave: [undefined, undefined, 2, 4, 6, 8, 10],
  roles: ROLES,
  engineIds: ['b2_echohorn', 'b2_hawkus', 'kennel', 'b2_beardsley', 'b2_spots', 'sylus', 'n2_paragon'],
  defaultWant: (cardId, v) => {
    const d = CARD_INDEX[cardId];
    if (!d || d.spell) return 0;
    if (d.tribe === 'beast' || d.tribe2 === 'beast' || d.universalTribe) return 1;
    return v.wave <= 3 && v.board.length < 2 ? 1 : 0;
  },
  feed: () => [],
  spellTarget: (v, spellId) => {
    if (spellId === 'resonance') return v.board.find((c) => c.cardId === 'b2_dawnclaw') ?? null;
    // Stat spells go on the Echohorn / Hawkus (they must survive to keep firing), else the biggest Beast.
    const engine = v.board.find((c) => c.cardId === 'b2_hawkus') ?? v.board.find((c) => c.cardId === 'b2_echohorn');
    if (engine) return engine;
    const beasts = v.board.filter((c) => isTribe(c, 'beast'));
    return [...(beasts.length ? beasts : v.board)].sort((a, b) => stats(b) - stats(a))[0] ?? null;
  },
  aim: (v, sourceCardId, legal) => {
    void sourceCardId;
    const beasts = v.board.filter((c) => legal.includes(c.uid)).sort((a, b) => stats(b) - stats(a));
    return beasts[0]?.uid ?? legal[0] ?? null;
  },
  slot: (c, v) => {
    // The best Echo LEFT-MOST, the second-best second (Spots), then the Rally bodies, then everything else, the
    // payoffs (Kennelmaster / Beardsley / Oona / Hawkus / Spots / Sylus / Paragon) at the back.
    const echoes = [...v.board].filter((x) => echoRank(x) > 0).sort((a, b) => echoRank(b) - echoRank(a));
    if (echoes[0]?.uid === c.uid) return 0;
    if (echoes[1]?.uid === c.uid) return 1;
    if (RALLY_BODIES.has(c.cardId)) return 2;
    if (['kennel', 'b2_beardsley', 'b2_oona', 'b2_hawkus', 'b2_spots', 'sylus', 'n2_paragon'].includes(c.cardId)) return 9;
    if (echoRank(c) > 0) return 4;
    return 5;
  },
  pinned: (c, v) => {
    const echoes = [...v.board].filter((x) => echoRank(x) > 0).sort((a, b) => echoRank(b) - echoRank(a));
    return echoes[0]?.uid === c.uid || ['b2_hawkus', 'b2_spots', 'sylus', 'kennel'].includes(c.cardId);
  },
  heroPower: (v, run, mem) => {
    if (mem.usedPower) return null;
    const p = v.hero.powers.find((x) => x.slot === 0 && x.ready);
    if (!p) return null;
    if (p.kind === 'dynamiteDig') {
      // Jensen: a Discover of the current tier. The cost is the number of digs so far (0, 1, 2, …).
      const digCost = run.heroPowerUses ?? 0;
      if (v.board.length + v.hand.length >= 7 + 3) return null;
      if (digCost > Math.floor(v.economy.gold / 3) || digCost > 3) return null;
      return { type: 'heroPower' };
    }
    return null;
  },
};

export function beastEchoRank(c: BotCardView): number { return echoRank(c); }
export const beastWant = (cardId: string, v: BotVisibleState): Want => wantOf(BEAST_OPERATOR, cardId, v);
