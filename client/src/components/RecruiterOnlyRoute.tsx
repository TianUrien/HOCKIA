import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth'
import { isRecruitingViewer } from '@/lib/recruiterAccess'

/**
 * Route guard for the Save / shortlist pages (/dashboard/saved,
 * /dashboard/shortlists[/:id]). Save is for clubs and coaches who recruit
 * for a team only (founder rule 2026-09-25); anyone else who reaches the
 * URL (an old bookmark, a stale link) is sent to their own profile. Their
 * saved_profiles rows are left in place, just unreachable.
 *
 * Renders nothing while the viewer's profile is still loading so a club
 * isn't bounced on a cold load. ProtectedRoute already handles auth.
 */
export default function RecruiterOnlyRoute({ children }: { children: ReactNode }) {
  const profile = useAuthStore((s) => s.profile)
  const profileStatus = useAuthStore((s) => s.profileStatus)

  if (!profile) {
    if (profileStatus === 'idle' || profileStatus === 'fetching') return null
    return <Navigate to="/dashboard/profile" replace />
  }
  if (!isRecruitingViewer(profile)) return <Navigate to="/dashboard/profile" replace />
  return <>{children}</>
}
