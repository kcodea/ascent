/**
 * Pure logic for the SFX manifest generator (`npm run sfx:manifest`). No fs / no `@game/*` imports here —
 * every function is pure over plain inputs, so the tests run with fixtures and never need `@game/sim` alias
 * resolution. The runner (`sfx-manifest.ts`) feeds these the real data and does the fs read/write.
 */

export type SfxStatus = '⬜' | '🎙️' | '✅' | '➖';

export interface SfxRow {
  section: string;
  filename: string;
  trigger: string;
  brief: string;
  status: SfxStatus;
}

/** Minimal shape the generator needs from a CardDef (decouples pure logic from @game/core's full type). */
export interface ManifestCard {
  id: string;
  name: string;
  tribe?: string;
  token?: boolean;
  spell?: boolean;
  effects: { on?: string; do?: string }[];
}
export interface ManifestHero {
  id: string;
  name: string;
  power: { name: string };
}

export const GEN_MARKER =
  '<!-- GENERATED BELOW — edit the Creative brief + Status columns only; Filename/Trigger are regenerated. -->';

export const SECTION_ORDER = [
  'System / UI', 'Heroes', 'Spells', 'Neutral', 'Beasts', 'Dragons', 'Undead', 'Mechs', 'Demons', 'Tokens',
];

const TRIBE_SECTION: Record<string, string> = {
  neutral: 'Neutral', beast: 'Beasts', dragon: 'Dragons', undead: 'Undead', mech: 'Mechs', demon: 'Demons',
};

/** Human-readable label for an effect trigger id (`on`), falling back to the raw value. */
const EFFECT_LABEL: Record<string, string> = {
  onPlay: 'Battlecry', onDeath: 'Deathrattle', onStartCombat: 'Start-of-Combat', startOfCombat: 'Start-of-Combat',
  onSummon: 'on-summon', onKill: 'on-kill', onBuy: 'on-buy', onSell: 'on-sell', onFriendDeath: 'on-ally-death',
};

/** Section a card belongs to. Spell/token are checked before tribe (a spell's tribe is 'neutral'). */
export function sectionOf(card: ManifestCard): string {
  if (card.spell) return 'Spells';
  if (card.token) return 'Tokens';
  return TRIBE_SECTION[card.tribe ?? 'neutral'] ?? 'Neutral';
}

/** The card's dominant effect trigger (`on`), or undefined for a vanilla minion. */
function dominantEffect(card: ManifestCard): string | undefined {
  return card.effects.find((e) => e.on)?.on;
}

/** Rows for one card: a spell → one cast row; a minion/token → play + death + effect. */
export function cardRows(card: ManifestCard): SfxRow[] {
  const section = sectionOf(card);
  if (card.spell) {
    return [{
      section, filename: `cards/${card.id}.mp3`,
      trigger: 'Spell cast — unique clip over the default bed',
      brief: `${card.name} — spell cast cue (~0.4s).`, status: '⬜',
    }];
  }
  const rows: SfxRow[] = [
    { section, filename: `cards/${card.id}.mp3`, trigger: 'Played to the board (over the landing bed)',
      brief: `${card.name} — play cue (~0.4s).`, status: '⬜' },
    { section, filename: `cards/${card.id}.death.mp3`, trigger: 'Dies in combat (over the death bed)',
      brief: `${card.name} — death cue (~0.4s).`, status: '⬜' },
  ];
  const eff = dominantEffect(card);
  rows.push(eff
    ? { section, filename: `cards/${card.id}.effect.mp3`, trigger: `${EFFECT_LABEL[eff] ?? eff} procs (shop or combat)`,
        brief: `${card.name} — ${EFFECT_LABEL[eff] ?? eff} proc cue (~0.4s).`, status: '⬜' }
    : { section, filename: `cards/${card.id}.effect.mp3`, trigger: 'Vanilla — no effect to proc',
        brief: '(vanilla — no clip needed)', status: '➖' });
  return rows;
}

export function heroRows(hero: ManifestHero): SfxRow[] {
  return [
    { section: 'Heroes', filename: `heroes/${hero.id}.mp3`, trigger: `${hero.name} selected in Hero Select`,
      brief: `${hero.name} — hero select cue.`, status: '⬜' },
    { section: 'Heroes', filename: `heroes/${hero.id}.power.mp3`, trigger: `${hero.name}'s power "${hero.power.name}" activates`,
      brief: `${hero.power.name} — hero power cue.`, status: '⬜' },
  ];
}

/** Sort by section order, then filename, so reruns produce no spurious diffs. */
function sortRows(rows: SfxRow[]): SfxRow[] {
  return [...rows].sort((a, b) => {
    const s = SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section);
    return s !== 0 ? s : a.filename.localeCompare(b.filename);
  });
}

/** Build every row from the current data. `systemFiles` = existing top-level audio/*.mp3 (status ✅). */
export function deriveRows(cards: ManifestCard[], heroes: ManifestHero[], systemFiles: string[]): SfxRow[] {
  const rows: SfxRow[] = [];
  for (const f of systemFiles) {
    rows.push({ section: 'System / UI', filename: f, trigger: 'Existing UI / system cue', brief: '(shipped)', status: '✅' });
  }
  rows.push({ section: 'Spells', filename: 'castspell.mp3', trigger: 'Default bed under every spell cast',
    brief: 'Generic spell whoosh (~0.3s).', status: '⬜' });
  for (const h of heroes) rows.push(...heroRows(h));
  for (const c of cards) rows.push(...cardRows(c));
  return sortRows(rows);
}

const escCell = (s: string): string => s.replace(/\|/g, '\\|').trim();

/** Parse the generated tables of an existing doc into filename → { brief, status }. */
export function parseExistingTables(md: string): Map<string, { brief: string; status: string }> {
  const out = new Map<string, { brief: string; status: string }>();
  for (const line of md.split('\n')) {
    const m = line.match(/^\|(.+)\|$/);
    if (!m) continue;
    const cells = m[1].split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
    if (cells.length !== 4) continue;
    const filename = cells[0].replace(/`/g, '').trim();
    if (!filename || filename === 'Filename' || /^-+$/.test(filename)) continue;
    out.set(filename, { brief: cells[2], status: cells[3] });
  }
  return out;
}

/** Overlay preserved human columns (brief, status) onto freshly-derived rows, keyed by filename. */
export function mergeRows(fresh: SfxRow[], existing: Map<string, { brief: string; status: string }>): SfxRow[] {
  return fresh.map((r) => {
    const prev = existing.get(r.filename);
    if (!prev) return r;
    return { ...r, brief: prev.brief || r.brief, status: (prev.status as SfxStatus) || r.status };
  });
}

/** Render the generated zone: one `### Section (n)` + table per non-empty section, in SECTION_ORDER. */
export function renderGeneratedZone(rows: SfxRow[]): string {
  const bySection = new Map<string, SfxRow[]>();
  for (const r of rows) {
    const list = bySection.get(r.section) ?? [];
    list.push(r);
    bySection.set(r.section, list);
  }
  const parts: string[] = [];
  for (const section of SECTION_ORDER) {
    const list = bySection.get(section);
    if (!list?.length) continue;
    parts.push(`### ${section} (${list.length})`, '');
    parts.push('| Filename | Trigger | Creative brief | Status |', '|---|---|---|---|');
    for (const r of list) parts.push(`| \`${r.filename}\` | ${escCell(r.trigger)} | ${escCell(r.brief)} | ${r.status} |`);
    parts.push('');
  }
  return parts.join('\n').trimEnd();
}

/** Placeholder in `sfx-guide.template.html` where the row data is injected. */
export const GUIDE_ROWS_MARKER = '/*__SFX_ROWS__*/[]';

/** Inject the manifest rows into the guide template (replaces the marker with a JSON array literal), so
 *  `sfx-guide.html` is a generated view of the same data as `sfx-manifest.md`. */
export function injectGuideData(template: string, rows: SfxRow[]): string {
  if (!template.includes(GUIDE_ROWS_MARKER)) {
    throw new Error(`sfx-guide template is missing the ${GUIDE_ROWS_MARKER} marker`);
  }
  return template.replace(GUIDE_ROWS_MARKER, JSON.stringify(rows));
}
