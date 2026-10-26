import { useState } from 'react'
import { CheckIcon } from '@/components/icons/HockiaIcons'
import { AuthShell, FormError } from '@/components/auth/authUi'
import { Button } from '@/components/ui/Button'
import { ONBOARDING_ROLES, ROLE_CARDS, ROLE_LOCK_COPY, roleCtaLabel, type OnboardingRole } from '@/lib/onboardingV2'
import { cn } from '@/lib/utils'
import { SetupSignOut } from './SetupSignOut'

/**
 * Choose your role (rebrand page 26; was Figma 04 Player 101:892) — shown
 * right after the account exists (email verification or OAuth return) and
 * before any set-up. White option cards with the role's colour dot, title and
 * one line, then the single Primary "Continue as a <role>". Selected = 2 px
 * violet border and a check. The role is locked after this (prevent_role_change): the
 * copy says so.
 *
 * Mounted by CompleteProfile when no role is known yet; `onSelect` creates
 * the profile row (create_profile_for_new_user) and fires `role_selected`.
 */
/** Role colour dots (role tokens, rebrand 2026-10-25). */
const ROLE_DOT: Record<OnboardingRole, string> = {
  player: 'bg-role-player-ink',
  coach: 'bg-role-coach-ink',
  club: 'bg-role-club-ink',
  brand: 'bg-role-brand-ink',
  umpire: 'bg-role-umpire-ink',
}

interface ChooseRoleScreenProps {
  onSelect: (role: OnboardingRole) => void | Promise<void>
  busy?: boolean
  error?: string | null
  /** Shown when the session expired mid-signup: sign out and back in to finish. */
  onSignInAgain?: () => void
}

export default function ChooseRoleScreen({ onSelect, busy = false, error, onSignInAgain }: ChooseRoleScreenProps) {
  const [role, setRole] = useState<OnboardingRole | null>(null)

  return (
    <AuthShell trailing={<SetupSignOut />}>
      <div className="pt-2">
        <h1 className="text-title text-ink-1">Choose your role</h1>
        <p className="mt-2 text-[17px] leading-[22px] text-ink-2">This shapes your profile and what Hockia shows you. {ROLE_LOCK_COPY}</p>
      </div>
      {/* Rebrand page 26 · Choose your role: white option cards with the
          role's colour dot; selected = 2 px violet border and a check. */}
      <div role="radiogroup" aria-label="Role" className="mt-6 space-y-2">
        {ROLE_CARDS.map((card) => {
          const selected = role === card.role
          return (
            <button
              key={card.role}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={busy}
              onClick={() => setRole(card.role)}
              className={cn(
                'flex min-h-[58px] w-full items-center gap-3 rounded-[18px] bg-white px-3.5 py-2 text-left transition-colors disabled:opacity-60',
                selected ? 'ring-2 ring-inset ring-brand-primary' : 'ring-1 ring-inset ring-line active:bg-surface-muted',
              )}
            >
              <span aria-hidden="true" data-testid={`role-icon-${card.role}`} className={cn('h-3 w-3 shrink-0 rounded-full', ROLE_DOT[card.role])} />
              <span className="min-w-0 flex-1">
                <span className="block font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">{card.title}</span>
                <span className="block text-[12px] font-medium leading-[1.3] text-ink-2">{card.detail}</span>
              </span>
              {selected && <CheckIcon className="h-6 w-6 shrink-0 text-brand-primary" />}
            </button>
          )
        })}
      </div>
      <div className="mt-auto space-y-3 pt-8">
        <FormError>{error}</FormError>
        {onSignInAgain && (
          <Button block variant="secondary" onClick={onSignInAgain} data-testid="sign-in-again">Sign in again</Button>
        )}
        <Button block loading={busy} disabled={!role || !ONBOARDING_ROLES.includes(role)} onClick={() => role && void onSelect(role)}>
          {roleCtaLabel(role)}
        </Button>
      </div>
    </AuthShell>
  )
}
