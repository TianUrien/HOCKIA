// ============================================================================
// HOME FEED TYPES
// ============================================================================

export type FeedItemType =
  | 'member_joined'
  | 'opportunity_posted'
  | 'milestone_achieved'
  | 'reference_received'
  | 'brand_post'
  | 'brand_product'
  | 'user_post'
  | 'club_responded'
  | 'media_added'
  | 'video_added'
  | 'open_to_play_confirmed'

export type MilestoneType =
  | 'first_gallery_image'
  | 'first_video'
  | 'profile_100_percent'
  | 'first_reference_received'

// Base fields added by the RPC to every item
interface BaseFeedItem {
  feed_item_id: string
  item_type: FeedItemType
  created_at: string
}

// --- Individual feed item types ---

export interface MemberJoinedFeedItem extends BaseFeedItem {
  item_type: 'member_joined'
  profile_id: string
  full_name: string | null
  role: 'player' | 'coach' | 'club' | 'umpire'
  avatar_url: string | null
  nationality_country_id: number | null
  base_location: string | null
  position: string | null
  current_club: string | null
}

export interface OpportunityPostedFeedItem extends BaseFeedItem {
  item_type: 'opportunity_posted'
  opportunity_id: string
  title: string
  opportunity_type: string | null
  position: string | null
  gender: string | null
  location_city: string | null
  location_country: string | null
  club_id: string
  club_name: string | null
  club_logo: string | null
  priority: string | null
  start_date: string | null
  publisher_role?: string | null
  world_club_name?: string | null
  world_club_avatar?: string | null
}

export interface MilestoneAchievedFeedItem extends BaseFeedItem {
  item_type: 'milestone_achieved'
  milestone_type: MilestoneType
  profile_id: string
  full_name: string | null
  avatar_url: string | null
  role: 'player' | 'coach' | 'club' | 'umpire'
  image_url?: string | null
}

export interface ReferenceReceivedFeedItem extends BaseFeedItem {
  item_type: 'reference_received'
  reference_record_id: string
  profile_id: string
  full_name: string | null
  avatar_url: string | null
  role: 'player' | 'coach' | 'club' | 'umpire'
  referee_id: string
  referee_name: string | null
  referee_avatar: string | null
  referee_role: string | null
  relationship_type: string | null
  endorsement_text: string | null
}

export interface BrandPostFeedItem extends BaseFeedItem {
  item_type: 'brand_post'
  brand_id: string
  brand_name: string | null
  brand_slug: string
  brand_logo_url: string | null
  brand_category: string | null
  brand_is_verified: boolean
  post_id: string
  post_content: string
  post_image_url: string | null
}

export interface BrandProductFeedItem extends BaseFeedItem {
  item_type: 'brand_product'
  brand_id: string
  brand_name: string | null
  brand_slug: string
  brand_logo_url: string | null
  brand_category: string | null
  brand_is_verified: boolean
  product_id: string
  product_name: string
  product_description: string | null
  product_images: Array<{ url: string; order: number }> | null
  product_external_url: string | null
}

export type PostType = 'text' | 'transfer' | 'signing'

export interface TransferMetadata {
  club_name: string
  club_country_id: number | null
  club_country_code: string | null
  club_country_name: string | null
  club_avatar_url: string | null
  world_club_id: string | null
  club_profile_id: string | null
  is_known_club: boolean
}

export interface SigningMetadata {
  person_name: string
  person_role: 'player' | 'coach'
  person_avatar_url: string | null
  person_profile_id: string
  person_position: string | null
}

/**
 * A post media item is either:
 *  - an IMAGE (Supabase Storage): has `url`
 *  - a CLOUDFLARE video/reel: has `video_id` (no url — playback is a signed
 *    token minted at render, so no public URL is ever stored)
 *  - a LEGACY Supabase-Storage video: has `url` + `thumb_url` (old posts /
 *    old native bundles). Renderers discriminate on `video_id ?? url`.
 */
export interface PostMediaItem {
  url?: string
  /** player_videos.id — present only for Cloudflare-backed video items. */
  video_id?: string
  thumb_url?: string | null
  media_type?: 'image' | 'video'
  width?: number | null
  height?: number | null
  duration?: number | null
  order: number
}

export interface UserPostFeedItem extends BaseFeedItem {
  item_type: 'user_post'
  post_id: string
  author_id: string
  author_name: string | null
  author_avatar: string | null
  author_role: 'player' | 'coach' | 'club' | 'brand' | 'umpire'
  content: string
  images: PostMediaItem[] | null
  like_count: number
  comment_count: number
  has_liked: boolean
  post_type?: PostType
  metadata?: TransferMetadata | SigningMetadata | null
}

// Post comment type
export interface PostComment {
  id: string
  post_id: string
  author_id: string
  author_name: string | null
  author_avatar: string | null
  author_role: string
  content: string
  created_at: string
}

// --- Phase-1 Pulse event types (P5) ---
// The generator's metadata keys ARE these fields (get_home_feed passes
// metadata through verbatim). See supabase/migrations/2026070813-16*.

export interface ClubRespondedFeedItem extends BaseFeedItem {
  item_type: 'club_responded'
  club_id: string
  club_name: string | null
  club_avatar_url: string | null
  week_start: string
  response_count: number
  responsiveness_tier: string | null
  last_response_at: string | null
}

export interface MediaAddedFeedItem extends BaseFeedItem {
  item_type: 'media_added'
  uploader_id: string
  uploader_name: string | null
  uploader_role: 'player' | 'coach' | 'club' | 'umpire'
  uploader_avatar_url: string | null
  media_kind: 'photo'
  day: string
  count: number
  sample_urls: string[]
  last_added_at: string | null
}

export interface VideoAddedFeedItem extends BaseFeedItem {
  item_type: 'video_added'
  media_kind: 'video'
  video_source: 'native'
  video_id: string
  kind: 'highlight' | 'full_match'
  title: string | null
  duration_seconds: number | null
  visibility: string
  uploader_id: string
  uploader_name: string | null
  uploader_role: 'player' | 'coach' | 'club' | 'umpire'
  uploader_avatar_url: string | null
}

export interface OpenToPlayConfirmedFeedItem extends BaseFeedItem {
  item_type: 'open_to_play_confirmed'
  player_id: string
  player_name: string | null
  player_role: 'player' | 'coach' | 'club' | 'umpire'
  player_avatar_url: string | null
  country_id: number | null
  position: string | null
  playing_category: string | null
  available_from: string | null
  open_to_opportunities: boolean
  confirmed_at: string | null
  first_confirmed_at: string | null
}

// Union type for all feed items
export type HomeFeedItem =
  | MemberJoinedFeedItem
  | OpportunityPostedFeedItem
  | MilestoneAchievedFeedItem
  | ReferenceReceivedFeedItem
  | BrandPostFeedItem
  | BrandProductFeedItem
  | UserPostFeedItem
  | ClubRespondedFeedItem
  | MediaAddedFeedItem
  | VideoAddedFeedItem
  | OpenToPlayConfirmedFeedItem
