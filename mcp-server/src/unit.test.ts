import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanText, sanitize } from './sanitize';
import { callRpc, newVerifier, propsFrom, s256, supabaseAuthorizeUrl } from './supabase';
import type { Env, Props } from './env';

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  PUBLIC_URL: 'https://mcp.example.com',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_OAUTH_CLIENT_ID: 'client-1',
  SUPABASE_OAUTH_CLIENT_SECRET: 'secret',
} as unknown as Env;

const props: Props = { sub: 'u1', supabaseAccessToken: 'at', supabaseRefreshToken: 'rt', supabaseExpiresAt: 0 };

describe('sanitize', () => {
  it('removes links, markup and invisible characters from member text', () => {
    const hostile = 'Great club​! <script>x</script>Visit https://evil.example/a?b=1 or www.evil.example now';
    expect(cleanText(hostile)).toBe('Great club! xVisit [link removed] or [link removed] now');
  });

  it('keeps a club website field and walks nested objects and arrays', () => {
    const out = sanitize({ website: 'https://club.example', items: [{ bio: 'see http://x.example' }] }) as {
      website: string;
      items: { bio: string }[];
    };
    expect(out.website).toBe('https://club.example');
    expect(out.items[0].bio).toBe('see [link removed]');
  });

  it('leaves no tag behind when tags are nested to survive one pass', () => {
    const out = cleanText('<scr<script>ipt>alert(1)</script> and 3 < 4 > 2');
    expect(out).not.toMatch(/[<>]/);
    expect(out).toBe('iptalert(1) and 3  4  2');
  });

  it('caps very long text', () => {
    expect(cleanText('a'.repeat(10000))).toHaveLength(4000);
  });

  it('leaves numbers, booleans and null alone', () => {
    expect(sanitize({ n: 3, b: true, z: null })).toEqual({ n: 3, b: true, z: null });
  });
});

describe('pkce and sign-in url', () => {
  it('produces an RFC 7636 S256 challenge', async () => {
    // Appendix B of RFC 7636.
    expect(await s256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(newVerifier()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('builds the Supabase authorize url for this Worker only', () => {
    const url = new URL(supabaseAuthorizeUrl(env, 'st', 'ch'));
    expect(url.pathname).toBe('/auth/v1/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('redirect_uri')).toBe('https://mcp.example.com/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('reads the member id from the issued token', () => {
    const payload = btoa(JSON.stringify({ sub: 'member-1' })).replace(/=+$/, '');
    const p = propsFrom({ access_token: `h.${payload}.s`, refresh_token: 'r', expires_in: 3600 }, 1000);
    expect(p).toEqual({ sub: 'member-1', supabaseAccessToken: `h.${payload}.s`, supabaseRefreshToken: 'r', supabaseExpiresAt: 4600 });
  });
});

describe('callRpc', () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

  it('calls the function with the member token, never a service key', async () => {
    const fetchMock = vi.fn(async (_url: URL, _init: RequestInit) => new Response('{"ok":1}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await callRpc(env, props, 'mcp_get_my_profile', {});
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://example.supabase.co/rest/v1/rpc/mcp_get_my_profile');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer at');
  });

  it('maps database refusals', async () => {
    respond(400, { code: 'P0001', message: 'rate_limited' });
    expect(await callRpc(env, props, 'f', {})).toEqual({ ok: false, refusal: 'rate_limited' });
    respond(200, { error: 'recruiters_only' });
    expect(await callRpc(env, props, 'f', {})).toEqual({ ok: false, refusal: 'recruiters_only' });
    respond(401, { message: 'JWT expired' });
    expect(await callRpc(env, props, 'f', {})).toEqual({ ok: false, refusal: 'session_expired' });
  });

  it('never passes an unknown database error through to the assistant', async () => {
    respond(500, { message: 'relation "x" does not exist' });
    expect(await callRpc(env, props, 'f', {})).toEqual({ ok: false, refusal: 'unavailable' });
  });
});
