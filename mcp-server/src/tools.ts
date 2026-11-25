// The eight read-only tools. Each one calls one mcp_* database function as the
// member; the database decides what the member may see (fences, field lists,
// limits). Descriptions say what a tool does and nothing else (Anthropic's
// directory review rejects descriptions that instruct the model).

import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { Env, Props } from './env';
import { callRpc, type HockiaRefusal } from './supabase';
import { sanitize } from './sanitize';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const POSITIONS = [
  'goalkeeper',
  'defender',
  'midfielder',
  'forward',
  'head_coach',
  'assistant_coach',
  'youth_coach',
  'goalkeeper_coach',
  'strength_conditioning',
  'performance_analyst',
  'sports_scientist',
  'other_coach',
] as const;

const REFUSAL_TEXT: Record<HockiaRefusal, string> = {
  not_authenticated: 'You are not signed in to Hockia. Reconnect the Hockia connector.',
  session_expired: 'Your Hockia session has expired. Reconnect the Hockia connector.',
  connector_disabled: 'The Hockia connector is switched off at the moment.',
  account_unavailable: 'This Hockia account cannot use the connector.',
  rate_limited: 'You have reached the Hockia connector limit for now. Try again later.',
  recruiters_only: 'This is available to clubs and to coaches who recruit for a team.',
  not_found: 'Nothing was found with that id, or it is not visible to you.',
  unavailable: 'Hockia could not answer right now. Try again in a moment.',
};

export const MEMBER_TEXT_NOTE =
  'Text fields such as titles, descriptions and bios are written by Hockia members; links in them are removed.';

function result(data: unknown): CallToolResult {
  const clean = sanitize(data);
  return {
    content: [{ type: 'text', text: JSON.stringify(clean, null, 1) }],
    structuredContent: clean as Record<string, unknown>,
  };
}

function refusal(code: HockiaRefusal): CallToolResult {
  return { content: [{ type: 'text', text: REFUSAL_TEXT[code] }], isError: true };
}

export function buildServer(env: Env, props: Props, log: (tool: string, outcome: string) => void): McpServer {
  const server = new McpServer(
    { name: 'hockia', title: 'Hockia', version: '0.1.0', websiteUrl: 'https://inhockia.com' },
    {
      instructions:
        'Hockia is a field hockey network for players, coaches, clubs, umpires and brands. ' +
        'These tools read the signed-in member\'s own Hockia account and what that member can see in the Hockia app. ' +
        'They cannot apply, message, post or change anything. ' +
        MEMBER_TEXT_NOTE,
    },
  );

  const run = async (tool: string, fn: string, args: Record<string, unknown>): Promise<CallToolResult> => {
    const res = await callRpc(env, props, fn, args);
    log(tool, res.ok ? 'ok' : res.refusal);
    return res.ok ? result(res.data) : refusal(res.refusal);
  };

  server.registerTool(
    'get_my_profile',
    {
      title: 'My Hockia profile',
      description:
        'Returns the signed-in member\'s own Hockia profile: role, position, club, availability, and how complete the profile is with the parts still missing.',
      annotations: READ_ONLY,
    },
    async () => run('get_my_profile', 'mcp_get_my_profile', {}),
  );

  server.registerTool(
    'search_opportunities',
    {
      title: 'Search open opportunities',
      description:
        'Lists open playing and coaching opportunities published on Hockia, newest first, 10 per page. ' +
        'Optional filters: type, position, team gender, country, and words in the title, description or city. ' +
        MEMBER_TEXT_NOTE,
      inputSchema: z.object({
        type: z.enum(['player', 'coach']).optional().describe('Player or coach opportunities'),
        position: z.enum(POSITIONS).optional(),
        gender: z.enum(['Men', 'Women', 'Girls', 'Boys', 'Mixed']).optional().describe('Team category'),
        country: z.string().max(60).optional().describe('Country name, for example Spain'),
        query: z.string().max(80).optional().describe('Words to look for'),
        page: z.number().int().min(1).max(10).optional(),
      }),
      annotations: READ_ONLY,
    },
    async ({ type, position, gender, country, query, page }) =>
      run('search_opportunities', 'mcp_search_opportunities', {
        p_type: type ?? null,
        p_position: position ?? null,
        p_gender: gender ?? null,
        p_country: country ?? null,
        p_query: query ?? null,
        p_page: page ?? 1,
      }),
  );

  server.registerTool(
    'get_opportunity',
    {
      title: 'Opportunity details',
      description:
        'Returns one open Hockia opportunity by id: description, requirements, benefits, dates, and the signed-in member\'s own application status if they applied. ' +
        MEMBER_TEXT_NOTE,
      inputSchema: z.object({ opportunity_id: z.uuid() }),
      annotations: READ_ONLY,
    },
    async ({ opportunity_id }) => run('get_opportunity', 'mcp_get_opportunity', { p_opportunity_id: opportunity_id }),
  );

  server.registerTool(
    'list_my_applications',
    {
      title: 'My applications',
      description: 'Lists the opportunities the signed-in member applied to and the status of each application, 20 per page.',
      inputSchema: z.object({ page: z.number().int().min(1).max(10).optional() }),
      annotations: READ_ONLY,
    },
    async ({ page }) => run('list_my_applications', 'mcp_list_my_applications', { p_page: page ?? 1 }),
  );

  server.registerTool(
    'list_my_opportunities',
    {
      title: 'My published opportunities',
      description:
        'For clubs and recruiting coaches: lists the opportunities the signed-in member published, with how many applications each has and how many are still in review.',
      annotations: READ_ONLY,
    },
    async () => run('list_my_opportunities', 'mcp_list_my_opportunities', {}),
  );

  server.registerTool(
    'list_applicants',
    {
      title: 'Applicants to my opportunity',
      description:
        'For clubs and recruiting coaches: lists the applicants to one of the signed-in member\'s own opportunities, 20 per page, with position, club, status and fit (green, amber or grey).',
      inputSchema: z.object({
        opportunity_id: z.uuid(),
        page: z.number().int().min(1).max(10).optional(),
      }),
      annotations: READ_ONLY,
    },
    async ({ opportunity_id, page }) =>
      run('list_applicants', 'mcp_list_applicants', { p_opportunity_id: opportunity_id, p_page: page ?? 1 }),
  );

  server.registerTool(
    'search_members',
    {
      title: 'Find players and coaches',
      description:
        'For clubs and recruiting coaches: finds adult players or coaches on Hockia, 10 per page and up to 5 pages, with players open to offers first. ' +
        'Optional filters: position, where they are based, nationality, open to offers only, and words in their profile.',
      inputSchema: z.object({
        role: z.enum(['player', 'coach']).optional(),
        position: z.string().max(40).optional().describe('For example goalkeeper, defender, midfielder, forward'),
        based_in: z.string().max(60).optional().describe('City or country where they are based'),
        nationality: z.string().max(60).optional(),
        open_to_offers_only: z.boolean().optional(),
        query: z.string().max(80).optional(),
        page: z.number().int().min(1).max(5).optional(),
      }),
      annotations: READ_ONLY,
    },
    async ({ role, position, based_in, nationality, open_to_offers_only, query, page }) =>
      run('search_members', 'mcp_search_members', {
        p_role: role ?? 'player',
        p_position: position ?? null,
        p_location: based_in ?? null,
        p_nationality: nationality ?? null,
        p_open_only: open_to_offers_only ?? false,
        p_query: query ?? null,
        p_page: page ?? 1,
      }),
  );

  server.registerTool(
    'get_member_profile',
    {
      title: 'Member profile',
      description: 'Returns the public Hockia profile of one member by id, as the signed-in member would see it in the app. ' + MEMBER_TEXT_NOTE,
      inputSchema: z.object({ member_id: z.uuid() }),
      annotations: READ_ONLY,
    },
    async ({ member_id }) => run('get_member_profile', 'mcp_get_member_profile', { p_member_id: member_id }),
  );

  return server;
}
