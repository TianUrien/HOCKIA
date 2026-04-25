/**
 * Admin API Module
 * 
 * Functions for calling admin RPC endpoints and Edge Functions.
 * All functions require the caller to be an admin.
 * 
 * NOTE: Type assertions through `unknown` are used because the admin RPC functions
 * are not yet in the generated Supabase types. After running the migration and
 * regenerating types with `supabase gen types typescript`, these can be simplified.
 */

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { normalizeEmailCampaign } from '../utils/campaigns'
import type {
  DashboardStats,
  SignupTrend,
  TopCountry,
  AuthOrphan,
  ProfileOrphan,
  BrokenReferences,
  AdminProfileListItem,
  AdminProfileDetails,
  AuditLogEntry,
  ProfileSearchParams,
  AuditLogSearchParams,
  EngagementSummary,
  UserEngagementItem,
  EngagementTrend,
  UserEngagementDetail,
  UserEngagementSearchParams,
  MessagingMetrics,
  FriendshipMetrics,
  ReferenceMetrics,
  FeatureUsageMetrics,
  DiscoveryAnalyticsData,
  CommandCenterStats,
  RetentionCohort,
  ActivationFunnelData,
  UserGrowthPoint,
  MonthlyReportData,
  DevicePlatformFilter,
  DeviceUsersResult,
} from '../types'

// Helper to call RPC functions that aren't in generated types yet
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminRpc = supabase.rpc.bind(supabase) as unknown as (fn: string, params?: Record<string, unknown>) => Promise<{ data: any; error: any }>

/**
 * Check if the current user is a platform admin
 */
export async function checkIsAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_platform_admin')
  if (error) {
    logger.error('[ADMIN_API] Failed to check admin status:', error)
    return false
  }
  return data === true
}

/**
 * Get dashboard statistics
 */
export async function getDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await adminRpc('admin_get_dashboard_stats')
  if (error) throw new Error(`Failed to get dashboard stats: ${error.message}`)
  return data as DashboardStats
}

/**
 * List users for a given device platform (or all if null).
 * Supports search, pagination, and multi-platform filtering.
 */
export async function getDeviceUsers(params: {
  platform: DevicePlatformFilter
  search?: string
  limit?: number
  offset?: number
}): Promise<DeviceUsersResult> {
  const { data, error } = await adminRpc('admin_get_device_users', {
    p_platform: params.platform,
    p_search: params.search ?? null,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  })
  if (error) throw new Error(`Failed to get device users: ${error.message}`)
  return data as DeviceUsersResult
}

/**
 * Get signup trends for charts
 */
export async function getSignupTrends(days: number = 30): Promise<SignupTrend[]> {
  const { data, error } = await adminRpc('admin_get_signup_trends', {
    p_days: days,
  })
  if (error) throw new Error(`Failed to get signup trends: ${error.message}`)
  return data as SignupTrend[]
}

/**
 * Get top countries by user count
 */
export async function getTopCountries(limit: number = 10): Promise<TopCountry[]> {
  const { data, error } = await adminRpc('admin_get_top_countries', {
    p_limit: limit,
  })
  if (error) throw new Error(`Failed to get top countries: ${error.message}`)
  return data as TopCountry[]
}

/**
 * Get auth users without profiles (orphans)
 */
export async function getAuthOrphans(): Promise<AuthOrphan[]> {
  const { data, error } = await adminRpc('admin_get_auth_orphans')
  if (error) throw new Error(`Failed to get auth orphans: ${error.message}`)
  return data as AuthOrphan[]
}

/**
 * Get profiles without auth users (orphans)
 */
export async function getProfileOrphans(): Promise<ProfileOrphan[]> {
  const { data, error } = await adminRpc('admin_get_profile_orphans')
  if (error) throw new Error(`Failed to get profile orphans: ${error.message}`)
  return data as ProfileOrphan[]
}

/**
 * Get broken references in the database
 */
export async function getBrokenReferences(): Promise<BrokenReferences> {
  const { data, error } = await adminRpc('admin_get_broken_references')
  if (error) throw new Error(`Failed to get broken references: ${error.message}`)
  return data as BrokenReferences
}

/**
 * Search profiles with filters
 */
export async function searchProfiles(params: ProfileSearchParams): Promise<{
  profiles: AdminProfileListItem[]
  totalCount: number
}> {
  const { data, error } = await adminRpc('admin_search_profiles', {
    p_query: params.query || null,
    p_role: params.role || null,
    p_is_blocked: params.is_blocked ?? null,
    p_is_test_account: params.is_test_account ?? null,
    p_onboarding_completed: params.onboarding_completed ?? null,
    p_limit: params.limit || 50,
    p_offset: params.offset || 0,
  })
  if (error) throw new Error(`Failed to search profiles: ${error.message}`)
  
  const profiles = data as AdminProfileListItem[]
  const totalCount = profiles.length > 0 ? profiles[0].total_count : 0
  
  return { profiles, totalCount }
}

/**
 * Get full profile details for admin view
 */
export async function getProfileDetails(profileId: string): Promise<AdminProfileDetails> {
  const { data, error } = await adminRpc('admin_get_profile_details', {
    p_profile_id: profileId,
  })
  if (error) throw new Error(`Failed to get profile details: ${error.message}`)
  return data as AdminProfileDetails
}

/**
 * Block a user
 */
export async function blockUser(profileId: string, reason?: string): Promise<void> {
  const { error } = await adminRpc('admin_block_user', {
    p_profile_id: profileId,
    p_reason: reason || null,
  })
  if (error) throw new Error(`Failed to block user: ${error.message}`)
}

/**
 * Unblock a user
 */
export async function unblockUser(profileId: string): Promise<void> {
  const { error } = await adminRpc('admin_unblock_user', {
    p_profile_id: profileId,
  })
  if (error) throw new Error(`Failed to unblock user: ${error.message}`)
}

/**
 * Update profile fields
 */
export async function updateProfile(
  profileId: string,
  updates: Record<string, unknown>,
  reason?: string
): Promise<void> {
  const { error } = await adminRpc('admin_update_profile', {
    p_profile_id: profileId,
    p_updates: updates,
    p_reason: reason || null,
  })
  if (error) throw new Error(`Failed to update profile: ${error.message}`)
}

/**
 * Set test account status
 */
export async function setTestAccount(profileId: string, isTest: boolean): Promise<void> {
  const { error } = await adminRpc('admin_set_test_account', {
    p_profile_id: profileId,
    p_is_test: isTest,
  })
  if (error) throw new Error(`Failed to set test account status: ${error.message}`)
}

/**
 * Grant or revoke the profile's admin-granted verified badge.
 *
 * Optional `sourceUrl` (e.g., federation panel page the admin checked) and
 * `notes` (free-text admin context) are recorded in admin_audit_logs.metadata
 * for provenance — so months later you can see WHY a profile was verified,
 * not just that it was.
 *
 * Audit-logged server-side via admin_log_action().
 */
export interface SetProfileVerifiedOptions {
  sourceUrl?: string | null
  notes?: string | null
}

export async function setProfileVerified(
  profileId: string,
  isVerified: boolean,
  options: SetProfileVerifiedOptions = {}
): Promise<void> {
  const { error } = await adminRpc('admin_set_profile_verified', {
    p_profile_id: profileId,
    p_value: isVerified,
    p_source_url: options.sourceUrl?.trim() || null,
    p_notes: options.notes?.trim() || null,
  })
  if (error) throw new Error(`Failed to set verified status: ${error.message}`)
}

/**
 * Delete orphan profile (profile without auth user)
 */
export async function deleteOrphanProfile(profileId: string): Promise<void> {
  const { error } = await adminRpc('admin_delete_orphan_profile', {
    p_profile_id: profileId,
  })
  if (error) throw new Error(`Failed to delete orphan profile: ${error.message}`)
}

/**
 * Get audit logs with pagination
 */
export async function getAuditLogs(params: AuditLogSearchParams): Promise<{
  logs: AuditLogEntry[]
  totalCount: number
}> {
  const { data, error } = await adminRpc('admin_get_audit_logs', {
    p_action: params.action || null,
    p_target_type: params.target_type || null,
    p_admin_id: params.admin_id || null,
    p_limit: params.limit || 50,
    p_offset: params.offset || 0,
  })
  if (error) throw new Error(`Failed to get audit logs: ${error.message}`)
  
  const logs = data as AuditLogEntry[]
  const totalCount = logs.length > 0 ? logs[0].total_count : 0
  
  return { logs, totalCount }
}

/**
 * Delete auth user (requires Edge Function with service role)
 */
export async function deleteAuthUser(userId: string, reason?: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('No active session')

  const response = await fetch(`${SUPABASE_URL}/functions/v1/admin-actions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      action: 'delete_auth_user',
      target_id: userId,
      params: { reason },
    }),
  })

  const result = await response.json()
  if (!result.success) {
    throw new Error(result.error || 'Failed to delete auth user')
  }
}

/**
 * Set admin status for a user (requires Edge Function with service role)
 */
export async function setAdminStatus(userId: string, isAdmin: boolean, reason?: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('No active session')

  const response = await fetch(`${SUPABASE_URL}/functions/v1/admin-actions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      action: 'set_admin_status',
      target_id: userId,
      params: { is_admin: isAdmin, reason },
    }),
  })

  const result = await response.json()
  if (!result.success) {
    throw new Error(result.error || 'Failed to set admin status')
  }
}

// ============================================================================
// VACANCY ANALYTICS
// ============================================================================

import type {
  VacancyListItem,
  VacancyApplicant,
  VacancyDetail,
  ClubActivity,
  ClubSummary,
  BrandActivity,
  BrandSummary,
  PlayerFunnel,
  ProfileCompletenessDistribution,
  ExtendedDashboardStats,
  VacancySearchParams,
} from '../types'

/**
 * Get paginated vacancy list with application statistics
 */
export async function getVacancies(params: VacancySearchParams = {}): Promise<{
  vacancies: VacancyListItem[]
  totalCount: number
}> {
  const { data, error } = await adminRpc('admin_get_opportunities', {
    p_status: params.status || null,
    p_club_id: params.club_id || null,
    p_days: params.days || null,
    p_limit: params.limit || 50,
    p_offset: params.offset || 0,
  })
  if (error) throw new Error(`Failed to get opportunities: ${error.message}`)
  
  const vacancies = data as VacancyListItem[]
  const totalCount = vacancies.length > 0 ? vacancies[0].total_count : 0
  
  return { vacancies, totalCount }
}

/**
 * Get applicants for a specific vacancy
 */
export async function getVacancyApplicants(
  vacancyId: string,
  status?: string,
  limit = 100,
  offset = 0
): Promise<{
  applicants: VacancyApplicant[]
  totalCount: number
}> {
  const { data, error } = await adminRpc('admin_get_opportunity_applicants', {
    p_opportunity_id: vacancyId,
    p_status: status || null,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw new Error(`Failed to get opportunity applicants: ${error.message}`)
  
  const applicants = data as VacancyApplicant[]
  const totalCount = applicants.length > 0 ? applicants[0].total_count : 0
  
  return { applicants, totalCount }
}

/**
 * Get full vacancy details with club info and application stats
 */
export async function getVacancyDetail(vacancyId: string): Promise<VacancyDetail> {
  const { data, error } = await adminRpc('admin_get_opportunity_detail', {
    p_opportunity_id: vacancyId,
  })
  if (error) throw new Error(`Failed to get opportunity detail: ${error.message}`)
  return data as VacancyDetail
}

// ============================================================================
// CLUB ANALYTICS
// ============================================================================

/**
 * Get club posting activity with vacancy and application stats
 */
export async function getClubActivity(
  days = 30,
  limit = 20,
  offset = 0
): Promise<{
  clubs: ClubActivity[]
  totalCount: number
}> {
  const { data, error } = await adminRpc('admin_get_club_activity', {
    p_days: days,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw new Error(`Failed to get club activity: ${error.message}`)
  
  const clubs = data as ClubActivity[]
  const totalCount = clubs.length > 0 ? clubs[0].total_count : 0
  
  return { clubs, totalCount }
}

/**
 * Get club summary statistics
 */
export async function getClubSummary(): Promise<ClubSummary> {
  const { data, error } = await adminRpc('admin_get_club_summary')
  if (error) throw new Error(`Failed to get club summary: ${error.message}`)
  return data as ClubSummary
}

// ============================================================================
// BRAND ANALYTICS
// ============================================================================

/**
 * Get brand activity with product/post counts, paginated
 */
export async function getBrandActivity(
  days = 30,
  limit = 20,
  offset = 0
): Promise<{
  brands: BrandActivity[]
  totalCount: number
}> {
  const { data, error } = await adminRpc('admin_get_brand_activity', {
    p_days: days,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw new Error(`Failed to get brand activity: ${error.message}`)

  const brands = data as BrandActivity[]
  const totalCount = brands.length > 0 ? brands[0].total_count : 0

  return { brands, totalCount }
}

/**
 * Get brand summary statistics
 */
export async function getBrandSummary(): Promise<BrandSummary> {
  const { data, error } = await adminRpc('admin_get_brand_summary')
  if (error) throw new Error(`Failed to get brand summary: ${error.message}`)
  return data as BrandSummary
}

// ============================================================================
// PLAYER ANALYTICS
// ============================================================================

/**
 * Get player journey funnel metrics
 */
export async function getPlayerFunnel(days?: number): Promise<PlayerFunnel> {
  const { data, error } = await adminRpc('admin_get_player_funnel', {
    p_days: days || null,
  })
  if (error) throw new Error(`Failed to get player funnel: ${error.message}`)
  return data as PlayerFunnel
}

/**
 * Get profile completeness distribution by role
 */
export async function getProfileCompletenessDistribution(
  role = 'player'
): Promise<ProfileCompletenessDistribution[]> {
  const { data, error } = await adminRpc('admin_get_profile_completeness_distribution', {
    p_role: role,
  })
  if (error) throw new Error(`Failed to get profile completeness: ${error.message}`)
  return data as ProfileCompletenessDistribution[]
}

// ============================================================================
// EXTENDED DASHBOARD
// ============================================================================

/**
 * Get extended dashboard statistics with vacancy and player insights
 */
export async function getExtendedDashboardStats(): Promise<ExtendedDashboardStats> {
  const { data, error } = await adminRpc('admin_get_extended_dashboard_stats')
  if (error) throw new Error(`Failed to get extended stats: ${error.message}`)
  return data as ExtendedDashboardStats
}

// ============================================================================
// ENGAGEMENT TRACKING
// ============================================================================

/**
 * Get engagement summary statistics
 */
export async function getEngagementSummary(): Promise<EngagementSummary> {
  const { data, error } = await adminRpc('admin_get_engagement_summary')
  if (error) throw new Error(`Failed to get engagement summary: ${error.message}`)
  return data as EngagementSummary
}

/**
 * Get per-user engagement metrics
 */
export async function getUserEngagement(
  params: UserEngagementSearchParams = {}
): Promise<{ users: UserEngagementItem[]; totalCount: number }> {
  const { data, error } = await adminRpc('admin_get_user_engagement', {
    p_limit: params.limit || 50,
    p_offset: params.offset || 0,
    p_sort_by: params.sort_by || 'total_time',
    p_sort_dir: params.sort_dir || 'desc',
    p_days: params.days || 30,
  })
  if (error) throw new Error(`Failed to get user engagement: ${error.message}`)
  
  const users = data as UserEngagementItem[]
  const totalCount = users.length > 0 ? users[0].total_count : 0
  
  return { users, totalCount }
}

/**
 * Get engagement trends over time (for charts)
 */
export async function getEngagementTrends(days = 30): Promise<EngagementTrend[]> {
  const { data, error } = await adminRpc('admin_get_engagement_trends', {
    p_days: days,
  })
  if (error) throw new Error(`Failed to get engagement trends: ${error.message}`)
  return data as EngagementTrend[]
}

/**
 * Get detailed engagement data for a specific user
 */
export async function getUserEngagementDetail(
  userId: string,
  days = 90
): Promise<UserEngagementDetail> {
  const { data, error } = await adminRpc('admin_get_user_engagement_detail', {
    p_user_id: userId,
    p_days: days,
  })
  if (error) throw new Error(`Failed to get user engagement detail: ${error.message}`)
  return data as UserEngagementDetail
}

// ============================================================================
// Hockey World API Functions
// ============================================================================

import type {
  WorldClub,
  WorldClubStats,
  WorldClubFilters,
  WorldCountry,
  WorldProvince,
  WorldLeague,
  WorldClubCreatePayload,
  WorldClubUpdatePayload,
  WorldLeagueAdmin,
  WorldLeagueFilters,
  WorldLeagueCreatePayload,
  WorldLeagueUpdatePayload,
  WorldProvinceAdmin,
  WorldProvinceFilters,
  WorldProvinceCreatePayload,
  WorldProvinceUpdatePayload,
  InvestorMetrics,
  InvestorSignupTrend,
  InvestorShareToken,
} from '../types'

/**
 * Get world clubs with filters and pagination
 */
export async function getWorldClubs(
  filters: WorldClubFilters = {},
  limit = 50,
  offset = 0
): Promise<{ clubs: WorldClub[]; totalCount: number }> {
  let query = supabase
    .from('world_clubs')
    .select(`
      *,
      country:countries!world_clubs_country_id_fkey(id, code, name),
      province:world_provinces!world_clubs_province_id_fkey(id, name),
      men_league:world_leagues!world_clubs_men_league_id_fkey(id, name),
      women_league:world_leagues!world_clubs_women_league_id_fkey(id, name),
      claimed_profile:profiles!world_clubs_claimed_profile_id_fkey(id, full_name)
    `, { count: 'exact' })

  // Apply filters
  if (filters.country_id) {
    query = query.eq('country_id', filters.country_id)
  }
  if (filters.province_id) {
    query = query.eq('province_id', filters.province_id)
  }
  if (filters.league_id) {
    query = query.or(`men_league_id.eq.${filters.league_id},women_league_id.eq.${filters.league_id}`)
  }
  if (filters.is_claimed !== undefined) {
    query = query.eq('is_claimed', filters.is_claimed)
  }
  if (filters.created_from) {
    query = query.eq('created_from', filters.created_from)
  }
  if (filters.search) {
    query = query.ilike('club_name', `%${filters.search}%`)
  }

  query = query.order('club_name').range(offset, offset + limit - 1)

  const { data, error, count } = await query

  if (error) throw new Error(`Failed to get world clubs: ${error.message}`)

  // Transform data to flatten nested objects
  const clubs: WorldClub[] = (data || []).map((row) => ({
    id: row.id,
    club_id: row.club_id,
    club_name: row.club_name,
    club_name_normalized: row.club_name_normalized,
    country_id: row.country_id,
    country_name: row.country?.name ?? undefined,
    country_code: row.country?.code ?? undefined,
    province_id: row.province_id,
    province_name: row.province?.name ?? null,
    men_league_id: row.men_league_id,
    men_league_name: row.men_league?.name ?? null,
    women_league_id: row.women_league_id,
    women_league_name: row.women_league?.name ?? null,
    avatar_url: row.avatar_url ?? null,
    is_claimed: row.is_claimed,
    claimed_profile_id: row.claimed_profile_id,
    claimed_profile_name: row.claimed_profile?.full_name ?? null,
    claimed_at: row.claimed_at,
    created_from: row.created_from as WorldClub['created_from'],
    created_at: row.created_at,
    updated_at: row.updated_at,
  }))

  return { clubs, totalCount: count ?? 0 }
}

/**
 * Get world club statistics
 */
export async function getWorldClubStats(): Promise<WorldClubStats> {
  const { count: total, error: totalError } = await supabase
    .from('world_clubs')
    .select('*', { count: 'exact', head: true })

  if (totalError) throw new Error(`Failed to get world club stats: ${totalError.message}`)

  const { count: claimed, error: claimedError } = await supabase
    .from('world_clubs')
    .select('*', { count: 'exact', head: true })
    .eq('is_claimed', true)

  if (claimedError) throw new Error(`Failed to get claimed count: ${claimedError.message}`)

  return {
    total_clubs: total ?? 0,
    claimed_clubs: claimed ?? 0,
    unclaimed_clubs: (total ?? 0) - (claimed ?? 0),
  }
}

/**
 * Get countries that have world directory support
 */
export async function getWorldCountries(): Promise<WorldCountry[]> {
  const { data, error } = await supabase
    .from('world_countries_with_directory')
    .select('country_id, country_code, country_name, flag_emoji')
    .order('country_name')

  if (error) throw new Error(`Failed to get world countries: ${error.message}`)

  return (data || [])
    .filter((row): row is typeof row & { country_id: number; country_code: string; country_name: string } =>
      row.country_id != null && row.country_code != null && row.country_name != null
    )
    .map((row) => ({
      id: row.country_id,
      code: row.country_code,
      name: row.country_name,
      flag_emoji: row.flag_emoji,
    }))
}

/**
 * Get provinces/regions for a country
 */
export async function getWorldProvinces(countryId: number): Promise<WorldProvince[]> {
  const { data, error } = await supabase
    .from('world_provinces')
    .select('id, country_id, name, slug')
    .eq('country_id', countryId)
    .order('display_order')

  if (error) throw new Error(`Failed to get world provinces: ${error.message}`)
  return data || []
}

/**
 * Get leagues for a location (country + optional region)
 */
export async function getWorldLeagues(
  countryId: number,
  provinceId?: number | null
): Promise<WorldLeague[]> {
  let query = supabase
    .from('world_leagues')
    .select('id, name, tier, province_id, country_id')

  if (provinceId) {
    // Get leagues for specific province
    query = query.eq('province_id', provinceId)
  } else {
    // Get leagues directly under country (no province)
    query = query.eq('country_id', countryId).is('province_id', null)
  }

  const { data, error } = await query.order('tier').order('name')

  if (error) throw new Error(`Failed to get world leagues: ${error.message}`)
  return data || []
}

/**
 * Create a new world club (admin only)
 */
export async function createWorldClub(payload: WorldClubCreatePayload): Promise<WorldClub> {
  const normalized = payload.club_name.toLowerCase().trim()
  const clubId = `${normalized.replace(/\s+/g, '_')}_${payload.country_id}_${Date.now()}`

  const { data, error } = await supabase
    .from('world_clubs')
    .insert({
      club_id: clubId,
      club_name: payload.club_name.trim(),
      club_name_normalized: normalized,
      country_id: payload.country_id,
      province_id: payload.province_id ?? null,
      men_league_id: payload.men_league_id ?? null,
      women_league_id: payload.women_league_id ?? null,
      is_claimed: false,
      created_from: 'admin',
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create world club: ${error.message}`)
  
  // Refetch with joins to get full data
  const { clubs } = await getWorldClubs({ search: payload.club_name }, 1, 0)
  return clubs[0] || data
}

/**
 * Update a world club (admin only)
 */
export async function updateWorldClub(
  clubId: string,
  payload: WorldClubUpdatePayload
): Promise<void> {
  const updates: Record<string, unknown> = {}

  if (payload.club_name !== undefined) {
    updates.club_name = payload.club_name.trim()
    updates.club_name_normalized = payload.club_name.toLowerCase().trim()
  }
  if (payload.country_id !== undefined) {
    updates.country_id = payload.country_id
  }
  if (payload.province_id !== undefined) {
    updates.province_id = payload.province_id
  }
  if (payload.men_league_id !== undefined) {
    updates.men_league_id = payload.men_league_id
  }
  if (payload.women_league_id !== undefined) {
    updates.women_league_id = payload.women_league_id
  }
  if (payload.avatar_url !== undefined) {
    updates.avatar_url = payload.avatar_url
  }
  if (payload.is_claimed !== undefined) {
    updates.is_claimed = payload.is_claimed
    if (!payload.is_claimed) {
      // Unclaiming - also clear profile link
      updates.claimed_profile_id = null
      updates.claimed_at = null
    }
  }
  if (payload.claimed_profile_id !== undefined) {
    updates.claimed_profile_id = payload.claimed_profile_id
    if (payload.claimed_profile_id === null) {
      updates.claimed_at = null
    }
  }

  const { error } = await supabase
    .from('world_clubs')
    .update(updates)
    .eq('id', clubId)

  if (error) throw new Error(`Failed to update world club: ${error.message}`)
}

/**
 * Unclaim a world club (admin safety valve)
 */
export async function unclaimWorldClub(clubId: string): Promise<void> {
  const { error } = await supabase
    .from('world_clubs')
    .update({
      is_claimed: false,
      claimed_profile_id: null,
      claimed_at: null,
    })
    .eq('id', clubId)

  if (error) throw new Error(`Failed to unclaim world club: ${error.message}`)
}

/**
 * Delete a world club (admin only)
 */
export async function deleteWorldClub(clubId: string): Promise<void> {
  const { error } = await supabase
    .from('world_clubs')
    .delete()
    .eq('id', clubId)

  if (error) throw new Error(`Failed to delete world club: ${error.message}`)
}

/**
 * Force claim a world club to a specific profile (admin only)
 */
export async function forceClaimWorldClub(
  clubId: string,
  profileId: string
): Promise<void> {
  // Validate that the profile exists and is a club
  const { data: targetProfile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', profileId)
    .single()

  if (profileError || !targetProfile) {
    throw new Error('Profile not found. Please check the profile ID.')
  }
  if (targetProfile.role !== 'club') {
    throw new Error(`Profile has role "${targetProfile.role}" — only club profiles can claim world clubs.`)
  }

  const { error } = await supabase
    .from('world_clubs')
    .update({
      is_claimed: true,
      claimed_profile_id: profileId,
      claimed_at: new Date().toISOString(),
    })
    .eq('id', clubId)

  if (error) throw new Error(`Failed to force claim club: ${error.message}`)
}

// ============================================================================
// Hockey World — All Countries (full list, not directory-only)
// ============================================================================

/**
 * Get ALL countries (not just those with leagues).
 * Used in admin modals for creating leagues/regions in new countries.
 */
export async function getAllCountries(): Promise<WorldCountry[]> {
  const { data, error } = await supabase
    .from('countries')
    .select('id, code, name, flag_emoji')
    .order('name')

  if (error) throw new Error(`Failed to get all countries: ${error.message}`)

  return (data || []).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    flag_emoji: row.flag_emoji,
  }))
}

// ============================================================================
// Hockey World — Leagues CRUD
// ============================================================================

function generateSlug(name: string): string {
  return name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

/**
 * Get leagues with filters, pagination, and joined country/province names
 */
export async function getWorldLeaguesAdmin(
  filters: WorldLeagueFilters = {},
  limit = 50,
  offset = 0
): Promise<{ leagues: WorldLeagueAdmin[]; totalCount: number }> {
  let query = supabase
    .from('world_leagues')
    .select(`
      *,
      country:countries(id, code, name, flag_emoji),
      province:world_provinces(id, name, country_id)
    `, { count: 'exact' })

  if (filters.province_id) {
    query = query.eq('province_id', filters.province_id)
  } else if (filters.country_id) {
    // Leagues can be directly under a country (province_id IS NULL) or under a province
    // belonging to that country. We need to find province IDs for this country first.
    const provinces = await getWorldProvinces(filters.country_id)
    const provinceIds = provinces.map(p => p.id)
    if (provinceIds.length > 0) {
      query = query.or(
        `country_id.eq.${filters.country_id},province_id.in.(${provinceIds.join(',')})`
      )
    } else {
      query = query.eq('country_id', filters.country_id)
    }
  }
  if (filters.search) {
    query = query.ilike('name', `%${filters.search}%`)
  }

  query = query.order('name').range(offset, offset + limit - 1)

  const { data, error, count } = await query

  if (error) throw new Error(`Failed to get world leagues: ${error.message}`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leagues: WorldLeagueAdmin[] = (data || []).map((row: any) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    tier: row.tier,
    logical_id: row.logical_id,
    display_order: row.display_order,
    province_id: row.province_id,
    province_name: row.province?.name ?? null,
    country_id: row.country_id ?? row.province?.country_id ?? null,
    country_name: row.country?.name ?? undefined,
    country_code: row.country?.code ?? undefined,
    country_flag_emoji: row.country?.flag_emoji ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }))

  return { leagues, totalCount: count ?? 0 }
}

/**
 * Create a new league (admin only)
 */
export async function createWorldLeague(
  payload: WorldLeagueCreatePayload
): Promise<void> {
  const { error } = await supabase
    .from('world_leagues')
    .insert({
      name: payload.name.trim(),
      slug: generateSlug(payload.name),
      tier: payload.tier ?? null,
      country_id: payload.province_id ? null : payload.country_id,
      province_id: payload.province_id ?? null,
      display_order: payload.display_order ?? 0,
    })

  if (error) {
    if (error.message.includes('duplicate key') || error.message.includes('unique')) {
      throw new Error('A league with this name already exists in this location')
    }
    throw new Error(`Failed to create league: ${error.message}`)
  }
}

/**
 * Update a league (admin only)
 */
export async function updateWorldLeague(
  leagueId: number,
  payload: WorldLeagueUpdatePayload
): Promise<void> {
  const updates: Record<string, unknown> = {}

  if (payload.name !== undefined) {
    updates.name = payload.name.trim()
    updates.slug = generateSlug(payload.name)
  }
  if (payload.tier !== undefined) updates.tier = payload.tier
  if (payload.province_id !== undefined) {
    updates.province_id = payload.province_id
    // If province is set, clear country_id (league gets country via province)
    if (payload.province_id) {
      updates.country_id = null
    } else if (payload.country_id !== undefined) {
      updates.country_id = payload.country_id
    }
  } else if (payload.country_id !== undefined) {
    updates.country_id = payload.country_id
  }
  if (payload.display_order !== undefined) updates.display_order = payload.display_order

  const { error } = await supabase
    .from('world_leagues')
    .update(updates)
    .eq('id', leagueId)

  if (error) {
    if (error.message.includes('duplicate key') || error.message.includes('unique')) {
      throw new Error('A league with this name already exists in this location')
    }
    throw new Error(`Failed to update league: ${error.message}`)
  }
}

/**
 * Delete a league (admin only)
 * Note: FK ON DELETE SET NULL means clubs referencing this league will have their league set to null
 */
export async function deleteWorldLeague(leagueId: number): Promise<void> {
  const { error } = await supabase
    .from('world_leagues')
    .delete()
    .eq('id', leagueId)

  if (error) throw new Error(`Failed to delete league: ${error.message}`)
}

// ============================================================================
// Hockey World — Regions/Provinces CRUD
// ============================================================================

/**
 * Get provinces with filters, pagination, and joined country names
 */
export async function getWorldProvincesAdmin(
  filters: WorldProvinceFilters = {},
  limit = 50,
  offset = 0
): Promise<{ provinces: WorldProvinceAdmin[]; totalCount: number }> {
  let query = supabase
    .from('world_provinces')
    .select(`
      *,
      country:countries(id, code, name, flag_emoji)
    `, { count: 'exact' })

  if (filters.country_id) {
    query = query.eq('country_id', filters.country_id)
  }
  if (filters.search) {
    query = query.ilike('name', `%${filters.search}%`)
  }

  query = query.order('country_id').order('display_order').range(offset, offset + limit - 1)

  const { data, error, count } = await query

  if (error) throw new Error(`Failed to get world provinces: ${error.message}`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provinces: WorldProvinceAdmin[] = (data || []).map((row: any) => ({
    id: row.id,
    country_id: row.country_id,
    country_name: row.country?.name ?? undefined,
    country_code: row.country?.code ?? undefined,
    country_flag_emoji: row.country?.flag_emoji ?? null,
    name: row.name,
    slug: row.slug,
    logical_id: row.logical_id,
    description: row.description,
    display_order: row.display_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }))

  return { provinces, totalCount: count ?? 0 }
}

/**
 * Create a new province/region (admin only)
 */
export async function createWorldProvince(
  payload: WorldProvinceCreatePayload
): Promise<void> {
  const { error } = await supabase
    .from('world_provinces')
    .insert({
      name: payload.name.trim(),
      slug: generateSlug(payload.name),
      country_id: payload.country_id,
      description: payload.description ?? null,
      display_order: payload.display_order ?? 0,
    })

  if (error) {
    if (error.message.includes('duplicate key') || error.message.includes('unique')) {
      throw new Error('A region with this name already exists in this country')
    }
    throw new Error(`Failed to create region: ${error.message}`)
  }
}

/**
 * Update a province/region (admin only)
 */
export async function updateWorldProvince(
  provinceId: number,
  payload: WorldProvinceUpdatePayload
): Promise<void> {
  const updates: Record<string, unknown> = {}

  if (payload.name !== undefined) {
    updates.name = payload.name.trim()
    updates.slug = generateSlug(payload.name)
  }
  if (payload.country_id !== undefined) updates.country_id = payload.country_id
  if (payload.description !== undefined) updates.description = payload.description
  if (payload.display_order !== undefined) updates.display_order = payload.display_order

  const { error } = await supabase
    .from('world_provinces')
    .update(updates)
    .eq('id', provinceId)

  if (error) {
    if (error.message.includes('duplicate key') || error.message.includes('unique')) {
      throw new Error('A region with this name already exists in this country')
    }
    throw new Error(`Failed to update region: ${error.message}`)
  }
}

/**
 * Delete a province/region (admin only)
 * Note: FK ON DELETE CASCADE will delete all leagues in this region.
 * FK ON DELETE SET NULL will unlink clubs from this region.
 */
export async function deleteWorldProvince(provinceId: number): Promise<void> {
  const { error } = await supabase
    .from('world_provinces')
    .delete()
    .eq('id', provinceId)

  if (error) throw new Error(`Failed to delete region: ${error.message}`)
}

/**
 * Get counts of leagues and clubs in a province (for delete confirmation)
 */
export async function getWorldProvinceRelationCounts(
  provinceId: number
): Promise<{ leagueCount: number; clubCount: number }> {
  const [leagueResult, clubResult] = await Promise.all([
    supabase
      .from('world_leagues')
      .select('*', { count: 'exact', head: true })
      .eq('province_id', provinceId),
    supabase
      .from('world_clubs')
      .select('*', { count: 'exact', head: true })
      .eq('province_id', provinceId),
  ])

  return {
    leagueCount: leagueResult.count ?? 0,
    clubCount: clubResult.count ?? 0,
  }
}

// ============================================================================
// INVESTOR DASHBOARD
// ============================================================================

/**
 * Get investor metrics (admin only)
 */
export async function getInvestorMetrics(days = 90): Promise<InvestorMetrics> {
  const { data, error } = await adminRpc('admin_get_investor_metrics', {
    p_days: days,
  })
  if (error) throw new Error(`Failed to get investor metrics: ${error.message}`)
  return data as InvestorMetrics
}

/**
 * Get investor signup trends for charts (admin only)
 */
export async function getInvestorSignupTrends(days = 90): Promise<InvestorSignupTrend[]> {
  const { data, error } = await adminRpc('admin_get_investor_signup_trends', {
    p_days: days,
  })
  if (error) throw new Error(`Failed to get investor signup trends: ${error.message}`)
  return data as InvestorSignupTrend[]
}

/**
 * Create a shareable investor token (admin only)
 */
export async function createInvestorToken(
  name: string,
  expiresInDays?: number
): Promise<InvestorShareToken> {
  const { data, error } = await adminRpc('admin_create_investor_token', {
    p_name: name,
    p_expires_in_days: expiresInDays ?? null,
  })
  if (error) throw new Error(`Failed to create investor token: ${error.message}`)
  return data as InvestorShareToken
}

/**
 * Revoke an investor token (admin only)
 */
export async function revokeInvestorToken(tokenId: string): Promise<boolean> {
  const { data, error } = await adminRpc('admin_revoke_investor_token', {
    p_token_id: tokenId,
  })
  if (error) throw new Error(`Failed to revoke investor token: ${error.message}`)
  return data as boolean
}

/**
 * List all investor tokens (admin only)
 */
export async function listInvestorTokens(): Promise<InvestorShareToken[]> {
  const { data, error } = await adminRpc('admin_list_investor_tokens')
  if (error) throw new Error(`Failed to list investor tokens: ${error.message}`)
  return data as InvestorShareToken[]
}

/**
 * Get investor metrics via public token (no auth required)
 */
export async function getPublicInvestorMetrics(
  token: string,
  days = 90
): Promise<InvestorMetrics> {
  const { data, error } = await supabase.rpc('public_get_investor_metrics', {
    p_token: token,
    p_days: days,
  })
  if (error) throw new Error(`Invalid or expired token`)
  return data as unknown as InvestorMetrics
}

/**
 * Get investor signup trends via public token (no auth required)
 */
export async function getPublicInvestorSignupTrends(
  token: string,
  days = 90
): Promise<InvestorSignupTrend[]> {
  const { data, error } = await supabase.rpc('public_get_investor_signup_trends', {
    p_token: token,
    p_days: days,
  })
  if (error) throw new Error(`Invalid or expired token`)
  return data as unknown as InvestorSignupTrend[]
}

// ============================================================================
// NETWORKING ANALYTICS
// ============================================================================

/**
 * Get messaging analytics (admin only)
 */
export async function getMessagingMetrics(
  days?: number,
  excludeTest?: boolean,
  role?: string,
): Promise<MessagingMetrics> {
  const { data, error } = await adminRpc('admin_get_messaging_metrics', {
    p_days: days ?? 30,
    p_exclude_test: excludeTest ?? true,
    p_role: role || null,
  })
  if (error) throw new Error(`Failed to get messaging metrics: ${error.message}`)
  return data as MessagingMetrics
}

/**
 * Get friendship analytics (admin only)
 */
export async function getFriendshipMetrics(
  days?: number,
  excludeTest?: boolean,
  role?: string,
): Promise<FriendshipMetrics> {
  const { data, error } = await adminRpc('admin_get_friendship_metrics', {
    p_days: days ?? 30,
    p_exclude_test: excludeTest ?? true,
    p_role: role || null,
  })
  if (error) throw new Error(`Failed to get friendship metrics: ${error.message}`)
  return data as FriendshipMetrics
}

/**
 * Get reference/endorsement analytics (admin only)
 */
export async function getReferenceMetrics(
  days?: number,
  excludeTest?: boolean,
  role?: string,
): Promise<ReferenceMetrics> {
  const { data, error } = await adminRpc('admin_get_reference_metrics', {
    p_days: days ?? 30,
    p_exclude_test: excludeTest ?? true,
    p_role: role || null,
  })
  if (error) throw new Error(`Failed to get reference metrics: ${error.message}`)
  return data as ReferenceMetrics
}

// ============================================================================
// EMAIL INTELLIGENCE
// ============================================================================

import type {
  EmailTemplate,
  EmailTemplateDetail,
  EmailOverviewStats,
  EmailCampaign,
  EmailSendItem,
  EmailEngagementItem,
  EmailSendStats,
  EmailEngagementSearchParams,
  CampaignDetail,
  AudiencePreview,
  CreateCampaignParams,
  CampaignVariantMetrics,
  EmailContactsSummary,
  EmailContact,
  EmailContactSearchParams,
} from '../types'

/**
 * Get email overview KPIs + daily trends
 */
export async function getEmailOverview(days = 30): Promise<EmailOverviewStats> {
  const { data, error } = await adminRpc('admin_get_email_overview', {
    p_days: days,
  })
  if (error) throw new Error(`Failed to get email overview: ${error.message}`)
  return data as EmailOverviewStats
}

/**
 * Get all email templates with stats
 */
export async function getEmailTemplates(): Promise<EmailTemplate[]> {
  const { data, error } = await adminRpc('admin_get_email_templates')
  if (error) throw new Error(`Failed to get email templates: ${error.message}`)
  return data as EmailTemplate[]
}

/**
 * Diagnose email metrics — shows status breakdown per template + orphaned events
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function diagnoseEmailMetrics(): Promise<any> {
  const { data, error } = await adminRpc('admin_diagnose_email_metrics')
  if (error) throw new Error(`Failed to diagnose email metrics: ${error.message}`)
  return data
}

/**
 * Backfill email statuses from email_events to email_sends
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function backfillEmailStatuses(): Promise<any> {
  const { data, error } = await adminRpc('admin_backfill_email_statuses')
  if (error) throw new Error(`Failed to backfill email statuses: ${error.message}`)
  return data
}

/**
 * Get template detail with versions and per-template stats
 */
export async function getEmailTemplateDetail(templateId: string): Promise<EmailTemplateDetail> {
  const { data, error } = await adminRpc('admin_get_email_template_detail', {
    p_template_id: templateId,
  })
  if (error) throw new Error(`Failed to get email template detail: ${error.message}`)
  return data as EmailTemplateDetail
}

/**
 * Save a new template draft (creates a new version)
 */
export async function saveEmailTemplateDraft(params: {
  templateId: string
  subject: string
  contentJson: unknown[]
  text?: string
  variables?: unknown[]
  changeNote?: string
}): Promise<{ version_id: string; version_number: number }> {
  const { data, error } = await adminRpc('admin_save_email_template_draft', {
    p_template_id: params.templateId,
    p_subject: params.subject,
    p_content_json: params.contentJson,
    p_text: params.text ?? null,
    p_variables: params.variables ?? [],
    p_change_note: params.changeNote ?? null,
  })
  if (error) throw new Error(`Failed to save template draft: ${error.message}`)
  return data as { version_id: string; version_number: number }
}

/**
 * Update a template's display name
 */
export async function updateEmailTemplateName(templateId: string, name: string): Promise<void> {
  const { error } = await adminRpc('admin_update_email_template_name', {
    p_template_id: templateId,
    p_name: name,
  })
  if (error) throw new Error(`Failed to update template name: ${error.message}`)
}

/**
 * Activate a specific template version (makes it live)
 */
export async function activateEmailTemplate(
  templateId: string,
  versionNumber: number
): Promise<void> {
  const { error } = await adminRpc('admin_activate_email_template', {
    p_template_id: templateId,
    p_version_number: versionNumber,
  })
  if (error) throw new Error(`Failed to activate template: ${error.message}`)
}

/**
 * Rollback to a previous template version
 */
export async function rollbackEmailTemplate(
  templateId: string,
  versionNumber: number
): Promise<void> {
  const { error } = await adminRpc('admin_rollback_email_template', {
    p_template_id: templateId,
    p_version_number: versionNumber,
  })
  if (error) throw new Error(`Failed to rollback template: ${error.message}`)
}

/**
 * Toggle a template's active/inactive state
 */
export async function toggleEmailTemplateActive(
  templateId: string,
  isActive: boolean
): Promise<void> {
  const { error } = await adminRpc('admin_toggle_email_template_active', {
    p_template_id: templateId,
    p_is_active: isActive,
  })
  if (error) throw new Error(`Failed to toggle template: ${error.message}`)
}

/**
 * Duplicate an email template
 */
export async function duplicateEmailTemplate(templateId: string): Promise<{ template_id: string }> {
  const { data, error } = await adminRpc('admin_duplicate_email_template', {
    p_template_id: templateId,
  })
  if (error) throw new Error(`Failed to duplicate template: ${error.message}`)
  return data as { template_id: string }
}

/**
 * Get campaigns list with pagination
 */
export async function getEmailCampaigns(params: {
  status?: string
  category?: string
  limit?: number
  offset?: number
} = {}): Promise<{ campaigns: EmailCampaign[]; totalCount: number }> {
  const { data, error } = await adminRpc('admin_get_email_campaigns', {
    p_status: params.status || null,
    p_category: params.category || null,
    p_limit: params.limit || 50,
    p_offset: params.offset || 0,
  })
  if (error) throw new Error(`Failed to get email campaigns: ${error.message}`)

  const campaigns = ((data || []) as EmailCampaign[]).map(normalizeEmailCampaign)
  const totalCount = campaigns.length > 0 ? campaigns[0].total_count : 0

  return { campaigns, totalCount }
}

/**
 * Get filtered send stats
 */
export async function getEmailSendStats(params: {
  days?: number
  templateKey?: string
  campaignId?: string
} = {}): Promise<EmailSendStats> {
  const { data, error } = await adminRpc('admin_get_email_send_stats', {
    p_days: params.days || 30,
    p_template_key: params.templateKey || null,
    p_campaign_id: params.campaignId || null,
  })
  if (error) throw new Error(`Failed to get email send stats: ${error.message}`)
  return data as EmailSendStats
}

/**
 * Get email history for a specific user
 */
export async function getUserEmailHistory(
  userId: string,
  limit = 50,
  offset = 0
): Promise<{ sends: EmailSendItem[]; totalCount: number }> {
  const { data, error } = await adminRpc('admin_get_user_email_history', {
    p_user_id: userId,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw new Error(`Failed to get user email history: ${error.message}`)

  const sends = data as EmailSendItem[]
  const totalCount = sends.length > 0 ? sends[0].total_count : 0

  return { sends, totalCount }
}

/**
 * Get email engagement explorer data
 */
export async function getEmailEngagementExplorer(
  params: EmailEngagementSearchParams = {}
): Promise<{ items: EmailEngagementItem[]; totalCount: number }> {
  const { data, error } = await adminRpc('admin_get_email_engagement_explorer', {
    p_template_key: params.template_key || null,
    p_campaign_id: params.campaign_id || null,
    p_status: params.status || null,
    p_role: params.role || null,
    p_country: params.country || null,
    p_since: params.since || null,
    p_until: params.until || null,
    p_limit: params.limit || 50,
    p_offset: params.offset || 0,
  })
  if (error) throw new Error(`Failed to get email engagement: ${error.message}`)

  const items = data as EmailEngagementItem[]
  const totalCount = items.length > 0 ? items[0].total_count : 0

  return { items, totalCount }
}

/**
 * Send a test email using a specific template (via Edge Function)
 */
export async function sendTestEmail(
  templateId: string,
  recipientEmail: string,
  testVariables: Record<string, string> = {}
): Promise<{ resend_email_id?: string }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('No active session')

  const response = await fetch(`${SUPABASE_URL}/functions/v1/admin-send-test-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      template_id: templateId,
      recipient_email: recipientEmail,
      test_variables: testVariables,
    }),
  })

  const result = await response.json()
  if (!result.success) {
    throw new Error(result.error || 'Failed to send test email')
  }
  return { resend_email_id: result.resend_email_id }
}

// ============================================================================
// CAMPAIGN MANAGEMENT
// ============================================================================

/**
 * Create a new email campaign (draft status)
 */
export async function createEmailCampaign(params: CreateCampaignParams): Promise<EmailCampaign> {
  const { data, error } = await adminRpc('admin_create_email_campaign', {
    p_name: params.name,
    p_template_id: params.template_id,
    p_category: params.category,
    p_audience_filter: params.audience_filter,
    p_audience_source: params.audience_source || 'users',
    p_ab_variants: params.ab_variants || null,
  })
  if (error) throw new Error(`Failed to create campaign: ${error.message}`)
  return data as EmailCampaign
}

/**
 * Get detailed campaign info with send stats
 */
export async function getCampaignDetail(campaignId: string): Promise<CampaignDetail> {
  const { data, error } = await adminRpc('admin_get_campaign_detail', {
    p_campaign_id: campaignId,
  })
  if (error) throw new Error(`Failed to get campaign detail: ${error.message}`)

  const detail = data as CampaignDetail

  return {
    ...detail,
    campaign: normalizeEmailCampaign(detail.campaign),
  }
}

/**
 * Preview campaign audience (dry run — returns count + sample)
 */
export async function previewCampaignAudience(
  category: string,
  audienceFilter: { role?: string; roles?: string[]; country?: string }
): Promise<AudiencePreview> {
  const { data, error } = await adminRpc('admin_preview_campaign_audience', {
    p_category: category,
    p_audience_filter: audienceFilter,
  })
  if (error) throw new Error(`Failed to preview audience: ${error.message}`)
  return data as AudiencePreview
}

/**
 * Send a campaign (via Edge Function)
 */
export async function sendCampaign(campaignId: string): Promise<{
  sent: number
  failed: number
  duration_ms: number
}> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('No active session')

  const response = await fetch(`${SUPABASE_URL}/functions/v1/admin-send-campaign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ campaign_id: campaignId }),
  })

  const data = await response.json()
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || `Failed to send campaign (${response.status})`)
  }

  return { sent: data.sent, failed: data.failed, duration_ms: data.duration_ms }
}

/**
 * Update a draft campaign
 */
export async function updateEmailCampaign(params: {
  campaignId: string
  name?: string
  template_id?: string
  category?: string
  audience_filter?: Record<string, unknown>
  audience_source?: string
  ab_variants?: { A: { subject: string; content_json?: unknown[] }; B: { subject: string; content_json?: unknown[] } } | null
}): Promise<void> {
  const { data, error } = await adminRpc('admin_update_email_campaign', {
    p_campaign_id: params.campaignId,
    p_name: params.name ?? null,
    p_template_id: params.template_id ?? null,
    p_category: params.category ?? null,
    p_audience_filter: params.audience_filter ?? null,
    p_audience_source: params.audience_source ?? null,
    p_ab_variants: params.ab_variants ?? null,
  })
  if (error) throw new Error(`Failed to update campaign: ${error.message}`)
  return data
}

/**
 * Delete a campaign and its associated sends
 */
export async function deleteEmailCampaign(campaignId: string): Promise<{ deleted_sends: number }> {
  const { data, error } = await adminRpc('admin_delete_email_campaign', {
    p_campaign_id: campaignId,
  })
  if (error) throw new Error(`Failed to delete campaign: ${error.message}`)
  return data as { deleted_sends: number }
}

/**
 * Duplicate a campaign as a new draft
 */
export async function duplicateEmailCampaign(campaignId: string): Promise<{ campaign_id: string }> {
  const { data, error } = await adminRpc('admin_duplicate_email_campaign', {
    p_campaign_id: campaignId,
  })
  if (error) throw new Error(`Failed to duplicate campaign: ${error.message}`)
  return data as { campaign_id: string }
}

/**
 * Get per-variant metrics for an A/B test campaign
 */
export async function getCampaignVariantMetrics(campaignId: string): Promise<CampaignVariantMetrics[]> {
  const { data, error } = await adminRpc('admin_get_campaign_variant_metrics', {
    p_campaign_id: campaignId,
  })
  if (error) throw new Error(`Failed to get variant metrics: ${error.message}`)
  return (data || []) as CampaignVariantMetrics[]
}

// ============================================================================
// CONTACT SEGMENTATION
// ============================================================================

/**
 * Get email contacts summary (per-role counts of email-eligible users)
 */
export async function getEmailContactsSummary(): Promise<EmailContactsSummary> {
  const { data, error } = await adminRpc('admin_get_email_contacts_summary')
  if (error) throw new Error(`Failed to get contacts summary: ${error.message}`)
  return data as EmailContactsSummary
}

/**
 * Get paginated email contacts list with filters
 */
export async function getEmailContacts(
  params: EmailContactSearchParams = {}
): Promise<{ contacts: EmailContact[]; totalCount: number }> {
  const { data, error } = await adminRpc('admin_get_email_contacts', {
    p_role: params.role || null,
    p_country: params.country || null,
    p_search: params.search || null,
    p_limit: params.limit || 50,
    p_offset: params.offset || 0,
  })
  if (error) throw new Error(`Failed to get email contacts: ${error.message}`)

  const contacts = data as EmailContact[]
  const totalCount = contacts.length > 0 ? contacts[0].total_count : 0

  return { contacts, totalCount }
}

// ============================================================================
// FEATURE USAGE
// ============================================================================

export async function getFeatureUsageMetrics(
  days?: number,
): Promise<FeatureUsageMetrics> {
  const { data, error } = await adminRpc('admin_get_feature_usage_metrics', {
    p_days: days ?? 30,
    p_exclude_test: true,
  })
  if (error) throw new Error(`Failed to get feature usage metrics: ${error.message}`)
  return data as FeatureUsageMetrics
}

// ============================================================================
// DISCOVERY ANALYTICS
// ============================================================================

export async function getDiscoveryAnalytics(
  days?: number,
): Promise<DiscoveryAnalyticsData> {
  const { data, error } = await adminRpc('admin_get_discovery_analytics', {
    p_days: days ?? 30,
    p_exclude_test: true,
  })
  if (error) throw new Error(`Failed to get discovery analytics: ${error.message}`)
  return data as DiscoveryAnalyticsData
}

// ============================================================================
// FOUNDER COMMAND CENTER
// ============================================================================

export async function getCommandCenterStats(days = 30): Promise<CommandCenterStats> {
  const { data, error } = await adminRpc('admin_get_command_center', { p_days: days })
  if (error) throw new Error(`Failed to get command center stats: ${error.message}`)
  return data as CommandCenterStats
}

export async function getRetentionCohorts(months = 3): Promise<RetentionCohort[]> {
  const { data, error } = await adminRpc('admin_get_retention_cohorts', { p_months: months })
  if (error) throw new Error(`Failed to get retention cohorts: ${error.message}`)
  return (data ?? []) as RetentionCohort[]
}

export async function getActivationFunnel(days?: number): Promise<ActivationFunnelData> {
  const { data, error } = await adminRpc('admin_get_activation_funnel', { p_days: days ?? null })
  if (error) throw new Error(`Failed to get activation funnel: ${error.message}`)
  return data as ActivationFunnelData
}

export async function getUserGrowthChart(days = 30): Promise<UserGrowthPoint[]> {
  const { data, error } = await adminRpc('admin_get_user_growth_chart', { p_days: days })
  if (error) throw new Error(`Failed to get user growth chart: ${error.message}`)
  return (data ?? []) as UserGrowthPoint[]
}

// ============================================================================
// MONTHLY REPORT
// ============================================================================

export async function getMonthlyReport(
  year?: number,
  month?: number,
): Promise<MonthlyReportData> {
  const params: Record<string, number> = {}
  if (year !== undefined) params.p_year = year
  if (month !== undefined) params.p_month = month
  const { data, error } = await adminRpc('admin_get_monthly_report', params)
  if (error) throw new Error(`Failed to get monthly report: ${error.message}`)
  return data as MonthlyReportData
}
