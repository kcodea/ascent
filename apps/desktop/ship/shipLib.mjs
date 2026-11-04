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
