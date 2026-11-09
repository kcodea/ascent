import { describe, expect, it } from 'vitest';
import { CHAT_BUBBLE_MAX_PARTS, CHAT_BUBBLE_PART_CHARS, splitChatBody } from './chatSpeech';

// A long chat message shows as more than one bubble (owner 2026-11-09: "i need the long message to appear as two bubbles").
describe('splitChatBody', () => {
  it('keeps a message that fits one bubble whole', () => {
    expect(splitChatBody('gl hf')).toEqual(['gl hf']);
    const fits = 'x'.repeat(CHAT_BUBBLE_PART_CHARS);
    expect(splitChatBody(fits)).toEqual([fits]);
  });

  it('splits a long message in two at a space, losing no words', () => {
    const body = 'A much longer message to check how the panel wraps text when somebody types a whole paragraph about your board choices';
    const parts = splitChatBody(body);
    expect(parts).toHaveLength(2);
    expect(parts.join(' ')).toBe(body);
    for (const p of parts) expect([...p].length).toBeLessThanOrEqual(CHAT_BUBBLE_PART_CHARS);
  });

  it('never breaks an emote token that sits at the cut', () => {
    const body = `${'word '.repeat(17)}:emote_zen_brian: ${'more '.repeat(10)}`.trim();
    const parts = splitChatBody(body);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.some((p) => p.includes(':emote_zen_brian:'))).toBe(true);
  });

  it('caps a very long message at the most bubbles', () => {
    const parts = splitChatBody('word '.repeat(200).trim());
    expect(parts).toHaveLength(CHAT_BUBBLE_MAX_PARTS);
  });
});
