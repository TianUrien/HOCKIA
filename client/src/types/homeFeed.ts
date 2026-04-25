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

export type MilestoneType =
  | 'first_gallery_image'
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

export interface PostMediaItem {
  url: string
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

// Union type for all feed items
export type HomeFeedItem =
  | MemberJoinedFeedItem
  | OpportunityPostedFeedItem
  | MilestoneAchievedFeedItem
  | ReferenceReceivedFeedItem
  | BrandPostFeedItem
  | BrandProductFeedItem
  | UserPostFeedItem
