/**
 * Pure helpers for `npm run ship` (scripts/ship.mjs): versioning, release notes, resume state. No I/O here, so
 * shipLib.test.ts covers them without touching GitHub or Cloudflare.
 */

/** The newest non-draft release (gh `release list --json tagName,isDraft,publishedAt`), or null. */
export function latestPublished(releases) {
  const live = (releases ?? []).filter((r) => !r.isDraft && r.publishedAt);
  live.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  return live[0] ?? null;
}

/** The next version (no leading v) after `latestTag` ('v0.2.0'); null means nothing shipped yet, so the first is 0.2.0. */
export function nextVersion(latestTag, bump) {
  if (latestTag == null) return '0.2.0';
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(latestTag).trim());
  if (!m) throw new Error(`cannot parse release tag "${latestTag}" as vMAJOR.MINOR.PATCH`);
  let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (bump === 'major') { major += 1; minor = 0; patch = 0; }
  else if (bump === 'minor') { minor += 1; patch = 0; }
  else if (bump === 'patch') patch += 1;
  else throw new Error(`unknown bump "${bump}" (patch | minor | major)`);
  return `${major}.${minor}.${patch}`;
}

/** YYYY-MM-DD of the newest non-draft release's publish time, or null when there is none (notesSince then returns the latest entry). */
export function previousReleaseDate(releases) {
  const r = latestPublished(releases);
  return r ? String(r.publishedAt).slice(0, 10) : null;
}

/** GitHub release body from already-filtered patch notes: Game (the Balance bucket) then Systems; details become sub-bullets. */
export function releaseNotesMarkdown(notes) {
  const groups = [['Balance', 'Game'], ['Systems', 'Systems']];
  const sections = [];
  for (const [category, title] of groups) {
    const lines = [];
    for (const note of notes) {
      for (const c of note.changes) {
        if (c.category !== category) continue;
        lines.push(`- ${c.text}`);
        for (const d of c.details ?? []) lines.push(`  - ${d}`);
      }
    }
    if (lines.length) sections.push([`## ${title}`, ...lines].join('\n'));
  }
  if (!sections.length) return 'ASCENT update.\n';
  return `${sections.join('\n\n')}\n`;
}

/** What `--resume` continues with: exactly the saved plan. It never re-reads origin/main (that may have moved since the Worker deployed). */
export function resumeState(saved, _now) {
  if (!saved || typeof saved !== 'object') throw new Error('no saved ship state to resume');
  const out = {};
  for (const k of ['sha', 'version', 'workerUrl', 'hubUrl', 'contentRevision']) {
    if (typeof saved[k] !== 'string' || !saved[k]) throw new Error(`saved ship state is missing "${k}"`);
    out[k] = saved[k];
  }
  return out;
}

/** The workflow run-name for one ship dispatch; the run lookup matches the run's displayTitle against this exactly. */
export function expectedRunName(version, sha) {
  return `desktop-release v${version} ${sha}`;
}

export const RELEASE_ASSETS = ['ASCENT-Setup.exe', 'ASCENT-Setup.exe.blockmap', 'latest.yml', 'release.json'];

/** Is this `gh release view --json isDraft,targetCommitish,assets` output the draft we expect to publish? Returns { ok, reason }. */
export function verifyDraft(release, { sha }) {
  if (!release) return { ok: false, reason: 'the draft release was not found' };
  if (release.isDraft !== true) return { ok: false, reason: 'the release is not a draft (already published?)' };
  if (release.targetCommitish !== sha) return { ok: false, reason: `the draft targets ${release.targetCommitish}, not ${sha}` };
  const have = (release.assets ?? []).map((a) => a.name).sort();
  const want = [...RELEASE_ASSETS].sort();
  const missing = want.filter((n) => !have.includes(n));
  const extra = have.filter((n) => !want.includes(n));
  if (missing.length || extra.length || have.length !== want.length) {
    return { ok: false, reason: `draft assets are not exactly the expected four (missing: ${missing.join(', ') || 'none'}; unexpected/duplicate: ${extra.join(', ') || (have.length !== want.length ? 'duplicates' : 'none')})` };
  }
  return { ok: true, reason: '' };
}

/** Parse ship's argv. Patch unless --minor / --major; anything unknown is an error, never silently ignored. */
export function parseArgs(argv) {
  const out = { bump: 'patch', dry: false, resume: false, error: null };
  for (const a of argv) {
    if (a === '--dry-run') out.dry = true;
    else if (a === '--resume') out.resume = true;
    else if (a === '--minor') { if (out.bump === 'major') out.error = 'use only one of --minor / --major'; else out.bump = 'minor'; }
    else if (a === '--major') { if (out.bump === 'minor') out.error = 'use only one of --minor / --major'; else out.bump = 'major'; }
    else { out.error = `unknown argument "${a}"`; break; }
  }
  if (out.resume && out.bump !== 'patch') out.error = out.error ?? '--resume continues the saved plan; --minor / --major do not apply';
  return out;
}

/** The desktop app's origin: a `VERSUS_ALLOWED_ORIGINS` override that omits it would lock the installed exe out of Versus. */
export const DESKTOP_ORIGIN = 'app://ascent';

/** null when fine; else the reason an explicit `VERSUS_ALLOWED_ORIGINS` (comma list) drops the desktop origin. */
export function allowedOriginsProblem(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const origins = String(value).split(',').map((o) => o.trim());
  return origins.includes(DESKTOP_ORIGIN) ? null : `VERSUS_ALLOWED_ORIGINS is set but does not include ${DESKTOP_ORIGIN}; the installed desktop app would be refused by the Versus Worker. Add it, or unset the variable.`;
}

export const USAGE = 'usage: npm run ship -- [--minor | --major] [--dry-run] [--resume]';

/** The newly dispatched run: newest run titled `title` whose id was not already present before the dispatch, else null. */
export function pickNewRun(runs, title, excludeIds) {
  const skip = new Set(excludeIds ?? []);
  const fresh = (runs ?? []).filter((r) => r.displayTitle === title && !skip.has(r.databaseId));
  fresh.sort((a, b) => b.databaseId - a.databaseId);
  return fresh[0]?.databaseId ?? null;
}
