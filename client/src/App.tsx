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
      const isStale =
        msg.includes('failed to fetch dynamically imported module') ||
        msg.includes('failed to load module script')

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

// Brand pages
const BrandProfilePage = lazyWithRetry(() => import('@/pages/BrandProfilePage'))
const BrandOnboardingPage = lazyWithRetry(() => import('@/pages/BrandOnboardingPage'))
const BrandDashboardPage = lazyWithRetry(() => import('@/pages/BrandDashboardPage'))

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
const AdminClubs = lazyWithRetry(() => import('@/features/admin/pages/AdminClubs').then(m => ({ default: m.AdminClubs })))
const AdminBrands = lazyWithRetry(() => import('@/features/admin/pages/AdminBrands').then(m => ({ default: m.AdminBrands })))
const AdminPlayers = lazyWithRetry(() => import('@/features/admin/pages/AdminPlayers').then(m => ({ default: m.AdminPlayers })))
const AdminEngagement = lazyWithRetry(() => import('@/features/admin/pages/AdminEngagement').then(m => ({ default: m.AdminEngagement })))
const AdminFeatureUsage = lazyWithRetry(() => import('@/features/admin/pages/AdminFeatureUsage').then(m => ({ default: m.AdminFeatureUsage })))
const AdminDiscovery = lazyWithRetry(() => import('@/features/admin/pages/AdminDiscovery').then(m => ({ default: m.AdminDiscovery })))
const AdminNetworking = lazyWithRetry(() => import('@/features/admin/pages/AdminNetworking').then(m => ({ default: m.AdminNetworking })))
const AdminDeviceUsers = lazyWithRetry(() => import('@/features/admin/pages/AdminDeviceUsers').then(m => ({ default: m.AdminDeviceUsers })))
const AdminInvestorDashboard = lazyWithRetry(() => import('@/features/admin/pages/AdminInvestorDashboard').then(m => ({ default: m.AdminInvestorDashboard })))
const AdminWorld = lazyWithRetry(() => import('@/features/admin/pages/AdminWorld'))
const AdminEmail = lazyWithRetry(() => import('@/features/admin/pages/AdminEmail').then(m => ({ default: m.AdminEmail })))
const AdminEmailTemplateEditor = lazyWithRetry(() => import('@/features/admin/pages/AdminEmailTemplateEditor').then(m => ({ default: m.AdminEmailTemplateEditor })))
const AdminOutreach = lazyWithRetry(() => import('@/features/admin/pages/AdminOutreach'))
const AdminPreferences = lazyWithRetry(() => import('@/features/admin/pages/AdminPreferences'))
const AdminFeedAnalytics = lazyWithRetry(() => import('@/features/admin/pages/AdminFeedAnalytics').then(m => ({ default: m.AdminFeedAnalytics })))
const AdminFunnels = lazyWithRetry(() => import('@/features/admin/pages/AdminFunnels').then(m => ({ default: m.AdminFunnels })))
const AdminCommunity = lazyWithRetry(() => import('@/features/admin/pages/AdminCommunity').then(m => ({ default: m.AdminCommunity })))
const AdminMonthlyReport = lazyWithRetry(() => import('@/features/admin/pages/AdminMonthlyReport').then(m => ({ default: m.AdminMonthlyReport })))
const AdminOnboardingFunnel = lazyWithRetry(() => import('@/features/admin/pages/AdminOnboardingFunnel').then(m => ({ default: m.AdminOnboardingFunnel })))
const AdminSearchQuality = lazyWithRetry(() => import('@/features/admin/pages/AdminSearchQuality').then(m => ({ default: m.AdminSearchQuality })))
const AdminMessagingHealth = lazyWithRetry(() => import('@/features/admin/pages/AdminMessagingHealth').then(m => ({ default: m.AdminMessagingHealth })))
const AdminAttribution = lazyWithRetry(() => import('@/features/admin/pages/AdminAttribution').then(m => ({ default: m.AdminAttribution })))
const AdminChurn = lazyWithRetry(() => import('@/features/admin/pages/AdminChurn').then(m => ({ default: m.AdminChurn })))

// Public investor dashboard (no auth required)
const PublicInvestorDashboard = lazyWithRetry(() => import('@/pages/PublicInvestorDashboard'))

// 404 page
const NotFoundPage = lazyWithRetry(() => import('@/pages/NotFoundPage'))

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
  const isFirstRender = useRef(true)

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

    // Skip the initial render (GA handles it via initGA)
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    trackPageView(location.pathname + location.search)
  }, [location])

  return null
}

// Map route paths to feature categories for analytics attribution
function getFeatureFromPath(path: string): string {
  if (path.startsWith('/home') || path === '/') return 'feed'
  if (path.startsWith('/messages')) return 'messaging'
  if (path.startsWith('/opportunities')) return 'marketplace'
  if (path.startsWith('/community')) return 'community'
  if (path.startsWith('/search')) return 'search'
  if (path.startsWith('/discover')) return 'discovery'
  if (path.startsWith('/player/') || path.startsWith('/club/') || path.startsWith('/coach/') || path.startsWith('/brand/')) return 'profiles'
  if (path.startsWith('/dashboard/profile')) return 'profiles'
  if (path.startsWith('/dashboard')) return 'dashboard'
  if (path.startsWith('/settings')) return 'settings'
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
    window.scrollTo(0, 0)
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
                <Route path="/world/:countrySlug" element={<WorldCountryPage />} />
                <Route path="/world/:countrySlug/:provinceSlug" element={<WorldProvincePage />} />

                {/* Brands (redirect /brands to community tab, keep profile routes) */}
                <Route path="/brands" element={<Navigate to="/community/brands" replace />} />
                <Route path="/brands/onboarding" element={<ErrorBoundary fallback={<RouteErrorFallback />}><BrandOnboardingPage /></ErrorBoundary>} />
                <Route path="/brands/:slug" element={<BrandProfilePage />} />
                <Route path="/dashboard/brand" element={<BrandDashboardPage />} />

                {/* Public Investor Dashboard (shareable link) */}
                <Route path="/investors/:token" element={<PublicInvestorDashboard />} />
                
                {/* Protected Routes (require authentication) - Lazy loaded */}
                <Route path="/complete-profile" element={<ErrorBoundary fallback={<RouteErrorFallback />}><CompleteProfile /></ErrorBoundary>} />
                <Route path="/home" element={<ErrorBoundary fallback={<RouteErrorFallback />}><HomePage /></ErrorBoundary>} />
                <Route path="/search" element={<ErrorBoundary fallback={<RouteErrorFallback />}><SearchPage /></ErrorBoundary>} />
                <Route path="/discover" element={<ErrorBoundary fallback={<RouteErrorFallback />}><DiscoverPage /></ErrorBoundary>} />
                <Route path="/community" element={<ErrorBoundary fallback={<RouteErrorFallback />}><CommunityPage /></ErrorBoundary>} />
                <Route path="/community/:tab" element={<ErrorBoundary fallback={<RouteErrorFallback />}><CommunityPage /></ErrorBoundary>} />
                <Route path="/community/questions/:questionId" element={<ErrorBoundary fallback={<RouteErrorFallback />}><QuestionDetailPage /></ErrorBoundary>} />
                <Route path="/opportunities" element={<ErrorBoundary fallback={<RouteErrorFallback />}><OpportunitiesPage /></ErrorBoundary>} />
                <Route path="/opportunities/:id" element={<ErrorBoundary fallback={<RouteErrorFallback />}><OpportunityDetailPage /></ErrorBoundary>} />
                <Route path="/messages" element={<ErrorBoundary fallback={<RouteErrorFallback />}><MessagesPage /></ErrorBoundary>} />
                <Route path="/messages/:conversationId" element={<ErrorBoundary fallback={<RouteErrorFallback />}><MessagesPage /></ErrorBoundary>} />
                <Route path="/settings" element={<ErrorBoundary fallback={<RouteErrorFallback />}><SettingsPage /></ErrorBoundary>} />
                <Route path="/dashboard/profile" element={<ErrorBoundary fallback={<RouteErrorFallback />}><DashboardRouter /></ErrorBoundary>} />
                <Route path="/dashboard/opportunities/:opportunityId/applicants" element={<ErrorBoundary fallback={<RouteErrorFallback />}><ApplicantsList /></ErrorBoundary>} />

                {/* Network-only profile routes (alias for clarity; still behind auth) */}
                <Route path="/members/:username" element={<PublicPlayerProfile />} />
                <Route path="/members/id/:id" element={<PublicPlayerProfile />} />

                <Route path="/players/:username" element={<PublicPlayerProfile />} />
                <Route path="/players/id/:id" element={<PublicPlayerProfile />} />
                <Route path="/clubs/:username" element={<PublicClubProfile />} />
                <Route path="/clubs/id/:id" element={<PublicClubProfile />} />
                <Route path="/umpires/:username" element={<PublicUmpireProfile />} />
                <Route path="/umpires/id/:id" element={<PublicUmpireProfile />} />
                
                {/* Admin Routes - Protected + Admin Guard */}
                <Route path="/admin" element={<ErrorBoundary fallback={<RouteErrorFallback />}><AdminGuard><AdminLayout /></AdminGuard></ErrorBoundary>}>
                  <Route index element={<Navigate to="/admin/overview" replace />} />
                  <Route path="overview" element={<AdminOverview />} />
                  <Route path="opportunities" element={<AdminOpportunities />} />
                  <Route path="opportunities/:id" element={<AdminOpportunityDetail />} />
                  <Route path="clubs" element={<AdminClubs />} />
                  <Route path="brands" element={<AdminBrands />} />
                  <Route path="players" element={<AdminPlayers />} />
                  <Route path="engagement" element={<AdminEngagement />} />
                  <Route path="feature-usage" element={<AdminFeatureUsage />} />
                  <Route path="discovery" element={<AdminDiscovery />} />
                  <Route path="networking" element={<AdminNetworking />} />
                  <Route path="devices" element={<AdminDeviceUsers />} />
                  <Route path="devices/:platform" element={<AdminDeviceUsers />} />
                  <Route path="email" element={<AdminEmail />} />
                  <Route path="email/template/:templateId" element={<AdminEmailTemplateEditor />} />
                  <Route path="outreach" element={<AdminOutreach />} />
                  <Route path="preferences" element={<AdminPreferences />} />
                  <Route path="feed" element={<AdminFeedAnalytics />} />
                  <Route path="funnels" element={<AdminFunnels />} />
                  <Route path="community" element={<AdminCommunity />} />
                  <Route path="monthly-report" element={<AdminMonthlyReport />} />
                  <Route path="onboarding" element={<AdminOnboardingFunnel />} />
                  <Route path="search-quality" element={<AdminSearchQuality />} />
                  <Route path="messaging-health" element={<AdminMessagingHealth />} />
                  <Route path="attribution" element={<AdminAttribution />} />
                  <Route path="churn" element={<AdminChurn />} />
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
