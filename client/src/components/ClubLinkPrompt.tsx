import { useState, useEffect } from 'react'
import { Link2, X, ChevronRight, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import Avatar from '@/components/Avatar'
import Flag from '@/components/Flag'

interface WorldClubMatch {
  id: string
  club_name: string
  avatar_url: string | null
  country_name: string
  country_code: string | null
  flag_emoji: string | null
  men_league_name: string | null
  women_league_name: string | null
}

const DISMISSED_KEY = 'club-link-prompt-dismissed'

interface ClubLinkPromptProps {
  /** Opens the surface where the user can add/link their club (the profile
   *  edit modal, which hosts WorldClubSearch + its "Add to directory" flow).
   *  When omitted, the no-match case simply hides. */
  onAddClub?: () => void
}

/**
 * Inline prompt shown on player AND coach dashboards when `current_club` exists
 * but `current_world_club_id` is null. Auto-searches for matching world clubs
 * and offers one-tap linking. When no match is found — the exact situation for
 * clubs in countries World hasn't mapped yet (e.g. Scotland) — it offers an
 * "add it to the directory" path instead of silently disappearing, so those
 * users can still contribute their club and recover the recruiting/logo/search
 * signal a free-text club loses.
 */
export default function ClubLinkPrompt({ onAddClub }: ClubLinkPromptProps = {}) {
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

  if (!shouldShow || loading) return null
  // No matches AND no way to add → nothing useful to show.
  if (matches.length === 0 && !onAddClub) return null

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

  const noMatches = matches.length === 0

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
          {noMatches ? (
            <>Can&rsquo;t find <span className="font-semibold">{currentClub}</span> in the directory?</>
          ) : (
            <>Link <span className="font-semibold">{currentClub}</span> to the directory</>
          )}
        </p>
      </div>
      <p className="text-xs text-blue-600 mb-3">
        {noMatches
          ? 'Add your club so coaches and clubs can find you by league.'
          : 'Linking your club helps coaches and clubs find you by league.'}
      </p>

      {!noMatches && (
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
                role="club"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate inline-flex items-center gap-1">
                  <Flag code={club.country_code} countryName={club.country_name} fallbackEmoji={club.flag_emoji} size="sm" />
                  <span className="truncate">{club.club_name}</span>
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {[club.country_name, club.men_league_name || club.women_league_name].filter(Boolean).join(' · ')}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-blue-400 flex-shrink-0" />
            </button>
          ))}
        </div>
      )}

      {/* "Add it" affordance — the primary action when there's no match, and a
          secondary "not one of these?" escape when there are. */}
      {onAddClub && (
        <button
          onClick={onAddClub}
          className={
            noMatches
              ? 'flex items-center justify-center gap-1.5 w-full px-3 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors'
              : 'mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900'
          }
        >
          <Plus className="w-3.5 h-3.5" />
          {noMatches ? 'Add your club to the directory' : 'Not one of these? Add it'}
        </button>
      )}
    </div>
  )
}
