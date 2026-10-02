import { lazy, Suspense, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { supabase, type Vacancy } from '@/lib/supabase'
import { useToastStore } from '@/lib/toast'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { compensationText, whenLine } from '@/lib/opportunityCopy'
import { firstNameOf, inviteCardState, inviteRoleLabel } from '@/lib/invites'
import { INVITES_KEY, inviteCardKey, useDeclineInvite, useInviteCard, type InviteCardData } from '@/hooks/useInvites'
import { cn } from '@/lib/utils'

// The normal Apply sheet (readiness check included), loaded only when Apply is tapped.
const ApplyToOpportunityModal = lazy(() => import('@/components/ApplyToOpportunityModal'))

/**
 * D3.3 · Invitation in chat (Figma 393:351; DEV NOTE 394:107). The invite
 * lands in the conversation with the club: the role, what it offers, the
 * note, then View role, Apply or Not interested. No fit, no applicant count.
 * Apply opens the normal Apply sheet with the note empty; the readiness check
 * still runs, and the server tags the application with the invite. Not
 * interested → respond_invite(decline); the club sees "<name> passed on this
 * role". Expired / role closed → the card greys out.
 *
 * The club (sender) sees the same card with a grey status line instead of
 * the actions ("Invitation pending", "<name> applied" — founder ruling
 * 2026-09-26: grey for the club; the player's own "Applied" is grey too). If the invite can't be read, the plain message text shows instead.
 */
interface Props {
  inviteId: string
  opportunityId: string
  /** The viewer sent the card (the club); otherwise the viewer is the invited player. */
  isMine: boolean
  fallbackText: string
}

function leagueFor(club: InviteCardData['club'], gender: string | null): string | null {
  const women = gender === 'Women' || gender === 'Girls'
  const men = club.mens_league_division?.trim() || null
  const wom = club.womens_league_division?.trim() || null
  return (women ? wom ?? men : men ?? wom) ?? null
}

function packageLine(benefits: string[] | null): string | null {
  const labels = (benefits ?? []).map((b) => b.trim()).filter(Boolean).map((b) => b.charAt(0).toUpperCase() + b.slice(1).toLowerCase())
  return labels.length ? [...new Set(labels)].join(' · ') : null
}

export default function InviteCard({ inviteId, opportunityId, isMine, fallbackText }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const { data, loading } = useInviteCard(inviteId, opportunityId)
  const { decline, busy } = useDeclineInvite()
  const [confirmPass, setConfirmPass] = useState(false)
  const [applyVacancy, setApplyVacancy] = useState<Vacancy | null>(null)
  const [opening, setOpening] = useState(false)

  if (loading) {
    return <div className="h-[260px] w-full animate-pulse rounded-card bg-surface-grouped" data-testid="invite-card-loading" />
  }
  if (!data) {
    return (
      <div className="rounded-card bg-surface-grouped px-3.5 py-2.5 text-[15px] leading-5 text-ink-1">
        <p className="whitespace-pre-wrap break-words" style={{ overflowWrap: 'anywhere' }}>{fallbackText}</p>
      </div>
    )
  }

  const { invite, role, club } = data
  const viewer = isMine ? 'club' : 'player'
  const state = inviteCardState({
    viewer,
    status: invite.status,
    expiresAt: invite.expires_at,
    roleOpen: role.status === 'open',
    playerFirstName: firstNameOf(data.playerName, 'The player'),
  })
  const when = role.start_date ? `From ${whenLine(role)}` : whenLine(role)
  const league = leagueFor(club, role.gender)
  const pkg = packageLine(role.benefits)
  const facts: [string, string | null][] = [
    ['When', when],
    ['Pay', compensationText(role)],
    ['Package', pkg],
    ['League', league],
  ]

  const viewRole = () => navigate(`/opportunities/${role.id}`)
  const apply = async () => {
    setOpening(true)
    try {
      const { data: vacancy, error } = await supabase.from('opportunities').select('*').eq('id', role.id).maybeSingle()
      if (error || !vacancy) {
        if (error) reportSupabaseError('InviteCard.openApply', error)
        addToast('Couldn’t open the role. Please try again.', 'error')
        return
      }
      setApplyVacancy(vacancy as Vacancy)
    } finally {
      setOpening(false)
    }
  }
  const onApplied = () => {
    // The server marks the invite applied when the application arrives.
    queryClient.setQueryData<InviteCardData | null>(inviteCardKey(invite.id), (d) => (d ? { ...d, invite: { ...d.invite, status: 'applied' } } : d))
    void queryClient.invalidateQueries({ queryKey: INVITES_KEY })
  }

  return (
    <div
      className={cn('w-full rounded-card border-[1.5px] bg-white p-4', state.muted ? 'border-line' : 'border-hockia-primary')}
      data-testid="invite-card"
      data-state={invite.status}
    >
      <p className={cn('text-[14px] font-semibold leading-5', state.muted ? 'text-ink-3' : 'text-hockia-primary')}>Invitation to apply</p>
      <h3 className={cn('pt-1 text-xl font-bold leading-6 tracking-[-0.2px]', state.muted ? 'text-ink-3' : 'text-ink-1')}>{inviteRoleLabel(role)}</h3>
      <dl className="mt-2.5 flex flex-col gap-2">
        {facts.filter(([, v]) => !!v).map(([label, value]) => (
          <div key={label} className="flex gap-3 text-[15px] leading-5">
            <dt className="w-[72px] shrink-0 text-ink-2">{label}</dt>
            <dd className={cn('min-w-0 flex-1', state.muted ? 'text-ink-3' : 'text-ink-1')}>{value}</dd>
          </div>
        ))}
      </dl>
      {invite.note && (
        <p className={cn('mt-3 whitespace-pre-wrap break-words rounded-card bg-surface-grouped px-3.5 py-3 text-[15px] leading-[21px]', state.muted ? 'text-ink-3' : 'text-ink-1')} style={{ overflowWrap: 'anywhere' }} data-testid="invite-card-note">
          {invite.note}
        </p>
      )}

      {state.actionable ? (
        <>
          <div className="mt-3.5 flex gap-2.5">
            <button type="button" onClick={viewRole} className="flex h-11 flex-1 items-center justify-center rounded-full border border-line bg-white text-[16px] font-semibold text-ink-1" data-testid="invite-view-role">
              View role
            </button>
            <button type="button" onClick={() => void apply()} disabled={opening} className="flex h-11 flex-1 items-center justify-center rounded-full bg-hockia-primary text-[16px] font-semibold text-white disabled:opacity-60" data-testid="invite-apply">
              {opening ? 'Opening…' : 'Apply'}
            </button>
          </div>
          <button type="button" onClick={() => setConfirmPass(true)} disabled={busy} className="mt-1 flex min-h-11 w-full items-center justify-center text-[15px] font-semibold text-ink-2 disabled:opacity-60" data-testid="invite-not-interested">
            Not interested
          </button>
        </>
      ) : (
        <div className="mt-3.5 flex items-center justify-between gap-3">
          {state.line && (
            <span
              className="inline-flex items-center rounded-full bg-surface-grouped px-3 py-1.5 text-secondary font-semibold text-ink-2"
              data-testid="invite-card-status"
              data-tone={state.tone}
            >
              {state.line}
            </span>
          )}
          <button type="button" onClick={viewRole} className="-my-1.5 inline-flex min-h-11 shrink-0 items-center text-[15px] font-semibold text-hockia-primary">View role</button>
        </div>
      )}

      {/* A sheet like every other D3/D4 confirmation; BottomSheet portals itself, so the bubble's `contain: paint` can't clip it. */}
      <ConfirmSheet
        open={confirmPass}
        onClose={() => setConfirmPass(false)}
        onConfirm={async () => { await decline(invite.id) }}
        title="Not interested in this role?"
        message={`${club.full_name?.trim() || 'The club'} will see that you passed. You can still message them.`}
        confirmLabel="Not interested"
        busyLabel="Sending…"
        testId="invite-pass-confirm"
      />
      {applyVacancy && (
        <Suspense fallback={null}>
          <ApplyToOpportunityModal
            isOpen={!!applyVacancy}
            onClose={() => setApplyVacancy(null)}
            vacancy={applyVacancy}
            clubName={club.full_name}
            clubLogo={club.avatar_url}
            publisherRole={club.role}
            league={league}
            onSuccess={onApplied}
          />
        </Suspense>
      )}
    </div>
  )
}
