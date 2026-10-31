/**
 * The access token the friends hub is called with (its socket, and the Live Games directory's HTTP reads,
 * R-LIVE-DIR-01): the Supabase session's (a guest's anonymous session included), read with a deadline so a stuck session
 * read never stalls the caller for good. A local dev hub (DEV_AUTH=1) also takes a dev token; the live hub never would,
 * so there it waits for a real session.
 */
import { VersusCfError } from '@game/versus-cf/client';
import { currentUserId } from '../../identity';
import { supabaseClient } from '../../remoteBoards';
import { isLocalHub } from './hubUrl';

/** The longest the hub waits for my access token before trying again. */
export const HUB_TOKEN_TIMEOUT_MS = 8_000;

export async function hubToken(base: string): Promise<string> {
  const c = supabaseClient();
  if (c) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const { data } = await Promise.race([
        c.auth.getSession(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new VersusCfError('token_timeout')), HUB_TOKEN_TIMEOUT_MS); }),
      ]);
      if (data.session?.access_token) return data.session.access_token;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const me = currentUserId();
  if (!me) throw new VersusCfError('not_signed_in');
  if (!isLocalHub(base)) throw new VersusCfError('not_signed_in');
  return `dev.${me}.dev`;
}
