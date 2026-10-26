import { describe, expect, it } from 'vitest';
import { classifyFrame, foldTopic, keyForUrl } from './egressMeter';

const BASE = 'https://abc.supabase.co';

describe('egress meter keys', () => {
  it('names PostgREST tables, RPCs, Edge Functions (with the action) and auth', () => {
    expect(keyForUrl(`${BASE}/rest/v1/profiles?select=avatar`, 'GET', BASE)).toBe('rest:profiles GET');
    expect(keyForUrl(`${BASE}/rest/v1/rpc/versus_group_reconcile`, 'POST', BASE)).toBe('rpc:versus_group_reconcile');
    expect(keyForUrl(`${BASE}/functions/v1/versus-resolve`, 'POST', BASE, '{"action":"finalize_duos","round":3}')).toBe('fn:versus-resolve:finalize_duos');
    expect(keyForUrl(`${BASE}/auth/v1/token?grant_type=refresh_token`, 'POST', BASE)).toBe('auth:token');
    expect(keyForUrl('https://example.com/x', 'GET', BASE)).toBeNull();
  });

  it('folds room / game ids out of Realtime topics', () => {
    expect(foldTopic('realtime:versus:0b5c1f0e-1111-4222-8333-944445555666')).toBe('versus:*');
  });

  it('classifies JSON frames (postgres_changes by table, broadcast by event, error replies)', () => {
    const pc = JSON.stringify([null, null, 'realtime:versus:0b5c1f0e-1111-4222-8333-944445555666', 'postgres_changes', { data: { table: 'versus_members', type: 'UPDATE' } }]);
    expect(classifyFrame(pc)).toEqual({ key: 'rt:versus:*:postgres_changes:versus_members:UPDATE', error: null });
    const err = JSON.stringify(['1', '2', 'realtime:x', 'phx_reply', { status: 'error', response: {} }]);
    expect(classifyFrame(err).error).toBe('reply_error');
  });

  it('decodes the binary user-broadcast header (topic + event)', () => {
    const topic = 'realtime:lobbylive:abc';
    const event = 'spectate';
    const enc = new TextEncoder();
    const head = [4, topic.length, event.length, 0, 1];
    const buf = new Uint8Array([...head, ...enc.encode(topic), ...enc.encode(event), ...enc.encode('{"a":1}')]).buffer;
    expect(classifyFrame(buf).key).toBe('rt:lobbylive:abc:broadcast:spectate');
  });
});
