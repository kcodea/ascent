// @vitest-environment jsdom
/**
 * GAUNTLET IN-RUN FOE — what a Gauntlet run floats on the right of the shop in place of the 8-seat lobby rail (owner
 * ask 2026-09-29: no rail, just the opponent's portrait + name; 2026-09-30: it mimics the combat portrait). Pins: the
 * combat opponent's own name plate + portrait disc (identical markup), one "Round N / 10 · Max loss N" line (held at
 * 10 once the final round is past; "No cap" on round 9), NO runes / health pill / hero power,
 * NO rail box, NO seat list / scouting and NO player Resolve. Plus the regression that the normal lobby rail still
 * reads the normal cap table (round 8 → −15), and the combat opponent: the stage's tribe emblem in place of the
 * stand-in hero portrait, no hero power, no health pill, name kept. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createGauntletRun, createLobbyRun, type RunState } from '@game/sim';
import type { GauntletStage } from '@game/content';
import { mount, type Mounted } from '../renderedText.mount';
import { LobbyPanel } from '../LobbyPanel';
import { CombatOpponent } from '../CombatOpponent';
import { useGame } from '../store';
import { artFor } from '../art';
import { GauntletFoe } from './GauntletFoe';

/** Stage 1 wears a portrait card and stage 2 has none, regardless of what the shipped stage files carry (the test owns its fixture). */
vi.mock('@game/content', async (importOriginal) => {
  const m = await importOriginal<typeof import('@game/content')>();
  return {
    ...m,
    gauntletStage: (n: number) => {
      const s = m.gauntletStage(n);
      if (n === 1) return { ...s!, portraitCardId: 'dm_grobbus' };
      if (n === 2) return { ...s!, portraitCardId: undefined }; // stage 2 has no portrait card -> tribe-emblem fallback
      return s;
    },
  };
});

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const stage: GauntletStage = {
  number: 1, name: 'Demons', opponentName: 'The Demon Host', tribe: 'demon', status: 'ready', runes: {},
  rounds: Array.from({ length: 10 }, () => ({ board: [{ cardId: 'alley', attack: 1, health: 1, cardVersion: 'x' }] })),
};

const atRound = (round: number): RunState => {
  const run = createGauntletRun(777, 'warden', stage);
  return { ...run, wave: round, lobby: { ...run.lobby!, round } };
};

const show = (run: RunState): HTMLElement => {
  act(() => { useGame.setState({ run }); });
  ui = mount(<GauntletFoe />);
  return ui.container;
};

describe('GauntletFoe', () => {
  it('wears the combat opponent face (name plate + portrait disc) with one round / cap line — no runes, no health, no rail', () => {
    const run = { ...atRound(3), gauntletStage: 2 }; // Kobolds: no portrait card, so the tribe emblem
    const el = show(run);
    // The combat group's own name plate + the shared portrait disc (FoePortraitDisc), inside the scaled group.
    expect(el.querySelector('.gauntletfoe-group > .combatopp-name')!.textContent).toBe('The Demon Host');
    expect(el.querySelector('.gauntletfoe-group .combatopp-portrait .combatopp-emblem svg')).not.toBeNull();
    expect(el.querySelector('.combatopp-portrait img')).toBeNull();
    expect(el.querySelector('.gauntletfoe-meta')!.textContent).toBe('Round 3 / 10');
    expect(el.querySelector('.gauntletfoe-cap')!.textContent).toBe('Max loss 5');
    expect(el.querySelector('.gauntletfoe-cap .gauntletfoe-capnum svg')).not.toBeNull();
    // Runes are combat-only; the stage foe takes no damage (no health pill), has no hero power, and the shop copy
    // is never the strike's lunge target (`.combatopp-body` is heroBlast's query hook).
    expect(el.querySelector('.combatopp-runes, .combatopp-rune, .combatopp-runeslots, .runebadge')).toBeNull();
    expect(el.querySelector('.combatopp-hp')).toBeNull();
    expect(el.querySelector('.combatopp-body, .combatopp')).toBeNull();
    expect(document.body.querySelector('.opp-power')).toBeNull();
    // No rail chrome, no seats, no scouting, no player Resolve/Armor, no native tooltips.
    expect(el.querySelector('.lobbyrail')).toBeNull();
    expect(el.querySelector('.lobbyseat, .lobbyseats, .lobbyhp, .lobbyarmor')).toBeNull();
    expect(el.textContent).not.toContain('You');
    expect(el.querySelector('[title]')).toBeNull();
    const foe = el.querySelector('.gauntletfoe')!;
    act(() => { foe.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); });
    expect(document.body.querySelector('.lobbyscout')).toBeNull();
  });

  it('a stage with a portrait card shows that card art with the combat crop (sync-decoded, no emblem)', () => {
    const run = { ...atRound(3), gauntletStage: 1 };
    const el = show(run);
    const img = el.querySelector<HTMLImageElement>('.combatopp-portrait img.combatopp-img.combatopp-cardart')!;
    expect(img).not.toBeNull();
    expect(img.getAttribute('decoding')).toBe('sync');
    expect(img.getAttribute('src')).toBe(artFor('dm_grobbus'));
    expect(el.querySelector('.combatopp-emblem')).toBeNull();
  });

  it('the shop portrait disc is the SAME markup the combat opponent renders (owner ask 2026-09-30: mimic combat)', () => {
    for (const stageNo of [1, 2]) { // portrait card art, then the tribe emblem
      const run: RunState = { ...atRound(2), gauntletStage: stageNo };
      const shop = show(run).querySelector('.combatopp-portrait')!.outerHTML;
      ui!.unmount(); ui = null;
      act(() => { useGame.setState({ run: { ...run, phase: 'combat' }, combatStaged: true }); });
      ui = mount(<CombatOpponent />);
      const combat = document.body.querySelector('.combatopp .combatopp-portrait')!.outerHTML;
      act(() => { useGame.setState({ combatStaged: false }); });
      ui.unmount(); ui = null;
      expect(shop).toBe(combat);
    }
  });

  it('reads "No cap" on the uncapped final rounds', () => {
    const el = show(atRound(9));
    expect(el.querySelector('.gauntletfoe-meta')!.textContent).toBe('Round 9 / 10');
    expect(el.querySelector('.gauntletfoe-cap')!.textContent).toBe('No cap');
  });

  it('holds the round at 10 once the final round is past', () => {
    const el = show(atRound(11));
    expect(el.querySelector('.gauntletfoe-meta')!.textContent).toBe('Round 10 / 10');
  });
});

describe('CombatOpponent in a Gauntlet', () => {
  it('wears the tribe emblem, keeps the name and shows no hero power or health (it takes no damage, R-GAUNTLET-02)', () => {
    const run: RunState = { ...atRound(2), gauntletStage: 2, phase: 'combat' }; // Kobolds: no portrait card
    act(() => { useGame.setState({ run, combatStaged: true }); });
    ui = mount(<CombatOpponent />);
    const opp = document.body.querySelector('.combatopp')!;
    expect(opp).not.toBeNull();
    expect(opp.querySelector('.combatopp-name')!.textContent).toBe('The Demon Host');
    expect(opp.querySelector('.combatopp-emblem')).not.toBeNull();
    expect(opp.querySelector('.combatopp-img')).toBeNull();
    expect(document.body.querySelector('.opp-power')).toBeNull();
    expect(document.body.querySelector('.combatopp-hp')).toBeNull();
    act(() => { useGame.setState({ combatStaged: false }); });
  });

  it('a stage with a portrait card wears that card art instead of the emblem', () => {
    const run: RunState = { ...atRound(2), gauntletStage: 1, phase: 'combat' };
    act(() => { useGame.setState({ run, combatStaged: true }); });
    ui = mount(<CombatOpponent />);
    const img = document.body.querySelector<HTMLImageElement>('.combatopp-portrait img.combatopp-img')!;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe(artFor('dm_grobbus'));
    expect(img.getAttribute('decoding')).toBe('sync');
    expect(document.body.querySelector('.combatopp-emblem')).toBeNull();
    act(() => { useGame.setState({ combatStaged: false }); });
  });

  it('a lobby foe still shows its health pill (regression)', () => {
    const run: RunState = { ...createLobbyRun(4242, 'warden'), phase: 'combat' };
    act(() => { useGame.setState({ run, combatStaged: true }); });
    ui = mount(<CombatOpponent />);
    expect(document.body.querySelector('.combatopp-hp')).not.toBeNull();
    act(() => { useGame.setState({ combatStaged: false }); });
  });
});

describe('Now Facing in a Gauntlet (Recruit source pin — the wipe is too deep in Recruit to mount here)', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'Recruit.tsx'), 'utf8');
  const at = src.indexOf('<div className="wipevs-label">Now Facing</div>');
  const block = src.slice(at, src.indexOf('<div className="wipevs-name">', at));

  it('wears the stage tribe emblem instead of the stand-in hero portrait; a lobby keeps the portrait', () => {
    expect(at).toBeGreaterThan(-1);
    expect(block).toMatch(/foePortrait\(run\.gauntletStage/);
    expect(block).toMatch(/<img decoding="sync" className="wipevs-face wipevs-cardart" src=\{gFace\.art\}/);
    expect(block).toMatch(/<span className="wipevs-face wipevs-emblem"><Icon name=\{tribe \? TRIBE_ICON\[tribe\]/);
    expect(block).toMatch(/:\s*<img decoding="sync" className="wipevs-face" src=\{heroPortrait\(foe\.seat\.heroId/);
  });
});

describe('lobby rail (regression)', () => {
  it('still reads the normal cap table: round 8 → −15', () => {
    const base = createLobbyRun(4242, 'warden');
    const run: RunState = { ...base, wave: 8, lobby: { ...base.lobby!, round: 8 } };
    act(() => { useGame.setState({ run }); });
    ui = mount(<LobbyPanel lobby={run.lobby!} />);
    expect(ui.container.querySelector('.lobbymax')!.textContent).toBe('Max dmg 15');
  });
});
