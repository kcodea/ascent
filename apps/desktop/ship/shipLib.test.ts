import { describe, expect, it } from 'vitest';
import { nextVersion, releaseNotesMarkdown, resumeState, previousReleaseDate } from './shipLib.mjs';

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
