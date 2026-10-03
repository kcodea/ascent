/**
 * DOC BOT LANE `shoutTriggerParity` (R-SHOUT-TRIGGER-01): a TRIGGERED Shout is a Shout, for every listener.
 *
 * Owner reports 2026-10-03: "auctioneer w/ rune of the choir does not work and it should", then "pulse or other
 * triggering options should absolutely trigger the extra shouts in this case. make sure all of this logic works
 * across the board". Two halves (see shoutTriggerParity.ts):
 *   · SOURCE: every Shop and combat site that fires a Shout reads its phase's ONE fold, and only the combat
 *     chokepoint notifies `battlecryTriggered`. A new hand-rolled Shout loop fails here the day it lands.
 *   · BEHAVIOUR: every Shout modifier (Choir family, Blasting Voices, Encore, Warm Embers, War Drum) × every entry
 *     path (played, Pulse, replayBattlecry, Ryme, Parting Cry, Shared Scripture, Ancestral Roar, War Chorus):
 *     the fire count, the Shout tally, a watcher, the edge buff and the charge latch all agree.
 */
import { describe, expect, it } from 'vitest';
import { SHOP_SHOUT_FIRE_SCOPES, SHOUT_ENTRY_PATHS, SHOUT_MODIFIERS, auditShoutParity, shoutModifierMatrix } from './shoutTriggerParity';

describe('Doc Bot — Shout-trigger parity (source)', () => {
  const audit = auditShoutParity();

  it('the scan sees both phases (the instrument is not blind)', () => {
    expect(audit.shop.length).toBeGreaterThanOrEqual(4);
    expect(audit.combat.map((s) => s.key)).toContain('factories.ts#replayCombatBattlecry#onPlay');
  });

  it('every shop scope that fires a Shout is classified', () => {
    const list = audit.unclassified.map((s) => `${s.file}:${s.line} ${s.scope}`);
    expect(list, `Unclassified Shout fire scope(s): ${list.join(' · ')} — add it to SHOP_SHOUT_FIRE_SCOPES and make its count read shoutFireCount.`).toEqual([]);
  });

  it('no registry entry describes a scope that no longer exists', () => {
    expect(audit.stale).toEqual([]);
  });

  it('NO DEAF SITE: every Shout fire site reads its phase\'s fold (and, in combat, notifies per fire)', () => {
    const list = audit.deaf.map((s) => `${s.file}:${s.line} ${s.key}`);
    expect(list, `Shout fired outside the fold: ${list.join(' · ')} — a triggered Shout is a Shout (R-SHOUT-TRIGGER-01). Shop: count with shoutFireCount. Combat: fire through fireShout / replayCombatBattlecry.`).toEqual([]);
  });

  it('only the combat chokepoint emits battlecryTriggered (one notify per fire, never a hand-rolled one)', () => {
    const list = audit.strayNotifies.map((n) => `${n.file}:${n.line} ${n.scope}`);
    expect(list, `battlecryTriggered emitted outside replayCombatBattlecry: ${list.join(' · ')}`).toEqual([]);
  });

  it('only the settle replay is excused, and it says why', () => {
    expect(Object.entries(SHOP_SHOUT_FIRE_SCOPES).filter(([, e]) => e.counter === 'settle').map(([k]) => k)).toEqual(['replayEconomyBattlecry']);
  });
});

describe('Doc Bot — Shout-trigger parity (behaviour): every modifier × every entry path', () => {
  const cells = shoutModifierMatrix();

  it('the matrix is complete (every modifier on every path)', () => {
    expect(cells).toHaveLength(SHOUT_MODIFIERS.length * SHOUT_ENTRY_PATHS.length);
  });

  for (const mod of SHOUT_MODIFIERS) {
    it(`${mod.label}: every path fires ${mod.fires}× and every listener hears each fire`, () => {
      const bad = cells.filter((c) => c.modifier === mod.id && !c.pass)
        .map((c) => `${c.path}: fires ${c.fires} tally ${c.tally} watcher ${c.watcher} edge ${c.edge} latch ${c.latchSpent} (want ${c.expected})`);
      expect(bad).toEqual([]);
    });
  }
});
