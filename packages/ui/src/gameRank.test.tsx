// @vitest-environment jsdom
/**
 * R-GAME-RANK-01 (owner 2026-10-17: "i want to show the rank that the game was in in this page, so it should say Plat 3
 * or w/e"). Pins where a game's rank comes from (the Career's settled `entry.rank.before`, Recent Games' telemetry
 * `rankAtStart`), that nothing is guessed (no stamp, a bare rating, Practice, Versus = no rank), the labels, and that the
 * shared list row + detail header print it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { careerRunOf } from './careerData';
import { asRecentGameRow, RECENT_GAMES_FAST_SELECT, RECENT_GAMES_SELECTS } from './remoteBoards';
import { careerGameRankOf, divisionIndexOf, shortRankLabel, telemetryGameRankOf } from './gameRankData';
import { GameRank } from './gameRank';
import { GameSplit, type GameListItem } from './GameSplit';
import { GameCard } from './GameCard';
import { mount, type Mounted } from './renderedText.mount';

HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

// Platinum III = medal 3 (Platinum) x 3 + tier 2 = 11.
const PLAT_III = 11;

describe('where a game\'s rank comes from', () => {
  it('a stored division index only, in range', () => {
    expect(divisionIndexOf(0)).toBe(0);
    expect(divisionIndexOf(17)).toBe(17);
    expect(divisionIndexOf('11')).toBe(11);
    expect(divisionIndexOf(18)).toBeNull();
    expect(divisionIndexOf(-1)).toBeNull();
    expect(divisionIndexOf(2.5)).toBeNull();
    expect(divisionIndexOf(null)).toBeNull();
    expect(divisionIndexOf('')).toBeNull();
  });

  it('Career: the position the server settled the game FROM (entry.rank.before), never the rating', () => {
    const before = { divisionIndex: PLAT_III, points: 40, demotionReady: false };
    const detailed = careerRunOf({ id: 1, mode: 'lobby', entry: { mode: 'lobby', seed: 1, rank: { before, after: { divisionIndex: 12, points: 10 } }, ratingBefore: 1140 } });
    expect(detailed.rank).toBe(PLAT_III);
    // The light select projects `entry->rank->before` as `rank_before`.
    expect(careerRunOf({ id: 2, mode: 'lobby', rank_before: before }).rank).toBe(PLAT_III);
    // No stamp: no rank, even with a rating on the row (100 x division + points is ambiguous at the gate).
    expect(careerRunOf({ id: 3, mode: 'lobby', entry: { mode: 'lobby', ratingAfter: 1100, ratingBefore: 1100 } }).rank).toBeNull();
  });

  it('Practice and Versus never carry a rank', () => {
    const before = { divisionIndex: PLAT_III, points: 0 };
    expect(careerGameRankOf(before, 'practice')).toBeNull();
    expect(careerGameRankOf(before, 'versus')).toBeNull();
    expect(careerGameRankOf(before, 'lobby')).toBe(PLAT_III);
    expect(careerRunOf({ id: 4, mode: 'versus', entry: { mode: 'versus', rank: { before } } }).rank).toBeNull();
  });

  it('Recent Games: the telemetry rankAtStart division (every player); a medal-only or absent stamp shows nothing', () => {
    expect(telemetryGameRankOf({ v: 1, medal: 'Platinum', divisionIndex: PLAT_III, division: 'Platinum III', points: 5 })).toBe(PLAT_III);
    expect(telemetryGameRankOf({ v: 1, medal: 'Gold' })).toBeNull();
    expect(telemetryGameRankOf(null)).toBeNull();
    expect(asRecentGameRow({ id: 9, hero_id: 'sable', rank_at_start: { v: 1, medal: 'Platinum', divisionIndex: PLAT_III } }).rank).toBe(PLAT_III);
    expect(asRecentGameRow({ id: 9, hero_id: 'sable' }).rank).toBeNull();
  });

  it('the Recent Games selects that already read `derived` also read the rank path', () => {
    expect(RECENT_GAMES_FAST_SELECT).toContain('rank_at_start:derived->rankAtStart');
    for (const sel of RECENT_GAMES_SELECTS) {
      if (sel.includes('derived->')) expect(sel).toContain('rank_at_start:derived->rankAtStart');
    }
  });
});

describe('the rank labels', () => {
  it('full name in the header, short in the list', () => {
    expect(shortRankLabel(PLAT_III)).toBe('Plat III');
    expect(shortRankLabel(0)).toBe('Bronze I');
    expect(shortRankLabel(17)).toBe('Asc III');
    expect(shortRankLabel(13)).toBe('Dia II');
  });
});

describe('the shared game views print it', () => {
  let m: Mounted | null = null;
  afterEach(() => { m?.unmount(); m = null; });

  it('the detail header: crest + "Platinum III" beside the record', () => {
    m = mount(
      <GameCard place={2} label="2nd place" hero={<span />} title="Neptus" record={<span>6-4</span>}
        rank={<GameRank divisionIndex={PLAT_III} />} board={<div />} meta={<div />} />,
    );
    const rec = m.container.querySelector('.gc-record')!;
    expect(rec.querySelector('.gamerank .rankcrest')).not.toBeNull();
    expect(rec.querySelector('.gamerank-l')!.textContent).toBe('Platinum III');
    expect(rec.querySelector('.gamerank')!.getAttribute('aria-label')).toBe('Played at Platinum III');
  });

  it('a list row: the compact tag on a ranked row, nothing on an unranked one', () => {
    const items: GameListItem[] = [
      { key: 'a', place: 1, portrait: <span />, title: 'Ranked', label: 'a', rank: PLAT_III },
      { key: 'b', place: 5, portrait: <span />, title: 'Old game', label: 'b', rank: null },
    ];
    m = mount(<GameSplit items={items} selected="a" onPick={() => {}} detail={null} label="Games" />);
    const rows = m.container.querySelectorAll('.gs-item');
    expect(rows[0]!.querySelector('.gamerank.compact .gamerank-l')!.textContent).toBe('Plat III');
    expect(rows[1]!.querySelector('.gamerank')).toBeNull();
  });
});
