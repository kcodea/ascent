/**
 * R-FX-BUFF-WATCHER-01 (owner 2026-11-09): a minion with its own buff effect (Beardsley, Vicious, Kennelmaster's bite)
 * plays that effect on each minion it buffs INSTEAD of the tendril, and plays its own On Watcher effect on ITSELF, once
 * per buffer per trigger, in the Shop and in combat.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const played: Array<{ id: string; uid: string | null; to?: string | null; target?: { x: number; y: number }; muteSound?: boolean }> = [];
vi.mock('../fx/playDef', () => ({
  playDef: (id: string, a: { target: { x: number; y: number } }, o?: { uids?: { source?: string | null; target?: string | null }; muteSound?: boolean }) => {
    played.push({ id, uid: o?.uids?.source ?? null, to: o?.uids?.target ?? null, target: a.target, ...(o?.muteSound ? { muteSound: true } : {}) });
  },
}));

const { bindingFor, sourceBuffDefFor } = await import('./bindings');
const { buffSourceDelayMs, buffSourceRanks, hasOwnBuffFx, oneBitePerTarget, playBuffSourceWatcher } = await import('./buffWatcher');
const { recruitMomentsSince } = await import('./recruitMoments');
const { CARD_EVENT_SLOTS } = await import('../fx/ui/cardEventSlots');

const BITERS = ['b2_beardsley', 'b2_florida', 'kennel'];
const watcherSlot = CARD_EVENT_SLOTS.find((s) => s.id === 'watcher')!;

afterEach(() => { played.length = 0; });

describe('a buffer with its own buff effect (R-FX-BUFF-WATCHER-01)', () => {
  it('Beardsley, Vicious and Kennelmaster bite the Beasts they buff (Shop and combat), not the tendril', () => {
    for (const id of BITERS) {
      expect(bindingFor(id, 'minionBuffed')?.def, id).toBe('beast-buff-bite');
      expect(sourceBuffDefFor(id), id).toBe('beast-buff-bite');
      expect(hasOwnBuffFx(id), id).toBe(true);
    }
  });

  it('plays its On Watcher effect on itself, and offers the slot in the workbench', () => {
    for (const id of BITERS) {
      playBuffSourceWatcher(id, `u-${id}`, { x: 1, y: 2 });
      expect(watcherSlot.kindFor({ cardId: id, spell: false } as never), id).toBe('watcher');
    }
    expect(played.map((p) => ({ id: p.id, uid: p.uid }))).toEqual(BITERS.map((id) => ({ id: 'beast-buff-bite-watcher', uid: `u-${id}` })));
  });

  it('travels from the buffer TO the minion it buffs, so a beam crosses between them (Kennelmaster to a Beast)', () => {
    playBuffSourceWatcher('kennel', 'k', { x: 0, y: 0 }, { uid: 'beast', at: { x: 300, y: 40 } });
    expect(played).toEqual([{ id: 'beast-buff-bite-watcher', uid: 'k', to: 'beast', target: { x: 300, y: 40 } }]);
  });

  it('a fan-out rings once: Kennelmaster biting three Beasts plays the later ones without sound', async () => {
    const src = await import('node:fs').then((m) => m.readFileSync(new URL('../useCombatReplay.ts', import.meta.url), 'utf8'));
    expect(src).toContain('const muteSound = srcRang.has(c.source);');
    playBuffSourceWatcher('kennel', 'k', { x: 0, y: 0 }, { uid: 'b1', at: { x: 1, y: 1 } }, false);
    playBuffSourceWatcher('kennel', 'k', { x: 0, y: 0 }, { uid: 'b2', at: { x: 2, y: 2 } }, true);
    expect(played.map((p) => !!p.muteSound)).toEqual([false, true]);
  });

  it('two Beardsleys buffing one Beast in the Shop take turns, 90 ms apart, instead of biting at once', () => {
    const events = [
      { sourceCardId: 'b2_beardsley', sourceUid: 'bA', targetUid: 'beast', attack: 2, health: 1 },
      { sourceCardId: 'b2_beardsley', sourceUid: 'bB', targetUid: 'beast', attack: 2, health: 1 },
    ];
    const ranks = buffSourceRanks(events);
    expect([buffSourceDelayMs(ranks.get('bA')), buffSourceDelayMs(ranks.get('bB'))]).toEqual([0, 90]);
    const moments = recruitMomentsSince({ recruitFxSeq: 1, recruitBuffFx: events } as never, {});
    expect(moments.filter((m) => m.kind === 'minionBuffed').map((m) => m.sourceUid)).toEqual(['bA', 'bB']);
    expect(buffSourceRanks([{ sourceCardId: 'drummer', sourceUid: 'd' }]).size).toBe(0);
  });

  it('the Shop plays every buffer watcher BEFORE the per-target coalescer folds two Beardsleys into one record', async () => {
    const src = await import('node:fs').then((m) => m.readFileSync(new URL('../Recruit.tsx', import.meta.url), 'utf8'));
    const watcherPass = src.indexOf('playBuffSourceWatcher(ev.sourceCardId, sourceUid');
    const coalesce = src.indexOf('const coalesced = coalesceBuffFxByTarget(events);');
    expect(watcherPass).toBeGreaterThan(0);
    expect(watcherPass).toBeLessThan(coalesce);
  });

  it('two Beardsleys on one Beast in the Shop: one bite (the first buffer), both watchers still play', () => {
    const bA = { kind: 'minionBuffed' as const, sourceCardId: 'b2_beardsley', sourceUid: 'bA', recipients: [{ uid: 'beast', count: 1 }] };
    const bB = { ...bA, sourceUid: 'bB', recipients: [{ uid: 'beast', count: 1 }, { uid: 'other', count: 1 }] };
    const ruby = { kind: 'rubyLanded' as const, recipients: [{ uid: 'beast', count: 1 }] };
    const out = oneBitePerTarget([bA, bB, ruby]);
    expect(out.map((m) => [m.sourceUid ?? m.kind, m.recipients.map((r) => r.uid)])).toEqual([['bA', ['beast']], ['bB', ['other']], ['rubyLanded', ['beast']]]);
    expect(oneBitePerTarget([bA, { ...bA, sourceUid: 'bB' }]).map((m) => m.sourceUid)).toEqual(['bA']);
  });

  it('combat plays one bite per minion too, but only for a buffer with a watcher (Karwind and King Oona still play per buffer)', async () => {
    const k = { kind: 'minionBuffed' as const, sourceCardId: 'karwind', sourceUid: 'k1', recipients: [{ uid: 'd', count: 1 }] };
    expect(oneBitePerTarget([k, { ...k, sourceUid: 'k2' }])).toHaveLength(2);
    const src = await import('node:fs').then((m) => m.readFileSync(new URL('../useCombatReplay.ts', import.meta.url), 'utf8'));
    expect(src).toContain("const oneBite = bindingFor(cardId, 'watcher') !== null;");
    expect(src).toContain('if (oneBite && bitten.has(biteKey)) { target?.stop(); return; }');
  });

  it('both effects ride their card as it moves (Follow source): the bite its Beast, the watcher its buffer', async () => {
    const { getDef } = await import('../fx/fxDefs');
    expect(getDef('beast-buff-bite')?.followSource).toBe(true);
    expect(getDef('beast-buff-bite-watcher')?.followSource).toBe(true);
  });

  it('a card with no own buff effect plays nothing through this path', () => {
    playBuffSourceWatcher('drummer', 'd', { x: 0, y: 0 }); // Drakko: a watcher def, but no buff effect of its own
    expect(played).toEqual([]);
  });
});
