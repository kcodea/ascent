import { describe, it, expect } from 'vitest';
import { HEROES } from '../heroes';
import { handleFor, handleKeyOf, uniqueHandleFor } from './handles';

/**
 * Generated seats wear player-looking HANDLES rather than their hero's name. "Nadja" read as scenery, and it
 * also made the real snapshot seats obvious by contrast — those carry a player's actual name.
 */

describe('fake player handles', () => {
  it('are deterministic — the same key always gives the same handle', () => {
    // Replays and restored lobbies must show the same table. `Math.random` is banned in sim precisely for this.
    for (const key of [1, 99, 12345, 0xffff]) expect(handleFor(key)).toBe(handleFor(key));
  });

  it('vary across keys', () => {
    const names = new Set(Array.from({ length: 200 }, (_, i) => handleFor(i * 7919)));
    expect(names.size, 'handles collapsed onto a few names').toBeGreaterThan(100);
  });

  it('never collide with a HERO name — that is the whole point', () => {
    const heroNames = new Set(HEROES.map((h) => h.name.toLowerCase()));
    const generated = Array.from({ length: 300 }, (_, i) => handleFor(i * 104_729).toLowerCase());
    expect(generated.filter((n) => heroNames.has(n))).toEqual([]);
  });

  it('look like handles — non-empty, single-line, no leaked seed digits alone', () => {
    for (let i = 0; i < 200; i++) {
      const n = handleFor(i * 31_337);
      expect(n.length).toBeGreaterThan(2);
      expect(n).not.toMatch(/[\r\n]/);
      expect(n, 'a bare number is not a handle').not.toMatch(/^\d+$/);
    }
  });

  it('hashes a string key stably, so a run key can name a seat', () => {
    expect(handleKeyOf('Ada|drakko|111')).toBe(handleKeyOf('Ada|drakko|111'));
    expect(handleKeyOf('Ada|drakko|111')).not.toBe(handleKeyOf('Baz|soren|222'));
  });
});

describe('uniqueness at a table', () => {
  it('avoids names already taken', () => {
    const first = handleFor(42);
    const second = uniqueHandleFor(42, new Set([first.toLowerCase()]));
    expect(second).not.toBe(first);
  });

  it('fills a whole table without repeating', () => {
    // Two seats sharing a name would read as a rendering bug.
    const taken = new Set<string>(['you']);
    const names: string[] = [];
    for (let i = 0; i < 7; i++) {
      const n = uniqueHandleFor(handleKeyOf(`seed|hero${i}|${i}`), taken);
      taken.add(n.toLowerCase());
      names.push(n);
    }
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(7);
  });

  it('stays deterministic even when it has to dodge a collision', () => {
    const taken = new Set([handleFor(7).toLowerCase()]);
    expect(uniqueHandleFor(7, taken)).toBe(uniqueHandleFor(7, taken));
  });
});
