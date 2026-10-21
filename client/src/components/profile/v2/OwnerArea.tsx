import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Award, BookOpen, Briefcase, CalendarDays, Camera, ChevronRight, CircleCheck, Crosshair, Eye, FileText, Flag, Image as ImageIcon, Images,
  Landmark, Link2, Lock, Mail, MapPin, Medal, MessageSquare, Pencil, PenLine, Route, Shield, Sparkles, Trophy, UserPlus, Video,
  type LucideIcon,
} from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { SquircleBox } from '@/components/home/v1/primitives'
import { cn } from '@/lib/utils'

/**
 * Own profile, under the hero (Figma PR2 101:46): Edit profile + Preview as…
 * (secondary 44) → ONE primary card (the next step) → private stats marked
 * "only you".
 */
export function OwnerButtons({ onEdit, previews }: {
  onEdit: () => void
  /** "Preview as…" options (PR3): e.g. "Someone on Hockia", "A club". */
  previews: Array<{ key: string; label: string; detail: string; onSelect: () => void }>
}) {
  const [open, setOpen] = useState(false)
  const btn = 'flex h-11 flex-1 items-center justify-center gap-2 rounded-full border border-line bg-white text-[15px] font-semibold text-ink-1 transition-transform duration-300 active:scale-[0.97]'
  return (
    <div className="flex gap-2.5 px-4 pt-4">
      <button type="button" onClick={onEdit} className={btn} data-testid="profile-edit"><Pencil className="h-4 w-4" strokeWidth={1.8} /> Edit profile</button>
      <button type="button" onClick={() => setOpen(true)} className={btn} data-testid="profile-preview-as"><Eye className="h-4 w-4" strokeWidth={1.8} /> Preview as…</button>
      <BottomSheet open={open} onClose={() => setOpen(false)} ariaLabel="Preview as">
        <div className="px-5 pb-4 pt-1">
          <h2 className="pb-3 text-body font-semibold text-ink-1">Preview your profile as…</h2>
          <div className="divide-y divide-line overflow-hidden rounded-card bg-surface-grouped">
            {previews.map((p) => (
              <button key={p.key} type="button" onClick={() => { setOpen(false); p.onSelect() }} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block text-body text-ink-1">{p.label}</span>
                  <span className="block text-secondary text-ink-2">{p.detail}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} />
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setOpen(false)} className="mt-2.5 flex h-11 w-full items-center justify-center text-body font-semibold text-ink-1">Cancel</button>
        </div>
      </BottomSheet>
    </div>
  )
}

/** Icon per next-step part (audit A2: the next missing item, never a %). */
const STEP_ICONS: Record<string, LucideIcon> = {
  photo: Camera, crest: Shield, logo: ImageIcon, position: Crosshair, current_club: Shield, league: Trophy,
  passport: BookOpen, base_location: MapPin, video: Video, open_to_play: CircleCheck, availability: CalendarDays,
  bio: PenLine, career: Route, references: Award, work_permit: FileText, nationality_base: Flag,
  specialization: Crosshair, gallery: Images, friends: UserPlus, open_to_coach: CircleCheck, level: Medal,
  federation: Landmark, available: CircleCheck, appointments: CalendarDays, country: Flag, year_founded: CalendarDays,
  contact: Mail, media: Images, posts: MessageSquare, links: Link2, ambassadors: UserPlus,
}

/** The next missing item's own icon in a white tile. */
export function NextStepIcon({ stepKey }: { stepKey: string }) {
  const Icon = STEP_ICONS[stepKey] ?? Sparkles
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-white text-hockia-primary" aria-hidden="true" data-testid="next-step-icon">
      <Icon className="h-6 w-6" strokeWidth={1.8} />
    </span>
  )
}

/** The ONE primary card: the next step (ring + copy + CTA), or a role-specific card (applicants …). */
export function PrimaryCard({ stepKey, title, subtitle, cta, onAction, visual, secondary = false }: {
  /** The next missing part's key: shows that item's icon (never a completeness %). */
  stepKey?: string | null
  title: string
  subtitle: string
  cta: string
  onAction: () => void
  /** Replaces the step icon (e.g. applicant faces). */
  visual?: ReactNode
  /** Another card owns the screen's one primary button: white pill, brand text. */
  secondary?: boolean
}) {
  return (
    <div className="px-4 pt-3">
      <SquircleBox className="flex items-center gap-3 bg-hockia-soft px-4 py-3.5" >
        {visual ?? (stepKey ? <NextStepIcon stepKey={stepKey} /> : null)}
        <span className="min-w-0 flex-1">
          <span className="block line-clamp-2 text-body font-semibold text-ink-1">{title}</span>
          <span className="block line-clamp-2 text-secondary text-ink-2">{subtitle}</span>
        </span>
        <button
          type="button"
          onClick={onAction}
          className={cn('flex h-11 min-w-[58px] shrink-0 items-center justify-center rounded-full px-4 text-[14px] font-semibold transition-transform duration-300 active:scale-[0.97]', secondary ? 'bg-white text-hockia-primary' : 'bg-hockia-primary text-white')}
          data-testid="profile-primary-cta"
        >
          {cta}
        </button>
      </SquircleBox>
    </div>
  )
}

/** Private stats (🔒 only you). Hidden until there is data (spec: stats hidden until there's data). */
export function PrivateStats({ stats, emptyText }: { stats: Array<{ value: number; label: string }>; /** PR25: one quiet line instead of nothing while every stat is 0. */ emptyText?: string }) {
  if (stats.every((s) => s.value === 0)) {
    return emptyText ? (
      <p className="flex items-center gap-1 px-4 pt-3 text-caption text-ink-3" data-testid="profile-private-stats-empty">
        <Lock className="h-3 w-3" strokeWidth={2} aria-hidden="true" /> {emptyText}
      </p>
    ) : null
  }
  return (
    <div className="px-4 pt-3" data-testid="profile-private-stats">
      <div className="flex divide-x divide-line rounded-[20px] border border-line bg-white">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-1 flex-col items-center py-3">
            <span className="text-title tabular-nums text-ink-1">{s.value}</span>
            <span className="text-caption text-ink-2">{s.label}</span>
          </div>
        ))}
      </div>
      <Link to="/pulse" className={cn('mt-2 flex min-h-[32px] items-center gap-1 text-caption text-ink-3')}>
        <Lock className="h-3 w-3" strokeWidth={2} aria-hidden="true" /> Only you see this · Your activity <ChevronRight className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
      </Link>
    </div>
  )
}

/**
 * Recruiting card (Figma PR7 / PR12, owner only) for clubs and recruiting
 * coaches. One primary per screen: with applicants to review it owns the
 * filled button; otherwise it goes white and the next-step card keeps it.
 * No review CTA when there is nothing to review.
 */
export function RecruitingCard({ pending, openRoleCount, roleNames, hasNextStep, onReview, onPostRole, testId }: {
  pending: number
  openRoleCount: number
  roleNames: string[]
  hasNextStep: boolean
  onReview: () => void
  onPostRole: () => void
  testId?: string
}) {
  const recruiting = openRoleCount > 0
  const toReview = recruiting && pending > 0
  const names = [...new Set(roleNames.filter(Boolean))].slice(0, 2).join(', ')
  return (
    <div className="px-4">
      <div className={cn('flex flex-col gap-3 rounded-[24px] p-4', toReview ? 'bg-hockia-soft' : 'border border-line bg-white')} data-testid={testId ?? 'recruiting-card'}>
        <div className="flex items-center gap-3">
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-hockia-primary', toReview ? 'bg-white' : 'bg-hockia-soft')}><Briefcase className="h-5 w-5" strokeWidth={1.8} /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">
              {toReview ? `${pending} ${pending === 1 ? 'applicant' : 'applicants'} to review` : recruiting ? 'No new applicants' : 'Not recruiting right now'}
            </span>
            <span className="block truncate text-secondary text-ink-2">
              {recruiting ? `${openRoleCount} open ${openRoleCount === 1 ? 'role' : 'roles'}${names ? ` · ${names}` : ''}` : 'Post a role and players can apply'}
            </span>
          </span>
        </div>
        <div className="flex gap-2.5">
          {toReview && (
            <button type="button" onClick={onReview} className="flex h-11 flex-1 items-center justify-center rounded-full bg-hockia-primary text-[16px] font-semibold text-white">Review applicants</button>
          )}
          <button type="button" onClick={onPostRole} className={cn('flex h-11 items-center justify-center rounded-full px-4 text-[16px] font-semibold', toReview ? 'bg-white text-hockia-primary' : hasNextStep ? 'border border-line bg-white text-hockia-primary' : 'flex-1 bg-hockia-primary text-white')}>+ Post a role</button>
          {recruiting && !toReview && (
            <button type="button" onClick={onReview} className="flex h-11 items-center px-2 text-[16px] font-semibold text-hockia-primary">View roles</button>
          )}
        </div>
      </div>
    </div>
  )
}
