import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import PlayerDashboard from './PlayerDashboard'
import CoachDashboard from './CoachDashboard'
import ClubDashboard from './ClubDashboard'
import BrandDashboard from './BrandDashboard'
import UmpireDashboard from './UmpireDashboard'

/**
 * DashboardRouter - Single source of truth for profile-based routing
 * 
 * This component is the ONLY place that makes routing decisions based on profile state.
 * 
 * Routing logic:
 * 1. No user → redirect to landing page
 * 2. User but no profile → wait (profile is being fetched)
 * 3. User with incomplete profile → redirect to /complete-profile (once only)
 * 4. User with complete profile → render role-based dashboard
 * 
 * Uses persistent state (hasCompletedOnboardingRedirect) to prevent redirect loops
 */
export default function DashboardRouter() {
  const navigate = useNavigate()
  const { user, profile, loading, hasCompletedOnboardingRedirect, setHasCompletedOnboardingRedirect, profileStatus } = useAuthStore()

  useEffect(() => {
    logger.debug('[DASHBOARD_ROUTER]', {
      loading,
      hasUser: !!user,
      hasProfile: !!profile,
      fullName: profile?.full_name,
      // onboarding_completed field exists in DB but not in types yet
      hasCompletedOnboardingRedirect,
      profileStatus
    })

    // Wait for auth to finish loading
    if (loading) return

    // No user → redirect to landing
    if (!user) {
      logger.debug('[DASHBOARD_ROUTER] No user, redirecting to landing')
      navigate('/', { replace: true })
      return
    }

    // No profile yet
    if (!profile) {
      if (profileStatus === 'missing') {
        logger.debug('[DASHBOARD_ROUTER] Profile missing, routing to /complete-profile')
        if (!hasCompletedOnboardingRedirect) {
          setHasCompletedOnboardingRedirect(true)
        }
        navigate('/complete-profile', { replace: true })
      } else {
        logger.debug('[DASHBOARD_ROUTER] No profile yet, waiting...')
      }
      return
    }

    // Profile exists but incomplete (onboarding not completed) → route to complete-profile
    // Only attempt redirect once to prevent loops
    if (!profile.onboarding_completed && !hasCompletedOnboardingRedirect) {
      setHasCompletedOnboardingRedirect(true)
      logger.debug('[DASHBOARD_ROUTER] Profile incomplete (onboarding_completed=false), routing to /complete-profile')
      navigate('/complete-profile', { replace: true })
      return
    }

    // Profile complete → continue to render dashboard below
    if (profile.onboarding_completed) {
      logger.debug('[DASHBOARD_ROUTER] Profile complete, rendering dashboard')
      if (hasCompletedOnboardingRedirect) {
        setHasCompletedOnboardingRedirect(false)
      }
    }

  }, [user, profile, loading, navigate, hasCompletedOnboardingRedirect, setHasCompletedOnboardingRedirect, profileStatus])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-[#8026FA] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (!profile) {
    if (profileStatus === 'error') {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-600 mb-2">Something went wrong loading your profile.</p>
            <p className="text-sm text-gray-500 mb-4">Please try refreshing the page.</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white rounded-lg hover:opacity-90 transition-opacity font-medium"
            >
              Refresh
            </button>
          </div>
        </div>
      )
    }
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">No profile found. Please complete your profile.</p>
          <button
            onClick={() => navigate('/complete-profile')}
            className="px-6 py-3 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white rounded-lg hover:opacity-90 transition-opacity font-medium"
          >
            Complete Profile
          </button>
        </div>
      </div>
    )
  }

  // If profile incomplete, show loading (useEffect will redirect)
  if (!profile.onboarding_completed) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-[#8026FA] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading your profile...</p>
        </div>
      </div>
    )
  }

  // Route based on role
  if (profile.role === 'player') {
    return <div data-testid="dashboard-player"><PlayerDashboard /></div>
  }

  if (profile.role === 'coach') {
    return <div data-testid="dashboard-coach"><CoachDashboard /></div>
  }

  // Brand users: render BrandDashboard (handles its own loading/redirect logic)
  if (profile.role === 'brand') {
    return <div data-testid="dashboard-brand"><BrandDashboard /></div>
  }

  // Umpire is Phase A: no self-service onboarding yet. Admins flip profiles
  // to role='umpire' manually to test the dashboard.
  if (profile.role === 'umpire') {
    return <div data-testid="dashboard-umpire"><UmpireDashboard /></div>
  }

  return <div data-testid="dashboard-club"><ClubDashboard /></div>
}
