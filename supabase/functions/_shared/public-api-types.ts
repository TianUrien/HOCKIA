// NOTE: This file runs on Supabase Edge Functions (Deno runtime).
declare const Deno: { env: { get(key: string): string | undefined } }

/**
 * Public Opportunities API Types
 *
 * Shared type definitions for the public-opportunities Edge Function.
 * These types define the public API contract for AI agents and external consumers.
 */

// =============================================================================
// REQUEST TYPES
// =============================================================================

export interface PublicOpportunitiesQuery {
  /** Filter by position: goalkeeper, defender, midfielder, forward */
  position?: string
  /** Filter by gender: Men, Women */
  gender?: string
  /** Filter by country name */
  country?: string
  /** Filter by opportunity type: player, coach */
  opportunity_type?: string
  /** Filter by priority: high, medium, low */
  priority?: string
  /** Number of results to return (default: 20, max: 100) */
  limit?: number
  /** Offset for pagination (default: 0) */
  offset?: number
}

// =============================================================================
// RESPONSE TYPES
// =============================================================================

export interface PublicOpportunityClub {
  name: string
  logo_url: string | null
  location: string | null
  league: string | null
}

export interface PublicOpportunityLocation {
  city: string
  country: string
}

export interface PublicOpportunity {
  id: string
  title: string
  opportunity_type: string
  position: string | null
  gender: string | null
  description: string | null
  location: PublicOpportunityLocation
  start_date: string | null
  duration: string | null
  application_deadline: string | null
  priority: string | null
  requirements: string[]
  benefits: string[]
  eu_passport_required: boolean
  club: PublicOpportunityClub
  published_at: string | null
  created_at: string
  /** Direct link to apply on HOCKIA */
  apply_url: string
}

export interface PublicOpportunitiesResponse {
  data: PublicOpportunity[]
  meta: {
    total: number
    limit: number
    offset: number
    has_more: boolean
  }
}

export interface PublicOpportunityDetailResponse {
  data: PublicOpportunity
}

export interface PublicAPIError {
  error: {
    code: string
    message: string
    details?: string
  }
}

// =============================================================================
// DATABASE ROW TYPE (from public_opportunities view)
// =============================================================================

export interface PublicOpportunityRow {
  id: string
  title: string
  opportunity_type: string
  position: string | null
  gender: string | null
  description: string | null
  location_city: string
  location_country: string
  start_date: string | null
  duration_text: string | null
  application_deadline: string | null
  priority: string | null
  requirements: string[] | null
  benefits: string[] | null
  custom_benefits: string[] | null
  published_at: string | null
  created_at: string
  club_name: string | null
  club_logo_url: string | null
  club_location: string | null
  club_league: string | null
  eu_passport_required: boolean
}

// =============================================================================
// CONSTANTS
// =============================================================================

export const HOCKIA_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'

export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 100

export const VALID_POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward']
// Phase 3d — extended with Girls / Boys / Mixed. Old 'Men' / 'Women' values
// remain valid (backward-compatible). UI surfaces label them "Adult Men" /
// "Adult Women" while keeping the legacy enum on the wire.
export const VALID_GENDERS = ['Men', 'Women', 'Girls', 'Boys', 'Mixed']
export const VALID_OPPORTUNITY_TYPES = ['player', 'coach']
export const VALID_PRIORITIES = ['high', 'medium', 'low']

// =============================================================================
// RATE LIMITING
// =============================================================================

export const RATE_LIMIT = {
  /** Maximum requests per IP per minute */
  REQUESTS_PER_MINUTE: 60,
  /** Maximum requests per IP per hour */
  REQUESTS_PER_HOUR: 500,
  /** Cache TTL in seconds */
  CACHE_TTL_SECONDS: 300, // 5 minutes
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Transform a database row to the public API response format
 */
export function transformToPublicOpportunity(row: PublicOpportunityRow): PublicOpportunity {
  return {
    id: row.id,
    title: row.title,
    opportunity_type: row.opportunity_type,
    position: row.position,
    gender: row.gender,
    description: row.description,
    location: {
      city: row.location_city,
      country: row.location_country,
    },
    start_date: row.start_date,
    duration: row.duration_text,
    application_deadline: row.application_deadline,
    priority: row.priority,
    requirements: row.requirements || [],
    eu_passport_required: row.eu_passport_required || false,
    benefits: [
      ...(row.benefits || []),
      ...(row.custom_benefits || []),
    ],
    club: {
      name: row.club_name || 'Unknown Club',
      logo_url: row.club_logo_url,
      location: row.club_location,
      league: row.club_league,
    },
    published_at: row.published_at,
    created_at: row.created_at,
    apply_url: `${HOCKIA_BASE_URL}/opportunities/${row.id}`,
  }
}

/**
 * Validate and sanitize query parameters
 */
export function validateQueryParams(params: URLSearchParams): {
  valid: boolean
  query: PublicOpportunitiesQuery
  error?: string
} {
  const limit = Math.min(
    Math.max(1, parseInt(params.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
    MAX_LIMIT
  )
  const offset = Math.max(0, parseInt(params.get('offset') || '0', 10) || 0)

  const position = params.get('position') || undefined
  const gender = params.get('gender') || undefined
  const country = params.get('country') || undefined
  const opportunity_type = params.get('opportunity_type') || undefined
  const priority = params.get('priority') || undefined

  // Validate enum values
  if (position && !VALID_POSITIONS.includes(position)) {
    return {
      valid: false,
      query: {},
      error: `Invalid position. Must be one of: ${VALID_POSITIONS.join(', ')}`,
    }
  }

  if (gender && !VALID_GENDERS.includes(gender)) {
    return {
      valid: false,
      query: {},
      error: `Invalid gender. Must be one of: ${VALID_GENDERS.join(', ')}`,
    }
  }

  if (opportunity_type && !VALID_OPPORTUNITY_TYPES.includes(opportunity_type)) {
    return {
      valid: false,
      query: {},
      error: `Invalid opportunity_type. Must be one of: ${VALID_OPPORTUNITY_TYPES.join(', ')}`,
    }
  }

  if (priority && !VALID_PRIORITIES.includes(priority)) {
    return {
      valid: false,
      query: {},
      error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}`,
    }
  }

  return {
    valid: true,
    query: {
      position,
      gender,
      country,
      opportunity_type,
      priority,
      limit,
      offset,
    },
  }
}
