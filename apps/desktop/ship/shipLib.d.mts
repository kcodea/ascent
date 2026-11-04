export interface ShipRelease { tagName: string; isDraft: boolean; publishedAt: string | null }
export interface ShipState { sha: string; version: string; workerUrl: string; hubUrl: string; contentRevision: string }
export interface ShipNote { date: string; label?: string; changes: { category: string; text: string; details?: string[] }[] }
export function latestPublished(releases: ShipRelease[]): ShipRelease | null;
export function nextVersion(latestTag: string | null, bump: 'patch' | 'minor' | 'major'): string;
export function previousReleaseDate(releases: ShipRelease[]): string | null;
export function releaseNotesMarkdown(notes: ShipNote[]): string;
export function resumeState(saved: unknown, now: Date): ShipState;
