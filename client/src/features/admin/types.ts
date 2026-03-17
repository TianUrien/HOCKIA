/**
 * Admin Portal Types
 * 
 * Type definitions for admin-specific data structures and API responses.
 */

export interface DashboardStats {
  // User metrics
  total_users: number
  total_players: number
  total_coaches: number
  total_clubs: number
  blocked_users: number
  test_accounts: number

  // Brand metrics
  total_brands: number
  brands_7d: number
  total_brand_products: number
  total_brand_posts: number

  // Signups
  signups_7d: number
  signups_30d: number
  
  // Onboarding
  onboarding_completed: number
  onboarding_pending: number
  
  // Content metrics
  total_vacancies: number
  open_vacancies: number
  closed_vacancies: number
  draft_vacancies: number
  vacancies_7d: number
  
  // Applications
  total_applications: number
  pending_applications: number
  applications_7d: number
  
  // Engagement
  total_conversations: number
  total_messages: number
  messages_7d: number
  total_friendships: number
  
  // Data health
  auth_orphans: number
  profile_orphans: number

  // Push & PWA metrics
  push_subscribers: number
  push_subscribers_player: number
  push_subscribers_coach: number
  push_subscribers_club: number
  push_subscribers_brand: number
  pwa_installs: number
  pwa_installs_ios: number
  pwa_installs_android: number
  pwa_installs_desktop: number

  // Meta
  generated_at: string
}

export interface SignupTrend {
  date: string
  total_signups: number
  players: number
  coaches: number
  clubs: number
  brands: number
}

export interface TopCountry {
  country: string
  user_count: number
}

export interface AuthOrphan {
  user_id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
  email_confirmed_at: string | null
  intended_role: string | null
}

export interface ProfileOrphan {
  profile_id: string
  email: string
  full_name: string | null
  role: string
  created_at: string
}

export interface BrokenReferences {
  applications_missing_player: Array<{
    application_id: string
    player_id: string
    vacancy_id: string
    created_at: string
  }> | null
  applications_missing_vacancy: Array<{
    application_id: string
    player_id: string
    vacancy_id: string
    created_at: string
  }> | null
  vacancies_missing_club: Array<{
    vacancy_id: string
    club_id: string
    title: string
    created_at: string
  }> | null
  messages_missing_sender: Array<{
    message_id: string
    sender_id: string
    conversation_id: string
    sent_at: string
  }> | null
  friendships_missing_users: Array<{
    friendship_id: string
    requester_id: string
    addressee_id: string
    missing: 'requester' | 'addressee' | 'both'
  }> | null
}

export interface AdminProfileListItem {
  id: string
  email: string
  full_name: string | null
  username: string | null
  role: string
  nationality: string | null
  nationality2: string | null
  base_location: string | null
  is_blocked: boolean
  is_test_account: boolean
  onboarding_completed: boolean
  created_at: string
  updated_at: string
  avatar_url: string | null
  total_count: number
}

export interface AdminProfileDetails {
  profile: {
    id: string
    email: string
    full_name: string | null
    username: string | null
    role: string
    nationality: string | null
    nationality_country_id: number | null
    nationality2_country_id: number | null
    base_location: string | null
    bio: string | null
    club_bio: string | null
    position: string | null
    secondary_position: string | null
    gender: string | null
    date_of_birth: string | null
    avatar_url: string | null
    highlight_video_url: string | null
    current_club: string | null
    current_world_club_id: string | null
    league_division: string | null
    is_blocked: boolean
    is_test_account: boolean
    onboarding_completed: boolean
    blocked_at: string | null
    blocked_reason: string | null
    blocked_by: string | null
    created_at: string
    updated_at: string
  }
  auth_user: {
    id: string
    email: string
    created_at: string
    last_sign_in_at: string | null
    email_confirmed_at: string | null
    phone: string | null
    is_sso_user: boolean
  } | null
  stats: {
    vacancies_count: number
    applications_count: number
    messages_sent: number
    conversations_count: number
    friends_count: number
    gallery_photos_count: number
    playing_history_count: number
  }
}

export interface AuditLogEntry {
  id: string
  admin_id: string
  admin_email: string | null
  admin_name: string | null
  action: string
  target_type: string
  target_id: string
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  created_at: string
  total_count: number
}

export interface ProfileSearchParams {
  query?: string
  role?: 'player' | 'coach' | 'club' | 'brand'
  is_blocked?: boolean
  is_test_account?: boolean
  onboarding_completed?: boolean
  limit?: number
  offset?: number
}

export interface AuditLogSearchParams {
  action?: string
  target_type?: string
  admin_id?: string
  limit?: number
  offset?: number
}

export type AdminAction = 
  | 'block_user'
  | 'unblock_user'
  | 'update_profile'
  | 'delete_orphan_profile'
  | 'delete_auth_user'
  | 'mark_test_account'
  | 'unmark_test_account'
  | 'grant_admin'
  | 'revoke_admin'

// ============================================================================
// FOUNDER COMMAND CENTER TYPES
// ============================================================================

export interface CommandCenterStats {
  total_users: number
  total_users_prev: number
  mau: number
  wau: number
  dau: number
  wau_mau_ratio: number
  live_opportunities: number
  live_opportunities_prev: number
  applications_period: number
  applications_prev: number
  application_conversion: number
  profile_completion_pct: number
  role_distribution: {
    player: number
    coach: number
    club: number
    brand: number
  }
  d7_retention: number
  generated_at: string
}

export interface RetentionCohort {
  signup_month: string
  cohort_size: number
  d1_pct: number | null
  d7_pct: number | null
  d14_pct: number | null
  d30_pct: number | null
}

export interface ActivationFunnelData {
  signed_up: number
  profile_complete: number
  browsed_opportunity: number
  applied: number
  messaged: number
}

export interface UserGrowthPoint {
  day: string
  new_users: number
  cumulative_total: number
}

// ============================================================================
// VACANCY ANALYTICS TYPES
// ============================================================================

export interface VacancyListItem {
  id: string
  title: string
  club_id: string
  club_name: string | null
  club_avatar_url: string | null
  status: 'draft' | 'open' | 'closed'
  opportunity_type: 'player' | 'coach'
  position: string | null
  location_city: string | null
  location_country: string | null
  application_count: number
  pending_count: number
  shortlisted_count: number
  first_application_at: string | null
  time_to_first_app_minutes: number | null
  created_at: string
  published_at: string | null
  application_deadline: string | null
  total_count: number
}

export interface VacancyApplicant {
  application_id: string
  player_id: string
  player_name: string | null
  player_email: string
  nationality: string | null
  position: string | null
  avatar_url: string | null
  highlight_video_url: string | null
  status: ApplicationStatus
  applied_at: string
  cover_letter: string | null
  onboarding_completed: boolean
  total_count: number
}

export type ApplicationStatus =
  | 'pending'
  | 'shortlisted'
  | 'maybe'
  | 'rejected'

export interface VacancyDetail {
  vacancy: {
    id: string
    club_id: string
    opportunity_type: 'player' | 'coach'
    title: string
    position: string | null
    gender: string | null
    description: string | null
    location_city: string
    location_country: string
    start_date: string | null
    duration_text: string | null
    requirements: string[]
    benefits: string[]
    custom_benefits: string[]
    priority: 'low' | 'medium' | 'high'
    status: 'draft' | 'open' | 'closed'
    application_deadline: string | null
    contact_email: string | null
    contact_phone: string | null
    published_at: string | null
    closed_at: string | null
    created_at: string
    updated_at: string
  }
  club: {
    id: string
    full_name: string | null
    email: string
    avatar_url: string | null
    base_location: string | null
  }
  stats: {
    total_applications: number
    pending: number
    shortlisted: number
    maybe: number
    rejected: number
    first_application_at: string | null
    last_application_at: string | null
    avg_apps_per_day: number | null
  }
}

export interface VacancySearchParams {
  status?: 'draft' | 'open' | 'closed'
  club_id?: string
  days?: number
  limit?: number
  offset?: number
}

// ============================================================================
// CLUB ANALYTICS TYPES
// ============================================================================

export interface ClubActivity {
  club_id: string
  club_name: string | null
  avatar_url: string | null
  base_location: string | null
  vacancy_count: number
  open_vacancy_count: number
  total_applications: number
  avg_apps_per_vacancy: number | null
  last_posted_at: string | null
  onboarding_completed: boolean
  total_count: number
}

export interface ClubSummary {
  total_clubs: number
  clubs_with_vacancies: number
  active_clubs_7d: number
  active_clubs_30d: number
  active_clubs_90d: number
  clubs_onboarded: number
  avg_vacancies_per_active_club: number | null
}

// ============================================================================
// BRAND ANALYTICS TYPES
// ============================================================================

export interface BrandActivity {
  brand_id: string
  brand_name: string | null
  logo_url: string | null
  category: string
  slug: string
  is_verified: boolean
  product_count: number
  post_count: number
  last_activity_at: string | null
  onboarding_completed: boolean
  created_at: string
  total_count: number
}

export interface BrandSummary {
  total_brands: number
  verified_brands: number
  brands_with_products: number
  brands_with_posts: number
  total_products: number
  total_posts: number
  brands_7d: number
  brands_30d: number
}

// ============================================================================
// PLAYER ANALYTICS TYPES
// ============================================================================

export interface PlayerFunnel {
  signed_up: number
  onboarding_completed: number
  has_avatar: number
  has_video: number
  has_journey_entry: number
  has_gallery_photo: number
  applied_to_vacancy: number
  open_to_opportunities: number
}

export interface ProfileCompletenessDistribution {
  bucket: string
  count: number
  percentage: number
}

// ============================================================================
// EXTENDED DASHBOARD TYPES
// ============================================================================

export interface ExtendedDashboardStats {
  // Vacancy performance
  vacancies_7d: number
  vacancies_30d: number
  avg_apps_per_vacancy: number | null
  active_clubs_7d: number
  active_clubs_30d: number
  vacancy_fill_rate: number | null
  
  // Player insights
  players_with_video: number
  players_with_video_pct: number | null
  players_applied_ever: number
  players_applied_7d: number
  avg_profile_score: number | null
  onboarding_rate: number | null
  
  // Application status breakdown
  application_status_breakdown: {
    pending: number
    shortlisted: number
    maybe: number
    rejected: number
  }
  
  generated_at: string
}

// ============================================================================
// ENGAGEMENT TRACKING TYPES
// ============================================================================

export interface EngagementSummary {
  total_active_users_7d: number
  total_active_users_30d: number
  total_time_minutes_7d: number
  total_time_minutes_30d: number
  total_sessions_7d: number
  total_sessions_30d: number
  avg_session_minutes: number
  avg_daily_active_users: number
  generated_at: string
}

export interface UserEngagementItem {
  user_id: string
  display_name: string
  email: string
  role: string
  avatar_url: string | null
  total_time_minutes: number
  active_days: number
  total_sessions: number
  last_active_at: string | null
  avg_session_minutes: number
  total_count: number
}

export interface EngagementTrend {
  date: string
  active_users: number
  total_minutes: number
  total_sessions: number
}

export interface UserEngagementDetail {
  user_id: string
  summary: {
    total_time_minutes: number
    active_days: number
    total_sessions: number
    first_active: string | null
    last_active: string | null
    avg_daily_minutes: number
  }
  daily_breakdown: Array<{
    date: string
    minutes: number
    sessions: number
  }>
  recent_sessions: Array<{
    session_id: string
    started_at: string
    last_heartbeat: string
    duration_minutes: number
    heartbeat_count: number
  }>
}

export interface UserEngagementSearchParams {
  limit?: number
  offset?: number
  sort_by?: 'total_time' | 'active_days' | 'sessions' | 'last_active'
  sort_dir?: 'asc' | 'desc'
  days?: number
}

// ============================================================================
// Hockey World Types
// ============================================================================

export interface WorldClub {
  id: string
  club_id: string
  club_name: string
  club_name_normalized: string
  country_id: number
  country_name?: string
  country_code?: string
  country_flag_emoji?: string | null
  province_id: number | null
  province_name?: string | null
  men_league_id: number | null
  men_league_name?: string | null
  women_league_id: number | null
  women_league_name?: string | null
  avatar_url?: string | null
  is_claimed: boolean
  claimed_profile_id: string | null
  claimed_profile_name?: string | null
  claimed_at: string | null
  created_from: 'seed' | 'user' | 'admin'
  created_at: string
  updated_at: string
}

export interface WorldClubStats {
  total_clubs: number
  claimed_clubs: number
  unclaimed_clubs: number
}

export interface WorldClubFilters {
  country_id?: number
  province_id?: number
  league_id?: number // matches either men or women league
  is_claimed?: boolean
  created_from?: 'seed' | 'user' | 'admin'
  search?: string
}

export interface WorldCountry {
  id: number
  code: string
  name: string
  flag_emoji: string | null
}

export interface WorldProvince {
  id: number
  country_id: number
  name: string
  slug: string
}

export interface WorldLeague {
  id: number
  name: string
  tier: number | null
  province_id: number | null
  country_id: number | null
}

export interface WorldClubCreatePayload {
  club_name: string
  country_id: number
  province_id?: number | null
  men_league_id?: number | null
  women_league_id?: number | null
  avatar_url?: string | null
}

export interface WorldClubUpdatePayload {
  club_name?: string
  country_id?: number
  province_id?: number | null
  men_league_id?: number | null
  women_league_id?: number | null
  avatar_url?: string | null
  is_claimed?: boolean
  claimed_profile_id?: string | null
}

// Admin-enriched league (with joined country/province names)
export interface WorldLeagueAdmin {
  id: number
  name: string
  slug: string | null
  tier: number | null
  logical_id: string | null
  display_order: number
  province_id: number | null
  province_name?: string | null
  country_id: number | null
  country_name?: string | null
  country_code?: string | null
  country_flag_emoji?: string | null
  created_at: string
  updated_at: string
}

export interface WorldLeagueFilters {
  country_id?: number
  province_id?: number
  search?: string
}

export interface WorldLeagueCreatePayload {
  name: string
  tier?: number | null
  country_id: number
  province_id?: number | null
  display_order?: number
}

export interface WorldLeagueUpdatePayload {
  name?: string
  tier?: number | null
  country_id?: number
  province_id?: number | null
  display_order?: number
}

// Admin-enriched region (with joined country name)
export interface WorldProvinceAdmin {
  id: number
  country_id: number
  country_name?: string
  country_code?: string
  country_flag_emoji?: string | null
  name: string
  slug: string
  logical_id: string | null
  description: string | null
  display_order: number
  created_at: string
  updated_at: string
}

export interface WorldProvinceFilters {
  country_id?: number
  search?: string
}

export interface WorldProvinceCreatePayload {
  name: string
  country_id: number
  description?: string | null
  display_order?: number
}

export interface WorldProvinceUpdatePayload {
  name?: string
  country_id?: number
  description?: string | null
  display_order?: number
}

// ============================================================================
// INVESTOR DASHBOARD TYPES
// ============================================================================

export interface InvestorMetrics {
  // User totals
  total_users: number
  total_players: number
  total_coaches: number
  total_clubs: number
  total_brands: number

  // Signups by period
  signups_7d: number
  signups_30d: number
  signups_90d: number

  // Growth rates (percentage vs previous period)
  growth_rate_7d: number
  growth_rate_30d: number

  // Geographic distribution
  top_countries: Array<{
    country: string
    user_count: number
  }>

  // Engagement signals
  dau_7d_avg: number
  total_messages_30d: number
  total_applications_30d: number
  total_opportunities: number

  // Metadata
  period_days: number
  generated_at: string
}

export interface InvestorSignupTrend {
  date: string
  total_signups: number
  cumulative_total: number
  players: number
  coaches: number
  clubs: number
}

export interface InvestorShareToken {
  id: string
  token: string
  name: string
  created_at: string
  expires_at: string | null
  revoked_at: string | null
  last_accessed_at: string | null
  access_count: number
  is_active: boolean
}

// ============================================================================
// NETWORKING ANALYTICS TYPES
// ============================================================================

export interface MessagingTrendItem {
  date: string
  message_count: number
}

export interface TopMessager {
  id: string
  name: string | null
  role: string
  message_count: number
}

export interface ConversationDetail {
  participant_one_name: string | null
  participant_one_role: string
  participant_two_name: string | null
  participant_two_role: string
  message_count: number
  last_message_at: string
}

export interface MessagingMetrics {
  total_conversations: number
  active_conversations_7d: number
  active_conversations_30d: number
  total_messages: number
  messages_7d: number
  messages_30d: number
  avg_messages_per_conversation: number
  users_who_messaged_30d: number
  users_never_messaged: number
  message_read_rate: number
  messaging_trend: MessagingTrendItem[] | null
  top_messagers: TopMessager[] | null
  top_conversations: ConversationDetail[] | null
  period_days: number | null
  generated_at: string
}

export interface FriendshipTrendItem {
  date: string
  friendship_count: number
}

export interface TopConnector {
  id: string
  name: string | null
  role: string
  friend_count: number
}

export interface FriendshipMetrics {
  total_friendships: number
  pending_requests: number
  friendships_7d: number
  friendships_30d: number
  acceptance_rate: number
  avg_friends_per_user: number
  users_with_zero_friends: number
  friendship_trend: FriendshipTrendItem[] | null
  top_connectors: TopConnector[] | null
  period_days: number | null
  generated_at: string
}

export interface ReferenceMetrics {
  total_references: number
  pending_references: number
  reference_acceptance_rate: number
  references_30d: number
  users_with_references: number
  period_days: number | null
  generated_at: string
}

// ============================================================================
// FEATURE USAGE TYPES
// ============================================================================

export interface ProfileViewStats {
  total: number
  unique_profiles_viewed: number
  unique_viewers: number
  by_viewed_role: Record<string, number>
  by_source: Record<string, number>
}

export interface MostViewedProfile {
  profile_id: string
  full_name: string | null
  role: string
  avatar_url: string | null
  view_count: number
  unique_viewers: number
}

export interface ViewTrendItem {
  date: string
  views: number
}

export interface EventSummaryItem {
  event_name: string
  count: number
  unique_users: number
}

export interface FeatureUsageMetrics {
  profile_views: ProfileViewStats
  most_viewed_profiles: MostViewedProfile[]
  view_trend: ViewTrendItem[]
  event_summary: EventSummaryItem[]
  period_days: number
  generated_at: string
}

// ============================================================================
// EMAIL INTELLIGENCE TYPES
// ============================================================================

export interface EmailContentBlock {
  type: 'heading' | 'paragraph' | 'card' | 'user_card' | 'button' | 'divider' | 'footnote' | 'note' | 'conversation_list'
  text?: string
  level?: number
  url?: string
  title?: string
  subtitle?: string
  label?: string
  fields?: Array<{ label: string; value: string; conditional?: boolean }>
  name_var?: string
  avatar_var?: string
  detail_vars?: string[]
  conversations_var?: string
  is_html?: boolean
  align?: string
  size?: string
  color?: string
  conditional?: boolean
}

export interface EmailTemplateVariable {
  name: string
  description: string
  required: boolean
}

export interface EmailTemplate {
  id: string
  template_key: string
  name: string
  description: string | null
  category: 'notification' | 'marketing'
  subject_template: string
  content_json: EmailContentBlock[]
  text_template: string | null
  variables: EmailTemplateVariable[]
  is_active: boolean
  current_version: number
  created_at: string
  updated_at: string
  // Joined stats (from admin_get_email_templates)
  total_sent?: number
  total_delivered?: number
  total_opened?: number
  total_clicked?: number
  open_rate?: number
  click_rate?: number
}

export interface EmailTemplateVersion {
  id: string
  version_number: number
  subject_template: string
  content_json: EmailContentBlock[]
  text_template: string | null
  variables: EmailTemplateVariable[]
  change_note: string | null
  created_by: string | null
  created_at: string
}

export interface EmailTemplateDetail {
  template: EmailTemplate
  versions: EmailTemplateVersion[]
  stats: {
    total_sent: number
    total_delivered: number
    total_opened: number
    total_clicked: number
    total_bounced: number
    daily_trend: Array<{ date: string; sent: number; opened: number }>
    by_role: Array<{ role: string; sent: number; opened: number; clicked?: number }>
    by_country: Array<{ country: string; sent: number; opened: number }>
  }
}

export interface EmailOverviewStats {
  total_sent: number
  total_delivered: number
  total_opened: number
  total_clicked: number
  total_bounced: number
  total_complained: number
  total_unsubscribed: number
  delivery_rate: number
  open_rate: number
  click_rate: number
  bounce_rate: number
  complaint_rate: number
  unsubscribe_rate: number
  daily_trend: Array<{
    date: string
    sent: number
    delivered: number
    opened: number
    clicked: number
    bounced: number
  }>
  template_breakdown: Array<{
    template_key: string
    name: string
    sent: number
    delivered: number
    opened: number
    clicked: number
    open_rate: number
    click_rate: number
  }>
  generated_at: string
}

export interface EmailCampaign {
  id: string
  template_id: string | null
  template_key: string | null
  template_name: string | null
  name: string
  category: string
  status: 'draft' | 'sending' | 'sent' | 'failed'
  audience_filter: Record<string, unknown> | null
  target_role: string | null
  target_country: string | null
  scheduled_at: string | null
  sent_at: string | null
  total_recipients: number
  audience_source: 'users' | 'outreach'
  created_by: string | null
  created_at: string
  updated_at: string
  total_sent: number
  total_delivered: number
  total_opened: number
  total_clicked: number
  total_count: number
}

export interface EmailSendItem {
  id: string
  template_key: string
  template_name: string | null
  campaign_id: string | null
  recipient_email: string
  recipient_role: string | null
  recipient_country: string | null
  subject: string
  status: string
  sent_at: string
  delivered_at: string | null
  opened_at: string | null
  clicked_at: string | null
  bounced_at: string | null
  total_count: number
}

export interface EmailEngagementItem {
  send_id: string
  recipient_id: string | null
  recipient_email: string
  recipient_role: string | null
  recipient_country: string | null
  recipient_name: string | null
  template_key: string
  template_name: string | null
  subject: string
  status: string
  engagement_state: string
  sent_at: string
  delivered_at: string | null
  opened_at: string | null
  clicked_at: string | null
  total_count: number
}

export interface EmailSendStats {
  total_sent: number
  total_delivered: number
  total_opened: number
  total_clicked: number
  total_bounced: number
  total_complained: number
  total_unsubscribed: number
  by_role: Array<{ role: string; sent: number; opened: number; clicked: number }>
  by_country: Array<{ country: string; sent: number; opened: number }>
}

export interface EmailEngagementSearchParams {
  template_key?: string
  campaign_id?: string
  status?: string
  role?: string
  country?: string
  since?: string
  until?: string
  limit?: number
  offset?: number
}

// ============================================================================
// CAMPAIGN MANAGEMENT TYPES
// ============================================================================

export interface CampaignDetail {
  campaign: EmailCampaign
  stats: {
    total: number
    delivered: number
    opened: number
    clicked: number
    bounced: number
  }
}

export interface AudiencePreview {
  count: number
  sample: Array<{
    full_name: string | null
    email: string
    role: string
    country_name: string | null
  }>
}

export interface CreateCampaignParams {
  name: string
  template_id: string
  category: string
  audience_filter: { role?: string; roles?: string[]; country?: string; status?: string; club?: string; contact_ids?: string[] }
  audience_source?: 'users' | 'outreach'
}

// ============================================================================
// CONTACT SEGMENTATION TYPES
// ============================================================================

export interface EmailContactsSummary {
  total: number
  player: number
  coach: number
  club: number
  brand: number
}

export interface EmailContact {
  id: string
  email: string
  full_name: string | null
  username: string | null
  role: string
  avatar_url: string | null
  base_location: string | null
  country_name: string | null
  country_code: string | null
  onboarding_completed: boolean
  created_at: string
  total_count: number
}

export interface EmailContactSearchParams {
  role?: string
  country?: string
  search?: string
  limit?: number
  offset?: number
}

// ============================================================================
// OUTREACH TYPES
// ============================================================================

export type OutreachStatus =
  | 'imported'
  | 'contacted'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'signed_up'
  | 'bounced'
  | 'unsubscribed'

export interface OutreachContact {
  id: string
  email: string
  contact_name: string | null
  club_name: string
  country: string | null
  role_at_club: string | null
  phone: string | null
  instagram: string | null
  notes: string | null
  status: OutreachStatus
  source: 'csv_import' | 'manual'
  world_club_id: string | null
  converted_profile_id: string | null
  converted_at: string | null
  first_contacted_at: string | null
  last_contacted_at: string | null
  created_at: string
  total_count: number
}

export interface OutreachStats {
  total: number
  imported: number
  contacted: number
  delivered: number
  opened: number
  clicked: number
  signed_up: number
  bounced: number
  unsubscribed: number
}

export interface OutreachContactFilters {
  status?: string
  country?: string
  search?: string
  limit?: number
  offset?: number
}

export interface OutreachAudiencePreview {
  count: number
  sample: Array<{
    contact_name: string | null
    email: string
    club_name: string
    country: string | null
    status: string
  }>
}

export interface OutreachImportResult {
  imported: number
  skipped: number
  total: number
}

// ============================================================================
// DISCOVERY ANALYTICS TYPES
// ============================================================================

export interface DiscoverySummary {
  total_queries: number
  unique_users: number
  avg_result_count: number
  zero_result_queries: number
  avg_response_time_ms: number
  error_count: number
}

export interface DiscoveryIntentBreakdown {
  intent: string
  count: number
  percentage: number
}

export interface DiscoveryFilterFrequency {
  filter_name: string
  count: number
}

export interface DiscoveryDailyTrend {
  date: string
  queries: number
  unique_users: number
}

export interface DiscoveryTopUser {
  user_id: string
  display_name: string | null
  email: string
  role: string
  avatar_url: string | null
  query_count: number
  last_query_at: string
}

export interface DiscoveryZeroResultQuery {
  id: string
  user_id: string
  display_name: string | null
  query_text: string
  parsed_filters: Record<string, unknown> | null
  created_at: string
}

export interface DiscoveryRecentQuery {
  id: string
  user_id: string
  display_name: string | null
  role: string
  query_text: string
  intent: string
  result_count: number
  parsed_filters: Record<string, unknown> | null
  response_time_ms: number | null
  created_at: string
}

export interface DiscoveryAnalyticsData {
  summary: DiscoverySummary
  intent_breakdown: DiscoveryIntentBreakdown[]
  filter_frequency: DiscoveryFilterFrequency[]
  daily_trend: DiscoveryDailyTrend[]
  top_users: DiscoveryTopUser[]
  zero_result_queries: DiscoveryZeroResultQuery[]
  recent_queries: DiscoveryRecentQuery[]
  period_days: number
  generated_at: string
}

// ── Monthly Report ──────────────────────────────────────────────────────

export interface MonthlyMetrics {
  // Growth
  new_signups: number
  new_players: number
  new_coaches: number
  new_clubs: number
  new_brands: number
  onboarding_completed: number
  total_users: number

  // Engagement
  mau: number
  avg_dau: number
  total_sessions: number
  total_minutes: number
  avg_session_minutes: number
  returning_users: number

  // Opportunities
  opportunities_created: number
  opportunities_closed: number
  applications_submitted: number
  unique_applicants: number

  // Social & Trust
  messages_sent: number
  active_conversations: number
  friend_requests_sent: number
  friendships_accepted: number
  references_requested: number
  references_accepted: number

  // Content
  posts_created: number
  comments_created: number
  likes_given: number
  media_uploads: number
  community_questions: number
  community_answers: number

  // Feature Adoption
  discovery_queries: number
  discovery_users: number
  brand_posts_published: number
  brand_followers_gained: number

  // Email
  emails_sent: number
  email_open_rate: number
  email_click_rate: number
}

export interface MonthlyReportData {
  current: MonthlyMetrics
  previous: MonthlyMetrics
  month: number
  year: number
  generated_at: string
}

// ============================================================================
// PREFERENCE ANALYTICS TYPES
// ============================================================================

export type PreferenceKey =
  | 'notify_applications'
  | 'notify_friends'
  | 'notify_references'
  | 'notify_messages'
  | 'notify_opportunities'
  | 'notify_push'
  | 'notify_profile_views'
  | 'browse_anonymously'

export interface PreferenceRoleBreakdown {
  enabled: number
  disabled: number
}

export interface PreferenceStat {
  enabled: number
  disabled: number
  by_role: Record<string, PreferenceRoleBreakdown>
}

export interface PreferenceSummary {
  total_users: number
  preferences: Record<PreferenceKey, PreferenceStat>
  generated_at: string
}

export interface PreferenceUser {
  id: string
  email: string
  full_name: string | null
  role: string
  avatar_url: string | null
  created_at: string
  total_count: number
}

// ============================================================================
// ADVANCED ANALYTICS TYPES
// ============================================================================

export interface FeedAnalytics {
  summary: {
    total_posts: number
    unique_authors: number
    user_posts: number
    transfer_posts: number
    signing_posts: number
    brand_posts: number
    prev_total_posts: number
    total_likes: number
    unique_likers: number
    prev_total_likes: number
    total_comments: number
    unique_commenters: number
    prev_total_comments: number
  }
  daily_trend: Array<{ day: string; posts: number; likes: number; comments: number }>
  posts_by_role: Array<{ role: string; count: number }>
  top_posts: Array<{
    id: string
    content: string
    post_type: string
    created_at: string
    author_name: string
    author_role: string
    author_avatar: string | null
    like_count: number
    comment_count: number
  }>
  generated_at: string
}

export interface NotificationEffectiveness {
  totals: {
    total_created: number
    total_read: number
    total_clicks: number
    overall_read_rate: number
    overall_click_rate: number
  }
  per_kind: Array<{
    kind: string
    created: number
    read: number
    cleared: number
    clicks: number
    unique_clickers: number
    read_rate: number
    click_rate: number
  }>
  daily_trend: Array<{ day: string; created: number; read: number; clicks: number }>
  generated_at: string
}

export interface ConversionFunnels {
  networking_funnel: {
    profile_viewers: number
    friend_requesters: number
    friend_accepted: number
  }
  opportunity_funnel: {
    vacancy_viewers: number
    applicants: number
    shortlisted: number
  }
  notification_funnel: {
    recipients: number
    readers: number
    clickers: number
  }
  reference_funnel: {
    requesters: number
    accepted: number
  }
  generated_at: string
}

export interface CommunityAnalytics {
  summary: {
    total_questions: number
    unique_askers: number
    prev_total_questions: number
    total_answers: number
    unique_answerers: number
    prev_total_answers: number
    response_rate: number
  }
  questions_by_role: Array<{ role: string; count: number }>
  top_contributors: Array<{
    id: string
    full_name: string | null
    role: string
    avatar_url: string | null
    answer_count: number
  }>
  daily_trend: Array<{ day: string; questions: number; answers: number }>
  generated_at: string
}

export interface MarketplaceHealth {
  supply: {
    players_available: number
    total_players: number
    coaches_available: number
    total_coaches: number
  }
  demand: {
    open_vacancies: number
    clubs_hiring: number
    new_vacancies_period: number
  }
  velocity: {
    applications_period: number
    unique_applicants: number
    vacancies_applied_to: number
    avg_hours_to_first_app: number
  }
  status_breakdown: Array<{ status: string; count: number }>
  by_position: Array<{ position: string; count: number }>
  generated_at: string
}

