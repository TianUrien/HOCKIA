import { useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Check, Share } from 'lucide-react'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { SettingsSwitch } from '@/components/settings/settingsUi'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useSigningData, useSigningActions, type SigningData } from '@/hooks/useSigning'
import { getImageUrl } from '@/lib/imageUrl'
import { inviteRoleLabel } from '@/lib/invites'
import { publicProfileShareUrl } from '@/lib/profileShare'
import {
  SIGNING_CONFIRM_DAYS,
  confirmSigningTitle,
  hideFromClubsCopy,
  offerStartLine,
  seasonLabel,
  signedTitle,
  signingShareText,
} from '@/lib/signing'

/**
 * D4.5 · Confirm signing (Figma 390:936; DEV NOTE 391:40) and D4.6 · Signed
 * (Figma 390:980; DEV NOTE 391:44), player side. A signing counts only when
 * the player confirms: Yes, I signed → confirm_signing, which sets signed,
 * adds the career entry with signed_via_hockia, the Squad membership and,
 * when the club chose to, closes the role as filled via Hockia. "Stop
 * showing me to other clubs" is on by default and turns off Open to play.
 * Not yet → nothing changes; the club sees "Waiting for <name> to confirm".
 * Then the signed screen: it's on the career now, with Share the news.
 * Works the same on phone and desktop (one centred column).
 */
function leagueFor(club: SigningData['club'], gender: string | null): string | null {
  const women = gender === 'Women' || gender === 'Girls'
  const men = club.mens_league_division?.trim() || null
  const wom = club.womens_league_division?.trim() || null
  return (women ? wom ?? men : men ?? wom) ?? null
}

function Crest({ src, name, size }: { src: string | null; name: string | null; size: number }) {
  const url = src ? getImageUrl(src, 'avatar-lg') ?? src : null
  return <EntityAvatar src={url} name={name} role="club" size={size} />
}

export default function ConfirmSigningPage() {
  const { applicationId } = useParams<{ applicationId: string }>()
  const navigate = useNavigate()
  const me = useAuthStore((s) => s.profile)
  const addToast = useToastStore((s) => s.addToast)
  const { data, loading, refetch } = useSigningData(applicationId ?? null)
  const { confirmSigning, busy } = useSigningActions()
  const [hide, setHide] = useState(true)
  const [confirmed, setConfirmed] = useState(false)
  useDocumentTitle('Signing')

  const shell = (children: ReactNode) => (
    <div className="flex min-h-[100dvh] flex-col bg-white pb-[max(env(safe-area-inset-bottom),1rem)] pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6">{children}</div>
    </div>
  )

  if (loading) return shell(<div className="mt-24 h-64 animate-pulse rounded-2xl bg-surface-grouped" />)
  const own = data && me && data.application.applicant_id === me.id
  if (!data || !own) {
    return shell(
      <div className="mt-24 text-center" data-testid="signing-unavailable">
        <p className="text-[17px] font-semibold text-ink-1">This signing isn’t available.</p>
        <button type="button" onClick={() => navigate('/opportunities/applications')} className="mt-3 text-row font-semibold text-hockia-primary">My applications</button>
      </div>,
    )
  }

  const { application, role, club, offer } = data
  const clubName = role.organization_name?.trim() || club.full_name?.trim() || 'The club'
  const roleText = inviteRoleLabel(role)
  const start = offer?.start_date ?? role.start_date
  const signed = confirmed || application.status === 'signed'

  if (signed) {
    const share = async () => {
      const url = me ? publicProfileShareUrl(me.role, me.id, me.username) : null
      const text = signingShareText(clubName)
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
          await navigator.share({ title: 'HOCKIA', text, url: url ?? undefined })
          return
        }
        await navigator.clipboard.writeText(url ? `${text} ${url}` : text)
        addToast('Copied — paste it anywhere', 'success')
      } catch (err) {
        if (!(err instanceof Error && err.name === 'AbortError')) addToast('Couldn’t share. Please try again.', 'error')
      }
    }
    return shell(
      <div className="flex flex-1 flex-col" data-testid="signing-signed">
        <div className="flex flex-1 flex-col items-center pt-24 text-center">
          <span className="flex h-28 w-28 items-center justify-center rounded-full bg-positive-soft text-positive" aria-hidden="true">
            <Check className="h-12 w-12" strokeWidth={2.6} />
          </span>
          <h1 className="mt-5 text-[28px] font-bold leading-[34px] tracking-[-0.3px] text-ink-1">{signedTitle(clubName, me?.role)}</h1>
          <p className="mt-2 text-[16px] leading-[23px] text-ink-2">It’s on your career now. Clubs will see where you signed and that it happened through Hockia.</p>
          <div className="mt-6 flex w-full items-center gap-3.5 rounded-2xl bg-surface-grouped px-4 py-4 text-left">
            <Crest src={club.avatar_url} name={clubName} size={52} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] font-semibold text-ink-1">{clubName}</p>
              <p className="truncate text-[14px] text-ink-1">{roleText} · {seasonLabel(start)}</p>
              <span className="mt-1 inline-flex rounded-full bg-hockia-soft px-2 py-0.5 text-caption font-semibold text-hockia-primary" data-testid="signed-through-hockia">Signed through Hockia</span>
            </div>
          </div>
        </div>
        <button type="button" onClick={() => void share()} className="flex h-[50px] w-full items-center justify-center gap-2 rounded-full bg-surface-grouped text-[16px] font-semibold text-ink-1" data-testid="signing-share">
          <Share className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" /> Share the news
        </button>
        <button type="button" onClick={() => navigate('/dashboard/profile')} className="mt-2.5 flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-[16px] font-semibold text-white">
          Done
        </button>
      </div>,
    )
  }

  const requested = application.signing_requested_at ? new Date(application.signing_requested_at).getTime() : null
  const lapsed = requested !== null && Date.now() - requested > SIGNING_CONFIRM_DAYS * 86_400_000
  if (application.status !== 'signed_pending_confirmation' || lapsed) {
    return shell(
      <div className="mt-24 text-center" data-testid="signing-not-waiting">
        <p className="text-[17px] font-semibold text-ink-1">{lapsed ? 'This signing request has expired.' : 'There’s no signing waiting for your confirmation.'}</p>
        <p className="mt-1 text-secondary text-ink-2">You can message the club if something isn’t right.</p>
        <button type="button" onClick={() => navigate('/opportunities/applications')} className="mt-3 text-row font-semibold text-hockia-primary">My applications</button>
      </div>,
    )
  }

  const rows: [string, string | null][] = [
    ['Club', clubName],
    ['Role', roleText],
    ['League', leagueFor(club, role.gender) ?? (role.level_sought?.trim() || null)],
    ['From', offerStartLine(start, offer?.length ?? role.duration_text)],
  ]
  const toggle = hideFromClubsCopy(me?.role)
  const confirm = async () => {
    if (!applicationId) return
    const res = await confirmSigning(applicationId, hide)
    if (res.ok) {
      setConfirmed(true)
      void refetch()
    }
  }

  return shell(
    <div className="flex flex-1 flex-col" data-testid="signing-confirm">
      <div className="flex flex-1 flex-col items-center pt-10 text-center">
        <Crest src={club.avatar_url} name={clubName} size={80} />
        <h1 className="mt-5 text-[26px] font-bold leading-8 tracking-[-0.3px] text-ink-1">{confirmSigningTitle(clubName)}</h1>
        <p className="mt-2 text-[16px] leading-[23px] text-ink-2">Confirm it and it goes on your career, with “Signed through Hockia”.</p>
        <dl className="mt-6 w-full overflow-hidden rounded-2xl bg-surface-grouped text-left">
          {rows.filter(([, v]) => !!v).map(([k, v], i) => (
            <div key={k}>
              {i > 0 && <div className="ml-4 h-[0.5px] bg-line" />}
              <div className="flex min-h-[45px] items-start justify-between gap-3 px-4 py-3">
                <dt className="shrink-0 text-[15px] text-ink-2">{k}</dt>
                <dd className="min-w-0 break-words text-right text-[15px] text-ink-1">{v}</dd>
              </div>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-line px-4 py-3 text-left">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-5 text-ink-1">{toggle.title}</p>
            <p className="text-secondary leading-[17px] text-ink-2">{toggle.detail}</p>
          </div>
          <SettingsSwitch checked={hide} onChange={() => setHide((v) => !v)} label={toggle.title} />
        </div>
      </div>
      <button type="button" onClick={() => void confirm()} disabled={busy} className="mt-6 flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-[16px] font-semibold text-white disabled:opacity-60" data-testid="signing-yes">
        {busy ? 'Confirming…' : 'Yes, I signed'}
      </button>
      <button type="button" onClick={() => navigate(-1)} className="mt-1 flex h-11 w-full items-center justify-center text-[16px] font-semibold text-ink-1" data-testid="signing-not-yet">
        Not yet
      </button>
    </div>,
  )
}
