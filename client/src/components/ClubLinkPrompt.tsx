import { useState, useEffect } from 'react'
import { Link2, X, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import Avatar from '@/components/Avatar'

interface WorldClubMatch {
  id: string
  club_name: string
  avatar_url: string | null
  country_name: string
  flag_emoji: string | null
  men_league_name: string | null
  women_league_name: string | null
}

const DISMISSED_KEY = 'club-link-prompt-dismissed'

/**
 * Inline prompt shown on player/coach dashboards when `current_club` exists
 * but `current_world_club_id` is null. Auto-searches for matching world clubs
 * and offers one-tap linking.
 */
export default function ClubLinkPrompt() {
  const { profile, setProfile } = useAuthStore()
  const [matches, setMatches] = useState<WorldClubMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [linking, setLinking] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem(DISMISSED_KEY) === 'true'
  )

  const currentClub = profile?.current_club?.trim()
  const hasWorldClub = Boolean(profile?.current_world_club_id)
  const isRelevantRole = profile?.role === 'player' || profile?.role === 'coach'
  const shouldShow = isRelevantRole && currentClub && !hasWorldClub && !dismissed

  useEffect(() => {
    if (!shouldShow || !currentClub) {
      setLoading(false)
      return
    }

    let cancelled = false

    const search = async () => {
      setLoading(true)
      const { data } = await supabase.rpc('search_world_clubs', {
        p_query: currentClub,
        p_limit: 3,
      })
      if (!cancelled && data) {
        setMatches(data as WorldClubMatch[])
      }
      if (!cancelled) setLoading(false)
    }

    void search()
    return () => { cancelled = true }
  }, [shouldShow, currentClub])

  if (!shouldShow || loading || matches.length === 0) return null

  const handleLink = async (club: WorldClubMatch) => {
    if (!profile?.id) return
    setLinking(club.id)

    const { error } = await supabase
      .from('profiles')
      .update({
        current_world_club_id: club.id,
        current_club: club.club_name,
      })
      .eq('id', profile.id)

    if (!error) {
      setProfile({
        ...profile,
        current_world_club_id: club.id,
        current_club: club.club_name,
      })
    }
    setLinking(null)
  }

  const handleDismiss = () => {
    setDismissed(true)
    localStorage.setItem(DISMISSED_KEY, 'true')
  }

  return (
    <div className="relative bg-blue-50 border border-blue-100 rounded-xl p-4 mb-4">
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 p-1 text-blue-400 hover:text-blue-600 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-center gap-2 mb-3 pr-6">
        <Link2 className="w-4 h-4 text-blue-600" />
        <p className="text-sm font-medium text-blue-900">
          Link <span className="font-semibold">{currentClub}</span> to the directory
        </p>
      </div>
      <p className="text-xs text-blue-600 mb-3">
        Linking your club helps coaches and clubs find you by league.
      </p>

      <div className="space-y-2">
        {matches.map((club) => (
          <button
            key={club.id}
            onClick={() => handleLink(club)}
            disabled={linking !== null}
            className="flex items-center gap-3 w-full px-3 py-2.5 bg-white rounded-lg border border-blue-100 hover:border-blue-300 transition-colors text-left disabled:opacity-50"
          >
            <Avatar
              src={club.avatar_url}
              alt={club.club_name}
              initials={club.club_name.charAt(0)}
              size="sm"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {club.flag_emoji && <span className="mr-1">{club.flag_emoji}</span>}
                {club.club_name}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {[club.country_name, club.men_league_name || club.women_league_name].filter(Boolean).join(' · ')}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-blue-400 flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  )
}
