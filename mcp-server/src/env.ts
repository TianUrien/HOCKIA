import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

export interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  AUTH_LIMITER: RateLimit;
  PUBLIC_URL: string;
  SUPABASE_URL: string;
  ENVIRONMENT: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_OAUTH_CLIENT_ID: string;
  SUPABASE_OAUTH_CLIENT_SECRET: string;
  CONSENT_SECRET: string;
}

/** What the grant carries, encrypted by the OAuth library. Never returned to the assistant. */
export interface Props {
  /** The member's Hockia user id (Supabase `sub`). */
  sub: string;
  supabaseAccessToken: string;
  supabaseRefreshToken: string;
  /** Seconds since the epoch. */
  supabaseExpiresAt: number;
}
