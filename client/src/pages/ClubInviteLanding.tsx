import { useCallback, useEffect, useState } from 'react'
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
    navigate('/signin')
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

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-7 shadow-xl ring-1 ring-gray-100 text-center">
        {children}
      </div>
    </div>
  )

  if (loading || authLoading) {
    return shell(
      <div className="py-8 flex flex-col items-center text-gray-400">
        <Loader2 className="w-7 h-7 animate-spin mb-3" />
        <p className="text-sm">Loading invitation…</p>
      </div>
    )
  }

  if (!preview?.valid) {
    return shell(
      <>
        <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
          <ShieldX className="w-7 h-7 text-gray-400" />
        </div>
        <h1 className="text-lg font-bold text-gray-900 mb-1">Invite not available</h1>
        <p className="text-sm text-gray-500 mb-6">This invite link is no longer valid. Ask the club for a new one.</p>
        <button type="button" onClick={() => navigate('/')} className="w-full rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200 transition-colors">
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
      <p className="text-xs font-semibold uppercase tracking-wide text-violet-500 mb-1">Club invitation</p>
      <h1 className="text-xl font-bold text-gray-900">{clubName}</h1>
      {preview.club_location && <p className="text-sm text-gray-500 mt-0.5">{preview.club_location}</p>}
    </>
  )

  let action: React.ReactNode
  if (!isAuthed) {
    action = (
      <>
        <p className="text-sm text-gray-600 mt-4 mb-5">Sign in or create your Hockia profile to join this club.</p>
        <button type="button" onClick={handleSignIn} className="w-full rounded-xl bg-hockia-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#6B20D4] transition-colors">
          Sign in to join
        </button>
        <button type="button" onClick={() => { try { sessionStorage.setItem('hockia-redirect-after-login', `/invite/club/${token}`) } catch { /* noop */ } navigate('/signup') }} className="mt-2 w-full rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200 transition-colors">
          Create an account
        </button>
      </>
    )
  } else if (alreadyMember) {
    action = (
      <>
        <p className="text-sm text-gray-600 mt-4 mb-5">You’re already a member of {clubName}.</p>
        <button type="button" onClick={() => navigate(clubPath)} className="w-full rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200 transition-colors">
          View club
        </button>
      </>
    )
  } else if (ineligibleRole) {
    action = (
      <>
        <p className="text-sm text-gray-600 mt-4 mb-5">Only players and coaches can join a club as a member.</p>
        <button type="button" onClick={() => navigate('/home')} className="w-full rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200 transition-colors">
          Go to Hockia
        </button>
      </>
    )
  } else {
    action = (
      <>
        <p className="text-sm text-gray-600 mt-4 mb-5">Join {clubName} as a member. They’ll see you in their roster.</p>
        <button type="button" onClick={handleJoin} disabled={joining} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-hockia-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#6B20D4] transition-colors disabled:opacity-60">
          {joining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
          {joining ? 'Joining…' : 'Join club'}
        </button>
      </>
    )
  }

  return shell(<>{header}{action}</>)
}
