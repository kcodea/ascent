/**
 * SET 3 WHISPERS, PRESENTATION (owner 2026-10-14):
 *  - "runebind should be a tracked buff in the buffs panel": a Whisper's grant is its own named row (a combat cast uses
 *    the same name, owner 2026-10-14: no "this combat" suffix; owner 2026-10-15: no "until your next turn" either).
 *  - Whaloo's "(3 times per combat)" counts down LIVE in combat; Tolan's Runebind value rises LIVE as combat casts land.
 */
import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { whisperCombatBuffLabel } from './buffExpiry';
import { whisperCasterText, whisperGranterText } from './cardText';
import { computeFrame } from './useCombatReplay';

const m = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack: CARD_INDEX[cardId]!.attack, health: CARD_INDEX[cardId]!.health, keywords: [], ...over } as unknown as BoardMinion);

describe('the buffs panel names a Whisper', () => {
  it('a combat Whisper cast uses its Whisper name (rows carry no expiry note since 2026-10-15)', () => {
    expect(whisperCombatBuffLabel('w4_runebind')).toBe('Runebind');
    expect(whisperCombatBuffLabel('growth')).toBeNull();
  });

  it('the combat replay ledgers Whaloo\'s Runebind under "Runebind" with its amounts', () => {
    const p = [m('d4_galas', { health: 60 }), m('d3_whaloo', { attack: 0, health: 100 })];
    const r = simulate(p, [m('sandbag', { attack: 1, health: 500 })], makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const names = new Map([...r.initial.player, ...r.initial.enemy].map((x) => [x.uid, x.name]));
    const galasUid = r.initial.player[0]!.uid;
    const first = r.events.findIndex((e) => e.type === 'buff' && e.target === galasUid && e.spellId === 'w4_runebind');
    expect(first).toBeGreaterThan(-1);
    const frame = computeFrame(r.initial, r.events, first + 1, first + 1, names);
    const galas = frame.player.find((u) => u.uid === galasUid)!;
    const row = galas.buffs?.find((b) => b.source === 'Runebind');
    expect(row).toBeTruthy();
    expect([row!.attack, row!.health]).toEqual([2, 2]);
    expect(row!.count).toBeGreaterThanOrEqual(1);
  });
});

describe('live combat text', () => {
  it('Whaloo prints its cap in the Shop and counts down in combat', () => {
    expect(whisperCasterText('d3_whaloo', false, undefined)).toContain('**(3 times per combat)**');
    expect(whisperCasterText('d3_whaloo', false, 1)).toContain('{{(2 left this combat)}}');
    expect(whisperCasterText('d3_whaloo', true, 3)).toContain('{{(0 left this combat)}}');
    expect(whisperCasterText('d3_whaloo', true, undefined)).toContain('Gilded Runebind');
    expect(whisperCasterText('venom', false, 1)).toBeNull();
  });

  it('the replay stamps Whaloo\'s trigger count and the side\'s live Runebind improvement (Tolan reads it)', () => {
    const p = [m('d4_tolan', { health: 60 }), m('d3_whaloo', { attack: 0, health: 100 }), m('d3_morro', { attack: 0, health: 100 })];
    const r = simulate(p, [m('sandbag', { attack: 1, health: 500 })], makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const names = new Map([...r.initial.player, ...r.initial.enemy].map((x) => [x.uid, x.name]));
    const frame = computeFrame(r.initial, r.events, r.events.length, r.events.length, names);
    const whaloo = frame.player.find((u) => u.cardId === 'd3_whaloo')!;
    expect(whaloo.whisperCastsUsed, 'triggers, not Morro\'s extra casts').toBe(3);
    const tolan = frame.player.find((u) => u.cardId === 'd4_tolan')!;
    expect(tolan.whisperImproveLive?.['w4_runebind']).toBe(12); // 6 casts x +2
    expect(whisperGranterText('d4_tolan', false, { whisperImprove: tolan.whisperImproveLive as Record<string, number> })).toContain('{{+14/+14}}');
  });
});
