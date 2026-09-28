import type { WikiEntry } from './types';

// Checked against packages/sim/src/lobby/runLobby.ts (pairRunLobby, ghostFor), rank.ts and lobbyStrength.ts
// on 2026-09-28.
export const ENTRIES: readonly WikiEntry[] = [
  {
    id: 'who-do-i-fight',
    topic: 'lobby',
    q: 'Who am I fighting? Are they real people?',
    a: "The other 7 seats are **recorded runs from real players** (or bots), so nobody has to be online at the same time as you. Each round you're matched with another player who's still alive, usually one you haven't fought in a while, so rematches are rare. If there's an odd number of players left, someone fights a **ghost**: the board of the last player knocked out (never someone you just fought or just knocked out yourself).",
    aliases: ['opponent', 'matchmaking', 'pairing', 'ghost', 'bot', 'real players', 'online'],
    seeAlso: ['goal-of-the-game', 'placement-and-rating'],
    covers: [{ rule: 'R-LOBBY-01', fp: '3ca6048e' }],
  },
  {
    id: 'placement-and-rating',
    topic: 'lobby',
    q: 'How does my Rating go up or down?',
    a: "It's all about where you **place**. In rated games, 1st gets you **+40**, 2nd **+28**, 3rd **+16**, 4th **+6**, and 5th–8th lose you 6, 16, 28 and 40. Finishing top 4 in a tough lobby adds a small bonus. Fill the bar to 100 and your next game is a **promotion** game. Win it and you start the new division at 10, so one bad game right after can't knock you straight back down.",
    aliases: ['rank', 'ladder', 'mmr', 'points', 'promotion', 'demotion', 'medal'],
    seeAlso: ['goal-of-the-game'],
    covers: [{ rule: 'R-RANK-01', fp: '739d650f' }],
  },
];
