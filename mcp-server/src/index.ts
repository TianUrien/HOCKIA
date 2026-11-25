// Hockia assistant connector: a remote MCP server on Cloudflare Workers.
//
// This Worker is the OAuth authorization server the assistants (Claude, later
// ChatGPT) talk to. It issues its own tokens, bound to /mcp, and keeps the
// member's Hockia (Supabase) session inside the encrypted grant: the assistant
// never holds a Hockia token. Members sign in on Hockia itself, through the
// Supabase OAuth 2.1 server, where this Worker is the single registered client.
//
// Flow: assistant → GET /authorize (consent for that assistant) → POST /authorize
// → Supabase /oauth/authorize → Hockia sign-in and consent page → GET /callback
// → code exchange → back to the assistant with a code for this Worker's token.

import OAuthProvider, {
  AuthorizationError,
  CimdFetchError,
  OAuthError,
  authorizationErrorRedirect,
  type OAuthResourceContext,
} from '@cloudflare/workers-oauth-provider';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { Env, Props } from './env';
import { consentPage, errorPage, homePage } from './pages';
import {
  SupabaseAuthError,
  exchangeCode,
  newVerifier,
  propsFrom,
  refreshTokens,
  s256,
  supabaseAuthorizeUrl,
} from './supabase';
import { buildServer } from './tools';

/**
 * Public origin of this Worker. The OAuth library needs it when the module
 * loads (it is the token audience and the issuer), so it is a constant, not a
 * var: change it here and in wrangler.jsonc PUBLIC_URL together.
 */
const ORIGIN = 'https://hockia-mcp-staging.inhockia.workers.dev';

/** Leave this much of the Hockia session unused, so our token always expires first. */
const SAFETY_SECONDS = 120;

const ttlFor = (props: Props) => Math.max(60, props.supabaseExpiresAt - Math.floor(Date.now() / 1000) - SAFETY_SECONDS);

async function limited(request: Request, env: Env): Promise<boolean> {
  const key = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const { success } = await env.AUTH_LIMITER.limit({ key });
  return !success;
}

const tooMany = () => new Response('Too many requests. Try again in a minute.', { status: 429, headers: { 'Retry-After': '60' } });

async function authorize(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (request.method === 'GET') {
      const authRequest = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(authRequest);
      const consent = await oauth.beginConsent(authRequest);
      consent.headers.set('Content-Type', 'text/html; charset=utf-8');
      return new Response(consentPage(details, consent.handle), { headers: consent.headers });
    }
    if (request.method === 'POST') {
      const form = await request.formData();
      const handle = String(form.get('handle') ?? '');
      if (form.get('decision') !== 'approve') {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approved = await oauth.approveConsent(request, handle);
      const verifier = newVerifier();
      const { state, headers } = await oauth.beginUpstream(approved.request, {
        data: { verifier },
        headers: approved.headers,
      });
      headers.set('Location', supabaseAuthorizeUrl(env, state, await s256(verifier)));
      return new Response(null, { status: 302, headers });
    }
    return new Response('Method not allowed', { status: 405 });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError) return errorPage(error.description ?? 'This request could not be accepted.');
    if (error instanceof CimdFetchError) return errorPage('This assistant could not be verified.');
    throw error;
  }
}

async function callback(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  let finished;
  try {
    finished = await oauth.finishUpstream<{ verifier: string }>(request);
  } catch (error) {
    if (error instanceof AuthorizationError) return errorPage('This sign-in link has expired or was opened in another browser.');
    throw error;
  }
  const { request: original, data, headers } = finished;
  const params = new URL(request.url).searchParams;
  const code = params.get('code');
  if (params.get('error') || !code) {
    headers.set('Location', authorizationErrorRedirect(original, 'access_denied'));
    return new Response(null, { status: 302, headers });
  }
  let props: Props;
  try {
    props = propsFrom(await exchangeCode(env, code, data.verifier));
  } catch (error) {
    console.warn('connector.signin', error instanceof SupabaseAuthError ? error.code : 'exchange_failed');
    headers.set('Location', authorizationErrorRedirect(original, 'server_error'));
    return new Response(null, { status: 302, headers });
  }
  const { redirectTo } = await oauth.completeAuthorization({
    request: original,
    userId: props.sub,
    metadata: {},
    scope: original.scope,
    props,
  });
  headers.set('Location', redirectTo);
  return new Response(null, { status: 302, headers });
}

const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/authorize' || pathname === '/callback') {
      if (await limited(request, env)) return tooMany();
      return pathname === '/authorize' ? authorize(request, env) : callback(request, env);
    }
    if (pathname === '/' && request.method === 'GET') return homePage();
    return new Response('Not found', { status: 404 });
  },
};

const mcpHandler = {
  async fetch(request: Request, env: Env, execution: ExecutionContext): Promise<Response> {
    // OAuthProvider sets props and auth on the context for apiHandler (see the library's resource-servers.md).
    const ctx = execution as unknown as OAuthResourceContext<Props>;
    const props = ctx.props;
    const started = Date.now();
    const log = (tool: string, outcome: string) =>
      console.log(JSON.stringify({ event: 'connector.tool', tool, outcome, ms: Date.now() - started, client: ctx.auth.clientId ?? null }));
    const handler = createMcpHandler(() => buildServer(env, props, log), { responseMode: 'json' });
    return handler.fetch(request);
  },
};

const provider = new OAuthProvider<Env>({
  apiRoute: '/mcp',
  apiHandler: mcpHandler,
  defaultHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/oauth/token',
  clientRegistrationEndpoint: '/oauth/register',
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: ['hockia:read'],
  resourceMetadata: {
    resource: `${ORIGIN}/mcp`,
    authorization_servers: [ORIGIN],
    bearer_methods_supported: ['header'],
    resource_name: 'Hockia',
  },
  requiredScopes: ['hockia:read'],
  accessTokenTTL: 3000,
  refreshTokenTTL: 30 * 24 * 3600,
  tokenExchangeCallback: async ({ grantType, props, env }) => {
    const current = props as Props;
    if (grantType === 'authorization_code') return { accessTokenTTL: ttlFor(current) };
    if (grantType !== 'refresh_token') return;
    try {
      const next = propsFrom(await refreshTokens(env as Env, current.supabaseRefreshToken));
      if (next.sub !== current.sub) throw new OAuthError('invalid_grant', { description: 'Account changed' });
      return { newProps: next, accessTokenTTL: ttlFor(next) };
    } catch (error) {
      if (error instanceof OAuthError) throw error;
      if (error instanceof SupabaseAuthError && (error.code === 'invalid_grant' || error.status === 400 || error.status === 401)) {
        // The member disconnected Hockia, signed out everywhere, or the session ended.
        throw new OAuthError('invalid_grant', { description: 'Hockia access ended. Connect again.' });
      }
      throw new OAuthError('temporarily_unavailable', { description: 'Hockia is unavailable', statusCode: 503 });
    }
  },
});

// Dynamic client registration and the token endpoint are served by the
// library before any handler runs, so the per-address limit wraps it here.
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if ((pathname === '/oauth/register' || pathname === '/oauth/token') && (await limited(request, env))) return tooMany();
    return provider.fetch(request, env, ctx);
  },
};
