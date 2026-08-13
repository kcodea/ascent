/**
 * BEAT SYSTEM — cutover slice 1: compile an authoritative End-of-Turn PresentationBatch into per-beat FX
 * categories, the shape the live player needs. This is the adapter that lets the future `RecruitBeatPlayer`
 * drive the End-of-Turn animation from the event stream instead of `projectEndOfTurnSteps` — and, right now,
 * the thing an equivalence test checks so we KNOW the batch carries everything the legacy path shows before any
 * live code changes (Codex's "temporary equivalence mode"; no live change in this slice).
 *
 * Each consequence class maps to a legacy `EotStepFx` category:
 *   statsChanged(board) → stat ticks · rubyPlayed → ruby cascade · cardGranted(hand) → hand grants ·
 *   shopChanged(buffed) → shop-offer growth · auraChanged(spellPower|impAura) → the aura washes ·
 *   counterChanged(attachments) → welds · cardDestroyed(board) → Fodder eaten.
 */
import type { GamePresentationEvent, PresentationBatch, SourceTriggerEvent, ConsequenceEvent } from '@game/core';

export interface EotBeatFx {
  trigger: SourceTriggerEvent;
  stats: Array<{ uid: string; attack: number; health: number }>;
  rubies: Array<{ uid: string; count: number }>;
  handGrants: string[];
  shopBuff: Array<{ uid: string; attack: number; health: number }>;
  spellPower: { attack: number; health: number };
  impAura: { attack: number; health: number };
  /** Host uids that gained an Attachment this beat (welds) — the UI rings each as it fuses. */
  weldHosts: string[];
  eaten: number;
}

const isTrigger = (e: GamePresentationEvent): e is SourceTriggerEvent => e.type === 'sourceTrigger';

/** Compile the batch into one FX bundle per source-trigger beat, in emission order. */
export function compileEotFx(batch: PresentationBatch): EotBeatFx[] {
  const byParent = new Map<string, ConsequenceEvent[]>();
  for (const e of batch.events) {
    if (!isTrigger(e) && e.parentId) (byParent.get(e.parentId) ?? byParent.set(e.parentId, []).get(e.parentId)!).push(e);
  }
  const beats: EotBeatFx[] = [];
  for (const e of batch.events) {
    if (!isTrigger(e)) continue;
    const fx: EotBeatFx = { trigger: e, stats: [], rubies: [], handGrants: [], shopBuff: [], spellPower: { attack: 0, health: 0 }, impAura: { attack: 0, health: 0 }, weldHosts: [], eaten: 0 };
    for (const c of byParent.get(e.id) ?? []) {
      switch (c.type) {
        case 'statsChanged': if (c.target.zone === 'board' && c.target.uid) fx.stats.push({ uid: c.target.uid, attack: c.attack, health: c.health }); break;
        case 'rubyPlayed': if (c.target.uid) fx.rubies.push({ uid: c.target.uid, count: c.count }); break;
        case 'cardGranted': if (c.target.zone === 'hand') fx.handGrants.push(c.cardId); break;
        case 'shopChanged': if (c.change === 'buffed' && c.target.uid) fx.shopBuff.push({ uid: c.target.uid, attack: c.attack ?? 0, health: c.health ?? 0 }); break;
        case 'auraChanged':
          if (c.aura === 'spellPower') { fx.spellPower.attack += c.attack ?? 0; fx.spellPower.health += c.health ?? 0; }
          else if (c.aura === 'impAura') { fx.impAura.attack += c.attack ?? 0; fx.impAura.health += c.health ?? 0; }
          break;
        case 'counterChanged': if (c.counter === 'attachments' && c.target?.uid) fx.weldHosts.push(c.target.uid); break;
        case 'cardDestroyed': if (c.target.zone === 'board') fx.eaten += 1; break;
        default: break;
      }
    }
    beats.push(fx);
  }
  return beats;
}

/** Aggregate every beat's categories into run-totals — the coarse view an equivalence check compares. */
export function aggregateEotFx(beats: readonly EotBeatFx[]): {
  stats: Map<string, { attack: number; health: number }>;
  rubies: Map<string, number>;
  handGrants: string[];
  shopBuff: Map<string, { attack: number; health: number }>;
  spellPower: { attack: number; health: number };
  impAura: { attack: number; health: number };
  eaten: number;
} {
  const stats = new Map<string, { attack: number; health: number }>();
  const rubies = new Map<string, number>();
  const handGrants: string[] = [];
  const shopBuff = new Map<string, { attack: number; health: number }>();
  const spellPower = { attack: 0, health: 0 };
  const impAura = { attack: 0, health: 0 };
  let eaten = 0;
  const bump = (m: Map<string, { attack: number; health: number }>, uid: string, a: number, h: number): void => {
    const p = m.get(uid) ?? { attack: 0, health: 0 }; p.attack += a; p.health += h; m.set(uid, p);
  };
  for (const b of beats) {
    for (const s of b.stats) bump(stats, s.uid, s.attack, s.health);
    for (const r of b.rubies) rubies.set(r.uid, (rubies.get(r.uid) ?? 0) + r.count);
    handGrants.push(...b.handGrants);
    for (const sb of b.shopBuff) bump(shopBuff, sb.uid, sb.attack, sb.health);
    spellPower.attack += b.spellPower.attack; spellPower.health += b.spellPower.health;
    impAura.attack += b.impAura.attack; impAura.health += b.impAura.health;
    eaten += b.eaten;
  }
  return { stats, rubies, handGrants, shopBuff, spellPower, impAura, eaten };
}
