export interface ShipRelease { tagName: string; isDraft: boolean; publishedAt: string | null }
export interface ShipState { sha: string; version: string; workerUrl: string; hubUrl: string; contentRevision: string }
export interface ShipNote { date: string; label?: string; changes: { category: string; text: string; details?: string[] }[] }
export function latestPublished(releases: ShipRelease[]): ShipRelease | null;
export function nextVersion(latestTag: string | null, bump: 'patch' | 'minor' | 'major'): string;
export function previousReleaseDate(releases: ShipRelease[]): string | null;
export function releaseNotesMarkdown(notes: ShipNote[]): string;
export function resumeState(saved: unknown, now: Date): ShipState;
export function expectedRunName(version: string, sha: string): string;
export const RELEASE_ASSETS: string[];
export function verifyDraft(release: { isDraft?: boolean; targetCommitish?: string; assets?: { name: string }[] } | null, o: { sha: string }): { ok: boolean; reason: string };
export function parseArgs(argv: string[]): { bump: 'patch' | 'minor' | 'major'; dry: boolean; resume: boolean; error: string | null };
export const USAGE: string;
export const DESKTOP_ORIGIN: string;
export function allowedOriginsProblem(value: string | undefined | null): string | null;
export function pickNewRun(runs: { databaseId: number; displayTitle: string }[], title: string, excludeIds: number[]): number | null;
