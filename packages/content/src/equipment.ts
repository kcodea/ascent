import type { CardDef } from '@game/core';

/**
 * ── EQUIPMENT (owner handoff 2026-08-28) ─────────────────────────────────────────────────────────────────
 *
 * A Shop-phase, second-hero-power-shaped ability GRANTED BY A MINION rather than owned by the hero. A minion
 * with an `equip` effect hands its Equipment to the player when played; the player activates it from the
 * second power slot, paying Gold and spending one of a SHARED per-turn allowance.
 *
 * The two facts that shape everything else:
 *
 *  1. **Equipment is not permanently unlocked.** It is rebuilt from the board at the start of every turn, so
 *     keeping it means keeping an Equip minion alive. Within a turn it survives its source leaving.
 *  2. **It is player state, not minion state.** Selling the source mid-turn does not revoke it, and an
 *     activated combat effect belongs to the player once paid for.
 *
 * WHY THE DEFINITION LIVES IN CONTENT, keyed by id, rather than on the card: several cards may grant the same
 * Equipment (the handoff's duplicate/Gilded precedence rules exist precisely for that), so the Equipment is
 * the shared thing and the card is one SOURCE of it. A card names its Equipment by id in its `equip` effect.
 */

/** How an Equipment asks for its target — the same vocabulary hero powers use, so the UI's aim flow is reused. */
export type EquipmentTargetMode =
  /** Fires on click, no target (the hero-power `untargeted` shape). */
  | 'none'
  /** Arms, then takes one friendly BOARD minion. */
  | 'friendly';

export interface EquipmentDefinition {
  id: string;
  name: string;
  /** Full sentence for the tooltip, written as the player reads it. */
  text: string;
  /** The Gilded source's wording. Absent = a Gilded source grants the plain version. */
  goldenText?: string;
  /** Gold to activate. Cost reductions apply on top; the floor is 0. */
  baseCost: number;
  targetMode: EquipmentTargetMode;
  /** The recruit factory that resolves one TRIGGER of this Equipment. */
  effectId: string;
  /** Params for `effectId`. A Gilded source uses `gildedParams` when present. */
  params?: Record<string, number | string>;
  gildedParams?: Record<string, number | string>;
  /**
   * EQUIPMENT SPELL (owner handoff 2026-08-28) — this Equipment CASTS a named Shop spell rather than
   * resolving a bespoke effect. Set it and use `equipmentCastSpell` as the `effectId`.
   *
   * The classification is what matters, and it is deliberately NARROW: an Equipment Spell goes through the
   * real Shop-spell pipeline, so it counts as a Shop spell cast, receives Shop-spell improvements, wakes
   * "after you cast a Shop spell" listeners and can be duplicated by spell multipliers — while never entering
   * the hand, never being offered in the Shop, and never counting as a card PLAYED.
   *
   * The handoff's warning is the reason this is opt-in per Equipment rather than a property of Equipment in
   * general: "Avoid treating every Equipment effect as a spell." Bloodpot is not one.
   */
  spellId?: string;
  /**
   * PRESENTATION for USING it (owner 2026-08-28). Both optional, and both named BY THE EQUIPMENT so a new one
   * brings its own cue without a UI change:
   *  · `useFxId`  — an authored FX def, played from the Equipment BUTTON to the target it was cast on.
   *  · `useSfxId` — an audio clip in `ui/src/audio/`, scheduled on the audio clock beside it.
   */
  useFxId?: string;
  useSfxId?: string;
  /**
   * CHOOSE ONE on an Equipment (owner ask 2026-08-31: *"we need to build prismpick the way it's stated. when
   * it's used it should open the choose one window"*). Present = using this Equipment opens the same Choose
   * One window a card does, and the branch the player picks supplies the effect instead of `effectId`.
   *
   * The card rule carries over unchanged: **the prompt commits nothing.** No Gold, no allowance, no trigger —
   * the activation is replayed from the top once a branch is picked, exactly as a deferred card play is, so
   * every consequence fires once and cancelling is a pure no-op.
   *
   * Gilding rides `gildedParams` per branch, the Equipment system's own channel — equipment factories ignore
   * the source's golden flag (see `equipmentBuffTarget`), and these branches reuse factories that do read it,
   * so the activation hands them a non-gilded self and lets the params carry it. One channel, not two.
   */
  chooseOne?: readonly EquipmentChoice[];
}

/** One branch of an Equipment's Choose One. Same shape as a card's, minus the card. */
export interface EquipmentChoice {
  /** Printed on the option in the picker, as the player reads it. */
  text: string;
  /** The Gilded wording. Absent = the plain text is shown for a Gilded source too. */
  goldenText?: string;
  /** The recruit factory this branch resolves through. */
  effectId: string;
  params?: Record<string, number | string>;
  gildedParams?: Record<string, number | string>;
}

/**
 * BLOODPOT — the reference Equipment (owner handoff: "Implement only Alchemist Frank as the reference card").
 * Deliberately the simplest shape that still exercises the whole system: a Gold cost, a friendly target, a
 * Gilded upgrade, and a plain stat grant whose result is trivially assertable.
 */
export const BLOODPOT: EquipmentDefinition = {
  id: 'bloodpot',
  name: 'Bloodpot',
  text: 'Give a friendly minion **+3/+3**.',
  goldenText: 'Give a friendly minion **+6/+6**.',
  baseCost: 1,
  targetMode: 'friendly',
  effectId: 'equipmentBuffTarget',
  params: { attack: 3, health: 3 },
  gildedParams: { attack: 6, health: 6 },
  useFxId: 'bloodpot',
  useSfxId: 'bloodpot',
};

/**
 * TITAN HAMMER — the second Equipment (owner 2026-08-28), and the first to prove the SELECTOR: two Equipment
 * held at once is what the swap control, the board-order fallback and last-used restoration exist for.
 *
 * SETS stats rather than adding them, which is why it needs its own factory: a body hammered to 50/50 is
 * 50/50 whatever it was, so a 2/1 and a 40/40 end up identical. Gilding doubles the printed numbers, the
 * gilding baseline.
 */
export const TITAN_HAMMER: EquipmentDefinition = {
  id: 'titan_hammer',
  name: 'Titan Hammer',
  text: "Set a friendly minion's stats to **50/50**.",
  goldenText: "Set a friendly minion's stats to **100/100**.",
  baseCost: 3,
  targetMode: 'friendly',
  effectId: 'equipmentSetStats',
  params: { attack: 50, health: 50 },
  gildedParams: { attack: 100, health: 100 },
  useFxId: 'titan-hammer',
  useSfxId: 'titanhammer',
};

/**
 * BLAST PUMP — Blast Surveyor's Equipment (set-3 Kobold roster, 2026-08-30).
 *
 * An EQUIPMENT SPELL: it casts `rubyexcavation`, the shipped set-2 Shop spell whose text is already exactly
 * this payload ("Cast 2 Rubies on all of your minions"). Naming the spell rather than re-implementing the
 * effect is the whole point of the classification — the Rubies land through the real Shop-spell pipeline, so
 * the activation counts as a Shop spell cast and every cast-watcher sees it.
 *
 * `targetMode: 'none'` because the payload is board-wide; there is nothing to aim at.
 *
 * GILDED casts it TWICE rather than naming a bigger spell — two genuine casts, which is what golden means
 * everywhere else and what makes the printed "4 Rubies" true (2 + 2) without a second spell existing.
 */
export const BLAST_PUMP: EquipmentDefinition = {
  id: 'blast_pump',
  name: 'Blast Pump',
  text: 'Cast **2 Rubies** on your minions.',
  goldenText: 'Cast **4 Rubies** on your minions.',
  baseCost: 1,
  targetMode: 'none',
  effectId: 'equipmentCastSpell',
  // BOTH: `spellId` is the CLASSIFICATION (this Equipment is an Equipment Spell — see the field's doc), and
  // `params.spellId` is what the factory reads. They name the same spell and must stay in step; Blast Pump is
  // the first Equipment to use the classification at all, so this is the shape that establishes it.
  spellId: 'rubyexcavation',
  params: { spellId: 'rubyexcavation' },
  gildedParams: { spellId: 'rubyexcavation', count: 2 },
  // Authored by the owner in the FX tuner and published to `fx/defs/blast-pump.json` (2026-08-31), with a
  // clip to match. Named here rather than in the UI so the Equipment carries its own presentation.
  useFxId: 'blast-pump',
  useSfxId: 'blastpump',
};

/**
 * PRISMATIC PICK — Prismpick Artificer's Equipment (set-3 Kobold roster), and the first Equipment to open the
 * CHOOSE ONE window.
 *
 * The two branches are the set's Choose One theme pointed at itself: one hands you another fork to take, the
 * other makes the next fork you take pay both ways. `targetMode: 'none'` — neither branch aims at anything.
 *
 * `effectId` is never fired: the picked branch supplies the effect. It names the second branch's factory so
 * that a build which somehow reached the activation without a pick resolves to something coherent rather than
 * failing the unknown-effect guard.
 *
 * Gilded doubles both branches through `gildedParams` (2 cards / 2 charges), not through the source's golden
 * flag — see the `chooseOne` field's note.
 */
export const PRISMATIC_PICK: EquipmentDefinition = {
  id: 'prismatic_pick',
  name: 'Prismatic Pick',
  text: 'Choose One — get a random **Choose One** card; or your next **Choose One** card this turn gains **both** effects.',
  goldenText: 'Choose One — get **2 random Choose One** cards; or your next **2 Choose One** cards this turn gain **both** effects.',
  baseCost: 2,
  targetMode: 'none',
  effectId: 'grantChooseBothCharges',
  params: { count: 1 },
  gildedParams: { count: 2 },
  chooseOne: [
    {
      text: 'Get a random **Choose One** card.',
      goldenText: 'Get **2 random Choose One** cards.',
      effectId: 'grantRandomChooseOne',
      params: { count: 1 },
      gildedParams: { count: 2 },
    },
    {
      // ADDS charges (no `set`): "your NEXT Choose One card", on top of whatever a Forked Crown already armed.
      text: 'Your next **Choose One** card this turn gains **both** effects.',
      goldenText: 'Your next **2 Choose One** cards this turn gain **both** effects.',
      effectId: 'grantChooseBothCharges',
      params: { count: 1 },
      gildedParams: { count: 2 },
    },
  ],
};

export const EQUIPMENT: readonly EquipmentDefinition[] = [BLOODPOT, TITAN_HAMMER, BLAST_PUMP, PRISMATIC_PICK];

export const EQUIPMENT_INDEX: Readonly<Record<string, EquipmentDefinition>> =
  Object.fromEntries(EQUIPMENT.map((e) => [e.id, e]));

/** The Equipment a card grants, or undefined. Resolved from the card's `equip` effect, so a card never has to
 *  restate the id anywhere else and the two can never disagree. */
export function equipmentOf(def: CardDef | undefined): EquipmentDefinition | undefined {
  const eff = def?.effects.find((e) => e.on === 'equip');
  const id = eff?.params?.equipmentId;
  return typeof id === 'string' ? EQUIPMENT_INDEX[id] : undefined;
}
