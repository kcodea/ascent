/**
 * BEAT SYSTEM — the HERO presentation surface (DoD item 1b: heroes were entirely absent from the registry).
 *
 * Heroes live in `@game/sim` and their powers are bespoke logic keyed by `power.kind`, not content `EffectDef`s
 * — so `@game/content`'s `presentationSurface` (which can't import sim) can't reach them. This sim-side
 * enumerator lists one key per hero, `hero:<id>:<power.kind>`, and the classify tripwire
 * (`heroPolicies.test.ts`) checks each has a registry entry — the same ratchet the content surface gives cards.
 */
import { HEROES } from './heroes';

export interface HeroSurfaceEntry {
  key: string;      // hero:<id>:<power.kind>
  heroId: string;
  name: string;
  powerKind: string;
}

export function heroSurface(): HeroSurfaceEntry[] {
  return HEROES.map((h) => {
    const kind = (h.power as { kind: string }).kind;
    return { key: `hero:${h.id}:${kind}`, heroId: h.id, name: h.name, powerKind: kind };
  }).sort((a, b) => (a.key < b.key ? -1 : 1));
}
