// @vitest-environment jsdom
/**
 * RUNEBIND'S OWN EFFECT, PRESENTATION HALF (owner 2026-10-14): "runebind effect. this should play at all casts of it,
 * when it casts from whaloo, or on whisp etc." The owner's FX Workbench export is the `runebind` def (two cyan/violet
 * shard bursts + a shockwave ring, 900 ms, every layer anchored `target`), bound on Runebind's card the Dragonflame way:
 * `buffedOn` for both its `spellCast` row (the player's cast from hand, a rune's / minion's cast, End of Turn) and its
 * `buffWave` row (a combat buff absorbed into a swing). Every Runebind cast lands exactly one buff on its target, so
 * the def plays ON the target once per cast, from every source (the sim tags are pinned in
 * packages/sim/src/set3Dragons1014.test.ts, R-WHISPER-07). `playDef` is mocked.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { playDef } from './playDef';
import { playCastFanOutBuffFx, resetSpellCastSoundGate } from './spellCastFx';
import { authoredBuffDefFor, castFxReplacesTendril, spellCastFanOutFor, spellCastFxFor } from '../choreo/bindings';

vi.mock('./playDef', () => ({ playDef: vi.fn(() => () => {}), canPlayDefs: vi.fn(() => true) }));
vi.mock('../sfx', () => ({ sfx: new Proxy({} as Record<string, unknown>, { get: (t, k: string) => (t[k] ??= vi.fn()) }) }));
const mockPlayDef = vi.mocked(playDef);

beforeEach(() => { mockPlayDef.mockClear(); resetSpellCastSoundGate(); });

describe('Runebind\'s FX def is bound and plays on the target of every cast', () => {
  it('the def is the owner\'s export: 900 ms, two shard bursts + a shockwave, all on the target', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const def = JSON.parse(readFileSync(join(here, 'defs', 'runebind.json'), 'utf8')) as { id: string; duration: number; layers: { primitive: string; anchor: string }[] };
    expect([def.id, def.duration]).toEqual(['runebind', 900]);
    expect(def.layers.map((l) => l.primitive)).toEqual(['burst', 'burst', 'shockwave']);
    expect(def.layers.every((l) => l.anchor === 'target')).toBe(true);
  });

  it('bound `buffedOn` on both rows (Dragonflame\'s shape): no single play at the cast, one play per buff', () => {
    expect(spellCastFanOutFor('w4_runebind')).toMatchObject({ def: 'runebind', fanOut: 'buffedOn' });
    expect(authoredBuffDefFor('w4_runebind')).toBe('runebind');
    expect(spellCastFxFor('w4_runebind'), 'never a second play at the caster').toBeNull();
    expect(castFxReplacesTendril('w4_runebind')).toBe(false);
  });

  it('one play ON each target, per cast (Whaloo\'s three casts and a Whisp echo: four plays, four targets)', () => {
    const A = { x: 100, y: 200 }, B = { x: 300, y: 200 };
    for (const [t, uid] of [[A, 'a'], [A, 'a'], [B, 'w'], [A, 'a']] as const) {
      expect(playCastFanOutBuffFx({ spellId: 'w4_runebind', from: { x: 0, y: 0 }, target: t, targetUid: uid })).toBe(true);
    }
    const plays = mockPlayDef.mock.calls.filter((c) => c[0] === 'runebind');
    expect(plays).toHaveLength(4);
    for (const c of plays) {
      const anchors = c[1] as { source: unknown; target: unknown };
      expect(anchors.source).toEqual(anchors.target); // ON the target, not travelling from the caster
    }
  });
});
