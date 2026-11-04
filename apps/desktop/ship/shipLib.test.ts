import { describe, expect, it } from 'vitest';
import { nextVersion, releaseNotesMarkdown, resumeState, previousReleaseDate, expectedRunName, verifyDraft, parseArgs, pickNewRun } from './shipLib.mjs';

describe('nextVersion', () => {
  it('starts at 0.2.0 when nothing is released', () => expect(nextVersion(null, 'patch')).toBe('0.2.0'));
  it('bumps patch', () => expect(nextVersion('v0.2.0', 'patch')).toBe('0.2.1'));
  it('bumps minor and resets patch', () => expect(nextVersion('v0.2.9', 'minor')).toBe('0.3.0'));
  it('bumps major and resets the rest', () => expect(nextVersion('v0.3.4', 'major')).toBe('1.0.0'));
  it('accepts a tag without the v', () => expect(nextVersion('1.4.2', 'patch')).toBe('1.4.3'));
  it('rejects a malformed tag', () => expect(() => nextVersion('latest', 'patch')).toThrow());
});

describe('resumeState', () => {
  const saved = { sha: 'abc123', version: '0.2.1', workerUrl: 'https://w', hubUrl: 'https://h', contentRevision: 'r1', extra: 1 };
  it('resumeUsesSavedState: returns the saved fields unchanged and never looks at origin/main', () => {
    expect(resumeState(saved, new Date('2026-11-04T00:00:00Z'))).toEqual({
      sha: 'abc123', version: '0.2.1', workerUrl: 'https://w', hubUrl: 'https://h', contentRevision: 'r1',
    });
  });
  it('refuses incomplete state', () => {
    expect(() => resumeState({ sha: 'abc' }, new Date())).toThrow(/version/);
    expect(() => resumeState(null, new Date())).toThrow();
  });
});

describe('releaseNotesMarkdown', () => {
  const notes = [
    {
      date: '2026-11-04',
      changes: [
        { category: 'Balance', text: 'Rook is stronger.', details: ['+1 Attack', '+2 Health'] },
        { category: 'Systems', text: 'Shop is snappier.' },
        { category: 'Balance', text: 'Sirius reworked.' },
      ],
    },
  ];
  it('groups Game then Systems with details as sub-bullets', () => {
    expect(releaseNotesMarkdown(notes)).toBe(
      ['## Game', '- Rook is stronger.', '  - +1 Attack', '  - +2 Health', '- Sirius reworked.', '', '## Systems', '- Shop is snappier.', ''].join('\n'),
    );
  });
  it('omits an empty group and handles no notes', () => {
    expect(releaseNotesMarkdown([{ date: 'd', changes: [{ category: 'Systems', text: 'x' }] }])).toBe('## Systems\n- x\n');
    expect(releaseNotesMarkdown([])).toContain('ASCENT');
  });
});

describe('previousReleaseDate', () => {
  it('takes YYYY-MM-DD of the newest non-draft release other than the new tag', () => {
    expect(previousReleaseDate([
      { tagName: 'v0.2.1', isDraft: true, publishedAt: null },
      { tagName: 'v0.2.0', isDraft: false, publishedAt: '2026-11-03T10:00:00Z' },
    ])).toBe('2026-11-03');
    expect(previousReleaseDate([])).toBeNull();
  });
});

describe('expectedRunName', () => {
  it('names the run by version and sha', () => expect(expectedRunName('0.2.0', 'abc')).toBe('desktop-release v0.2.0 abc'));
});

describe('verifyDraft', () => {
  const assets = ['ASCENT-Setup.exe', 'ASCENT-Setup.exe.blockmap', 'latest.yml', 'release.json'].map((name) => ({ name }));
  const good = { isDraft: true, targetCommitish: 'abc', assets };
  it('accepts the exact draft', () => expect(verifyDraft(good, { sha: 'abc' }).ok).toBe(true));
  it('refuses a wrong sha', () => expect(verifyDraft({ ...good, targetCommitish: 'zzz' }, { sha: 'abc' }).ok).toBe(false));
  it('refuses a published release', () => expect(verifyDraft({ ...good, isDraft: false }, { sha: 'abc' }).ok).toBe(false));
  it('refuses a missing asset', () => expect(verifyDraft({ ...good, assets: assets.slice(1) }, { sha: 'abc' })).toMatchObject({ ok: false, reason: expect.stringContaining('ASCENT-Setup.exe') }));
  it('refuses an extra asset', () => expect(verifyDraft({ ...good, assets: [...assets, { name: 'x.zip' }] }, { sha: 'abc' }).ok).toBe(false));
  it('refuses no release', () => expect(verifyDraft(null, { sha: 'abc' }).ok).toBe(false));
});

describe('parseArgs', () => {
  it('defaults to patch', () => expect(parseArgs([])).toMatchObject({ bump: 'patch', dry: false, resume: false, error: null }));
  it('takes --minor, --major, --dry-run, --resume', () => {
    expect(parseArgs(['--minor']).bump).toBe('minor');
    expect(parseArgs(['--major', '--dry-run'])).toMatchObject({ bump: 'major', dry: true });
    expect(parseArgs(['--resume']).resume).toBe(true);
  });
  it('rejects unknown arguments and conflicts', () => {
    expect(parseArgs(['--bump', 'minor']).error).toMatch(/unknown/);
    expect(parseArgs(['--wat']).error).toMatch(/unknown/);
    expect(parseArgs(['--minor', '--major']).error).toBeTruthy();
    expect(parseArgs(['--resume', '--minor']).error).toBeTruthy();
  });
});

describe('pickNewRun', () => {
  const t = 'desktop-release v0.2.0 abc';
  it('ignores an old same-title run', () => expect(pickNewRun([{ databaseId: 5, displayTitle: t }], t, [5])).toBeNull());
  it('picks the new run over the old one', () => expect(pickNewRun([{ databaseId: 5, displayTitle: t }, { databaseId: 9, displayTitle: t }], t, [5])).toBe(9));
  it('ignores other titles and no match gives null', () => {
    expect(pickNewRun([{ databaseId: 9, displayTitle: 'other' }], t, [])).toBeNull();
    expect(pickNewRun([], t, [])).toBeNull();
  });
});
