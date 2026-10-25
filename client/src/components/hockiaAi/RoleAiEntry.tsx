import { BetaPill } from './BetaPill'
import { ChevronRight } from 'lucide-react'
import type { Vacancy } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { positionLabel } from '@/lib/identity'
import { CHECK_PROFILE_AGAINST_ROLE } from '@/lib/hockiaAi'
import { MascotAvatar } from './mascot'
import { useHockiaAiSheet } from './hockiaAiSheetStore'

/**
 * "Ask Hockia AI about this role" (handoff B3, Figma 178:465): on an open
 * role, for players and coaches who didn't post it. Opens the Hockia AI sheet
 * with the role attached (B4): Check my profile against this role · Prepare my application · Life in
 * the city. The sheet itself is mounted once for the app (GlobalHockiaAiSheet).
 */
export function RoleAiEntry({ vacancy, clubName, clubLogo, className }: { vacancy: Vacancy; clubName: string | null; clubLogo: string | null; className?: string }) {
  const role = useAuthStore((s) => s.profile?.role)
  const askAboutRole = useHockiaAiSheet((s) => s.askAboutRole)
  if (role !== 'player' && role !== 'coach') return null
  const position = positionLabel(vacancy.position)
  const city = vacancy.location_city?.trim() || null
  const label = [position ?? vacancy.title, clubName].filter(Boolean).join(' · ')
  return (
      <button
        type="button"
        onClick={() => askAboutRole({ id: vacancy.id, title: vacancy.title, organization: clubName, logoUrl: clubLogo, city, label })}
        className={className ?? 'flex w-full items-center gap-3 rounded-[16px] border border-brand-primary/25 bg-brand-soft px-3.5 py-2.5 text-left'}
        data-testid="role-ask-ai"
      >
        <MascotAvatar size={36} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[15px] font-semibold leading-5 text-ink-1">Ask Hockia AI about this opportunity <BetaPill onSoft testId="role-ask-ai-beta" /></span>
          <span className="block truncate text-caption text-ink-2">{[CHECK_PROFILE_AGAINST_ROLE, 'Prepare my application', city ? `Life in ${city}` : null].filter(Boolean).join(' · ')}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-brand-primary" strokeWidth={2} />
      </button>
  )
}
