import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Building2, UserPlus, Shield, X } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { useProfileStrength } from '@/hooks/useProfileStrength'
import type { Profile } from '@/lib/supabase'

interface CompletionStep {
  id: string
  icon: React.ReactNode
  title: string
  description: string
  action: () => void
  actionLabel: string
  completed: boolean
}

const DISMISSED_KEY = 'profile-completion-dismissed'
const DISMISSED_ITEMS_KEY = 'profile-completion-dismissed-items'

/**
 * ProfileCompletionCard — shown at the top of the home feed when the user's
 * profile is incomplete. Shows one step at a time, ordered by AI data value.
 * Dismissible per-item; fully hidden at 80%+ or after 3 dismissals.
 */
export default function ProfileCompletionCard() {
  const { profile, user } = useAuthStore()
  const navigate = useNavigate()
  const profileStrength = useProfileStrength(profile as Profile | null)
  const [dismissedItems, setDismissedItems] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(DISMISSED_ITEMS_KEY)
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set()
    } catch {
      return new Set()
    }
  })
  const [fullyDismissed, setFullyDismissed] = useState(() =>
    localStorage.getItem(DISMISSED_KEY) === 'true'
  )

  const role = profile?.role ?? null

  // Build steps ordered by AI data value (S-tier → A-tier → B-tier)
  const steps: CompletionStep[] = useMemo(() => {
    if (!profile || !user) return []
    const p = profile as Profile
    const items: CompletionStep[] = []

    // Photo — visual trust, 3x visibility
    if (!p.avatar_url?.trim()) {
      items.push({
        id: 'photo',
        icon: <Camera className="w-5 h-5 text-[#8026FA]" />,
        title: 'Add a profile photo',
        description: role === 'club'
          ? 'Clubs with logos get more attention from players.'
          : 'Profiles with photos are more likely to be shortlisted by clubs.',
        action: () => {
          const dashPath = role === 'coach' ? '/coaches/' : role === 'club' ? '/clubs/' : '/players/'
          navigate(`${dashPath}${(p as Profile).username}?action=edit`)
        },
        actionLabel: 'Add Photo',
        completed: false,
      })
    }

    // Club linking — unlocks league AI filtering (players/coaches only)
    if ((role === 'player' || role === 'coach') && !p.current_world_club_id && p.current_club?.trim()) {
      items.push({
        id: 'club',
        icon: <Building2 className="w-5 h-5 text-[#8026FA]" />,
        title: 'Link your current club',
        description: 'Coaches in your league will find you faster in search.',
        action: () => {
          const dashPath = role === 'coach' ? '/coaches/' : '/players/'
          navigate(`${dashPath}${(p as Profile).username}?action=edit`)
        },
        actionLabel: 'Link Club',
        completed: false,
      })
    }

    // Friends — prerequisite for references
    if ((p.accepted_friend_count ?? 0) === 0) {
      items.push({
        id: 'friends',
        icon: <UserPlus className="w-5 h-5 text-[#8026FA]" />,
        title: 'Connect with someone you know',
        description: 'Build your network to unlock references and trust signals.',
        action: () => navigate('/community?tab=people'),
        actionLabel: 'Find People',
        completed: false,
      })
    }

    // References — highest AI value signal
    if ((role === 'player' || role === 'coach') && (p.accepted_reference_count ?? 0) === 0 && (p.accepted_friend_count ?? 0) > 0) {
      items.push({
        id: 'references',
        icon: <Shield className="w-5 h-5 text-[#8026FA]" />,
        title: 'Get your first reference',
        description: 'Players with references rank higher in every search.',
        action: () => {
          const dashPath = role === 'coach' ? '/coaches/' : '/players/'
          navigate(`${dashPath}${(p as Profile).username}?tab=friends`)
        },
        actionLabel: 'Ask for Reference',
        completed: false,
      })
    }

    return items
  }, [profile, user, role, navigate])

  // Filter out dismissed items
  const visibleSteps = steps.filter(s => !dismissedItems.has(s.id))
  const currentStep = visibleSteps[0]

  // Fully dismiss after 3 item dismissals or no more steps
  useEffect(() => {
    if (dismissedItems.size >= 3 || (steps.length > 0 && visibleSteps.length === 0)) {
      setFullyDismissed(true)
      localStorage.setItem(DISMISSED_KEY, 'true')
    }
  }, [dismissedItems.size, steps.length, visibleSteps.length])

  // Don't render for unauthenticated users, loading state, or completed profiles
  if (!user || !profile || profileStrength.loading) return null
  if (fullyDismissed) return null
  if (profileStrength.percentage >= 80) return null
  if (!currentStep) return null

  const handleDismiss = () => {
    const next = new Set(dismissedItems)
    next.add(currentStep.id)
    setDismissedItems(next)
    try {
      localStorage.setItem(DISMISSED_ITEMS_KEY, JSON.stringify([...next]))
    } catch { /* localStorage full */ }
  }

  return (
    <div className="relative bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-6">
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 p-1 text-gray-400 hover:text-gray-600 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>

      {/* Progress bar */}
      <div className="flex items-center gap-3 mb-3 pr-6">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-gray-500">Profile strength</span>
            <span className="text-xs font-bold text-gray-700 tabular-nums">{profileStrength.percentage}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#8026FA] to-[#924CEC] rounded-full transition-all duration-500"
              style={{ width: `${profileStrength.percentage}%` }}
            />
          </div>
        </div>
      </div>

      {/* Current step */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-50">
          {currentStep.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{currentStep.title}</p>
          <p className="text-xs text-gray-500 mt-0.5">{currentStep.description}</p>
          <button
            onClick={currentStep.action}
            className="mt-2 inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-[#8026FA] to-[#924CEC] rounded-lg hover:opacity-90 transition-opacity"
          >
            {currentStep.actionLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
