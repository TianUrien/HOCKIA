import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

// Get environment variables – prefer process.env to align with shared config, fall back to Vite env entries
const supabaseUrl =
  (typeof process !== 'undefined' && process.env ? process.env.SUPABASE_URL : undefined) ??
  (import.meta.env ? (import.meta.env as Record<string, string | undefined>).SUPABASE_URL : undefined) ??
  (import.meta.env ? (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_URL : undefined)

const supabaseAnonKey =
  (typeof process !== 'undefined' && process.env ? process.env.SUPABASE_ANON_KEY : undefined) ??
  (import.meta.env ? (import.meta.env as Record<string, string | undefined>).SUPABASE_ANON_KEY : undefined) ??
  (import.meta.env ? (import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_ANON_KEY : undefined)

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables – check .env.local')
}

export const AUTH_STORAGE_KEY = 'hockia-auth'

// One-time migration: move session from legacy key so existing users stay logged in
if (typeof window !== 'undefined') {
  const legacy = window.localStorage.getItem('playr-auth')
  if (legacy && !window.localStorage.getItem(AUTH_STORAGE_KEY)) {
    window.localStorage.setItem(AUTH_STORAGE_KEY, legacy)
  }
  // Clean up legacy key regardless (after copy or if new key already exists)
  if (legacy) {
    window.localStorage.removeItem('playr-auth')
  }
}

// Create Supabase client with typed database
// Use implicit auth flow so email links work across devices/browsers
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'implicit', // Implicit avoids local-only PKCE storage so email links work cross-device
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true, // Automatically detect and exchange tokens from URL
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    storageKey: AUTH_STORAGE_KEY,
  }
})

export const SUPABASE_URL = supabaseUrl
export const SUPABASE_ANON_KEY = supabaseAnonKey

// Export types
export type Profile = Database['public']['Tables']['profiles']['Row']
export type ProfileInsert = Database['public']['Tables']['profiles']['Insert']
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update']
export type ProfileReference = Database['public']['Tables']['profile_references']['Row']

// Opportunity types (formerly Vacancy)
export type Opportunity = Database['public']['Tables']['opportunities']['Row']
export type OpportunityInsert = Database['public']['Tables']['opportunities']['Insert']
export type OpportunityUpdate = Database['public']['Tables']['opportunities']['Update']

// Legacy aliases - keep for backward compatibility during migration
/** @deprecated Use Opportunity instead */
export type Vacancy = Opportunity
/** @deprecated Use OpportunityInsert instead */
export type VacancyInsert = OpportunityInsert
/** @deprecated Use OpportunityUpdate instead */
export type VacancyUpdate = OpportunityUpdate

// Application types (formerly VacancyApplication)
export type OpportunityApplication = Database['public']['Tables']['opportunity_applications']['Row']
export type OpportunityApplicationInsert = Database['public']['Tables']['opportunity_applications']['Insert']
export type OpportunityApplicationUpdate = Database['public']['Tables']['opportunity_applications']['Update']

// Legacy aliases
/** @deprecated Use OpportunityApplication instead */
export type VacancyApplication = OpportunityApplication
/** @deprecated Use OpportunityApplicationInsert instead */
export type VacancyApplicationInsert = OpportunityApplicationInsert
/** @deprecated Use OpportunityApplicationUpdate instead */
export type VacancyApplicationUpdate = OpportunityApplicationUpdate

export type GalleryPhoto = Database['public']['Tables']['gallery_photos']['Row']
export type GalleryPhotoInsert = Database['public']['Tables']['gallery_photos']['Insert']
export type GalleryPhotoUpdate = Database['public']['Tables']['gallery_photos']['Update']

export type ClubMedia = Database['public']['Tables']['club_media']['Row']
export type ClubMediaInsert = Database['public']['Tables']['club_media']['Insert']
export type ClubMediaUpdate = Database['public']['Tables']['club_media']['Update']

// Career history types (formerly PlayingHistory)
export type CareerHistory = Database['public']['Tables']['career_history']['Row']
export type CareerHistoryInsert = Database['public']['Tables']['career_history']['Insert']
export type CareerHistoryUpdate = Database['public']['Tables']['career_history']['Update']

// Legacy aliases
/** @deprecated Use CareerHistory instead */
export type PlayingHistory = CareerHistory
/** @deprecated Use CareerHistoryInsert instead */
export type PlayingHistoryInsert = CareerHistoryInsert
/** @deprecated Use CareerHistoryUpdate instead */
export type PlayingHistoryUpdate = CareerHistoryUpdate

export type Message = Database['public']['Tables']['messages']['Row']
export type MessageInsert = Database['public']['Tables']['messages']['Insert']
export type MessageUpdate = Database['public']['Tables']['messages']['Update']

export type Conversation = Database['public']['Tables']['conversations']['Row']
export type ConversationInsert = Database['public']['Tables']['conversations']['Insert']
export type ConversationUpdate = Database['public']['Tables']['conversations']['Update']

// Complex joined types
export type OpportunityApplicationWithApplicant = OpportunityApplication & {
  applicant: Pick<
    Profile,
    'id' | 'full_name' | 'avatar_url' | 'position' | 'secondary_position' | 'base_location' | 'nationality' | 'username'
  >
}

// Legacy alias
/** @deprecated Use OpportunityApplicationWithApplicant instead */
export type VacancyApplicationWithPlayer = OpportunityApplicationWithApplicant

export type { Json } from './database.types'
