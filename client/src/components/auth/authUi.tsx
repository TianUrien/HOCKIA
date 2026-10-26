import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/ui/IconButton'
import { webButtonClassName } from '@/components/ui/buttonClasses'
import { BackGlyph } from '@/components/ui/BackGlyph'

/**
 * Pieces shared by the account-first auth and onboarding screens (Figma 04
 * Player: First run 104:2096, Log in 114:477, Create with email 114:434,
 * Choose your role 101:892, Set up 114:537 / 114:608). Phone-first: a white
 * full-height page with a 16 px gutter and safe-area padding; on wider screens
 * the same column sits centred at 448 px so desktop keeps working.
 */
/* Field header + Text field classes live in `ui/fieldClasses.ts` (shared with
   the pickers' 'field' appearance); this file exports components only. */

interface AuthShellProps {
  children: ReactNode
  /** Back chevron — accessible name "Back to <parent>". Omit for root screens. */
  back?: { parent: string; onBack: () => void }
  /** Centred nav-bar title (17/semibold). */
  title?: string
  /** One trailing text action in the nav bar ("Skip"). */
  trailing?: ReactNode
  /** Step progress "Step 1 of 2" above the content (Figma Step progress 472:159). */
  step?: { current: number; total: number }
  className?: string
}

export function AuthShell({ children, back, title, trailing, step, className }: AuthShellProps) {
  return (
    <div className="flex min-h-app-screen flex-col bg-white pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),16px)]">
      {(back || title || trailing) && (
        <div className="relative mx-auto flex h-11 w-full max-w-md items-center justify-between px-2">
          {back ? (
            // Nav bar back = Ghost icon button 44 (Figma 459:171) with the chevron.
            <IconButton label={`Back to ${back.parent}`} tone="brand" onClick={back.onBack}>
              <BackGlyph className="h-6 w-6" strokeWidth={2} />
            </IconButton>
          ) : (
            <span className="w-11" />
          )}
          {title && (
            <h1 className="pointer-events-none absolute inset-x-16 truncate text-center text-body font-semibold text-ink-1">{title}</h1>
          )}
          {trailing ? <div className="flex h-11 items-center pr-2">{trailing}</div> : <span className="w-11" />}
        </div>
      )}
      {step && (
        <div className="mx-auto w-full max-w-md px-4 pt-2" aria-label={`Step ${step.current} of ${step.total}`}>
          <div className="flex gap-1.5" aria-hidden="true">
            {Array.from({ length: step.total }, (_, i) => (
              <span key={i} className={cn('h-1 flex-1 rounded-full', i < step.current ? 'bg-hockia-primary' : 'bg-line')} />
            ))}
          </div>
          <p className="mt-2 text-caption font-semibold uppercase tracking-[0.04em] text-ink-3">
            Step {step.current} of {step.total}
          </p>
        </div>
      )}
      <main className={cn('mx-auto flex w-full max-w-md flex-1 flex-col px-4', className)}>{children}</main>
    </div>
  )
}

/** "By continuing, you agree to our Terms and Privacy Policy."
 *  `tone="web"` = the Landing v3 auth card cut (13/18, ink-3, underlined links). */
export function TermsLine({ className, tone = 'app' }: { className?: string; tone?: 'app' | 'web' }) {
  const link = tone === 'web' ? 'underline underline-offset-2 hover:text-ink-1' : 'text-ink-2 underline underline-offset-2'
  return (
    <p className={cn('text-center', tone === 'web' ? 'text-[13px] leading-[18px] text-ink-3' : 'text-caption leading-4 text-ink-3', className)}>
      By continuing, you agree to our{' '}
      <Link to="/terms" className={link}>Terms</Link>
      {' '}and{' '}
      <Link to="/privacy-policy" className={link}>Privacy Policy</Link>.
    </p>
  )
}

/* ─────────────────── Auth layout (rebrand page 26) ───────────────────
 * Phones: a 56 top bar with the back chevron only, content at 24 px gutters,
 * the terms and switch lines pinned to the bottom (safe-area aware).
 * 768–1023: the same column in a white card on the subtle page (unchanged).
 * 1024 and up: the split layout — the photo panel on the left (lockup, halo,
 * the two players, the tagline) and the 400 px form on the right.
 */

interface AuthPageProps {
  children: ReactNode
  /** "Already a member? Log in" — pinned to the bottom / under the form. */
  switchLine: ReactNode
  /** Terms line shown above the switch line in the footer (Join, Create with email). */
  footerNote?: ReactNode
  /** Phone top-bar back chevron. Omit when there is nowhere to go (native first run). */
  onBack?: () => void
  /** Accessible name of the back chevron, "Back to <parent>". */
  backLabel?: string
  className?: string
}

export function AuthPage({ children, switchLine, footerNote, onBack, backLabel = 'Back', className }: AuthPageProps) {
  return (
    <div className="flex min-h-app-screen bg-white pt-[env(safe-area-inset-top)] md:bg-surface-subtle lg:bg-white lg:pt-0">
      <AuthPhotoPanel />
      <div className="flex w-full flex-col lg:w-1/2">
        {/* Phone top bar (56): back only */}
        <div className="relative flex h-14 shrink-0 items-center px-2 md:hidden">
          {onBack ? (
            <IconButton label={backLabel} tone="brand" onClick={onBack}>
              <BackGlyph className="h-6 w-6" strokeWidth={2} />
            </IconButton>
          ) : (
            <span className="w-11" />
          )}
        </div>

        {/* Tablet header (72); the photo panel carries the logo from 1024 up */}
        <header className="mx-auto hidden h-[72px] w-full max-w-[1280px] shrink-0 items-center justify-between px-10 md:flex lg:hidden">
          <Link to="/" aria-label="Hockia home" className="flex items-center rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
            <img src="/brand/lockup/hockia-lockup-horizontal-ink.svg" alt="" width={136} height={28} className="h-7 w-auto" />
          </Link>
          <Link to="/" className={webButtonClassName({ variant: 'link', size: 'medium' })}>
            Back to home
          </Link>
        </header>

        <main className={cn('flex w-full flex-1 flex-col md:items-center md:justify-center md:px-6 md:py-10', className)}>
          <div className="flex w-full flex-1 flex-col px-6 pt-2 md:w-[440px] md:flex-none md:rounded-panel md:border md:border-line md:bg-white md:p-10 md:shadow-[0_12px_32px_rgba(15,15,20,0.06)] lg:w-[400px] lg:border-0 lg:p-0 lg:shadow-none">
            {children}
          </div>
          <div className="mt-auto flex flex-col gap-3 px-6 pb-[max(env(safe-area-inset-bottom),24px)] pt-8 md:mt-8 md:w-[440px] md:p-0 lg:mt-6 lg:w-[400px]">
            {footerNote}
            <p className="text-center text-[15px] leading-[21px] text-ink-2">{switchLine}</p>
          </div>
        </main>
      </div>
    </div>
  )
}

/** Web photo panel (rebrand page 26 · Web, 720 × 900 design): positions are
 *  percentages of the panel so the composition holds at any desktop size. */
function AuthPhotoPanel() {
  return (
    <aside className="relative hidden w-1/2 shrink-0 overflow-hidden bg-gradient-to-b from-purple-50 to-surface-subtle lg:block" aria-hidden="true">
      <img src="/native/welcome-halo.svg" alt="" className="absolute aspect-square max-w-none" style={{ left: '13.9%', top: '16.7%', width: '72.2%' }} draggable={false} />
      <img src="/native/player-man-fullbody.webp" alt="" width={587} height={620} className="absolute max-w-none object-contain" style={{ left: '9.7%', top: '29%', width: '57.2%', height: '48.2%' }} draggable={false} />
      <img src="/native/player-woman-fullbody.webp" alt="" width={476} height={920} className="absolute max-w-none object-contain" style={{ left: '38.1%', top: '15.3%', width: '46.3%', height: '71.6%' }} draggable={false} />
      <div className="absolute inset-x-0 bottom-0 h-[38%] bg-gradient-to-b from-surface-subtle/0 to-surface-subtle to-[60%]" />
      <Link to="/" aria-label="Hockia home" tabIndex={-1} className="pointer-events-auto absolute left-16 top-14">
        <img src="/brand/lockup/hockia-lockup-horizontal-ink.svg" alt="" width={157} height={32} className="h-8 w-auto" />
      </Link>
      <p className="absolute bottom-16 left-16 max-w-[520px] font-display text-[40px] font-bold leading-[1.1] tracking-[-0.035em] text-ink-1">
        Where field hockey sticks together.
      </p>
    </aside>
  )
}

/** Heading (rebrand page 26): the large title and the 17 px subtitle. */
export function AuthHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col pt-2">
      <h1 className="text-large-title text-ink-1">{title}</h1>
      {subtitle && <p className="mt-3 text-[17px] leading-[22px] text-ink-2">{subtitle}</p>}
    </div>
  )
}

/** The "or" divider between the providers and email. */
export function OrDivider() {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-line" />
      <span className="text-caption text-ink-3">or</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}

/** Status screen body (rebrand page 26 · recovery & email links): an 88 icon
 *  disc, the title, one line or two, and the actions pinned to the bottom.
 *  `tone`: positive = a real success, brand = a soft violet note, neutral = info. */
export function AuthStatus({ icon, tone = 'neutral', title, children, actions }: { icon: ReactNode; tone?: 'positive' | 'brand' | 'neutral'; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  const disc = tone === 'positive' ? 'bg-positive-soft text-positive' : tone === 'brand' ? 'bg-hockia-soft text-hockia-primary' : 'bg-surface-muted text-ink-2'
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <span className={cn('flex h-[88px] w-[88px] items-center justify-center rounded-full', disc)} aria-hidden="true">{icon}</span>
        <h1 className="mt-8 text-title text-ink-1">{title}</h1>
        {children && <div className="mt-3 text-[17px] leading-[22px] text-ink-2">{children}</div>}
      </div>
      {actions && <div className="space-y-3 pt-8">{actions}</div>}
    </div>
  )
}

/** Inline error under a form (role="alert"). */
export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p className="rounded-[12px] bg-status-danger-soft px-3.5 py-2.5 text-secondary text-status-danger" role="alert">
      {children}
    </p>
  )
}
