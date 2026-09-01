import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bindingAt,
  bindingBeneathDraft,
  bindingFor,
  bindingsJson,
  bindingWithout,
  clearBinding,
  DRAFT_DEF_ID,
  effectiveTables,
  parseTable,
  resetBindings,
  setBinding,
  unbindJson,
  HUD_BINDING_KINDS,
} from './bindings';
import { CARD_INDEX } from '@game/content';
import { SCORE_DEFAULTS } from './score';
import { RECRUIT_MOMENT_KINDS } from './recruitMoments';

// The session patch is module-level shared state — a `setBinding` in one test would otherwise leak into
// every test that runs after it in this file, including the FILE-baseline assertions below that predate the
// override layer and know nothing about it.
beforeEach(() => resetBindings());

describe('parseTable', () => {
  it('accepts a well-formed table', () => {
    const t = parseTable({
      version: 1,
      kinds: { scCast: { def: 'spell-cast' } },
      cards: { bloodbinder: { scCast: { def: 'ruby-lance', fanOut: 'damaged' } } },
    });
    expect(t.kinds.scCast).toEqual({ def: 'spell-cast' });
    expect(t.cards.bloodbinder?.scCast).toEqual({ def: 'ruby-lance', fanOut: 'damaged' });
  });

  // Per-entry, not all-or-nothing: losing one binding must not cost the others.
  it('drops only the bad entry and keeps the rest, naming the key', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = parseTable({
      version: 1,
      kinds: { scCast: { def: 'spell-cast' }, buffWave: { def: 42 }, rally: { def: 'rally-link' } },
      cards: {},
    });
    expect(t.kinds.scCast).toEqual({ def: 'spell-cast' });
    expect(t.kinds.rally).toEqual({ def: 'rally-link' });
    expect(t.kinds.buffWave).toBeUndefined();
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]?.[0])).toContain('kinds.buffWave');
    err.mockRestore();
  });

  it('rejects an unknown fanOut', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = parseTable({ version: 1, kinds: { scCast: { def: 'x', fanOut: 'sideways' } }, cards: {} });
    expect(t.kinds.scCast).toBeUndefined();
    expect(String(err.mock.calls[0]?.[0])).toContain('fanOut');
    err.mockRestore();
  });

  it('accepts the `buffed` fanOut (cross-buff targets)', () => {
    const t = parseTable({ version: 1, kinds: { buffWave: { def: 'flame-ring', fanOut: 'buffed' } }, cards: {} });
    expect(t.kinds.buffWave).toEqual({ def: 'flame-ring', fanOut: 'buffed' });
  });

  it('returns empty tables for a wholly wrong shape', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseTable(null)).toEqual({ kinds: {}, cards: {} });
    expect(parseTable({ version: 1, kinds: [], cards: 'nope' })).toEqual({ kinds: {}, cards: {} });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  // Object.entries over JSON.parse output surfaces "__proto__" as a normal own key; assigning to it on a
  // plain object literal invokes the inherited Object.prototype.__proto__ setter instead of creating an own
  // property, which would silently rewrite the table's prototype rather than dropping the bad entry.
  it('drops a __proto__-keyed entry instead of polluting the table prototype', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const raw = JSON.parse('{"version":1,"kinds":{"__proto__":{"def":"evil"},"rally":{"def":"rally-link"}},"cards":{"__proto__":{"scCast":{"def":"evil"}}}}');
    const t = parseTable(raw);
    expect(t.kinds.rally).toEqual({ def: 'rally-link' });
    expect((t.kinds as Record<string, unknown>).__proto__).toBe(Object.prototype);
    expect(Object.getPrototypeOf(t.kinds)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(t.cards)).toBe(Object.prototype);
    expect(Object.keys(t.cards)).not.toContain('__proto__');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  // The two cases above cover the top-level `kinds` loop and the `cards` card-id loop; this covers the third
  // site — the per-card KIND loop — plus `constructor`/`prototype`, which are refused alongside `__proto__`
  // but never separately exercised.
  it('drops unsafe keys in the per-card kind loop too', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const raw = JSON.parse(
      '{"version":1,"kinds":{},"cards":{"bloodbinder":{"__proto__":{"def":"evil"},"constructor":{"def":"evil"},"prototype":{"def":"evil"},"rally":{"def":"rally-link"}}}}',
    );
    const t = parseTable(raw);
    expect(t.cards.bloodbinder).toEqual({ rally: { def: 'rally-link' } });
    expect(Object.getPrototypeOf(t.cards.bloodbinder)).toBe(Object.prototype);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('bindingFor', () => {
  it('resolves a kind-level binding', () => {
    expect(bindingFor(null, 'scCast')).toEqual({ def: 'spell-cast' });
  });

  it('lets a card-level binding beat the kind default', () => {
    expect(bindingFor('bloodbinder', 'scCast')).toEqual({ def: 'ruby-lance', fanOut: 'damaged' });
  });

  it('falls back to the kind for a card with no entry at that kind', () => {
    expect(bindingFor('bloodbinder', 'shieldGain')).toEqual({ def: 'ward-gained' });
    expect(bindingFor('somethingelse', 'scCast')).toEqual({ def: 'spell-cast' });
  });

  it('returns null for a kind nothing is bound to', () => {
    expect(bindingFor(null, 'damage')).toBeNull();
    expect(bindingFor('bloodbinder', 'damage')).toBeNull();
  });
});

describe('effectiveTables', () => {
  it('exposes the file contents', () => {
    const t = effectiveTables();
    expect(t.kinds.scCast).toEqual({ def: 'spell-cast' });
    expect(Object.keys(t.cards)).toContain('bloodbinder');
  });

  it('hands out a copy — mutating the result cannot corrupt the module', () => {
    const t = effectiveTables();
    delete t.kinds.scCast;
    expect(effectiveTables().kinds.scCast).toEqual({ def: 'spell-cast' });
  });

  // The top-level delete above only proves the outer maps are copied. A leaf FxBinding is a plain object too
  // (an editor UI would reasonably write `binding.def = 'x'` in place after fetching one) — this proves the
  // leaves are copies as well, not shared references into the module's own table.
  it('hands out copies of the leaf bindings too — editing a field cannot corrupt the module', () => {
    const t = effectiveTables();
    t.kinds.scCast!.def = 'clobbered';
    expect(effectiveTables().kinds.scCast).toEqual({ def: 'spell-cast' });
  });
});

/**
 * THE binding table, as a hand-maintained golden copy. The duplication is the point: a `toEqual` against an
 * expectation somebody had to type is the only thing that catches a binding added to `bindings.json` without
 * telling anyone, and an accidental extra binding — one def firing on a neighbouring event's beat — is the
 * failure mode this whole subsystem keeps reproducing. It stays invisible until someone authors that def.
 */
const BINDINGS: Record<string, { def: string }> = {
  shieldGain: { def: 'ward-gained' }, venomSpent: { def: 'venom-spent' }, scCast: { def: 'spell-cast' },
  reveal: { def: 'stealth-break' }, keyword: { def: 'keyword-gain' }, keywordLost: { def: 'keyword-lost' },
  toHand: { def: 'to-hand' }, hpGrant: { def: 'hp-grant' },
  // The first SHOP-phase binding — a recruit moment kind, not a combat one (see recruitMoments.ts).
  rubyLanded: { def: 'ruby-gem-apply' },
  shopRubied: { def: 'ruby-gem-veinstorm' },
  // The whole shop buffed by the run-wide `tavernBuyBonus` channel — camera-anchored, one play for the row.
  // Distinct from `shopRubied` on purpose: gems go through their own span, and Veinstorm deliberately never
  // touches this channel, so the two can never both fire for one event.
  shopBuffAll: { def: 'shop-buff-aura' },
  // A rune's own effect firing, on its HUD badge. Deliberately not `questTrigger`: that kind is anchored by
  // the combat score, which can only reach board units, so it has never played (see `runeTriggerFx.ts`).
  runeTriggered: { def: 'rune-burst' },
  // Epic runes fire a distinct burst — same HUD-badge channel, resolved per slot by the rune's `epic` flag.
  epicRuneTriggered: { def: 'epic-rune-burst' },
  // The DEFAULT tavern-spell cast — every spell with no card binding of its own. Fires ONCE at the cursor
  // (no `fanOut`), which is what makes it safe as a default; the ales opt into the per-minion volley.
  spellCast: { def: 'spell-sparks' },
  // Shop self-buffs (the green-pulse channel) — the recruit twin of combat's buffWave/attackExchange default.
  minionSelfBuffed: { def: 'self-buff-gold' },
  spellProgress: { def: 'spell-progress' },
  questTrigger: { def: 'quest-trigger' }, questComplete: { def: 'quest-complete' },
  // NB: `rally` is absent from this table on purpose — it is a committed TOMBSTONE, asserted below.
};

/**
 * The CARD layer's golden copy, for the same reason the kind table has one. A card row is the narrower key
 * and the easier one to add without telling anyone, and it SHADOWS the kind beneath it — so an unnoticed
 * entry here silences a global effect for one card rather than merely adding to it.
 */
const CARD_BINDINGS: Record<string, Record<string, { def: string; fanOut?: string; sfx?: string; critDef?: string; launchOnDeath?: boolean }>> = {
  b2_echohorn: { rally: { def: 'echohorn-target-sparkle' } },
  bloodbinder: { scCast: { def: 'ruby-lance', fanOut: 'damaged' } },
  // Broodfire's Shout buffs every Dragon; the authored def cascades over each one it pumped (owner 2026-09-01).
  // Shop-only by construction — a Shout has no combat moment — so there is no `buffWave` row to pair with it.
  d2_broodfire: { minionBuffed: { def: 'broodfire-buff' } },
  // Karwind rings every Dragon it pumps — the combat `buffed` fan-out plays `flame-ring` once per cross-buffed
  // unit, and the shop's source-keyed `minionBuffed` moment plays it on each Dragon Karwind buffed in the tavern.
  karwind: { buffWave: { def: 'flame-ring', fanOut: 'buffed' }, minionBuffed: { def: 'flame-ring', critDef: 'flame-ring-crit' } },
  // Paymaster Pimm's Shout pays you next turn — `coin-shout` on the card, with the max-Gold sound, which is
  // the first binding to carry an `sfx` at all (see `BINDING_SFX`).
  dm_butcher: { shout: { def: 'shop-buff-shout' }, scNarrate: { def: 'shop-buff-shout' } },
  // Dragonflame is bound by the SPELL, on both phases — the shop's `spellCast` (played from hand) and combat's
  // `buffWave`. `buffWave`, not `scNarrate`: the cast's ANNOUNCEMENT and its BUFFS are separate moments, and
  // the buffs are both what the def plays on and where the stock tendril it replaces lives. Every combat
  // caster is covered without naming one, because the buff events now carry the spell's `spellId`
  // (Flamebeat Drake, Warflame, and whatever casts it next). Owner 2026-09-01.
  sp_dragonflame: { spellCast: { def: 'dragonflame', fanOut: 'buffedOn', sfx: 'dragonflame' }, buffWave: { def: 'dragonflame', fanOut: 'buffedOn' } },
  dm_felspikes: { damage: { def: 'fel-spike', fanOut: 'struck', launchOnDeath: true } },
  dm_tormentor: { shout: { def: 'shop-buff-shout' }, scNarrate: { def: 'shop-buff-shout' } },
  dw_pimm: { shout: { def: 'coin-shout', sfx: 'maxGold' } },
  // Golden Ale — the proof-of-path binding for the shop spell-cast site (Task 2): a placeholder def so the
  // release-point emission + generic-spark suppression can be verified end-to-end before an authored def exists.
  wo_attack: { spellCast: { def: 'bloody-ale', fanOut: 'buffed' } },
  wo_champion: { spellCast: { def: 'champions-ale', fanOut: 'buffed' } },
  wo_health: { spellCast: { def: 'defensive-ale', fanOut: 'buffed' } },
  wo_mine: { spellCast: { def: 'coin-ale', fanOut: 'buffed' } },
  wo_reinforcement: { spellCast: { def: 'reinforcing-ale', fanOut: 'buffed' } },
};

/** Bindings that FAN OUT rather than playing once at the moment's own pair. `attackExchange` is in here for a
 *  reason worth keeping: a self-buff absorbed into a wind-up never produces a `buffWave` moment, so binding
 *  only to `buffWave` would miss a unit that grows as it is attacked. */
const FANOUT_BINDINGS: Record<string, { def: string; fanOut: string }> = {
  buffWave: { def: 'self-buff-gold', fanOut: 'selfBuffed' },
  attackExchange: { def: 'self-buff-gold', fanOut: 'selfBuffed' },
};

describe('the bound kinds', () => {
  it('binds exactly the intended kind → def pairs, and nothing else', () => {
    const expected: Record<string, { def: string; fanOut?: string }> = { ...BINDINGS, ...FANOUT_BINDINGS };
    expect(effectiveTables().kinds).toEqual(expected);
  });

  it('binds exactly the intended card → kind → def entries, and nothing else', () => {
    expect(effectiveTables().cards).toEqual(CARD_BINDINGS);
  });

  /**
   * `rally` is deliberately SILENT at the kind layer, and it has to be a tombstone rather than an omission.
   *
   * The channel that plays a Rally (`rallyFx`) resolves a binding per rally EVENT, which is what finally made
   * the `rally` row reachable at all — it had been authored and unplayable for as long as it existed, because
   * every Rally is absorbed into its attacker's wind-up. Leaving `rally-link` bound globally at the moment it
   * became reachable would have started playing it on every Rally in the game, which is a change nobody asked
   * for dressed up as a bug fix (owner decision 2026-08-04: Echohorn only).
   *
   * The tombstone says that out loud, where an absent key would read as "nobody got round to it".
   */
  it('keeps `rally` globally silent as an explicit tombstone, with the card row still live beneath it', () => {
    expect(bindingFor(null, 'rally')).toBeNull();
    expect(bindingAt(null, 'rally')).toEqual({ binding: null, source: 'file' });
    expect(bindingFor('b2_echohorn', 'rally')).toEqual({ def: 'echohorn-target-sparkle' });
  });

  // Kinds that already existed and already had FX must be untouched — a def on a NEIGHBOURING kind must never
  // reach them. (`damage` is the one that matters most: quest beats used to be classified as damage moments,
  // so binding their def there would have fired it on every hit in the fight.)
  // `attackExchange` and `buffWave` are deliberately NOT on this list: both now carry the self-buff fan-out
  // (see FANOUT_BINDINGS). Everything else stays unbound, so the list keeps doing its job of catching a def
  // bound somewhere nobody intended.
  it('leaves every previously-effected kind unbound', () => {
    for (const kind of ['damage', 'death', 'riseDeath', 'shieldPop', 'poisonTick',
      'scNarrate', 'summon', 'reborn', 'ascend', 'maxGold', 'improve', 'tribeAura'] as const) {
      expect(bindingFor(null, kind), kind).toBeNull();
    }
  });
});

/**
 * PERMANENT. A binding naming a def that does not exist is a silent no-op at runtime — `playDef` returns null
 * and nothing plays, which is indistinguishable from a binding nobody wired. That ambiguity cost a long
 * debugging session on Bloodbinder.
 */
describe('binding integrity', () => {
  it('every bound def id exists in the registry', async () => {
    await import('../fx/primitives');
    const { listDefs } = await import('../fx/fxDefs');
    const known = new Set(listDefs().map((d) => d.id));
    const t = effectiveTables();
    const missing: string[] = [];
    for (const [kind, b] of Object.entries(t.kinds)) if (!known.has(b.def)) missing.push(`${kind}:${b.def}`);
    for (const [cardId, byKind] of Object.entries(t.cards)) {
      for (const [kind, b] of Object.entries(byKind)) {
        if (b && !known.has(b.def)) missing.push(`${cardId}.${kind}:${b.def}`);
        // A crit-variant is a real def id too — a dangling `critDef` fails CI exactly like a dangling `def`.
        if (b && b.critDef !== undefined && !known.has(b.critDef)) missing.push(`${cardId}.${kind}.critDef:${b.critDef}`);
      }
    }
    expect(missing, `bindings naming defs that do not exist: ${missing.join(', ')}`).toEqual([]);
  });

  it('every key is a real moment kind and a real card id', () => {
    // Both phases plus the HUD: combat kinds come from the score table, shop kinds from the recruit
    // vocabulary, and HUD kinds (a rune badge firing) from their own list — they have neither a combat cue
    // row nor a recruit emitter, by design (see `HudBindingKind`).
    const kinds = new Set<string>([...Object.keys(SCORE_DEFAULTS), ...RECRUIT_MOMENT_KINDS, ...HUD_BINDING_KINDS]);
    const t = effectiveTables();
    const bad: string[] = [];
    for (const kind of Object.keys(t.kinds)) if (!kinds.has(kind)) bad.push(`kinds.${kind}`);
    for (const [cardId, byKind] of Object.entries(t.cards)) {
      if (!(cardId in CARD_INDEX)) bad.push(`cards.${cardId}`);
      for (const kind of Object.keys(byKind)) if (!kinds.has(kind)) bad.push(`cards.${cardId}.${kind}`);
    }
    expect(bad, `keys that name nothing real: ${bad.join(', ')}`).toEqual([]);
  });
});

// The suite runs in bare node (no jsdom), so `localStorage` is undefined and setBinding/resetBindings's
// try/catch swallows every access — same situation score.test.ts documents for `overrides`. Install a
// minimal stub only for the one test that needs to observe the real persistence path.
const withLocalStorage = (fn: () => void): void => {
  const store = new Map<string, string>();
  const g = globalThis as unknown as { localStorage?: unknown };
  const had = 'localStorage' in g;
  const prev = g.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    configurable: true,
    writable: true,
  });
  try {
    fn();
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', { value: prev, configurable: true, writable: true });
    else delete g.localStorage;
  }
};

describe('session overrides', () => {
  beforeEach(() => resetBindings());

  it('a kind-level override wins over the file', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    expect(bindingFor(null, 'scCast')).toEqual({ def: 'test-red-blast' });
  });

  it('a card-level override wins over both the file and a kind override', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    setBinding('bloodbinder', 'scCast', { def: 'ember-lance', fanOut: 'damaged' });
    expect(bindingFor('bloodbinder', 'scCast')).toEqual({ def: 'ember-lance', fanOut: 'damaged' });
    expect(bindingFor('somethingelse', 'scCast')).toEqual({ def: 'test-red-blast' });
  });

  // A tombstone, not an absent key. Against a file baseline "absent" means INHERIT, so without an explicit
  // null there is no way to say "this card should play nothing here" as a live change.
  it('binding to null unbinds, and does NOT fall through to the kind', () => {
    setBinding('bloodbinder', 'scCast', null);
    expect(bindingFor('bloodbinder', 'scCast')).toBeNull();
    expect(bindingFor('somethingelse', 'scCast')).toEqual({ def: 'spell-cast' });
  });

  it('a kind-level tombstone unbinds the kind', () => {
    setBinding(null, 'scCast', null);
    expect(bindingFor(null, 'scCast')).toBeNull();
  });

  // The tombstone must beat a LIVE kind override, not just the committed file's default. Today's early
  // return makes that true by construction; this pins it, because the obvious "simplification" to a single
  // nullish chain (`overridden ?? patch.kinds[kind] ?? …`) would silently reintroduce the fallthrough.
  it('a card tombstone beats a live kind-level override, not just the file default', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    setBinding('bloodbinder', 'scCast', null);
    expect(bindingFor('bloodbinder', 'scCast')).toBeNull();
    expect(bindingFor('somethingelse', 'scCast')).toEqual({ def: 'test-red-blast' });
  });

  it('resetBindings returns everything to the file baseline', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    setBinding('bloodbinder', 'scCast', null);
    resetBindings();
    expect(bindingFor(null, 'scCast')).toEqual({ def: 'spell-cast' });
    expect(bindingFor('bloodbinder', 'scCast')).toEqual({ def: 'ruby-lance', fanOut: 'damaged' });
  });

  it('effectiveTables reflects overrides and drops tombstoned entries', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    setBinding('bloodbinder', 'scCast', null);
    const t = effectiveTables();
    expect(t.kinds.scCast).toEqual({ def: 'test-red-blast' });
    expect(t.cards.bloodbinder).toBeUndefined();
  });

  it('persists to localStorage under its own key', () => {
    withLocalStorage(() => {
      setBinding(null, 'scCast', { def: 'test-red-blast' });
      expect(localStorage.getItem('ascent.fxBindings')).toContain('test-red-blast');
      resetBindings();
      expect(localStorage.getItem('ascent.fxBindings')).toBeNull();
    });
  });
});

describe('clearBinding', () => {
  beforeEach(() => resetBindings());

  // The distinction this function exists for. A tombstone says "this card plays NOTHING here" and stops
  // resolution; clearing says "I have no opinion", so the file's own binding applies again. Tearing down a
  // draft needs the second — the first would leave the card silent instead of restored.
  it('removes an override, restoring the file binding — unlike a tombstone', () => {
    setBinding('bloodbinder', 'scCast', { def: 'test-red-blast' });
    expect(bindingFor('bloodbinder', 'scCast')).toEqual({ def: 'test-red-blast' });

    clearBinding('bloodbinder', 'scCast');
    expect(bindingFor('bloodbinder', 'scCast')).toEqual({ def: 'ruby-lance', fanOut: 'damaged' });

    setBinding('bloodbinder', 'scCast', null); // tombstone, for contrast
    expect(bindingFor('bloodbinder', 'scCast')).toBeNull();
  });

  it('clears a kind-level override', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    clearBinding(null, 'scCast');
    expect(bindingFor(null, 'scCast')).toEqual({ def: 'spell-cast' });
  });

  it('is a no-op when nothing was overridden', () => {
    clearBinding('bloodbinder', 'scCast');
    expect(bindingFor('bloodbinder', 'scCast')).toEqual({ def: 'ruby-lance', fanOut: 'damaged' });
  });

  // The `> 0` branch: clearing one of a card's overrides must leave its siblings alone. An implementation
  // that dropped the whole card entry would pass every other test here while silently wiping an override
  // the author still wanted — and since the patch is what makes a live draft visible, that surfaces as
  // "my other override just disappeared", with nothing logged.
  it('leaves a card\'s other overrides alone when clearing one of them', () => {
    setBinding('bloodbinder', 'scCast', { def: 'test-red-blast' });
    setBinding('bloodbinder', 'buffWave', { def: 'self-buff-bloom' });

    clearBinding('bloodbinder', 'scCast');

    expect(bindingFor('bloodbinder', 'scCast')).toEqual({ def: 'ruby-lance', fanOut: 'damaged' }); // back to file
    expect(bindingFor('bloodbinder', 'buffWave')).toEqual({ def: 'self-buff-bloom' });             // untouched
  });

  it('persists the removal, so a reload does not resurrect the override', () => {
    withLocalStorage(() => {
      setBinding(null, 'scCast', { def: 'test-red-blast' });
      clearBinding(null, 'scCast');
      expect(localStorage.getItem('ascent.fxBindings') ?? '').not.toContain('test-red-blast');
    });
  });
});

describe('bindingsJson', () => {
  beforeEach(() => resetBindings());

  // What commit writes must be what the session was playing, or the button lies. A tombstone is part of
  // that: it survives as an explicit `null`, because a card that plays nothing is a decision the file has
  // to be able to hold — dropping the key would re-read as "no opinion" and restore the kind default on
  // the next reload.
  it('round-trips: the committed text re-parses to the same resolution, tombstones included', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    setBinding('bloodbinder', 'scCast', null);
    const parsed = parseTable(JSON.parse(bindingsJson()));
    expect(parsed.kinds.scCast).toEqual({ def: 'test-red-blast' });
    expect(parsed.cards.bloodbinder?.scCast).toBeNull();
    // …and a tombstone already IN the committed file survives the round trip the same way a session one does.
    expect(parsed.kinds.rally).toBeNull();
  });

  it('emits version 1, sorted keys, and a trailing newline', () => {
    const text = bindingsJson();
    expect(JSON.parse(text).version).toBe(1);
    expect(text.endsWith('\n')).toBe(true);
    const kinds = Object.keys(JSON.parse(text).kinds);
    expect(kinds).toEqual([...kinds].sort());
  });
});

/**
 * The draft id applies IN MEMORY but must never reach disk in either direction — a committed binding to it
 * points at a def that exists only in this session, which resolves to nothing and reads as a broken tool.
 *
 * Both routes are ordinary happy paths, not edge cases, which is why they are pinned here rather than left
 * to the workbench to remember: writing bindings.json triggers a full page reload (so the React cleanup that
 * tears the draft down never runs), and a global-scope commit writes the KIND row while leaving the card row
 * the draft sits on untouched — straight into `bindingsJson()`'s output.
 */
describe('the live-preview draft never reaches disk', () => {
  beforeEach(() => resetBindings());

  it('never persists a draft binding to localStorage', () => {
    withLocalStorage(() => {
      setBinding('bloodbinder', 'scCast', { def: DRAFT_DEF_ID });
      expect(localStorage.getItem('ascent.fxBindings')).not.toContain(DRAFT_DEF_ID);
      // ...and the card it was the ONLY binding for is pruned, not left behind as an empty object.
      expect(JSON.parse(localStorage.getItem('ascent.fxBindings') ?? '{}').cards).toEqual({});
    });
  });

  it('strips only the draft, leaving a real override beside it persisted', () => {
    withLocalStorage(() => {
      setBinding('bloodbinder', 'scCast', { def: DRAFT_DEF_ID });
      setBinding(null, 'rally', { def: 'test-red-blast' });
      const stored = JSON.parse(localStorage.getItem('ascent.fxBindings') ?? '{}');
      expect(stored.kinds.rally).toEqual({ def: 'test-red-blast' });
      expect(stored.cards).toEqual({});
    });
  });

  it('never serialises a draft binding into the committed table', () => {
    // Exactly the global-scope commit: the kind row is the commit target, the card row is the live draft.
    setBinding(null, 'scCast', { def: 'committed-thing' });
    setBinding('bloodbinder', 'scCast', { def: DRAFT_DEF_ID });
    const text = bindingsJson();
    expect(text).not.toContain(DRAFT_DEF_ID);
    expect(JSON.parse(text).kinds.scCast).toEqual({ def: 'committed-thing' });
  });

  // A draft over a card row must not take the committed row down with it. Stripping post-merge deleted the
  // value underneath instead of falling back to it — so tuning Bloodbinder and committing globally wrote a
  // file with Bloodbinder's own effect silently removed. Strip the PATCH, then merge.
  it('leaves a committed card binding intact when a draft is live over it', () => {
    setBinding('bloodbinder', 'scCast', { def: DRAFT_DEF_ID, fanOut: 'damaged' });
    setBinding(null, 'scCast', { def: 'my-new-thing' });
    const parsed = JSON.parse(bindingsJson());
    expect(parsed.cards.bloodbinder?.scCast).toEqual({ def: 'ruby-lance', fanOut: 'damaged' });
    expect(parsed.kinds.scCast).toEqual({ def: 'my-new-thing' });
    expect(bindingsJson()).not.toContain(DRAFT_DEF_ID);
  });

  // A card whose ONLY binding is a draft still must not appear — there is nothing committed underneath to
  // fall back to, so the right answer is absence, not an empty object.
  it('omits a card whose only binding is a draft', () => {
    setBinding('drone', 'summon', { def: DRAFT_DEF_ID });
    expect(JSON.parse(bindingsJson()).cards.drone).toBeUndefined();
  });

  it('still resolves a draft binding in memory, which is what makes the preview work', () => {
    setBinding('bloodbinder', 'scCast', { def: DRAFT_DEF_ID });
    expect(bindingFor('bloodbinder', 'scCast')).toEqual({ def: DRAFT_DEF_ID });
  });
});

/**
 * The prefill's question — "what plays here, ignoring my draft" — which `bindingFor` cannot answer once the
 * draft is bound, because by then the draft IS the answer and carries whatever the prefill last produced.
 */
describe('bindingBeneathDraft', () => {
  beforeEach(() => resetBindings());

  it('sees through a card-level draft to the committed card binding', () => {
    setBinding('bloodbinder', 'scCast', { def: DRAFT_DEF_ID, fanOut: 'selfBuffed' });
    expect(bindingFor('bloodbinder', 'scCast')).toEqual({ def: DRAFT_DEF_ID, fanOut: 'selfBuffed' });
    expect(bindingBeneathDraft('bloodbinder', 'scCast')).toEqual({ def: 'ruby-lance', fanOut: 'damaged' });
  });

  // A GLOBAL commit asks the kind layer, so a card override — draft or not — must not colour the answer.
  // This is the case that wrote Bloodbinder's `damaged` onto every card's scCast.
  it('ignores the card layer entirely when asked for the kind', () => {
    setBinding('bloodbinder', 'scCast', { def: DRAFT_DEF_ID, fanOut: 'damaged' });
    expect(bindingBeneathDraft(null, 'scCast')).toEqual({ def: 'spell-cast' });
  });

  it('sees through a kind-level draft too', () => {
    setBinding(null, 'scCast', { def: DRAFT_DEF_ID, fanOut: 'damaged' });
    expect(bindingBeneathDraft(null, 'scCast')).toEqual({ def: 'spell-cast' });
  });

  // Only the DRAFT is see-through. A tombstone still means "plays nothing here" and must stop resolution,
  // exactly as it does in `bindingFor` — otherwise the prefill would inherit from a row the author silenced.
  it('still stops at a tombstone', () => {
    setBinding('bloodbinder', 'scCast', null);
    expect(bindingBeneathDraft('bloodbinder', 'scCast')).toBeNull();
  });

  it('is identical to bindingFor when no draft is in play', () => {
    setBinding('bloodbinder', 'scCast', { def: 'test-red-blast', fanOut: 'selfBuffed' });
    expect(bindingBeneathDraft('bloodbinder', 'scCast')).toEqual(bindingFor('bloodbinder', 'scCast'));
  });
});

/**
 * The two questions the unbind panel has to answer before it can offer a button: "is there a row HERE" and
 * "what is left if it goes away". Neither is answerable with `bindingFor`/`bindingBeneathDraft`, which
 * resolve THROUGH the layers — their answer may have come from the layer beneath the one being removed.
 */
describe('bindingAt', () => {
  beforeEach(() => resetBindings());

  it('reports the committed row at the layer asked for', () => {
    expect(bindingAt('bloodbinder', 'scCast')).toEqual({
      binding: { def: 'ruby-lance', fanOut: 'damaged' },
      source: 'file',
    });
    expect(bindingAt(null, 'scCast')).toEqual({ binding: { def: 'spell-cast' }, source: 'file' });
  });

  // The distinction the resolver cannot make: this card has no scCast row of its own, it INHERITS one.
  // Offering to "unbind" it would delete a row that isn't there and change nothing.
  it('is undefined for a card that only inherits the kind default', () => {
    expect(bindingFor('gnasher', 'scCast')).toEqual({ def: 'spell-cast' });
    expect(bindingAt('gnasher', 'scCast')).toBeUndefined();
  });

  it('prefers an uncommitted session override and says where it came from', () => {
    setBinding('bloodbinder', 'scCast', { def: 'ember-lance' });
    expect(bindingAt('bloodbinder', 'scCast')).toEqual({ binding: { def: 'ember-lance' }, source: 'session' });
  });

  it('reports a tombstone as a row that plays nothing, not as an absent row', () => {
    setBinding('bloodbinder', 'scCast', null);
    expect(bindingAt('bloodbinder', 'scCast')).toEqual({ binding: null, source: 'session' });
  });

  // The live preview must not be offered up as the thing to unbind: while rail mode previews, the draft IS
  // the row, and removing it would remove the preview rather than the author's real binding.
  it('sees through the live draft to the committed row beneath it', () => {
    setBinding('bloodbinder', 'scCast', { def: DRAFT_DEF_ID });
    expect(bindingAt('bloodbinder', 'scCast')).toEqual({
      binding: { def: 'ruby-lance', fanOut: 'damaged' },
      source: 'file',
    });
  });

  it('is undefined when a draft sits over a row that did not exist', () => {
    setBinding('gnasher', 'scCast', { def: DRAFT_DEF_ID });
    expect(bindingAt('gnasher', 'scCast')).toBeUndefined();
  });
});

describe('bindingWithout', () => {
  beforeEach(() => resetBindings());

  it('is the kind default for a card row — the clear consequence, computed not assumed', () => {
    expect(bindingWithout('bloodbinder', 'scCast')).toEqual({ def: 'spell-cast' });
  });

  it('is null for a kind row, which is why clear and tombstone collapse there', () => {
    expect(bindingWithout(null, 'scCast')).toBeNull();
  });

  it('is null for a card row whose kind nobody bound', () => {
    expect(bindingWithout('bloodbinder', 'damage')).toBeNull();
  });

  it('follows a live kind-level override rather than the file', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    expect(bindingWithout('bloodbinder', 'scCast')).toEqual({ def: 'test-red-blast' });
  });

  it('ignores the card row being removed, tombstone included', () => {
    setBinding('bloodbinder', 'scCast', null);
    expect(bindingFor('bloodbinder', 'scCast')).toBeNull();
    expect(bindingWithout('bloodbinder', 'scCast')).toEqual({ def: 'spell-cast' });
  });

  it('sees through a kind-level draft', () => {
    setBinding(null, 'scCast', { def: DRAFT_DEF_ID });
    expect(bindingWithout('bloodbinder', 'scCast')).toEqual({ def: 'spell-cast' });
  });
});

/**
 * The text an unbind writes. Computed from the tables rather than by mutating them, so a page reload
 * landing inside the write cannot leave the session and the file disagreeing about what a card plays.
 */
describe('unbindJson', () => {
  beforeEach(() => resetBindings());

  it('clearing a card row drops the card entirely, so the kind default applies again', () => {
    const parsed = parseTable(JSON.parse(unbindJson('bloodbinder', 'scCast', 'clear')));
    expect(parsed.cards.bloodbinder).toBeUndefined();
    expect(parsed.kinds.scCast).toEqual({ def: 'spell-cast' });
  });

  it('tombstoning a card row writes an explicit null, so nothing plays there', () => {
    const parsed = parseTable(JSON.parse(unbindJson('bloodbinder', 'scCast', 'tombstone')));
    expect(parsed.cards.bloodbinder?.scCast).toBeNull();
    expect(parsed.kinds.scCast).toEqual({ def: 'spell-cast' });
  });

  it('clearing a kind row removes it and leaves every other kind alone', () => {
    const parsed = parseTable(JSON.parse(unbindJson(null, 'scCast', 'clear')));
    expect(parsed.kinds.scCast).toBeUndefined();
    expect(parsed.kinds.toHand).toEqual({ def: 'to-hand' });
    // The card override is NOT collateral: it still names its own def.
    expect(parsed.cards.bloodbinder?.scCast).toEqual({ def: 'ruby-lance', fanOut: 'damaged' });
  });

  it('does not touch the live tables — the write is what changes anything', () => {
    unbindJson('bloodbinder', 'scCast', 'clear');
    expect(bindingFor('bloodbinder', 'scCast')).toEqual({ def: 'ruby-lance', fanOut: 'damaged' });
    expect(bindingsJson()).not.toEqual(unbindJson('bloodbinder', 'scCast', 'clear'));
  });

  // Same invariant `bindingsJson` carries: the memory-only preview def can never reach disk, and an unbind
  // is a second route to the file that would otherwise have to remember it.
  it('never serialises the live draft', () => {
    setBinding('gnasher', 'scCast', { def: DRAFT_DEF_ID });
    expect(unbindJson('bloodbinder', 'scCast', 'clear')).not.toContain(DRAFT_DEF_ID);
  });

  it('keeps a card that still has another binding after one is cleared', () => {
    setBinding('bloodbinder', 'rally', { def: 'test-red-blast' });
    const parsed = parseTable(JSON.parse(unbindJson('bloodbinder', 'scCast', 'clear')));
    expect(parsed.cards.bloodbinder).toEqual({ rally: { def: 'test-red-blast' } });
  });

  it('emits the same shape a commit does — version 1, sorted keys, trailing newline', () => {
    const text = unbindJson('bloodbinder', 'scCast', 'tombstone');
    expect(JSON.parse(text).version).toBe(1);
    expect(text.endsWith('\n')).toBe(true);
    const kinds = Object.keys(JSON.parse(text).kinds);
    expect(kinds).toEqual([...kinds].sort());
  });
});

/** A committed tombstone stops resolution exactly like a session one — otherwise "play nothing" would last
 *  only until the next reload. */
describe('a tombstone in the file', () => {
  it('parses as a row that plays nothing rather than being dropped as malformed', () => {
    const t = parseTable({ kinds: { scCast: null }, cards: { bloodbinder: { rally: null } } });
    expect(t.kinds.scCast).toBeNull();
    expect(t.cards.bloodbinder?.rally).toBeNull();
    expect('scCast' in t.kinds).toBe(true);
  });
});

/**
 * AN AUTHORED DEF REPLACES THE STOCK CUE (owner ruling 2026-08-11).
 *
 * `Recruit.tsx`'s tendril loop skips any event whose SOURCE card has a `minionBuffed` binding, because that
 * same event also plays the bound def through `runRecruitMomentCues` — so without the skip a bound card gets
 * both, which reads as two effects for one event.
 *
 * The suppression itself lives in a DOM-measuring component this repo cannot test (no jsdom), so what is
 * pinned here is the QUESTION it asks. If these answers ever flip, the tendril loop silently changes
 * behaviour for every card in the table.
 */
describe('a bound def suppresses the stock shop tendril AND the flame flash', () => {
  // Both stock cues (the buff tendril and Karwind's flame flash) key their suppression off the SAME question:
  // did a card with a `minionBuffed` binding buff this Dragon? The flash reads it via `recruitBuffFx`'s
  // per-event `sourceCardId`; the pins below guard the answers that question depends on. `onBattlecryBuffTribe`
  // (which stamps the flash) is used by Karwind AND by unbound tribe-buffers (set-1's Dragon and Beast
  // battlecries), so the discriminator MUST be the binding, never the card id — an id check would strip the
  // unbound buffers' flash too. Broodfire (`d2_broodfire`) used to be the set-2 example here; it is BOUND as
  // of 2026-09-01, which is precisely the swap this suppression exists to perform.

  it('Karwind is bound at minionBuffed, so its tendril is suppressed', () => {
    expect(bindingFor('karwind', 'minionBuffed')).not.toBeNull();
  });

  // Broodfire's authored buff (owner, 2026-09-01: *"its animation plays on the dragons that are buffed"*).
  // A `minionBuffed` binding is what makes the cue runner cascade the def over each buffed Dragon AND what
  // suppresses the stock tendril/flash it replaces — so the KIND is load-bearing, not just the def id. Bound
  // at the wrong kind the def would either never fire or fire on top of the stock cue.
  it('Broodfire is bound at minionBuffed, so its authored def replaces the stock cue', () => {
    expect(bindingFor('d2_broodfire', 'minionBuffed')?.def).toBe('broodfire-buff');
  });

  it('an unbound buffer keeps its tendril', () => {
    expect(bindingFor('b2_echohorn', 'minionBuffed')).toBeNull();
    expect(bindingFor('bloodbinder', 'minionBuffed')).toBeNull();
    expect(bindingFor(null, 'minionBuffed')).toBeNull();
  });

  it('a binding on a DIFFERENT kind does not suppress the tendril', () => {
    // Pimm is bound at `shout`, not `minionBuffed` — a Shout that also buffs others must still draw its ribbon.
    expect(bindingFor('dw_pimm', 'shout')).not.toBeNull();
    expect(bindingFor('dw_pimm', 'minionBuffed')).toBeNull();
  });
});
