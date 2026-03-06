import { useState } from 'react'
import { Zap } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'

interface AvailabilityToggleStripProps {
  role: 'player' | 'coach'
}

/**
 * AvailabilityToggleStrip — one-tap toggles for open_to_play, open_to_coach,
 * open_to_opportunities. Shown on own dashboard only.
 *
 * These booleans are high-value AI search fields but are buried in the
 * EditProfileModal. This strip makes them zero-friction.
 */
export default function AvailabilityToggleStrip({ role }: AvailabilityToggleStripProps) {
  const { profile, setProfile } = useAuthStore()
  const { addToast } = useToastStore()
  const [saving, setSaving] = useState<string | null>(null)

  if (!profile) return null

  const toggles = [
    ...(role === 'player' ? [{
      id: 'open_to_play',
      label: 'Open to Play',
      active: Boolean(profile.open_to_play),
      activeGradient: 'from-emerald-400 to-green-500',
    }] : [{
      id: 'open_to_coach',
      label: 'Open to Coach',
      active: Boolean(profile.open_to_coach),
      activeGradient: 'from-violet-500 to-purple-600',
    }]),
    {
      id: 'open_to_opportunities',
      label: 'Open to Opportunities',
      active: Boolean(profile.open_to_opportunities),
      activeGradient: 'from-blue-500 to-indigo-500',
    },
  ]

  const handleToggle = async (field: string, currentValue: boolean) => {
    if (saving) return
    setSaving(field)

    const newValue = !currentValue
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ [field]: newValue })
        .eq('id', profile.id)

      if (error) throw error

      setProfile({ ...profile, [field]: newValue })
    } catch (err) {
      logger.error('[AVAILABILITY] Toggle failed', { field, err })
      addToast('Failed to update availability', 'error')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-medium text-gray-500 mr-0.5">I&apos;m open to:</span>
      {toggles.map(toggle => (
        <button
          key={toggle.id}
          type="button"
          onClick={() => void handleToggle(toggle.id, toggle.active)}
          disabled={saving === toggle.id}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all duration-200',
            toggle.active
              ? `bg-gradient-to-r ${toggle.activeGradient} text-white shadow-sm`
              : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
            saving === toggle.id && 'opacity-60'
          )}
        >
          <Zap className={cn('w-3 h-3', toggle.active && 'fill-current')} />
          {toggle.label}
        </button>
      ))}
    </div>
  )
}
