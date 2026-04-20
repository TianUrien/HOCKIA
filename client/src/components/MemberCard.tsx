import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageCircle, User, Globe, MapPin, Shield, Building2 } from 'lucide-react'
import { Avatar, RoleBadge, TierBadge, NationalityCardDisplay, AvailabilityPill } from '@/components'
import type { ProfileTier } from '@/lib/profileTier'
import SignInPromptModal from '@/components/SignInPromptModal'
import { useAuthStore } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useToastStore } from '@/lib/toast'
import { useWorldClubLogo } from '@/hooks/useWorldClubLogo'
import { getSpecializationLabel } from '@/lib/coachSpecializations'

interface MemberCardProps {
  id: string
  avatar_url: string | null
  full_name: string
  role: 'player' | 'coach' | 'club' | 'brand'
  brandSlug?: string
  brandCategory?: string
  nationality: string | null
  nationality_country_id?: number | null
  nationality2_country_id?: number | null
  base_location: string | null
  position: string | null
  secondary_position: string | null
  current_team: string | null
  current_world_club_id?: string | null
  created_at: string
  open_to_play?: boolean
  open_to_coach?: boolean
  accepted_reference_count?: number
  coach_specialization?: string | null
  coach_specialization_custom?: string | null
  /**
   * Profile tier (Rookie → Active → Rising → Elite), derived client-side from
   * the member's profile-strength estimate. When provided, rendered as a
   * TierBadge in the badge row. Omit to render no tier.
   */
  tier?: ProfileTier
}

export default function MemberCard({
  id,
  avatar_url,
  full_name,
  role,
  brandSlug,
  brandCategory,
  nationality,
  nationality_country_id,
  nationality2_country_id,
  base_location,
  position,
  secondary_position,
  current_team,
  current_world_club_id,
  open_to_play,
  open_to_coach,
  accepted_reference_count,
  coach_specialization,
  coach_specialization_custom,
  tier,
}: MemberCardProps) {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { addToast } = useToastStore()
  const clubLogo = useWorldClubLogo(current_world_club_id ?? null)
  const [isLoading, setIsLoading] = useState(false)
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)
  const [signInAction, setSignInAction] = useState<'message' | 'view'>('message')
  const positions = [position, secondary_position].filter((value, index, self): value is string => {
    if (!value) return false
    return self.findIndex((item) => item === value) === index
  })

  // Capitalize first letter only (preserves rest of user input)
  const capitalizeFirst = (str: string | null) => {
    if (!str) return ''
    return str.charAt(0).toUpperCase() + str.slice(1)
  }

  // Handle Message button
  const handleMessage = async () => {
    if (!user) {
      setSignInAction('message')
      setShowSignInPrompt(true)
      return
    }

    setIsLoading(true)
    try {
      // Check if conversation already exists
      // Use maybeSingle() instead of single() to handle 0 or 1 results gracefully
      const { data: existingConversation, error: fetchError } = await supabase
        .from('conversations')
        .select('id')
        .or(
          `and(participant_one_id.eq.${user.id},participant_two_id.eq.${id}),and(participant_one_id.eq.${id},participant_two_id.eq.${user.id})`
        )
        .maybeSingle()

      // If there's a database error (not just "no results"), throw it
      if (fetchError) throw fetchError

      if (existingConversation) {
        // Conversation exists - navigate to it
        navigate(`/messages?conversation=${existingConversation.id}`)
      } else {
        // No conversation yet - open messages in "new conversation" mode
        navigate(`/messages?new=${id}`)
      }
    } catch (error) {
      logger.error('Error creating conversation:', error)
      addToast('Failed to start conversation. Please try again.', 'error')
    } finally {
      setIsLoading(false)
    }
  }

  // Handle View Profile
  const handleViewProfile = () => {
    if (!user) {
      setSignInAction('view')
      setShowSignInPrompt(true)
      return
    }
    // Navigate to correct public profile based on role
    if (role === 'brand') {
      navigate(brandSlug ? `/brands/${brandSlug}?ref=community` : '/brands')
    } else if (role === 'club') {
      navigate(`/clubs/id/${id}?ref=community`)
    } else {
      // Players and Coaches use player profile route
      navigate(`/players/id/${id}?ref=community`)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 hover:shadow-lg transition-shadow">
      {/* Avatar + name header */}
      <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-5">
        <Avatar
          src={avatar_url}
          alt={full_name}
          initials={full_name ? full_name.split(' ').map(n => n[0]).join('') : '?'}
          size="xl"
          enablePreview
          previewTitle={full_name}
        />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{full_name}</h3>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <RoleBadge role={role} />
            {role === 'brand' && brandCategory && (
              <span className="text-xs text-gray-500 capitalize">{brandCategory}</span>
            )}
            {role === 'player' && open_to_play && <AvailabilityPill variant="play" size="sm" className="!shadow-none" />}
            {role === 'coach' && open_to_coach && <AvailabilityPill variant="coach" size="sm" className="!shadow-none" />}
            {tier && <TierBadge tier={tier} size="sm" />}
            {(accepted_reference_count ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-medium">
                <Shield className="w-2.5 h-2.5" />
                Trusted by {accepted_reference_count}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="space-y-3 mb-4 sm:mb-5 text-sm">
        {(nationality_country_id || nationality) && (
          <div className="flex items-center gap-2.5">
            <Globe className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider min-w-[68px]">Nationality</span>
            <NationalityCardDisplay
              primaryCountryId={nationality_country_id}
              secondaryCountryId={nationality2_country_id}
              fallbackText={nationality}
              className="text-gray-700"
            />
          </div>
        )}

        {base_location && (
          <div className="flex items-center gap-2.5">
            <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider min-w-[68px]">Location</span>
            <span className="text-gray-700">{base_location}</span>
          </div>
        )}

        {role === 'coach' && coach_specialization ? (
          <div className="flex items-center gap-2.5">
            <Shield className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider min-w-[68px]">Role</span>
            <span className="text-gray-700">{getSpecializationLabel(coach_specialization, coach_specialization_custom)}</span>
          </div>
        ) : positions.length > 0 && (role === 'player' || role === 'coach') ? (
          <div className="flex items-center gap-2.5">
            <Shield className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider min-w-[68px]">Position</span>
            <span className="text-gray-700">{positions.map(capitalizeFirst).join(' • ')}</span>
          </div>
        ) : null}

        {current_team && (
          <div className="pt-1">
            <div className="flex items-center gap-2.5">
              <Building2 className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Current Team</span>
            </div>
            <div className="flex items-center gap-2 mt-1.5 ml-[22px]">
              {clubLogo && (
                <img src={clubLogo} alt="" className="w-7 h-7 rounded-lg object-cover flex-shrink-0" />
              )}
              <span className="text-gray-700 font-medium">{current_team}</span>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleMessage}
          disabled={isLoading}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <MessageCircle className="w-4 h-4" />
          <span>Message</span>
        </button>
        <button
          onClick={handleViewProfile}
          className="flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] rounded-lg border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50 hover:text-gray-700 transition-colors"
        >
          <User className="w-4 h-4" />
          <span>View Profile</span>
        </button>
      </div>

      {/* Sign In Prompt Modal */}
      <SignInPromptModal
        isOpen={showSignInPrompt}
        onClose={() => setShowSignInPrompt(false)}
        title={signInAction === 'message' ? 'Sign in to message' : 'Sign in to view profile'}
        message={signInAction === 'message' 
          ? 'Sign in or create a free HOCKIA account to connect with this member.'
          : 'Sign in or create a free HOCKIA account to view member profiles.'
        }
      />
    </div>
  )
}
