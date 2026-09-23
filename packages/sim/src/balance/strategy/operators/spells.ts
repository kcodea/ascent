/**
 * B9 — the shared SPELL POLICY every operator uses.
 *
 * Spells are the set's biggest operational lever (Ales, Dragonflame, Growth, Blessing …) and its biggest trap
 * (Channeling the Devourer eats your engine; Closed Casket destroys it; Turnabout swaps its stats). A strong player
 * knows which is which by name. So does this table: every drawable set-2 spell is either a KIND the skeleton knows
 * how to cast (stat buff → the line's spell target; board buff → cast; economy → cast first; generate → cast when
 * the hand has room; shop buff → cast BEFORE buying) or `never` (held, never cast, never bought). A spell the table
 * does not name is treated as `never` — an unknown spell is a risk, not an opportunity.
 */
import { CARD_INDEX } from '@game/content';
import type { BotVisibleState } from '../../../productionBots/types';

export type SpellKind =
  | 'statTarget' // buff one friendly minion (the line picks the body)
  | 'boardBuff' // buff the board / several minions, untargeted
  | 'economy' // Gold now or next turn — cast first, before buying
  | 'generate' // puts a card in hand — cast while the hand has room
  | 'shopBuff' // buffs the Shop — cast BEFORE buying
  | 'combat' // next-combat utility — cast when held, rarely bought
  | 'consume' // Cupcakes: a Demon eats the Shop — the Demon line's payoff
  | 'trigger' // Resonance / Chrono Staff: re-fire an engine — cast on the line's engine
  | 'never';

export interface SpellPolicy {
  kind: SpellKind;
  /** Buy appeal when the Shop offers it, 0 = never buy (0..3 like a card want). */
  buy: 0 | 1 | 2 | 3;
  /** Cast only when the target has fewer than this many total stats (Perfect Vision sets 20/20). */
  targetBelow?: number;
}

const P = (kind: SpellKind, buy: 0 | 1 | 2 | 3, extra: Partial<SpellPolicy> = {}): SpellPolicy => ({ kind, buy, ...extra });

export const SPELL_POLICY: Readonly<Record<string, SpellPolicy>> = {
  // ── stat buffs on one body ──
  spiritfire: P('statTarget', 1), bulwark: P('statTarget', 0), shatter: P('never', 0), fronttoback: P('statTarget', 2),
  lanternlight: P('statTarget', 1), crestclimb: P('statTarget', 1), patchjob: P('statTarget', 1), hoardflame: P('statTarget', 2),
  sp_blessing: P('statTarget', 2), sp_beefy: P('statTarget', 2), sp_flutter: P('statTarget', 1), perfectvision: P('statTarget', 1, { targetBelow: 20 }),
  // ── board buffs ──
  growth: P('boardBuff', 2), sparkplug: P('boardBuff', 3), greatpot: P('boardBuff', 2), sp_dragonflame: P('boardBuff', 2),
  mightofaeon: P('boardBuff', 1), fleetingvigor: P('boardBuff', 0), sp_solidground: P('boardBuff', 0),
  wo_champion: P('boardBuff', 2), wo_health: P('boardBuff', 2), wo_attack: P('boardBuff', 2),
  // ── economy ──
  emberpouch: P('economy', 1), wo_mine: P('economy', 2), depositbox: P('economy', 1), manafont: P('economy', 2),
  refreshtexts: P('economy', 1), insurancepolicy: P('economy', 0), quicksale: P('economy', 0),
  // ── generate a card ──
  summonstone: P('generate', 0), sprout: P('generate', 0), tribeschoice: P('generate', 1), wo_reinforcement: P('generate', 2),
  helpwanted: P('generate', 1), corpseboard: P('generate', 1), tribeportal: P('generate', 2), beyondsummit: P('generate', 2),
  invitationabove: P('generate', 2), riftsunkcodex: P('generate', 1), hourglassreserve: P('generate', 1), funeralonloan: P('generate', 0),
  sp_gamble: P('generate', 1), lasso: P('generate', 1), deepdelvewrit: P('generate', 1), rivalsreflection: P('generate', 0),
  onthehouse: P('generate', 2), ironcladreq: P('generate', 0), rubyshipment: P('generate', 0), facetwright: P('never', 0),
  // ── shop buffs (cast before buying) ──
  staffofguel: P('shopBuff', 1), apples: P('shopBuff', 0), quickstudy: P('shopBuff', 1), veinstorm: P('shopBuff', 0),
  goldentouch: P('shopBuff', 0), elevationritual: P('shopBuff', 0), spellcart: P('never', 0),
  // ── combat utility ──
  rallyoffensive: P('combat', 1), preemptive: P('combat', 0), markedtarget: P('combat', 0), weaken: P('combat', 0),
  sp_containmentrune: P('combat', 0), decoysigil: P('combat', 0), sp_stoleninitiative: P('combat', 0), summoningbulwark: P('combat', 0),
  fieldmaneuvers: P('never', 0), laststand: P('never', 0), executionersedge: P('never', 0), farseersreport: P('never', 0),
  sp_partingcry: P('never', 0), openthegates: P('combat', 0),
  // ── the Demon payoff + engine re-fires ──
  cupcakes: P('consume', 3), resonance: P('trigger', 1), chronostaff: P('trigger', 2),
  // ── never: they can eat, destroy, swap or transform the engine ──
  devour: P('never', 0), powershifter: P('never', 0), mend: P('never', 0), turnabout: P('never', 0), displacement: P('never', 0),
  sigilkinship: P('never', 0), layaway: P('never', 0), seconddraft: P('never', 0), strangerevision: P('never', 0),
  sp_closedcasket: P('never', 0), commonground: P('never', 0), aresmar: P('statTarget', 2), rubytransfer: P('never', 0), rubyexcavation: P('never', 0),
  sp_dissipate: P('never', 0), // sells a board minion (the engine) — 2026-09-18
  sp_picnic: P('shopBuff', 1), // right-most Shop slot +8/+8 for the run — cast before buying (2026-09-23)
};

export function spellPolicyOf(cardId: string): SpellPolicy {
  return SPELL_POLICY[cardId] ?? P('never', 0);
}

export const isSpellCard = (cardId: string): boolean => !!CARD_INDEX[cardId]?.spell && !CARD_INDEX[cardId]?.ruby;

/** Does casting this spell need a friendly target (the line supplies it)? */
export function spellNeedsTarget(cardId: string): boolean {
  const d = CARD_INDEX[cardId];
  return !!d && (d.target === 'friendly' || d.target === 'any');
}

/** Cast order within a turn: economy → shop buffs → generators → the rest. */
export const CAST_ORDER: readonly SpellKind[] = ['economy', 'shopBuff', 'generate', 'consume', 'trigger', 'statTarget', 'boardBuff', 'combat'];

/** Whether a generated spell in hand may be cast now (a Choose One spell is left to the search — its pick and aim
 *  are mandatory follow-ups the skeleton delegates). */
export function castableNow(cardId: string, v: BotVisibleState): boolean {
  const p = spellPolicyOf(cardId);
  if (p.kind === 'never') return false;
  // A generator into a nearly full hand is a wasted card — unless the hand is already clogged, when casting anything
  // is the only way to make room.
  if (p.kind === 'generate' && v.hand.length >= 9 && v.hand.length < 10) return false;
  return true;
}
