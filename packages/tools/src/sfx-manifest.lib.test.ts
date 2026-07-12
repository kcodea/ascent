import { describe, it, expect } from 'vitest';
import {
  deriveRows, mergeRows, parseExistingTables, renderGeneratedZone, GEN_MARKER,
  injectGuideData, GUIDE_ROWS_MARKER,
  type ManifestCard, type ManifestHero,
} from './sfx-manifest.lib';

const cat: ManifestCard = { id: 'alley', name: 'Pennycat', tribe: 'beast', effects: [{ on: 'onPlay', do: 'battlecrySummon' }] };
const vanilla: ManifestCard = { id: 'plain', name: 'Plain Beast', tribe: 'beast', effects: [] };
const tokenCard: ManifestCard = { id: 'stray', name: 'Stray', tribe: 'beast', token: true, effects: [] };
const spell: ManifestCard = { id: 'spiritfire', name: 'Spirit Fire', tribe: 'neutral', spell: true, effects: [{ on: 'onPlay', do: 'spellBuffTarget' }] };
const hero: ManifestHero = { id: 'warden', name: 'Warden', power: { name: 'Aegis' } };

describe('deriveRows', () => {
  const rows = deriveRows([cat, vanilla, tokenCard, spell], [hero], ['buy1.mp3', 'roll.mp3']);
  const byFile = (f: string) => rows.find((r) => r.filename === f)!;

  it('gives a minion three rows: play, death, effect', () => {
    expect(byFile('cards/alley.mp3').section).toBe('Beasts');
    expect(byFile('cards/alley.mp3').trigger).toMatch(/Played/);
    expect(byFile('cards/alley.death.mp3').trigger).toMatch(/Dies/);
    expect(byFile('cards/alley.effect.mp3').trigger).toMatch(/Battlecry/);
  });

  it('marks a vanilla minion\'s effect row N/A', () => {
    const eff = byFile('cards/plain.effect.mp3');
    expect(eff.status).toBe('➖');
    expect(eff.trigger).toMatch(/Vanilla/);
  });

  it('puts tokens in Tokens and spells in Spells (spell = one cast row)', () => {
    expect(byFile('cards/stray.mp3').section).toBe('Tokens');
    expect(byFile('cards/spiritfire.mp3').section).toBe('Spells');
    expect(rows.filter((r) => r.filename.startsWith('cards/spiritfire')).length).toBe(1);
  });

  it('gives a hero select + power rows, and a spell default bed + system rows', () => {
    expect(byFile('heroes/warden.mp3').trigger).toMatch(/selected/);
    expect(byFile('heroes/warden.power.mp3').trigger).toMatch(/Aegis/);
    expect(byFile('castspell.mp3').section).toBe('Spells');
    expect(byFile('buy1.mp3').section).toBe('System / UI');
    expect(byFile('buy1.mp3').status).toBe('✅');
  });
});

describe('merge round-trip preserves human columns', () => {
  it('carries brief + status from an existing rendered table, seeds new rows', () => {
    const first = deriveRows([cat], [], []);
    const edited = renderGeneratedZone(first.map((r) =>
      r.filename === 'cards/alley.mp3' ? { ...r, brief: 'my custom meow', status: '✅' } : r));
    const parsed = parseExistingTables(edited);
    const merged = mergeRows(deriveRows([cat, vanilla], [], []), parsed);
    const play = merged.find((r) => r.filename === 'cards/alley.mp3')!;
    expect(play.brief).toBe('my custom meow');
    expect(play.status).toBe('✅');
    expect(merged.find((r) => r.filename === 'cards/plain.mp3')!.status).toBe('⬜');
  });
});

describe('renderGeneratedZone', () => {
  it('emits a table per non-empty section and escapes pipes', () => {
    const md = renderGeneratedZone(deriveRows([cat], [], []));
    expect(md).toMatch(/### Beasts \(3\)/);
    expect(md).toMatch(/\| Filename \| Trigger \| Creative brief \| Status \|/);
    expect(md).not.toContain(GEN_MARKER);
  });
});

describe('injectGuideData', () => {
  const rows = deriveRows([{ id: 'alley', name: 'Pennycat', tribe: 'beast', effects: [{ on: 'onPlay' }] }], [], []);
  it('replaces the template marker with the rows as a JSON array', () => {
    const out = injectGuideData(`const DATA = ${GUIDE_ROWS_MARKER}; // rest`, rows);
    expect(out).not.toContain(GUIDE_ROWS_MARKER);
    expect(out).toContain('const DATA = [');
    expect(JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1))).toEqual(rows);
  });
  it('throws if the template is missing the marker', () => {
    expect(() => injectGuideData('no marker here', rows)).toThrow(/marker/);
  });
});
