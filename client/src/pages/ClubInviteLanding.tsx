import { useCallback, useEffect, useState } from 'react'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2, ShieldX, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { Avatar } from '@/components'
import { useClubT } from '@/i18n/ns/club'

interface InvitePreview {
  valid: boolean
  club_profile_id?: string
  club_name?: string | null
  club_username?: string | null
  club_avatar_url?: string | null
  club_location?: string | null
  caller_role?: string | null
  caller_member_status?: string | null
}

export default function ClubInviteLanding() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuthStore()
  const { addToast } = useToastStore()
  const t = useClubT()

  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)

  const loadPreview = useCallback(async () => {
    if (!token) {
      setPreview({ valid: false })
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase.rpc('get_club_invite_preview', { p_token: token })
    setPreview(error ? { valid: false } : (data as unknown as InvitePreview))
    setLoading(false)
  }, [token])

  useEffect(() => {
    // Re-fetch once auth resolves so caller_role/member_status reflect the user.
    if (!authLoading) void loadPreview()
  }, [authLoading, loadPreview])

  const clubPath = preview?.club_username
    ? `/clubs/${preview.club_username}`
    : preview?.club_profile_id
      ? `/clubs/id/${preview.club_profile_id}`
      : '/'

  const handleSignIn = () => {
    try { sessionStorage.setItem('hockia-redirect-after-login', `/invite/club/${token}`) } catch { /* noop */ }
    navigate(`/signin?next=${encodeURIComponent(`/invite/club/${token}`)}`)
  }

  const handleJoin = async () => {
    if (!token) return
    setJoining(true)
    const { data, error } = await supabase.rpc('join_club_via_link', { p_token: token })
    setJoining(false)
    const result = (error ? { success: false, error: error.message } : data) as { success: boolean; error?: string; already_member?: boolean }
    if (result.success) {
      addToast(result.already_member ? t('inviteLanding.toastAlreadyMember') : preview?.club_name ? t('inviteLanding.toastJoined', { clubName: preview.club_name }) : t('inviteLanding.toastJoinedNoName'), 'success')
      navigate(clubPath)
    } else {
      addToast(result.error ?? t('inviteLanding.toastJoinFailed'), 'error')
      void loadPreview()
    }
  }

  // Rebrand page 28 · Club invite: lockup on top, the invitation centred.
  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-app-screen flex-col bg-white pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <header className="flex h-[46px] shrink-0 items-center px-6">
        <img src="/brand/lockup/hockia-lockup-horizontal-ink.svg" alt="Hockia" width={108} height={22} className="h-[22px] w-auto" />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 text-center">{children}</main>
    </div>
  )

  if (loading || authLoading) {
    return shell(
      <div className="flex flex-col items-center py-8 text-ink-3">
        <Loader2 className="w-7 h-7 animate-spin mb-3" />
        <p className="text-sm">{t('inviteLanding.loading')}</p>
      </div>
    )
  }

  if (!preview?.valid) {
    return shell(
      <>
        <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-full bg-surface-muted">
          <ShieldX className="h-9 w-9 text-ink-2" />
        </div>
        <h1 className="mt-8 text-title text-ink-1">{t('inviteLanding.unavailableTitle')}</h1>
        <p className="mb-8 mt-3 text-[17px] leading-[22px] text-ink-2">{t('inviteLanding.unavailableBody')}</p>
        <button type="button" onClick={() => navigate('/')} className={buttonClassName({ variant: 'secondary', size: 'large', radius: 'rounded-full', block: true })}>
          {t('inviteLanding.goHome')}
        </button>
      </>
    )
  }

  const clubName = preview.club_name ?? t('inviteLanding.aClub')
  const isAuthed = Boolean(user)
  const role = preview.caller_role
  const alreadyMember = preview.caller_member_status === 'active'
  const ineligibleRole = isAuthed && role != null && role !== 'player' && role !== 'coach'

  const header = (
    <>
      <Avatar src={preview.club_avatar_url} alt={clubName} initials={clubName.slice(0, 2)} size="xl" role="club" className="mx-auto mb-4 shadow-sm" />
      <p className="mb-2 text-micro font-semibold uppercase tracking-[0.06em] text-brand-text">{t('inviteLanding.eyebrow')}</p>
      <h1 className="text-title text-ink-1">{t('inviteLanding.title', { clubName })}</h1>
      {preview.club_location && <p className="mt-1 text-secondary text-ink-3">{preview.club_location}</p>}
    </>
  )

  let action: React.ReactNode
  if (!isAuthed) {
    action = (
      <>
        <p className="mb-8 mt-3 text-[17px] leading-[22px] text-ink-2">{t('inviteLanding.signedOutBody')}</p>
        <button type="button" onClick={() => { try { sessionStorage.setItem('hockia-redirect-after-login', `/invite/club/${token}`) } catch { /* noop */ } navigate(`/signup?next=${encodeURIComponent(`/invite/club/${token}`)}`) }} className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', block: true })}>
          {t('inviteLanding.createProfile')}
        </button>
        <button type="button" onClick={handleSignIn} className={buttonClassName({ variant: 'secondary', size: 'large', radius: 'rounded-full', block: true, className: 'mt-3' })}>
          {t('inviteLanding.haveAccount')}
        </button>
      </>
    )
  } else if (alreadyMember) {
    action = (
      <>
        <p className="mb-8 mt-3 text-[17px] leading-[22px] text-ink-2">{t('inviteLanding.alreadyMember', { clubName })}</p>
        <button type="button" onClick={() => navigate(clubPath)} className={buttonClassName({ variant: 'secondary', size: 'large', radius: 'rounded-full', block: true })}>
          {t('inviteLanding.viewClub')}
        </button>
      </>
    )
  } else if (ineligibleRole) {
    action = (
      <>
        <p className="mb-8 mt-3 text-[17px] leading-[22px] text-ink-2">{t('inviteLanding.ineligible')}</p>
        <button type="button" onClick={() => navigate('/home')} className={buttonClassName({ variant: 'secondary', size: 'large', radius: 'rounded-full', block: true })}>
          {t('inviteLanding.goHome')}
        </button>
      </>
    )
  } else {
    action = (
      <>
        <p className="mb-8 mt-3 text-[17px] leading-[22px] text-ink-2">{t('inviteLanding.joinBody', { clubName })}</p>
        <button type="button" onClick={handleJoin} disabled={joining} className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', block: true })}>
          {joining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
          {joining ? t('inviteLanding.joining') : t('inviteLanding.join')}
        </button>
      </>
    )
  }

  return shell(<>{header}{action}</>)
}
