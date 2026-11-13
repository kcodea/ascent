/**
 * The RUNE-HIT channel (R-RUNE-SPIKE-FX-01, owner 2026-11-13: *"for pitchforks and other similar runes/effects, use
 * the fel spikes animation"*) — which hits inside a moment were dealt by a RUNE's own effect, from which body, at
 * which units.
 *
 * A rune has no body and no card, so the ordinary binding path (the moment's source → its card → `bindings.json`)
 * cannot reach it: Wildfire's hit and Imp Legion's Echo are sourceless, and a Pitchforks, Hellfire or Mirror Sheen hit names
 * whatever Imp, Demon or Warded minion dealt it. The engine therefore stamps each rune hit's OWN event (`tagRuneHit` in
 * `simulate.ts`: its `dmg`, or the Ward pop that absorbed it) with `key: 'rune:<runeId>:hit'` + `srcCard: <runeId>`,
 * and the rune's `questTrigger` names the body the effect visibly comes FROM (`from`). Imp Legion's hit is a grafted
 * Echo whose effect key is its own (`factory:deathrattleDamageLowestEnemy:onDeath`, used by nothing else), so it is
 * read off that key.
 *
 * `bindings.json` binds these by RUNE id under `cards` (`rune_hellfire.damage` → `fel-spike`), resolved with the
 * same `bindingFor(runeId, 'damage')` every card uses. A `launchOnDeath` binding means what it means for Fel Spikes:
 * the projectile launches a beat EARLY (here: as the rune's trigger beat plays) and the hit beat is held for its
 * travel, so the number lands as the spike connects.
 *
 * Pure: this is the testable surface. `useCombatReplay` schedules the launch + hold, `score.ts` claims the stock hit
 * burst for the struck units.
 */
import type { CombatEvent } from '@game/core';
import { RUNE_INDEX } from '@game/content';
import type { Moment } from '../compile';

/** Effect keys that ARE a rune's hit without a `rune:` stamp: a rune-grafted effect whose factory nothing else uses. */
const RUNE_HIT_FACTORY_KEYS: Readonly<Record<string, string>> = {
  'factory:deathrattleDamageLowestEnemy:onDeath': 'rune_imp_legion', // Imp Legion's grafted Echo
};

/** The rune whose OWN hit this event is, or null. A hit is a `dmg`, or the Ward pop / downgrade that absorbed it. */
export function runeOfHit(e: CombatEvent | undefined): string | null {
  if (!e || (e.type !== 'dmg' && e.type !== 'shield' && e.type !== 'wardDowngrade')) return null;
  const key = e.key;
  if (typeof key !== 'string') return null;
  if (key.startsWith('rune:') && key.endsWith(':hit')) return typeof e.srcCard === 'string' ? e.srcCard : key.slice(5, -4);
  return RUNE_HIT_FACTORY_KEYS[key] ?? null;
}

/** The combat flag a rune's `questTrigger` carries (`rune_hellfire` → `runeHellfire`), or null. */
function flagOfRune(runeId: string): string | null {
  const reward = RUNE_INDEX[runeId]?.reward as { kind?: string; flag?: string } | undefined;
  return reward?.kind === 'combatFlag' && typeof reward.flag === 'string' ? reward.flag : null;
}

export interface RuneHitGroup {
  runeId: string;
  /** The body the effect comes FROM: the hit's own `source` (the Imp, the Warded minion) or, for a sourceless volley
   *  (Wildfire, Imp Legion), the `from` on the rune's trigger that preceded it. Null when neither names one. */
  from: string | null;
  /** The units struck, in log order, de-duplicated (a Ward-absorbed hit included). */
  targets: string[];
  /** How many of them took actual damage (a number fires): gates the landing sound, like Fel Spikes' volley. */
  damaged: number;
}

/** The source body of the rune hit at `idx`: its own `source`, else the nearest preceding trigger's `from`. */
function fromOfHit(events: readonly CombatEvent[], idx: number, runeId: string): string | null {
  const e = events[idx];
  if (e?.type === 'dmg' && typeof e.source === 'string') return e.source;
  const flag = flagOfRune(runeId);
  if (!flag) return null;
  for (let j = idx - 1; j >= 0; j--) {
    const t = events[j];
    if (t?.type === 'questTrigger' && t.flag === flag) return typeof t.from === 'string' ? t.from : null;
  }
  return null;
}

/** Every rune hit in `moment`, grouped by (rune, source body) in first-seen order: one Hellfire volley is ONE group
 *  of every enemy it struck (one spray), Pitchforks' two hits from one Imp are one group. */
export function runeHitsIn(moment: Pick<Moment, 'start' | 'end'>, events: readonly CombatEvent[]): RuneHitGroup[] {
  const out: RuneHitGroup[] = [];
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    const runeId = runeOfHit(e);
    if (!runeId || !e || !('target' in e) || typeof e.target !== 'string') continue;
    const from = fromOfHit(events, i, runeId);
    let g = out.find((x) => x.runeId === runeId && x.from === from);
    if (!g) { g = { runeId, from, targets: [], damaged: 0 }; out.push(g); }
    if (!g.targets.includes(e.target)) {
      g.targets.push(e.target);
      if (e.type === 'dmg') g.damaged += 1;
    }
  }
  return out;
}

/** True when `moment` holds any rune hit at all — the cheap pre-check before the grouping (most moments have none). */
export function hasRuneHit(moment: Pick<Moment, 'start' | 'end'>, events: readonly CombatEvent[]): boolean {
  for (let i = moment.start; i < moment.end; i++) if (runeOfHit(events[i]) !== null) return true;
  return false;
}
