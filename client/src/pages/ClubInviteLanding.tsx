import { useCallback, useEffect, useState } from 'react'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2, ShieldX, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { Avatar } from '@/components'

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
      addToast(result.already_member ? 'You’re already a member.' : `You joined ${preview?.club_name ?? 'the club'}.`, 'success')
      navigate(clubPath)
    } else {
      addToast(result.error ?? 'Could not join the club.', 'error')
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
        <p className="text-sm">Loading invitation…</p>
      </div>
    )
  }

  if (!preview?.valid) {
    return shell(
      <>
        <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-full bg-surface-muted">
          <ShieldX className="h-9 w-9 text-ink-2" />
        </div>
        <h1 className="mt-8 text-title text-ink-1">Invite not available</h1>
        <p className="mb-8 mt-3 text-[17px] leading-[22px] text-ink-2">This invite link is no longer valid. Ask the club for a new one.</p>
        <button type="button" onClick={() => navigate('/')} className={buttonClassName({ variant: 'secondary', size: 'large', radius: 'rounded-full', block: true })}>
          Go to Hockia
        </button>
      </>
    )
  }

  const clubName = preview.club_name ?? 'A club'
  const isAuthed = Boolean(user)
  const role = preview.caller_role
  const alreadyMember = preview.caller_member_status === 'active'
  const ineligibleRole = isAuthed && role != null && role !== 'player' && role !== 'coach'

  const header = (
    <>
      <Avatar src={preview.club_avatar_url} alt={clubName} initials={clubName.slice(0, 2)} size="xl" role="club" className="mx-auto mb-4 shadow-sm" />
      <p className="mb-2 text-micro font-semibold uppercase tracking-[0.06em] text-brand-text">Club invitation</p>
      <h1 className="text-title text-ink-1">{clubName} invited you to join its squad</h1>
      {preview.club_location && <p className="mt-1 text-secondary text-ink-3">{preview.club_location}</p>}
    </>
  )

  let action: React.ReactNode
  if (!isAuthed) {
    action = (
      <>
        <p className="mb-8 mt-3 text-[17px] leading-[22px] text-ink-2">Sign in or create your Hockia profile to join this club.</p>
        <button type="button" onClick={() => { try { sessionStorage.setItem('hockia-redirect-after-login', `/invite/club/${token}`) } catch { /* noop */ } navigate(`/signup?next=${encodeURIComponent(`/invite/club/${token}`)}`) }} className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', block: true })}>
          Create my profile
        </button>
        <button type="button" onClick={handleSignIn} className={buttonClassName({ variant: 'secondary', size: 'large', radius: 'rounded-full', block: true, className: 'mt-3' })}>
          I already have an account
        </button>
      </>
    )
  } else if (alreadyMember) {
    action = (
      <>
        <p className="mb-8 mt-3 text-[17px] leading-[22px] text-ink-2">You’re already a member of {clubName}.</p>
        <button type="button" onClick={() => navigate(clubPath)} className={buttonClassName({ variant: 'secondary', size: 'large', radius: 'rounded-full', block: true })}>
          View club
        </button>
      </>
    )
  } else if (ineligibleRole) {
    action = (
      <>
        <p className="mb-8 mt-3 text-[17px] leading-[22px] text-ink-2">Only players and coaches can join a club as a member.</p>
        <button type="button" onClick={() => navigate('/home')} className={buttonClassName({ variant: 'secondary', size: 'large', radius: 'rounded-full', block: true })}>
          Go to Hockia
        </button>
      </>
    )
  } else {
    action = (
      <>
        <p className="mb-8 mt-3 text-[17px] leading-[22px] text-ink-2">Join {clubName} as a member. They’ll see you in their roster.</p>
        <button type="button" onClick={handleJoin} disabled={joining} className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', block: true })}>
          {joining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
          {joining ? 'Joining…' : 'Join club'}
        </button>
      </>
    )
  }

  return shell(<>{header}{action}</>)
}
