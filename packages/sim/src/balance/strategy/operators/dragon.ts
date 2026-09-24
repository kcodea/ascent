/**
 * B9 — THE DRAGON SPELL OPERATOR (set 2), written off the recorded Dragon runs that reached the end-game
 * (LazerLemon | emeraldwarden: Chorus Drake at wave 4, Vaultkeeper at 9 → a golden Vaultkeeper 470/535 at w11 →
 * 1,171/1,302 at w12 with two Flamebeat Drakes + Lastlight + Drakko; bram | dragon: Chorus + Vaultkeeper + Warflame +
 * Lastlight + Sylus to wave 17; the study's strongest late pair: Chorus Drake + Vaultkeeper, 18 boards, 100%).
 *
 * THE ENGINE. Set-2 Dragons scale off SHOP SPELLS — casting them, copying them, and the count of them.
 *  - Chorus Drake (T3 Rally): +1 Health to your Shop spells, PERMANENTLY, every time it attacks — every fight
 *    makes every future spell bigger. Two Chorus Drakes attacking early is the whole early game.
 *  - Earthbreaker (T4): +2/+3 to every Dragon per Shop spell cast. Vaultkeeper (T6): +2/+2 per Dragon PLAYED,
 *    improving +2/+2 per 4 spells cast this game — the late multiplier (a golden one doubles both).
 *  - Mirrorwing (T2): the first Shop spell cast on it each turn casts AGAIN — every targeted spell goes there.
 *  - Spell Warden (T5): the second spell each turn copies the first; Recaller (T4 Shout): a copy of the last
 *    spell; Fel Conjurer (T5): a Quick Study (+1/+1 spell power) every turn; Mushy / Flutterdrake: a Growth /
 *    a Flutter on play.
 *  - Flamebeat Drake (T5 Rally) and Warflame (T6) cast Dragonflame in combat (+4/+4 per Dragon, repeated per
 *    Dragon, at the spell power Chorus Drake built); Transcendant (T4) Engraves adjacent Dragons so combat gains
 *    stay; Drakko (T5) doubles the Shouts (Recaller, Mushy, Flutterdrake, Broodfire).
 *
 * THE PROCEDURE.
 *  - Tier: T2 at wave 2 (Mirrorwing / Skald / Broodfire), T3 at 4 (Chorus Drake ×2, Scalefeather), T4 at 6
 *    (Earthbreaker / Transcendant / Recaller), T5 at 8 (Flamebeat / Warden / Conjurer), T6 at 10 (Vaultkeeper).
 *  - EVERY turn: buy the Shop spell slot when a Dragon engine is fielded; cast every spell — targeted ones on
 *    Mirrorwing first (the recast), then on the Vaultkeeper / biggest Dragon; play Dragons while a Vaultkeeper
 *    is out (each is +2/+2 × the count); the Chorus Drakes attack EARLY (left) and the Transcendant sits between
 *    them.
 *  - Buy: Chorus Drake on sight (pairs → golden), Earthbreaker and Transcendant when T4 opens, Vaultkeeper on
 *    sight at T6, Flamebeat / Warflame as the late Rallies.
 *  - Sell: Embermouth Whelp (4% survival past wave 6), Cinderchef, River Drake, Skald from wave 6 when an
 *    engine needs the seat.
 *  - Hero: Emerald Warden's Vanguard is passive (a minion per tier-up) — the tier curve is the power.
 *  - Pivot: no Chorus Drake / Earthbreaker / Mirrorwing / Vaultkeeper by wave 7 → the strategist takes over.
 */
import { CARD_INDEX } from '@game/content';
import type { Action, RunState } from '../../../state';
import type { BotCardView, BotVisibleState } from '../../../productionBots/types';
import { isTribe, stats, type CardRole, type LineOperator, type TurnMemory, type Want } from './types';

const R = (want: Want, note: string, extra: Partial<CardRole> = {}): CardRole => ({ want, note, ...extra });

const ROLES: Record<string, CardRole> = {
  d2_chorus: R(3, 'Rally: +1 Health to every Shop spell, permanent — every fight', { core: true }),
  d2_scalechanter: R(3, 'Earthbreaker: +2/+3 to every Dragon per Shop spell cast', { core: true }),
  d2_herzog: R(3, 'Vaultkeeper: +2/+2 per Dragon played, improving per 4 spells cast', { fromWave: 9 }),
  d2_mirrorwing: R(2, 'the first spell cast on it each turn casts again'),
  d2_spellkeeper: R(2, 'Spell Warden: the second spell copies the first', { fromWave: 8 }),
  d2_recaller: R(2, 'Shout: a copy of the last spell cast this turn', { fromWave: 6 }),
  d2_felconjurer: R(2, 'a Quick Study every turn', { fromWave: 8 }),
  d2_scalefeather: R(2, 'Mushy: a Growth on Shout and on Echo', { fromWave: 8 }),
  d2_flutterdrake: R(2, 'a Flutter on Shout', { fromWave: 8 }),
  d2_flamebeat: R(3, 'Rally: cast Dragonflame in combat', { fromWave: 8 }),
  d2_warflame: R(3, 'Dragonflame whenever a Dragon attacks', { fromWave: 10 }),
  d2_transcendence: R(3, 'Transcendant: adjacent Dragons are Engraved — combat gains stay', { fromWave: 6 }),
  d2_grimoire: R(2, 'the first spell each turn casts twice', { fromWave: 10 }),
  d2_orivax: R(3, 'Orivax: the first spell each turn casts 3 times', { fromWave: 12 }),
  d2_broodfire: R(1, 'Shout: +2/+2 to the Dragons', { filler: true }),
  d2_skald: R(1, 'Traveling Skald: +2/+1 to an attacking Dragon', { filler: true }),
  d2_chronicler: R(1, 'Scalefeather: a Tier-1 spell on Shout', { filler: true }),
  d2_voicekeeper: R(1, 'a plain copy of the first Dragon sold each turn', { fromWave: 7 }),
  d2_blazingkeeper: R(1, 'Commander Warpath: a Brood Whelp', { fromWave: 8 }),
  d2_roarcollector: R(1, 'Rally: a random Shout minion', { fromWave: 7 }),
  d2_cinderchef: R(1, 'Cinderchef: a Rally body the survivors keep early', { filler: true }),
  d2_riverdrake: R(1, 'a spell when sold', { filler: true }),
  d2_embermouth: R(0, 'the study: 4% survival past wave 6', { filler: true }),
  karwind: R(1, 'Karwind', { fromWave: 10 }),
  // Neutral engines the recorded Dragon boards carried.
  n2_spellsword: R(2, 'Coppercoat Spellsword: spell power on Shout'),
  dw_wardkeeper: R(1, 'Wardkeeper: +1 Attack to the Shop spells'),
  n2_standardbearer: R(2, 'Rally +3/+3 to one of each type', { fromWave: 5 }),
  n2_lastlight: R(2, 'Echo: Ward to two bodies', { fromWave: 8 }),
  drummer: R(2, 'Drakko: Shouts twice', { fromWave: 9 }),
  n2_fatecarver: R(2, 'one of each type +2/+2 per Shop spell', { fromWave: 8 }),
  n2_bellringer: R(1, 'a plain copy of its left neighbour every 2 turns', { fromWave: 8 }),
  chronos: R(1, 'End of Turn twice', { fromWave: 10 }),
  sylus: R(1, 'Echoes twice', { fromWave: 10 }),
};

/** The Dragon a targeted spell goes on: Mirrorwing while its recast is unspent this turn, else the Vaultkeeper,
 *  else the biggest Dragon (an Engraved one first), else the biggest body. */
function spellBody(v: BotVisibleState, mem?: TurnMemory): BotCardView | null {
  const mirror = v.board.find((c) => c.cardId === 'd2_mirrorwing');
  if (mirror && !mem?.castOn.has(mirror.uid)) return mirror;
  const vault = v.board.find((c) => c.cardId === 'd2_herzog');
  if (vault) return vault;
  const dragons = v.board.filter((c) => isTribe(c, 'dragon'));
  const pool = dragons.length ? dragons : [...v.board];
  return [...pool].sort((a, b) => stats(b) - stats(a))[0] ?? null;
}

export const DRAGON_OPERATOR: LineOperator = {
  id: 'dragon',
  packages: ['dragon', 'spellEngine'],
  tribe: 'dragon',
  tierByWave: [undefined, undefined, 2, 4, 6, 8, 10],
  roles: ROLES,
  engineIds: ['d2_chorus', 'd2_scalechanter', 'd2_mirrorwing', 'd2_herzog', 'd2_flamebeat', 'd2_spellkeeper'],
  defaultWant: (cardId, v) => {
    const d = CARD_INDEX[cardId];
    if (!d || d.spell) return 0;
    if (d.tribe === 'dragon' || d.tribe2 === 'dragon' || d.universalTribe) return 1;
    return v.wave <= 3 && v.board.length < 2 ? 1 : 0;
  },
  feed: (v: BotVisibleState, _run: RunState, mem: TurnMemory): Action[] => {
    // Every Dragon in hand is played while a Vaultkeeper is fielded, even into a full board (the skeleton's
    // replace step handles the seat): each play is +2/+2 × the spell count.
    const out: Action[] = [];
    const vault = v.board.find((c) => c.cardId === 'd2_herzog');
    if (vault && v.board.length >= 7) {
      const dragonInHand = v.hand.find((c) => isTribe(c, 'dragon') && stats(c) > 1 && !mem.refused.has(`play:${c.uid}`));
      const worst = [...v.board].filter((c) => !c.golden && c.cardId !== 'd2_herzog' && !mem.bought.has(c.cardId)).sort((a, b) => stats(a) - stats(b))[0];
      if (dragonInHand && worst && stats(worst) < stats(dragonInHand) + 4) out.push({ type: 'sell', uid: worst.uid });
    }
    return out;
  },
  spellTarget: (v, spellId, mem) => {
    if (spellId === 'resonance') return v.board.find((c) => c.cardId === 'd2_recaller') ?? v.board.find((c) => c.cardId === 'd2_scalefeather') ?? v.board.find((c) => c.cardId === 'd2_flutterdrake') ?? null;
    return spellBody(v, mem);
  },
  aim: (v, sourceCardId, legal) => {
    const body = spellBody(v);
    if (body && legal.includes(body.uid)) return body.uid;
    const dragons = v.board.filter((c) => legal.includes(c.uid)).sort((a, b) => stats(b) - stats(a));
    void sourceCardId;
    return dragons[0]?.uid ?? legal[0] ?? null;
  },
  slot: (c, v) => {
    // The Chorus Drakes attack first (their Rally is the run's spell power), the Transcendant BETWEEN them (both
    // adjacent Dragons are Engraved), the Flamebeat / Warflame next, the Vaultkeeper protected at the back.
    const chorus = v.board.filter((x) => x.cardId === 'd2_chorus');
    if (c.cardId === 'd2_chorus') return chorus[0]?.uid === c.uid ? 0 : 2;
    if (c.cardId === 'd2_transcendence') return 1;
    if (c.cardId === 'd2_flamebeat' || c.cardId === 'd2_warflame') return 3;
    if (c.cardId === 'd2_herzog') return 9;
    if (c.cardId === 'd2_mirrorwing') return 8;
    if (c.keywords.includes('T')) return 4;
    return 5;
  },
  pinned: (c) => c.cardId === 'd2_chorus' || c.cardId === 'd2_transcendence' || c.cardId === 'd2_herzog',
};

export { spellBody as dragonSpellBody };
