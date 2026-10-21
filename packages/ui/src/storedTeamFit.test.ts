import { describe, expect, it } from 'vitest';
import { boardStatFit } from './StoredTeam';

describe('boardStatFit: one number size per stored board', () => {
  it('takes the bucket of the longest printed number on the board', () => {
    expect(boardStatFit([{ attack: 14, health: 13 }, { attack: 1160, health: 886 }])).toBe('4');
  });
  it('is undefined when every number fits at full size', () => {
    expect(boardStatFit([{ attack: 200, health: 148 }, { attack: 7, health: 999 }])).toBeUndefined();
    expect(boardStatFit([])).toBeUndefined();
  });
  it('reads the abbreviated text, not the raw digits', () => {
    expect(boardStatFit([{ attack: 104_000, health: 5 }])).toBe('4'); // "104k"
    expect(boardStatFit([{ attack: 12345, health: 5 }])).toBe('5');
  });
});
