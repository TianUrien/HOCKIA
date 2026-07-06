import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import type { ComponentType } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigationType } from 'react-router-dom'
import { initializeAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { initGA, trackPageView } from '@/lib/analytics'
import * as Sentry from '@sentry/react'
import { ProtectedRoute, ErrorBoundary, Layout, SentryTestButton } from '@/components'
import ToastContainer from '@/components/ToastContainer'
import UploadIndicator from '@/components/UploadIndicator'
import { ProfileImagePreviewProvider } from '@/components/ProfileImagePreviewProvider'
import InstallPrompt from '@/components/InstallPrompt'
import PushPrompt from '@/components/PushPrompt'
import NativeUpdatePrompt from '@/components/NativeUpdatePrompt'
import AppRatingPrompt from '@/components/AppRatingPrompt'
import ContactModal from '@/components/ContactModal'
import { useEngagementTracking } from '@/hooks/useEngagementTracking'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import KeyboardShortcutsModal from '@/components/KeyboardShortcutsModal'
import Landing from '@/pages/Landing'
import SignUp from '@/pages/SignUp'
import AuthScreen from '@/pages/AuthScreen'
import AuthCallback from '@/pages/AuthCallback'
import VerifyEmail from '@/pages/VerifyEmail'
import ForgotPassword from '@/pages/ForgotPassword'
import ResetPassword from '@/pages/ResetPassword'
import PrivacyPolicy from '@/pages/PrivacyPolicy'
import Terms from '@/pages/Terms'
import DevelopersPage from '@/pages/DevelopersPage'
import SettingsPage from '@/pages/SettingsPage'
import OfflinePage from '@/pages/OfflinePage'
import TermsGate from '@/components/TermsGate'

// Auto-reload on stale chunk errors (after deploy, old hashed filenames 404).
// Uses sessionStorage guard to prevent infinite reload loops.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyWithRetry<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    importFn().catch((error: Error) => {
      const msg = (error.message ?? '').toLowerCase()
      // Three stale-chunk signatures we've seen in prod Sentry:
      //   1. "failed to fetch dynamically imported module" — Chrome/FF when
      //      the old hashed file 404s post-deploy.
      //   2. "failed to load module script" — generic browser variant.
      //   3. "is not a valid javascript mime type" — Vercel's SPA fallback
      //      serves index.html (text/html) for any unknown path, so when
      //      Safari fetches a missing chunk it gets HTML and the ES module
      //      loader throws this. Previously slipped past the guard and
      //      surfaced as JAVASCRIPT-REACT-3 (95 occurrences in Sentry).
      const isStale =
        msg.includes('failed to fetch dynamically imported module') ||
        msg.includes('failed to load module script') ||
        msg.includes('is not a valid javascript mime type')

      if (isStale && !sessionStorage.getItem('chunk-reload')) {
        sessionStorage.setItem('chunk-reload', '1')
        window.location.reload()
        return new Promise<never>(() => {}) // hang until reload completes
      }

      sessionStorage.removeItem('chunk-reload')
      throw error // not stale or already retried — let ErrorBoundary handle
    }),
  )
}

// Lazy load heavy components
const CompleteProfile = lazyWithRetry(() => import('@/pages/CompleteProfile'))
const DashboardRouter = lazyWithRetry(() => import('@/pages/DashboardRouter'))
const HomePage = lazyWithRetry(() => import('@/pages/HomePage'))
const OpportunitiesPage = lazyWithRetry(() => import('@/pages/OpportunitiesPage'))
const OpportunityDetailPage = lazyWithRetry(() => import('@/pages/OpportunityDetailPage'))
const CommunityPage = lazyWithRetry(() => import('@/pages/CommunityPage'))
const QuestionDetailPage = lazyWithRetry(() => import('@/pages/QuestionDetailPage'))
const ApplicantsList = lazyWithRetry(() => import('@/pages/ApplicantsList'))
const SavedCandidatesPage = lazyWithRetry(() => import('@/pages/SavedCandidatesPage'))
const ShortlistsIndexPage = lazyWithRetry(() => import('@/pages/ShortlistsIndexPage'))
const ShortlistDetailPage = lazyWithRetry(() => import('@/pages/ShortlistDetailPage'))
const PublicPlayerProfile = lazyWithRetry(() => import('@/pages/PublicPlayerProfile'))
const PublicClubProfile = lazyWithRetry(() => import('@/pages/PublicClubProfile'))
const PublicUmpireProfile = lazyWithRetry(() => import('@/pages/PublicUmpireProfile'))
const MessagesPage = lazyWithRetry(() => import('@/pages/MessagesPage'))
const SearchPage = lazyWithRetry(() => import('@/pages/SearchPage'))
const DiscoverPage = lazyWithRetry(() => import('@/pages/DiscoverPage'))

// World directory pages
const WorldPage = lazyWithRetry(() => import('@/pages/WorldPage'))
const WorldCountryPage = lazyWithRetry(() => import('@/pages/WorldCountryPage'))
const WorldProvincePage = lazyWithRetry(() => import('@/pages/WorldProvincePage'))
const WorldClubPage = lazyWithRetry(() => import('@/pages/WorldClubPage'))
const PostPage = lazyWithRetry(() => import('@/pages/PostPage'))

// Brand pages
const BrandProfilePage = lazyWithRetry(() => import('@/pages/BrandProfilePage'))
const BrandIdRedirect = lazyWithRetry(() => import('@/pages/BrandIdRedirect'))
const BrandOnboardingPage = lazyWithRetry(() => import('@/pages/BrandOnboardingPage'))
// BrandDashboardPage was the legacy /dashboard/brand page; replaced by the
// rich BrandDashboard component used by DashboardRouter at /dashboard/profile.
// Import removed; legacy route now redirects.
const MarketplacePage = lazyWithRetry(() => import('@/pages/BrandsPage'))

// Lazy load admin components (code splitting)
const AdminGuard = lazyWithRetry(() => import('@/features/admin/components/AdminGuard').then(m => ({ default: m.AdminGuard })))
const AdminLayout = lazyWithRetry(() => import('@/features/admin/components/AdminLayout').then(m => ({ default: m.AdminLayout })))
const AdminOverview = lazyWithRetry(() => import('@/features/admin/pages/AdminOverview').then(m => ({ default: m.AdminOverview })))
const AdminDataIssues = lazyWithRetry(() => import('@/features/admin/pages/AdminDataIssues').then(m => ({ default: m.AdminDataIssues })))
const AdminDirectory = lazyWithRetry(() => import('@/features/admin/pages/AdminDirectory').then(m => ({ default: m.AdminDirectory })))
const AdminAuditLog = lazyWithRetry(() => import('@/features/admin/pages/AdminAuditLog').then(m => ({ default: m.AdminAuditLog })))
const AdminReports = lazyWithRetry(() => import('@/features/admin/pages/AdminReports').then(m => ({ default: m.AdminReports })))
const AdminSettings = lazyWithRetry(() => import('@/features/admin/pages/AdminSettings').then(m => ({ default: m.AdminSettings })))
const AdminOpportunities = lazyWithRetry(() => import('@/features/admin/pages/AdminOpportunities').then(m => ({ default: m.AdminOpportunities })))
const AdminOpportunityDetail = lazyWithRetry(() => import('@/features/admin/pages/AdminOpportunityDetail').then(m => ({ default: m.AdminOpportunityDetail })))
const AdminUsers = lazyWithRetry(() => import('@/features/admin/pages/AdminUsers').then(m => ({ default: m.AdminUsers })))
const AdminEngagement = lazyWithRetry(() => import('@/features/admin/pages/AdminEngagement').then(m => ({ default: m.AdminEngagement })))
const AdminFeatureUsage = lazyWithRetry(() => import('@/features/admin/pages/AdminFeatureUsage').then(m => ({ default: m.AdminFeatureUsage })))
const AdminAIOpinions = lazyWithRetry(() => import('@/features/admin/pages/AdminAIOpinions').then(m => ({ default: m.AdminAIOpinions })))
const AdminFeedback = lazyWithRetry(() => import('@/features/admin/pages/AdminFeedback').then(m => ({ default: m.AdminFeedback })))
const AdminAppRatings = lazyWithRetry(() => import('@/features/admin/pages/AdminAppRatings').then(m => ({ default: m.AdminAppRatings })))
const AdminDiscovery = lazyWithRetry(() => import('@/features/admin/pages/AdminDiscovery').then(m => ({ default: m.AdminDiscovery })))
const AdminDeviceUsers = lazyWithRetry(() => import('@/features/admin/pages/AdminDeviceUsers').then(m => ({ default: m.AdminDeviceUsers })))
const AdminInvestorDashboard = lazyWithRetry(() => import('@/features/admin/pages/AdminInvestorDashboard').then(m => ({ default: m.AdminInvestorDashboard })))
const AdminWorld = lazyWithRetry(() => import('@/features/admin/pages/AdminWorld'))
const AdminEmail = lazyWithRetry(() => import('@/features/admin/pages/AdminEmail').then(m => ({ default: m.AdminEmail })))
const AdminEmailTemplateEditor = lazyWithRetry(() => import('@/features/admin/pages/AdminEmailTemplateEditor').then(m => ({ default: m.AdminEmailTemplateEditor })))
const AdminOutreach = lazyWithRetry(() => import('@/features/admin/pages/AdminOutreach'))
const AdminPreferences = lazyWithRetry(() => import('@/features/admin/pages/AdminPreferences'))
const AdminFeedAnalytics = lazyWithRetry(() => import('@/features/admin/pages/AdminFeedAnalytics').then(m => ({ default: m.AdminFeedAnalytics })))
// Phase 2D: AdminFunnels / AdminOnboardingFunnel / AdminChurn are now
// rendered INSIDE AdminProductHealth's tabbed shell — they're imported
// statically by that component, no longer by App.tsx. Direct routes
// to /admin/funnels, /admin/onboarding, /admin/churn redirect into
// the matching tab below.
const AdminProductHealth = lazyWithRetry(() => import('@/features/admin/pages/AdminProductHealth').then(m => ({ default: m.AdminProductHealth })))
const AdminCommunity = lazyWithRetry(() => import('@/features/admin/pages/AdminCommunity').then(m => ({ default: m.AdminCommunity })))
const AdminMonthlyReport = lazyWithRetry(() => import('@/features/admin/pages/AdminMonthlyReport').then(m => ({ default: m.AdminMonthlyReport })))
const AdminMessagingHealth = lazyWithRetry(() => import('@/features/admin/pages/AdminMessagingHealth').then(m => ({ default: m.AdminMessagingHealth })))
const AdminAttribution = lazyWithRetry(() => import('@/features/admin/pages/AdminAttribution').then(m => ({ default: m.AdminAttribution })))
const AdminCountries = lazyWithRetry(() => import('@/features/admin/pages/AdminCountries').then(m => ({ default: m.AdminCountries })))

// Public investor dashboard (no auth required)
const PublicInvestorDashboard = lazyWithRetry(() => import('@/pages/PublicInvestorDashboard'))
const ClubInviteLanding = lazyWithRetry(() => import('@/pages/ClubInviteLanding'))
const EmailActionPage = lazyWithRetry(() => import('@/pages/EmailActionPage'))

// 404 page
const NotFoundPage = lazyWithRetry(() => import('@/pages/NotFoundPage'))

// /notifications deep-link handler — opens the global drawer + redirects to home.
const NotificationsRedirect = lazyWithRetry(() => import('@/pages/NotificationsRedirect'))

// Route-level error fallback — keeps nav alive so user can recover
const RouteErrorFallback = () => (
  <div className="min-h-[60vh] flex items-center justify-center px-4">
    <div className="max-w-sm w-full text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-red-100 mb-4">
        <svg className="w-7 h-7 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h2>
      <p className="text-gray-600 text-sm mb-6">This page encountered an error. You can try reloading or go back home.</p>
      <div className="space-y-3">
        <button type="button" onClick={() => window.location.reload()} className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm">
          Reload Page
        </button>
        <button type="button" onClick={() => { window.location.href = '/home' }} className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm">
          Go to Home
        </button>
      </div>
    </div>
  </div>
)

// Loading fallback component
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
      <p className="text-gray-600 text-sm">Loading...</p>
    </div>
  </div>
)

// Engagement tracking wrapper - tracks time in app via heartbeats
function EngagementTracker() {
  useEngagementTracking()
  return null
}

// Google Analytics page view tracker
function AnalyticsTracker() {
  const location = useLocation()

  useEffect(() => {
    // Tag current route on every event sent to Sentry (critical for debugging
    // auth/onboarding flows where the crashing route is the key signal).
    Sentry.setTag('route', location.pathname)
    Sentry.addBreadcrumb({
      category: 'navigation',
      level: 'info',
      message: `route.${location.pathname}`,
      data: { pathname: location.pathname, search: location.search },
    })

    // Fire on every route change INCLUDING the first render. We
    // disabled gtag's send_page_view in cookieConsent.ts as part of
    // the PII scrub (initial auto pageview leaked raw URLs / titles),
    // so trackPageView is now the single source of all page_view
    // events. Sanitization is applied inside trackPageView.
    trackPageView(location.pathname + location.search)
  }, [location])

  return null
}

// Map route paths to feature categories for analytics attribution
function getFeatureFromPath(path: string): string {
  if (path.startsWith('/home') || path === '/') return 'feed'
  if (path.startsWith('/messages')) return 'messaging'
  if (path.startsWith('/opportunities')) return 'marketplace'
  if (path.startsWith('/marketplace')) return 'marketplace'
  if (path.startsWith('/community')) return 'community'
  if (path.startsWith('/search')) return 'search'
  if (path.startsWith('/discover')) return 'discovery'
  // Public profile routes use plural prefixes (matches App.tsx routes).
  // Earlier this checked singular forms (/player/, /club/, /coach/, /brand/)
  // which never match — every public-profile page-view was tagged 'other'.
  if (
    path.startsWith('/players/') ||
    path.startsWith('/coaches/') ||
    path.startsWith('/clubs/') ||
    path.startsWith('/umpires/') ||
    path.startsWith('/brands/') ||
    path.startsWith('/members/')
  ) return 'profiles'
  if (path.startsWith('/dashboard/profile')) return 'profiles'
  if (path.startsWith('/dashboard')) return 'dashboard'
  if (path.startsWith('/settings')) return 'settings'
  if (path.startsWith('/world')) return 'world'
  if (path.startsWith('/admin')) return 'admin'
  return 'other'
}

// Track page views to the DB events table (separate from GA4 tracking above)
function DbPageViewTracker() {
  const location = useLocation()
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    trackDbEvent('page_view', undefined, undefined, {
      path: location.pathname,
      feature: getFeatureFromPath(location.pathname),
    })
  }, [location])

  return null
}

// Track session starts to the DB events table
function SessionTracker() {
  const lastActiveRef = useRef<number>(Date.now())

  useEffect(() => {
    const sessionId = sessionStorage.getItem('hockia_engagement_session_id')
    trackDbEvent('session_start', undefined, undefined, { session_id: sessionId })

    const handleVisibility = () => {
      if (!document.hidden) {
        const elapsed = Date.now() - lastActiveRef.current
        if (elapsed > 30 * 60 * 1000) {
          trackDbEvent('session_start', undefined, undefined, {
            session_id: sessionStorage.getItem('hockia_engagement_session_id'),
            resumption: true,
          })
        }
      }
      lastActiveRef.current = Date.now()
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  return null
}

// Scroll to top on forward navigation; skip on back/forward (POP) to allow scroll restoration
function ScrollToTop() {
  const { pathname } = useLocation()
  const navigationType = useNavigationType()
  useEffect(() => {
    if (navigationType === 'POP') return
    // behavior: 'instant' overrides `scroll-smooth` on <html> so route
    // changes don't visibly animate scroll-to-top after the new page
    // has already rendered at the previous scroll position.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname, navigationType])
  return null
}

// Global keyboard shortcuts (/, g+key, ?)
function KeyboardShortcutsManager() {
  const [showHelp, setShowHelp] = useState(false)
  useKeyboardShortcuts({ onShowHelp: () => setShowHelp(true) })
  return <KeyboardShortcutsModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
}

function App() {
  const initRef = useRef(false)

  useEffect(() => {
    // Initialize Google Analytics
    initGA()
  }, [])

  useEffect(() => {
    // Guard against React 18 Strict Mode double initialization
    if (initRef.current) {
      logger.debug('[APP] Already initialized, skipping')
      return
    }
    
    initRef.current = true
    logger.debug('[APP] Initializing auth')
    
    // Initialize auth listener
    const subscription = initializeAuth()
    
    return () => {
      logger.debug('[APP] Cleaning up auth')
      subscription.unsubscribe()
      // Reset on actual unmount (not Strict Mode)
      initRef.current = false
    }
  }, [])

  const isProduction = import.meta.env.MODE === 'production' || import.meta.env.VITE_ENVIRONMENT === 'production'

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ProfileImagePreviewProvider>
          <ToastContainer />
          <UploadIndicator />
          <InstallPrompt />
          <PushPrompt />
          <NativeUpdatePrompt />
          <AppRatingPrompt />
          <ContactModal />
          <EngagementTracker />
          <AnalyticsTracker />
          <DbPageViewTracker />
          <SessionTracker />
          <ScrollToTop />
          <KeyboardShortcutsManager />
          {!isProduction && <SentryTestButton />}
          <TermsGate>
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                {/* Public Routes (allowlisted in ProtectedRoute) */}
                <Route path="/" element={<ErrorBoundary fallback={<RouteErrorFallback />}><Landing /></ErrorBoundary>} />
                <Route path="/signup" element={<ErrorBoundary fallback={<RouteErrorFallback />}><SignUp /></ErrorBoundary>} />
                <Route path="/signin" element={<ErrorBoundary fallback={<RouteErrorFallback />}><AuthScreen mode="signin" /></ErrorBoundary>} />
                <Route path="/auth/callback" element={<ErrorBoundary fallback={<RouteErrorFallback />}><AuthCallback /></ErrorBoundary>} />
                <Route path="/verify-email" element={<ErrorBoundary fallback={<RouteErrorFallback />}><VerifyEmail /></ErrorBoundary>} />
                <Route path="/forgot-password" element={<ErrorBoundary fallback={<RouteErrorFallback />}><ForgotPassword /></ErrorBoundary>} />
                <Route path="/reset-password" element={<ErrorBoundary fallback={<RouteErrorFallback />}><ResetPassword /></ErrorBoundary>} />
                <Route path="/privacy-policy" element={<PrivacyPolicy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/developers" element={<DevelopersPage />} />
                <Route path="/offline" element={<OfflinePage />} />
                
                {/* World Directory (public) */}
                <Route path="/world" element={<WorldPage />} />
                <Route path="/world/clubs/:id" element={<WorldClubPage />} />
                <Route path="/world/:countrySlug" element={<WorldCountryPage />} />
                <Route path="/world/:countrySlug/:provinceSlug" element={<WorldProvincePage />} />

                {/* Single-post permalink. Public-readable (matches the
                    user_posts RLS posture) so external share links work
                    for unauthenticated visitors. Like/comment actions
                    still require auth via the underlying RLS. */}
                <Route path="/post/:postId" element={<PostPage />} />

                {/* Marketplace (canonical brand discovery surface — products + brand directory) */}
                <Route path="/marketplace" element={<ErrorBoundary fallback={<RouteErrorFallback />}><MarketplacePage /></ErrorBoundary>} />

                {/* Legacy brand routes — redirect to canonical marketplace.
                    Note: /community/brands is NOT redirected here — it's
                    a real role filter inside the Community page now
                    (May 2026 QA pass). Marketplace still exists for the
                    products surface and featured brand discovery. */}
                <Route path="/brands" element={<Navigate to="/marketplace" replace />} />
                <Route path="/brands/onboarding" element={<ErrorBoundary fallback={<RouteErrorFallback />}><BrandOnboardingPage /></ErrorBoundary>} />
                {/* id-fallback for brands — mirrors /players/id/:id etc.
                    Resolves brand profile_id → slug, then redirects to
                    /brands/:slug. Used when notifications or friend lists
                    only know the brand's auth user id. */}
                <Route path="/brands/id/:id" element={<BrandIdRedirect />} />
                <Route path="/brands/:slug" element={<BrandProfilePage />} />
                {/* Legacy /dashboard/brand was a stripped-down edit-only page;
                    canonical brand UX now lives at /dashboard/profile (rich
                    BrandDashboard via DashboardRouter). Redirect any stale
                    bookmarks rather than 404. */}
                <Route path="/dashboard/brand" element={<Navigate to="/dashboard/profile" replace />} />

                {/* Public Investor Dashboard (shareable link) */}
                <Route path="/investors/:token" element={<PublicInvestorDashboard />} />

                {/* Club invite link (public — sign-in prompted for guests) */}
                <Route path="/invite/club/:token" element={<ClubInviteLanding />} />

                {/* Digest email one-click triage landing (public — the token
                    is the authorization; see EmailActionPage) */}
                <Route path="/email-action" element={<EmailActionPage />} />
                
                {/* Protected Routes (require authentication) - Lazy loaded */}
                <Route path="/complete-profile" element={<ErrorBoundary fallback={<RouteErrorFallback />}><CompleteProfile /></ErrorBoundary>} />
                <Route path="/home" element={<ErrorBoundary fallback={<RouteErrorFallback />}><HomePage /></ErrorBoundary>} />
                <Route path="/search" element={<ErrorBoundary fallback={<RouteErrorFallback />}><SearchPage /></ErrorBoundary>} />
                <Route path="/discover" element={<ErrorBoundary fallback={<RouteErrorFallback />}><DiscoverPage /></ErrorBoundary>} />
                {/* Alias: /discovery → /discover. Some users (and external
                    links) have used the longer name; keep them out of 404. */}
                <Route path="/discovery" element={<Navigate to="/discover" replace />} />
                <Route path="/discovery/:rest" element={<Navigate to="/discover" replace />} />
                <Route path="/community" element={<ErrorBoundary fallback={<RouteErrorFallback />}><CommunityPage /></ErrorBoundary>} />
                <Route path="/community/:tab" element={<ErrorBoundary fallback={<RouteErrorFallback />}><CommunityPage /></ErrorBoundary>} />
                <Route path="/community/questions/:questionId" element={<ErrorBoundary fallback={<RouteErrorFallback />}><QuestionDetailPage /></ErrorBoundary>} />
                <Route path="/opportunities" element={<ErrorBoundary fallback={<RouteErrorFallback />}><OpportunitiesPage /></ErrorBoundary>} />
                <Route path="/opportunities/:id" element={<ErrorBoundary fallback={<RouteErrorFallback />}><OpportunityDetailPage /></ErrorBoundary>} />
                <Route path="/messages" element={<ErrorBoundary fallback={<RouteErrorFallback />}><MessagesPage /></ErrorBoundary>} />
                <Route path="/messages/:conversationId" element={<ErrorBoundary fallback={<RouteErrorFallback />}><MessagesPage /></ErrorBoundary>} />
                {/* /notifications was an unrouted dead-link (the UI lives in
                    a global drawer, not a page). Email/bookmark deep-links
                    used to hit the 404. Handler opens the drawer + redirects
                    to /home so the URL has a real destination. */}
                <Route path="/notifications" element={<ErrorBoundary fallback={<RouteErrorFallback />}><NotificationsRedirect /></ErrorBoundary>} />
                <Route path="/settings" element={<ErrorBoundary fallback={<RouteErrorFallback />}><SettingsPage /></ErrorBoundary>} />
                {/* Bare /dashboard 404'd in production — the bottom-nav
                    label is "Dashboard" and users typed it directly. Redirect
                    to the canonical /dashboard/profile. */}
                <Route path="/dashboard" element={<Navigate to="/dashboard/profile" replace />} />
                {/* /dashboard/community was a stale link target that 404'd
                    in the wild (QA found it in a notification path). Send
                    it to the player Community hub instead of nowhere. */}
                <Route path="/dashboard/community" element={<Navigate to="/dashboard/profile/community" replace />} />
                <Route path="/dashboard/profile" element={<ErrorBoundary fallback={<RouteErrorFallback />}><DashboardRouter /></ErrorBoundary>} />
                {/* PR2 — promote the player Bento Grid card CTAs from
                    ?tab=X to /:section route segments. Coach/Club/Umpire/
                    Brand dashboards stay on ?tab= until their own Bento
                    conversion lands; if a non-player role mounts under
                    /:section, their dashboard renders its landing
                    (section param is silently ignored, no crash). */}
                <Route path="/dashboard/profile/:section" element={<ErrorBoundary fallback={<RouteErrorFallback />}><DashboardRouter /></ErrorBoundary>} />
                <Route path="/dashboard/opportunities/:opportunityId/applicants" element={<ErrorBoundary fallback={<RouteErrorFallback />}><ApplicantsList /></ErrorBoundary>} />
                <Route path="/dashboard/saved" element={<ErrorBoundary fallback={<RouteErrorFallback />}><SavedCandidatesPage /></ErrorBoundary>} />
                <Route path="/dashboard/shortlists" element={<ErrorBoundary fallback={<RouteErrorFallback />}><ShortlistsIndexPage /></ErrorBoundary>} />
                <Route path="/dashboard/shortlists/:id" element={<ErrorBoundary fallback={<RouteErrorFallback />}><ShortlistDetailPage /></ErrorBoundary>} />

                {/* Network-only profile routes (alias for clarity; still behind auth) */}
                <Route path="/members/:username" element={<PublicPlayerProfile />} />
                <Route path="/members/id/:id" element={<PublicPlayerProfile />} />
                <Route path="/members/:username/:section" element={<PublicPlayerProfile />} />
                <Route path="/members/id/:id/:section" element={<PublicPlayerProfile />} />

                <Route path="/players/:username" element={<PublicPlayerProfile />} />
                <Route path="/players/id/:id" element={<PublicPlayerProfile />} />
                <Route path="/players/:username/:section" element={<PublicPlayerProfile />} />
                <Route path="/players/id/:id/:section" element={<PublicPlayerProfile />} />
                {/* Coaches share PublicPlayerProfile (multi-role union per
                    PublicPlayerProfile.tsx) but several call sites build
                    /coaches/<...> URLs directly (BrandDashboard followers,
                    ProfileCompletionCard, etc). Without these aliases those
                    clicks 404. Cheap fix; same component renders coach view. */}
                <Route path="/coaches/:username" element={<PublicPlayerProfile />} />
                <Route path="/coaches/id/:id" element={<PublicPlayerProfile />} />
                {/* Coach Bento Grid (May 2026) promoted each section to
                    its own URL segment, mirroring the Player redesign.
                    PublicPlayerProfile dispatches coach profiles to
                    CoachDashboard which reads :section from the route. */}
                <Route path="/coaches/:username/:section" element={<PublicPlayerProfile />} />
                <Route path="/coaches/id/:id/:section" element={<PublicPlayerProfile />} />
                <Route path="/clubs/:username" element={<PublicClubProfile />} />
                <Route path="/clubs/id/:id" element={<PublicClubProfile />} />
                {/* Club Bento Grid (May 2026) promoted each section to
                    its own URL segment, mirroring the Coach redesign.
                    PublicClubProfile dispatches to ClubDashboard which
                    reads :section from the route. */}
                <Route path="/clubs/:username/:section" element={<PublicClubProfile />} />
                <Route path="/clubs/id/:id/:section" element={<PublicClubProfile />} />
                <Route path="/umpires/:username" element={<PublicUmpireProfile />} />
                <Route path="/umpires/id/:id" element={<PublicUmpireProfile />} />
                
                {/* Admin Routes - Protected + Admin Guard */}
                <Route path="/admin" element={<ErrorBoundary fallback={<RouteErrorFallback />}><AdminGuard><AdminLayout /></AdminGuard></ErrorBoundary>}>
                  <Route index element={<Navigate to="/admin/overview" replace />} />
                  <Route path="overview" element={<AdminOverview />} />
                  <Route path="opportunities" element={<AdminOpportunities />} />
                  <Route path="opportunities/:id" element={<AdminOpportunityDetail />} />
                  {/* Phase 2C: Player / Club / Brand Analytics consolidated
                      into a tabbed Users & Roles page. Old per-role URLs
                      redirect into the matching tab so bookmarks survive. */}
                  <Route path="users" element={<AdminUsers />} />
                  <Route path="users/:role" element={<AdminUsers />} />
                  <Route path="players" element={<Navigate to="/admin/users/players" replace />} />
                  <Route path="clubs" element={<Navigate to="/admin/users/clubs" replace />} />
                  <Route path="brands" element={<Navigate to="/admin/users/brands" replace />} />
                  <Route path="player-analytics" element={<Navigate to="/admin/users/players" replace />} />
                  {/* Phase 2A: removed-from-sidebar pages still answer URLs
                      (kept reachable for bookmarks; pages themselves remain).
                      search-quality was subsumed by Discovery; networking
                      duplicated Messaging Health; investors moved to a
                      button on Overview but the page is still useful. */}
                  <Route path="search-quality" element={<Navigate to="/admin/discovery" replace />} />
                  <Route path="networking" element={<Navigate to="/admin/messaging-health" replace />} />
                  <Route path="engagement" element={<AdminEngagement />} />
                  <Route path="feature-usage" element={<AdminFeatureUsage />} />
                  <Route path="ai-opinions" element={<AdminAIOpinions />} />
                  <Route path="feedback" element={<AdminFeedback />} />
                  <Route path="app-ratings" element={<AdminAppRatings />} />
                  <Route path="discovery" element={<AdminDiscovery />} />
                  {/* networking page removed Phase 2A — old URL caught by redirect above */}
                  <Route path="devices" element={<AdminDeviceUsers />} />
                  <Route path="devices/:platform" element={<AdminDeviceUsers />} />
                  <Route path="email" element={<AdminEmail />} />
                  <Route path="email/template/:templateId" element={<AdminEmailTemplateEditor />} />
                  <Route path="outreach" element={<AdminOutreach />} />
                  <Route path="preferences" element={<AdminPreferences />} />
                  <Route path="feed" element={<AdminFeedAnalytics />} />
                  <Route path="community" element={<AdminCommunity />} />
                  <Route path="monthly-report" element={<AdminMonthlyReport />} />
                  {/* search-quality page removed Phase 2A — old URL caught by redirect above */}
                  <Route path="messaging-health" element={<AdminMessagingHealth />} />
                  <Route path="attribution" element={<AdminAttribution />} />
                  <Route path="countries" element={<AdminCountries />} />
                  {/* Phase 2D: Funnels & Health / Onboarding Funnel / Churn
                      consolidated into a tabbed Product Health page. Old
                      per-page URLs redirect into the matching tab so
                      bookmarks survive. The underlying components are
                      still rendered (composed inside AdminProductHealth). */}
                  <Route path="product-health" element={<AdminProductHealth />} />
                  <Route path="product-health/:tab" element={<AdminProductHealth />} />
                  <Route path="funnels" element={<Navigate to="/admin/product-health/activation" replace />} />
                  <Route path="onboarding" element={<Navigate to="/admin/product-health/onboarding" replace />} />
                  <Route path="churn" element={<Navigate to="/admin/product-health/retention" replace />} />
                  <Route path="investors" element={<AdminInvestorDashboard />} />
                  <Route path="world" element={<AdminWorld />} />
                  <Route path="data-issues" element={<AdminDataIssues />} />
                  <Route path="directory" element={<AdminDirectory />} />
                  <Route path="reports" element={<AdminReports />} />
                  <Route path="audit-log" element={<AdminAuditLog />} />
                  <Route path="settings" element={<AdminSettings />} />
                </Route>
                
                  {/* 404 */}
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </Suspense>
            </Layout>
          </ProtectedRoute>
          </TermsGate>
        </ProfileImagePreviewProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
