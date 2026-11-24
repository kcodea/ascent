import type { EffectDef, EffectFactoryId } from '../types';

/**
 * WHAT IS AN ECHO — the one definition every phase reads (R-ECHO-WATCHER-01, owner report 2026-11-20: "an
 * echohorn just triggered a brood matron - that shouldnt happen since it is not an echo").
 *
 * An Echo is an `onDeath` effect that fires when ITS OWN body dies. The `onDeath` bus also carries FRIEND-DEATH
 * WATCHERS — effects that react to SOMEONE ELSE dying (they read the dead body from the payload and no-op on their
 * own death). Those ride the same trigger only because the bus is shared; they are not Echoes and their cards print
 * no "Echo:". Every "has an Echo" / "trigger its Echo" / "copy its Echo" / "strip its Echo" consumer goes through
 * `isEchoEffect`, so a watcher can never be picked, fired, counted, copied or stripped as an Echo.
 *
 * The wide reading stays: an Echo is ANY own-death `onDeath` effect, not only `deathrattle*` ids (owner report
 * 2026-07-31: Moss Colossus, Runesnout, Anvilshade, Brunni, Spencer, Antsy … are Echoes). A NEW friend-death
 * watcher factory must be added here; the shop's friendly-death broadcast reads this same set.
 */
export const DEATH_WATCHER_FACTORIES: ReadonlySet<EffectFactoryId> = new Set<EffectFactoryId>([
  'impInheritOnDeath', // Ashen Heir: a friendly Imp died → pass its stats on
  'onFriendDeathGainEcho', // Echo Mimic: another friendly died → gain ITS Echo
  'onAnyDeathGainSelf', // Huntsman: any minion died, either side → it gains stats
]);

/** Is this effect an Echo (an own-death `onDeath` effect), as opposed to a friend-death watcher? */
export function isEchoEffect(e: Pick<EffectDef, 'on' | 'do'>): boolean {
  return e.on === 'onDeath' && !DEATH_WATCHER_FACTORIES.has(e.do);
}

/** Does this effect list carry at least one Echo? */
export function hasEchoEffect(effects: readonly Pick<EffectDef, 'on' | 'do'>[] | undefined): boolean {
  return !!effects && effects.some(isEchoEffect);
}
