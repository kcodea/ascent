/**
 * THE PAGE IS IN FRONT OF ME: visible, and focused where the browser can tell. Every chat's "read when seen" rule asks
 * this (the direct messages, R-DM-READ-01, and the lobby chat, R-LOBBY-CHAT-02): a message that lands while the chat is
 * showing AND the page is seen is never counted unread.
 */
export function pageSeen(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.visibilityState === 'hidden') return false;
  return typeof document.hasFocus !== 'function' || document.hasFocus();
}
