import { useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, LogIn, UserPlus, Lock } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { trackSignupWallAction } from '@/lib/analytics'
import { trackDbEvent, markWallIntent } from '@/lib/trackDbEvent'
import { isSafeRedirectPath } from '@/lib/safeRedirect'

/**
 * The state a public profile page renders when it has NO profile to show —
 * shared by the player/coach, club and umpire pages so the three cannot
 * drift.
 *
 * WHY THIS BRANCHES ON THE VIEWER (founder brief, 2026-08-15):
 *
 * For a guest, "0 rows" is ambiguous BY DESIGN. RLS returns the same empty
 * result for a profile that is hidden (blocked, test-only, frozen minor,
 * private) as for one that never existed — an existence oracle would leak
 * exactly what the fence exists to hide. So a guest tapping "View Club" on
 * a listing whose club is not publicly visible was met with "Profile Not
 * Found · Go Back": a hard stop, on the very page where they had just found
 * something worth looking into.
 *
 * That moment IS the conversion point. A guest is shown "not publicly
 * visible — sign in to see more", with the two ways in, and the return path
 * remembered so they land straight back here afterwards. Where the profile
 * genuinely does not exist they still learn that — after signing in, when
 * the truthful "not found" renders for them as a member.
 *
 * For a MEMBER, 0 rows means what it says, so they keep the honest
 * "Profile Not Found".
 *
 * Funnel: fires `login_wall_shown` (action = view_profile) and marks wall
 * intent on the way out — the same chokepoint contract as
 * SignInPromptModal, so this wall is attributed like every other.
 */
export default function ProfileUnavailable({
  noun = 'profile',
  message,
}: {
  /** "club" | "player" | "coach" | "umpire" | "profile" — copy only. */
  noun?: string
  /** Member-facing detail, e.g. "Club profile not found." */
  message?: string | null
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuthStore()
  // A signed-in account with no profile row yet is NOT a guest — telling them
  // to "sign in" while signed in is nonsense. Only a true no-session visitor
  // gets the conversion wall; everyone else gets the honest not-found.
  const isGuest = !user

  const fired = useRef(false)
  useEffect(() => {
    if (isGuest && !fired.current) {
      fired.current = true
      trackDbEvent('login_wall_shown', undefined, undefined, { action: 'view_profile', noun })
    }
  }, [isGuest, noun])

  const go = (kind: 'sign_in' | 'sign_up') => {
    trackSignupWallAction(kind)
    markWallIntent('view_profile')
    // Return path. Two mechanisms, because two flows read them:
    //  - /signin honours `?next=` (AuthScreen), NOT location.state.from —
    //    passing state alone landed the returning member on /dashboard/profile,
    //    not the club they had just asked to see.
    //  - Sign-up goes email → AuthCallback, which reads the sessionStorage
    //    stash. Stashing here means a brand-new member lands back on the
    //    profile that made them sign up. Same key AuthScreen/Landing use.
    // The path is our own location.pathname, but validate at the write point
    // anyway (defence in depth, mirrors AuthScreen.stashRedirectIntent).
    const from = location.pathname
    if (isSafeRedirectPath(from)) {
      try { sessionStorage.setItem('hockia-redirect-after-login', from) } catch { /* noop */ }
    }
    navigate(kind === 'sign_in' ? `/signin?next=${encodeURIComponent(from)}` : '/signup')
  }

  if (isGuest) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center bg-gray-50 px-4">
        <div className="mx-auto w-full max-w-sm text-center">
          <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f4f1ff] text-[#5b21b6]">
            <Lock className="h-6 w-6" strokeWidth={2.25} aria-hidden="true" />
          </span>
          <h2 className="text-[22px] font-bold leading-7 tracking-[-0.02em] text-gray-900">
            Sign in to view this {noun}
          </h2>
          <p className="mt-2 text-[15px] leading-6 text-gray-600">
            This {noun} isn&apos;t publicly visible. Members can see full profiles, message, and connect.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => go('sign_up')}
              className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-[#7c3aed] text-[16px] font-semibold text-white shadow-[0_6px_18px_rgba(124,58,237,0.28)] transition-all hover:bg-[#6d28d9] active:scale-[0.985]"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Create a free profile
            </button>
            <button
              type="button"
              onClick={() => go('sign_in')}
              className="flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-[#dad9e2] bg-white text-[16px] font-semibold text-gray-900 transition-all hover:bg-gray-50 active:scale-[0.985]"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Log in
            </button>
          </div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Keep exploring
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="mx-auto max-w-md px-4 text-center">
        <div className="mb-4 text-6xl">🏑</div>
        <h2 className="mb-2 text-2xl font-bold text-gray-900">Profile Not Found</h2>
        <p className="mb-6 text-gray-600">{message || `This ${noun} could not be found.`}</p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-6 py-3 text-white transition-colors hover:bg-purple-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Go Back
        </button>
      </div>
    </div>
  )
}
