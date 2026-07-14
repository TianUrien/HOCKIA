import { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'

interface ProtectedRouteProps {
  children: React.ReactNode
}

const PUBLIC_ROUTES = ['/', '/signup', '/signin', '/verify-email', '/auth/callback', '/forgot-password', '/reset-password', '/privacy-policy', '/terms', '/developers', '/offline', '/opportunities', '/community', '/world', '/investors', '/invite', '/brands', '/marketplace', '/post', '/players', '/coaches', '/clubs', '/umpires', '/members', '/email-action', '/juniors-waitlist']

/**
 * ProtectedRoute - Centralized auth guard
 *
 * Uses global auth store (useAuthStore) instead of local state
 * to prevent duplicate auth listeners and state management conflicts.
 *
 * PUBLIC ROUTES (no auth required):
 * - /                    Landing page (hero + CTAs only after 2026 redesign)
 * - /signup              Role selection → AuthScreen in signup mode
 * - /signin              AuthScreen in signin mode (added in redesign)
 * - /verify-email        Email verification instructions
 * - /auth/callback       OAuth/email verification handler
 * - /forgot-password     Password reset request
 * - /reset-password      Password reset form
 * - /privacy-policy      Legal page
 * - /terms               Legal page  
 * - /developers          API documentation
 * - /offline             PWA offline fallback
 * - /opportunities/*     Public vacancy listings (read-only)
 * - /community/*         Public Q&A (read-only)
 * - /world/*             Country/league/club directory (read-only)
 * - /brands/*            Brand directory, profiles, and feed (read-only)
 * - /players/*           Public player profiles (shareable externally)
 * - /coaches/*           Public coach profiles (shareable externally)
 * - /clubs/*             Public club profiles (shareable externally)
 * - /umpires/*           Public umpire profiles (shareable externally)
 * - /members/*           Public member profiles (alias, shareable externally)
 *
 * PROTECTED ROUTES (require authentication):
 * - /dashboard/*         User dashboard & profile
 * - /messages/*          Messaging
 * - /settings            User settings
 * - /complete-profile    Onboarding
 * - /admin/*             Admin portal
 * 
 * IMPORTANT: Never redirect from /auth/callback or /verify-email
 * before auth processing completes
 * 
 * Uses shallow selectors to minimize re-renders
 */
// Routes an authenticated-but-NOT-onboarded account may still reach: the
// onboarding itself, auth plumbing, legal pages (linked from onboarding),
// and the email-action/waitlist endpoints. Everything else redirects to
// onboarding until it is completed.
const ONBOARDING_EXEMPT_ROUTES = [
  // '/brands/onboarding' is the ONE onboarding surface that lives outside
  // /complete-profile: brands finish signup there (CompleteProfile redirects
  // role='brand' → /brands/onboarding). Without it in this list the gate
  // below bounces the un-onboarded brand to /complete-profile, which bounces
  // it right back — an infinite loop that made brand signup impossible.
  '/complete-profile', '/brands/onboarding', '/auth/callback', '/verify-email',
  '/terms', '/privacy-policy', '/offline', '/email-action', '/juniors-waitlist',
]

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const location = useLocation()
  const user = useAuthStore(state => state.user)
  const profile = useAuthStore(state => state.profile)
  const loading = useAuthStore(state => state.loading)

  useEffect(() => {
    logger.debug('[PROTECTED_ROUTE]', {
      path: location.pathname,
      loading,
      hasUser: !!user,
      isPublic: PUBLIC_ROUTES.some(route => route === '/' ? location.pathname === '/' : location.pathname === route || location.pathname.startsWith(route + '/'))
    })
  }, [location.pathname, loading, user])

  // Show loading while checking auth
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-hockia-primary mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  // ONBOARDING GATE (Tian's age-gate decision 3, 2026-07-11): an authenticated
  // account must finish onboarding — which contains the 18+ DOB step — before
  // reaching ANY surface, public pages included. Leaving and returning resumes
  // at onboarding. Applies only once the profile row has loaded (no redirect
  // flicker mid-fetch); server-side RLS already keeps these accounts invisible
  // and uncontactable, this closes the browse path.
  if (user && profile && !profile.onboarding_completed) {
    const isOnboardingExempt = ONBOARDING_EXEMPT_ROUTES.some(route =>
      location.pathname === route || location.pathname.startsWith(route + '/'))
    if (!isOnboardingExempt) {
      return <Navigate to="/complete-profile" replace />
    }
  }

  // Check if current route is public (exact match for /, prefix match for others)
  const isPublicRoute = PUBLIC_ROUTES.some(route => {
    if (route === '/') return location.pathname === '/'
    // Ensure prefix match doesn't collide: /opportunities must not match /opportunities-admin
    return location.pathname === route || location.pathname.startsWith(route + '/')
  })

  // Public routes - allow access regardless of auth status
  if (isPublicRoute) {
    return <>{children}</>
  }

  // Protected routes - require authentication
  if (!user) {
    // Store intended destination for redirect after login (state for email/password, sessionStorage for OAuth)
    try { sessionStorage.setItem('hockia-redirect-after-login', location.pathname) } catch { /* noop */ }
    return <Navigate to="/" state={{ from: location.pathname }} replace />
  }

  return <>{children}</>
}
