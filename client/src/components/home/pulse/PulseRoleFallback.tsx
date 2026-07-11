import { useNavigate } from 'react-router-dom'
import { Users, Briefcase, Sparkles, ChevronRight } from 'lucide-react'
import { AuroraHero, HeroLabel } from './AuroraHero'
import { recordModuleImpression, trackModuleClick, useImpressionOnce } from '@/lib/homeInstrumentation'

/**
 * Holding hero for roles whose full Pulse ships in a later phase (club →
 * Phase 2, coach → Phase 3, brand → Phase 4). Never a blank tab: an honest
 * "coming" line PLUS the one real action that role most wants right now,
 * routed to the surface that already exists. Replaced wholesale when the
 * role's real hero lands.
 */
const MODULE_ID = 'pulse_role_fallback'

type Role = 'club' | 'coach' | 'brand' | 'umpire' | string

const COPY: Record<string, { headline: string; sub: string; cta: string; to: string; Icon: typeof Users }> = {
  club: {
    headline: 'Your recruiting week, at a glance — coming soon.',
    sub: 'Meanwhile, review who applied and keep your roles moving.',
    cta: 'Review applicants',
    to: '/dashboard',
    Icon: Users,
  },
  coach: {
    headline: 'Your coaching week, at a glance — coming soon.',
    sub: 'Meanwhile, find roles and manage who you’re recruiting.',
    cta: 'Go to your dashboard',
    to: '/dashboard',
    Icon: Briefcase,
  },
  brand: {
    headline: 'Your brand’s reach, at a glance — coming soon.',
    sub: 'Meanwhile, find athletes to partner with and manage your products.',
    cta: 'Go to your dashboard',
    to: '/dashboard',
    Icon: Sparkles,
  },
  umpire: {
    headline: 'Your umpiring week, at a glance — coming soon.',
    sub: 'Meanwhile, keep your profile and appointments up to date.',
    cta: 'Go to your dashboard',
    to: '/dashboard',
    Icon: Briefcase,
  },
}

export function PulseRoleFallback({ role }: { role: Role }) {
  const navigate = useNavigate()
  const copy = COPY[role] ?? COPY.coach
  const ref = useImpressionOnce(() => recordModuleImpression(MODULE_ID, 0))

  return (
    <div ref={ref} className="mb-6">
      <AuroraHero accent="#4f46e5">
        <HeroLabel>Your week on HOCKIA</HeroLabel>
        <h1 className="mt-2 text-xl font-black leading-tight">{copy.headline}</h1>
        <p className="mt-1 text-sm text-white/70">{copy.sub}</p>
        <button
          type="button"
          onClick={() => {
            trackModuleClick(MODULE_ID, 0)
            navigate(copy.to)
          }}
          className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-2xl bg-white/[0.14] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/20"
        >
          <copy.Icon className="h-4 w-4" />
          {copy.cta}
          <ChevronRight className="h-4 w-4" />
        </button>
      </AuroraHero>
    </div>
  )
}
