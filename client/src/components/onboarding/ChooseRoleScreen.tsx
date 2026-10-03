import { useState } from 'react'
import { Check } from 'lucide-react'
import { AuthShell, FormError } from '@/components/auth/authUi'
import { Button } from '@/components/ui/Button'
import { ONBOARDING_ROLES, ROLE_CARDS, ROLE_LOCK_COPY, roleCtaLabel, type OnboardingRole } from '@/lib/onboardingV2'
import { cn } from '@/lib/utils'

/**
 * Choose your role (Figma 04 Player 101:892) — shown right after the account
 * exists (email verification or OAuth return) and before any set-up. Option
 * cards (460:40) for player / coach / club / brand / umpire, one line each,
 * then the single Primary "Continue as a <role>". The role is locked after
 * this (prevent_role_change): the copy says so.
 *
 * Mounted by CompleteProfile when no role is known yet; `onSelect` creates
 * the profile row (create_profile_for_new_user) and fires `role_selected`.
 */
interface ChooseRoleScreenProps {
  onSelect: (role: OnboardingRole) => void | Promise<void>
  busy?: boolean
  error?: string | null
}

export default function ChooseRoleScreen({ onSelect, busy = false, error }: ChooseRoleScreenProps) {
  const [role, setRole] = useState<OnboardingRole | null>(null)

  return (
    <AuthShell>
      <div className="pt-6">
        <h1 className="text-title text-ink-1">Choose your role</h1>
        <p className="mt-1.5 text-row text-ink-2">{ROLE_LOCK_COPY}</p>
      </div>
      <div role="radiogroup" aria-label="Role" className="mt-6 space-y-2.5">
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
                'flex min-h-[64px] w-full items-center gap-3 rounded-card px-4 py-3 text-left transition-colors disabled:opacity-60',
                selected ? 'bg-hockia-soft ring-2 ring-inset ring-hockia-primary' : 'bg-surface-grouped active:bg-surface-muted-pressed',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold text-ink-1">{card.title}</span>
                <span className="block text-secondary text-ink-2">{card.detail}</span>
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                  selected ? 'bg-hockia-primary text-white' : 'ring-1 ring-inset ring-line',
                )}
              >
                {selected && <Check className="h-4 w-4" strokeWidth={2.5} />}
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-auto space-y-3 pt-8">
        <FormError>{error}</FormError>
        <Button block loading={busy} disabled={!role || !ONBOARDING_ROLES.includes(role)} onClick={() => role && void onSelect(role)}>
          {roleCtaLabel(role)}
        </Button>
      </div>
    </AuthShell>
  )
}
