/**
 * Smoke-mode console-error classifier (pure, so it can be unit-tested). A console error is a REMOTE NETWORK REFUSAL only when it is
 * a CORS block or a Chromium net::ERR_* AND it names an http(s):// URL (in the message or the console event's sourceId). Anything
 * else, notably a failed app:// load whose "Failed to load resource: net::ERR_*" line carries no URL, stays a plain console error.
 */
function isRemoteNetworkError(message, sourceId) {
  if (!/blocked by CORS policy|net::ERR_/.test(message)) return false;
  return /https?:\/\//i.test(`${message}\n${sourceId ?? ''}`);
}
module.exports = { isRemoteNetworkError };
