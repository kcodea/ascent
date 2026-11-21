/**
 * EACH ANCIENT'S OWN TENDRIL (owner 2026-11-21, R-FX-ANCIENT-TENDRIL-02): "create bespoke tendril effects for each of
 * the 6 ancients when they trigger a combat or shop effect".
 *
 * An Ancient's stat grant already streams a tendril (R-FX-ANCIENT-TENDRIL-01) from wherever its pairing starts
 * (R-FX-ANCIENT-ORIGIN-01: the hero-power button, or the minion that set it off). This file only decides WHICH def
 * that tendril plays: the Ancient's own `ancient-tendril-<id>` when one has been saved, else the generic gold
 * `rune-buff-trail` exactly as before.
 *
 * AUTHORING = SAVING A FILE. Open `rune-buff-trail` (or anything) in the FX workbench, make it that Ancient's, and Save
 * it as one of the six ids below. The def is looked up by id at fire time (`getDef`), so it goes live on Save with no
 * code change, and its ribbon's `travelMs` moves the stat roll with it, like every other tendril.
 *
 *   ancient-tendril-death   ancient-tendril-fortune   ancient-tendril-war
 *   ancient-tendril-genesis ancient-tendril-time      ancient-tendril-bonds
 */
import { ANCIENTS, ANCIENT_IDS, type AncientId } from '@game/sim';
import { getDef } from './fxDefs';
import { hasPrimitives } from './registry';
import type { StoredFxDef } from './defStore';

/** The def id an Ancient's bespoke tendril is saved under. */
export function ancientTendrilDefId(id: AncientId): string {
  return `ancient-tendril-${id}`;
}

/** Every id the workbench should save to, in the Ancients' own order. */
export const ANCIENT_TENDRIL_DEF_IDS: readonly string[] = ANCIENT_IDS.map(ancientTendrilDefId);

/**
 * The combat labels that name a hero POWER rather than its Ancient (the pairings that print the power's own name,
 * `*_COMBAT_LABEL` in sim/ancients.ts). The label alone cannot always say which Ancient: "Aegis" is BOTH Warden × Bonds
 * and Warden × Time. So these resolve to the side's picked Ancient when the caller knows it (the player's run), else to
 * the one Ancient the label can only mean (null = ambiguous: the generic trail plays). Combat only: the Shop tags its
 * records with the Ancient directly, so base Warden's own Shop "Aegis" grant never reaches this.
 */
const POWER_LABEL_ANCIENT: Readonly<Record<string, AncientId | null>> = {
  'Rounded Spellbook': 'bonds', // HUNCH_BONDS_COMBAT_LABEL, Hunch × Bonds only
  'Pocket Magic': 'bonds', // MERRIN_BONDS_COMBAT_LABEL, Merrin × Bonds only
  Aegis: null, // WARDEN_TIME_COMBAT_LABEL, also Warden × Bonds' label
};

let byName: ReadonlyMap<string, AncientId> | null = null;

/**
 * The Ancient a grant's source LABEL belongs to (`"Ancient of War"` → `war`), or undefined for any other source.
 * `sidePicked` = the granting side's picked Ancient, when known: it settles a power-name label.
 */
export function ancientOfLabel(label: string | null | undefined, sidePicked?: AncientId): AncientId | undefined {
  if (!label) return undefined;
  byName ??= new Map(ANCIENT_IDS.map((id) => [ANCIENTS[id].name, id]));
  const named = byName.get(label);
  if (named) return named;
  if (!(label in POWER_LABEL_ANCIENT)) return undefined;
  return sidePicked ?? POWER_LABEL_ANCIENT[label] ?? undefined;
}

/**
 * The Ancient's saved tendril def, or undefined while it has none (the caller then plays the generic trail).
 *
 * NEVER READS THE REGISTRY BEFORE THE PRIMITIVES REGISTER (`fxDefs.ts`'s ORDER MATTERS note): the registry drops layers
 * whose primitive is unknown and caches that on first read, so a `getDef` ahead of `ensureDefsReady()` would strip EVERY
 * def to zero layers for the whole session. Until then this answers "none" and the generic trail plays (it is a
 * `playDef` too, which waits for the same readiness). A def left with no playable layers also counts as none.
 */
export function ancientTendrilDef(id: AncientId | null | undefined): StoredFxDef | undefined {
  if (!id || !hasPrimitives()) return undefined;
  const def = getDef(ancientTendrilDefId(id));
  return def && def.layers.length > 0 ? def : undefined;
}

/**
 * When the def's tendril ARRIVES, so the stat roll lands with it: the ribbon's `travelMs`, else the first
 * target-anchored layer's `at` (a def built around a landing burst), else `fallbackMs`.
 *
 * `index` is the recipient's place in its burst (`playDef`'s `index`): the layer that sets the landing time is delayed
 * by its own workbench Stagger × `index`, so a staggered minion's stat rolls when ITS tendril lands, not the first one's.
 */
export function ancientTendrilLandingMs(def: StoredFxDef, fallbackMs: number, index = 0): number {
  const ribbon = def.layers.find((l) => l.primitive === 'ribbon' && typeof l.travelMs === 'number');
  if (ribbon?.travelMs !== undefined) return ribbon.travelMs + (ribbon.stagger ?? 0) * index;
  const landing = def.layers.find((l) => l.anchor === 'target' && typeof l.at === 'number');
  return landing ? landing.at + (landing.stagger ?? 0) * index : fallbackMs;
}

/** The run's picked Ancient (undefined outside an Ancients run or before the pick): settles a power-name label. */
export function pickedAncientOf(run: { ancientsEnabled?: boolean; ancients?: { picked?: AncientId } }): AncientId | undefined {
  return run.ancientsEnabled ? run.ancients?.picked : undefined;
}
