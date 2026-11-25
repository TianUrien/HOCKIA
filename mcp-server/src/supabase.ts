// Calls to Hockia's Supabase project: the OAuth sign-in (this Worker is the
// single registered client) and the mcp_* database functions, always with the
// member's own token so row-level security and auth.uid() apply.

import type { Env, Props } from './env';

export interface SupabaseTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export class SupabaseAuthError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

const base64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export function newVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function s256(verifier: string): Promise<string> {
  return base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

export function supabaseAuthorizeUrl(env: Env, state: string, codeChallenge: string): string {
  const url = new URL('/auth/v1/oauth/authorize', env.SUPABASE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', env.SUPABASE_OAUTH_CLIENT_ID);
  url.searchParams.set('redirect_uri', `${env.PUBLIC_URL}/callback`);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('scope', 'openid');
  return url.toString();
}

async function tokenRequest(env: Env, body: Record<string, string>): Promise<SupabaseTokens> {
  const res = await fetch(new URL('/auth/v1/oauth/token', env.SUPABASE_URL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      apikey: env.SUPABASE_ANON_KEY,
    },
    body: new URLSearchParams({
      ...body,
      client_id: env.SUPABASE_OAUTH_CLIENT_ID,
      client_secret: env.SUPABASE_OAUTH_CLIENT_SECRET,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<SupabaseTokens> & { error?: string };
  if (!res.ok || !json.access_token || !json.refresh_token) {
    throw new SupabaseAuthError(json.error ?? 'token_request_failed', res.status);
  }
  return json as SupabaseTokens;
}

export function exchangeCode(env: Env, code: string, verifier: string): Promise<SupabaseTokens> {
  return tokenRequest(env, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${env.PUBLIC_URL}/callback`,
    code_verifier: verifier,
  });
}

export function refreshTokens(env: Env, refreshToken: string): Promise<SupabaseTokens> {
  return tokenRequest(env, { grant_type: 'refresh_token', refresh_token: refreshToken });
}

/** The `sub` claim of a token Supabase just issued to us over TLS (not used for any check). */
export function subjectOf(accessToken: string): string {
  const payload = accessToken.split('.')[1] ?? '';
  const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string };
  if (!json.sub) throw new SupabaseAuthError('no_subject', 500);
  return json.sub;
}

export function propsFrom(tokens: SupabaseTokens, now = Math.floor(Date.now() / 1000)): Props {
  return {
    sub: subjectOf(tokens.access_token),
    supabaseAccessToken: tokens.access_token,
    supabaseRefreshToken: tokens.refresh_token,
    supabaseExpiresAt: now + tokens.expires_in,
  };
}

/** Refusals raised by mcp_guard, and the two answers some tools return as data. */
export type HockiaRefusal =
  | 'not_authenticated'
  | 'connector_disabled'
  | 'account_unavailable'
  | 'rate_limited'
  | 'recruiters_only'
  | 'not_found'
  | 'session_expired'
  | 'unavailable';

export type RpcResult = { ok: true; data: unknown } | { ok: false; refusal: HockiaRefusal };

const KNOWN: ReadonlySet<string> = new Set([
  'not_authenticated',
  'connector_disabled',
  'account_unavailable',
  'rate_limited',
  'recruiters_only',
  'not_found',
]);

export async function callRpc(
  env: Env,
  props: Props,
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcResult> {
  const res = await fetch(new URL(`/rest/v1/rpc/${fn}`, env.SUPABASE_URL), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${props.supabaseAccessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (res.status === 401) return { ok: false, refusal: 'session_expired' };
  const json = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
  if (!res.ok) {
    const message = json?.message ?? '';
    return { ok: false, refusal: KNOWN.has(message) ? (message as HockiaRefusal) : 'unavailable' };
  }
  if (json && typeof json === 'object' && !Array.isArray(json) && typeof json.error === 'string' && KNOWN.has(json.error)) {
    return { ok: false, refusal: json.error as HockiaRefusal };
  }
  return { ok: true, data: json };
}
