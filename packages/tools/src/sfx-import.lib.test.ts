import { describe, it, expect } from 'vitest';
import { slugify, parseName, resolveId, matchFile, buildIndex, type MatchCard, type MatchHero } from './sfx-import.lib';

const cards: MatchCard[] = [
  { id: 'alley', name: 'Pennycat', effects: [{ on: 'onPlay' }] },
  { id: 'pack', name: 'Mama Pup', effects: [{ on: 'onDeath' }] },
  { id: 'plain', name: 'Plain Beast', effects: [] },
];
const heroes: MatchHero[] = [
  { id: 'warden', name: 'Warden' },
  { id: 'rohan', name: 'Yirin' }, // id kept stable; display name differs
];
const index = buildIndex(cards, heroes);
const m = (fn: string) => matchFile(fn, index);

describe('slugify + parseName', () => {
  it('slugifies to lowercase alphanumerics', () => {
    expect(slugify('Mama Pup!')).toBe('mamapup');
    expect(slugify('Yirin')).toBe('yirin');
  });
  it('pulls a trailing variant word across separators', () => {
    expect(parseName('Pennycat death.mp3')).toEqual({ variant: 'death', phraseSlug: 'pennycat' });
    expect(parseName('alley.death.mp3')).toEqual({ variant: 'death', phraseSlug: 'alley' });
    expect(parseName('warden_power.mp3')).toEqual({ variant: 'power', phraseSlug: 'warden' });
    expect(parseName('Yirin.mp3')).toEqual({ variant: null, phraseSlug: 'yirin' });
  });
  it('does not treat a leading/embedded variant word as the variant', () => {
    expect(parseName('Death Knight.mp3')).toEqual({ variant: null, phraseSlug: 'deathknight' });
  });
});

describe('resolveId', () => {
  it('matches an exact id, an exact display name, and a fuzzy typo', () => {
    expect(resolveId('alley', index)).toMatchObject({ id: 'alley', kind: 'card', confidence: 'exact' });
    expect(resolveId('pennycat', index)).toMatchObject({ id: 'alley', kind: 'card', confidence: 'exact' });
    expect(resolveId('yirin', index)).toMatchObject({ id: 'rohan', kind: 'hero', confidence: 'exact' });
    expect(resolveId('penycat', index)).toMatchObject({ id: 'alley', confidence: 'fuzzy' });
  });
  it('returns suggestions when nothing is close', () => {
    const r = resolveId('zzzzzzz', index);
    expect('id' in r).toBe(false);
    expect((r as { suggestions: string[] }).suggestions.length).toBeGreaterThan(0);
  });
});

describe('matchFile', () => {
  it('maps each variant to the right target', () => {
    expect(m('Pennycat death.mp3')).toMatchObject({ ok: true, target: 'cards/alley.death.mp3' });
    expect(m('mama pup death.mp3')).toMatchObject({ ok: true, target: 'cards/pack.death.mp3' });
    expect(m('alley effect.mp3')).toMatchObject({ ok: true, target: 'cards/alley.effect.mp3' });
    expect(m('alley.mp3')).toMatchObject({ ok: true, target: 'cards/alley.mp3' });
    expect(m('warden power.mp3')).toMatchObject({ ok: true, target: 'heroes/warden.power.mp3' });
    expect(m('Yirin.mp3')).toMatchObject({ ok: true, target: 'heroes/rohan.mp3', variant: 'select' });
  });
  it('rejects a .effect clip for a vanilla minion', () => {
    const r = m('plain effect.mp3');
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/no effect/);
  });
  it('rejects a minion-variant on a hero', () => {
    const r = m('warden death.mp3');
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/hero/);
  });
  it('passes an already-correct exact basename straight through', () => {
    expect(m('rohan.power.mp3')).toMatchObject({ ok: true, target: 'heroes/rohan.power.mp3' });
  });
});
