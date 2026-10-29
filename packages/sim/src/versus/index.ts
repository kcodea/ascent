/** VERSUS (real-time 1v1, 2026-10-13) — the public module. See docs/devlog/2026-10-13-versus.md. */
export * from './constants';
export * from './canonical';
export * from './combat';
export { carryAsPlayerFields, flipEventSides, mirrorForEnemySeat, ownSeatPerspective, swapTagTeam } from './mirror';
export * from './run';
export * from './lobbyView';
export * from './options';
export * from './group';
export { handleVersusGroupFinalize, groupRoundDigest, type VersusGroupFinalizeStore } from './groupFinalize';
export { handleVersusFinalize, storedVersusVitals, versusFightDigest, versusFightPayload, type VersusFinalizeStore, type VersusVitalsCommit } from './finalize';
export * from './groupLobbyView';
export * from './duos';
export * from './vitals';
export { handleVersusDuosFinalize, duosFightPayload, duosRoundDigest, type VersusDuosFinalizeStore, type VersusDuosMatchRow } from './duosFinalize';
// RANKED DUOS (owner 2026-10-26): the shared rules (end-turn gate, team names), the table seating and its server handler.
export * from './rankedDuos';
export * from './rankedDuosSeating';
export { handleRankedDuosSeat, rankedDuosTablePayload, RANKED_DUOS_DUO_SAMPLE, RANKED_DUOS_SOLO_SAMPLE, type RankedDuosSeatStore, type RankedDuosSeatMatchRow, type RankedDuosSoloRow, type RankedDuosDuoRow } from './rankedDuosSeat';
export * from './rankedDuosRound';
export { handleRankedDuosFinalize, rankedDuosFirstOf, rankedDuosMemberSide, rankedDuosPayload, rankedDuosRoundDigest, type RankedDuosFinalizeStore, type RankedDuosRoundRaw, type RankedDuosTeamRow, type RankedDuosMemberBoard } from './rankedDuosFinalize';
// DUOS MATCH HISTORY (owner 2026-10-29): the compact per-game record the Cloudflare room writes and Recent Games reads.
export * from './duosHistory';
