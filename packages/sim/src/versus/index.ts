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
