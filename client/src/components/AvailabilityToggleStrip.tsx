import { useState } from 'react'
import { Zap } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { TablesUpdate } from '@/lib/database.types'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import InfoTooltip from './InfoTooltip'
import { useProfileEditT } from '@/i18n/ns/profileEdit'

/** The profile columns this strip can flip. */
type AvailabilityField =
  | 'available_for_appointments'
  | 'open_to_opportunities'
  | 'open_to_play'
  | 'open_to_coach'

interface AvailabilityToggleStripProps {
  role: 'player' | 'coach' | 'club' | 'brand' | 'umpire'
}

/**
 * AvailabilityToggleStrip — one-tap availability toggles, shown on own
 * dashboard only. Role-aware:
 *   player → open_to_play + open_to_opportunities
 *   coach  → open_to_coach + open_to_opportunities
 *   club   → open_to_opportunities ("Recruiting")
 *   brand  → open_to_opportunities ("Open to partnerships")
 *   umpire → available_for_appointments (the dedicated umpire flag)
 *
 * These booleans are high-value AI search fields + drive the Community card's
 * availability chip, but are otherwise buried in the edit form. This strip
 * makes them zero-friction. It owns the persistence so every surface mutates
 * through one place.
 */
export default function AvailabilityToggleStrip({ role }: AvailabilityToggleStripProps) {
  const { profile, setProfile } = useAuthStore()
  const { addToast } = useToastStore()
  const t = useProfileEditT()
  const [saving, setSaving] = useState<string | null>(null)

  if (!profile) return null

  type Toggle = {
    id: AvailabilityField
    label: string
    active: boolean
    activeGradient: string
    /** Optional tooltip explainer shown next to the label. */
    tooltip?: string
  }

  let toggles: Toggle[]
  if (role === 'umpire') {
    // Umpires use the dedicated available_for_appointments flag (the generic
    // open_to_opportunities is player/coach-framed and isn't read for umpires).
    toggles = [{
      id: 'available_for_appointments',
      label: t('availabilityStrip.umpire'),
      active: Boolean(profile.available_for_appointments),
      activeGradient: 'from-role-umpire-ink to-role-umpire-ink',
      tooltip: t('availabilityStrip.umpireTip'),
    }]
  } else if (role === 'club' || role === 'brand') {
    // Orgs have a single availability flag: open_to_opportunities.
    toggles = [{
      id: 'open_to_opportunities',
      label: role === 'club' ? t('availabilityStrip.club') : t('availabilityStrip.brand'),
      active: Boolean(profile.open_to_opportunities),
      activeGradient: role === 'club' ? 'from-role-club-ink to-role-club-ink' : 'from-role-brand-ink to-role-brand-ink',
      tooltip:
        role === 'club'
          ? t('availabilityStrip.clubTip')
          : t('availabilityStrip.brandTip'),
    }]
  } else {
    toggles = [
      role === 'player'
        ? {
            id: 'open_to_play',
            label: t('availabilityStrip.play'),
            active: Boolean(profile.open_to_play),
            activeGradient: 'from-status-positive to-status-positive',
            tooltip: t('availabilityStrip.playTip'),
          }
        : {
            id: 'open_to_coach',
            label: t('availabilityStrip.coach'),
            active: Boolean(profile.open_to_coach),
            activeGradient: 'from-role-coach-ink to-role-coach-ink',
            tooltip: t('availabilityStrip.coachTip'),
          },
      {
        id: 'open_to_opportunities',
        label: t('availabilityStrip.opportunities'),
        active: Boolean(profile.open_to_opportunities),
        activeGradient: 'from-brand-primary to-brand-primary',
        tooltip:
          role === 'player'
            ? t('availabilityStrip.playerOpportunitiesTip')
            : t('availabilityStrip.coachOpportunitiesTip'),
      },
    ]
  }

  const handleToggle = async (field: AvailabilityField, currentValue: boolean) => {
    if (saving) return
    setSaving(field)

    const newValue = !currentValue
    const patch: TablesUpdate<'profiles'> = {}
    patch[field] = newValue
    try {
      const { error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', profile.id)

      if (error) throw error

      setProfile({ ...profile, [field]: newValue })
    } catch (err) {
      logger.error('[AVAILABILITY] Toggle failed', { field, err })
      addToast(t('availabilityStrip.saveFailed'), 'error')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-medium text-gray-500 mr-0.5">{t('availabilityStrip.intro')}</span>
      {toggles.map(toggle => (
        <div key={toggle.id} className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleToggle(toggle.id, toggle.active)}
            disabled={saving === toggle.id}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all duration-200',
              toggle.active
                ? `bg-gradient-to-r ${toggle.activeGradient} text-white shadow-sm`
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              saving === toggle.id && 'opacity-60'
            )}
          >
            <Zap className={cn('w-3 h-3', toggle.active && 'fill-current')} />
            {toggle.label}
          </button>
          {toggle.tooltip && (
            <InfoTooltip
              label={t('availabilityStrip.tooltipLabel', { label: toggle.label })}
              triggerClassName="h-5 w-5 text-gray-400 hover:text-gray-700"
              iconClassName="h-3.5 w-3.5"
            >
              {toggle.tooltip}
            </InfoTooltip>
          )}
        </div>
      ))}
    </div>
  )
}
