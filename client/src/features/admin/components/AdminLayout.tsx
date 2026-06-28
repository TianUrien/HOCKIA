/**
 * AdminLayout Component
 *
 * Layout wrapper for admin pages with sidebar navigation.
 * Features:
 * - Responsive sidebar (collapsible on mobile)
 * - Global user search in header
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type { ComponentType } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  AlertTriangle,
  ScrollText,
  Settings,
  ArrowLeft,
  Briefcase,
  UserCheck,
  Activity,
  Globe2,
  Mail,
  Megaphone,
  BarChart3,
  ToggleRight,
  Sparkles,
  FileText,
  Heart,
  GitBranch,
  HelpCircle,
  Menu,
  X,
  Search,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Star,
  Share2,
  Flag,
  ChevronRight,
} from 'lucide-react'
import { searchProfiles } from '../api/adminApi'
import type { AdminProfileListItem } from '../types'

interface NavItem {
  path: string
  icon: ComponentType<{ className?: string }>
  label: string
  exact?: boolean
}

interface NavSection {
  /** Display label for the collapsible group header. Set to null for the
   *  single-item Overview row which renders without a section heading. */
  label: string | null
  /** Stable key for localStorage persistence of collapsed state. */
  key: string
  items: NavItem[]
}

// Phase 2B (admin IA audit, 2026-05-25): 25 items grouped into 6 sections
// so the sidebar is scannable instead of an alphabet soup. Section order
// is the audit's "Six Loops" lens — Overview → Users → Opportunities →
// Product Health → Engagement+Comms → System.
//
// Page mergers (Player/Club/Brand → Users & Roles tabs; Funnels/Onboarding/
// Churn → Product Health tabs) are Phase 2C/2D — separate slices because
// they touch page state, not just nav.
const NAV_SECTIONS: NavSection[] = [
  {
    label: null,
    key: 'overview',
    items: [
      { path: '/admin/overview', icon: LayoutDashboard, label: 'Overview', exact: true },
    ],
  },
  {
    // Phase 2C — Player / Club / Brand Analytics consolidated into a
    // single tabbed page (/admin/users). The single sidebar entry
    // points at the default tab (players); switching tabs is in-page.
    label: 'Users & Roles',
    key: 'users',
    items: [
      { path: '/admin/users', icon: UserCheck, label: 'Role Analytics' },
      { path: '/admin/countries', icon: Globe2, label: 'Countries' },
      { path: '/admin/directory', icon: Users, label: 'User Directory' },
    ],
  },
  {
    label: 'Opportunities',
    key: 'opportunities',
    items: [
      { path: '/admin/opportunities', icon: Briefcase, label: 'Opportunities' },
    ],
  },
  {
    // Phase 2D — Funnels & Health / Onboarding / Churn consolidated
    // into a tabbed Product Health page. User Engagement, Feature
    // Usage, and Attribution stay separate because they cover
    // different aspects (raw usage, feature adoption, cross-feature
    // attribution) — they don't share a "funnel" lens that would
    // make tabs meaningful.
    label: 'Product Health',
    key: 'health',
    items: [
      { path: '/admin/engagement', icon: Activity, label: 'User Engagement' },
      { path: '/admin/feature-usage', icon: BarChart3, label: 'Feature Usage' },
      { path: '/admin/ai-opinions', icon: Sparkles, label: 'AI Opinions' },
      { path: '/admin/feedback', icon: MessageSquarePlus, label: 'User Feedback' },
      { path: '/admin/app-ratings', icon: Star, label: 'App Ratings' },
      { path: '/admin/product-health', icon: GitBranch, label: 'Funnels & Retention' },
      { path: '/admin/attribution', icon: Share2, label: 'Attribution' },
    ],
  },
  {
    label: 'Engagement & Comms',
    key: 'comms',
    items: [
      { path: '/admin/messaging-health', icon: MessageSquare, label: 'Messaging Health' },
      { path: '/admin/community', icon: HelpCircle, label: 'Community' },
      { path: '/admin/feed', icon: Heart, label: 'Feed & Content' },
      { path: '/admin/reports', icon: Flag, label: 'Content Reports' },
      { path: '/admin/discovery', icon: Sparkles, label: 'Discovery' },
      { path: '/admin/email', icon: Mail, label: 'Email' },
      { path: '/admin/outreach', icon: Megaphone, label: 'Outreach' },
      { path: '/admin/monthly-report', icon: FileText, label: 'Monthly Report' },
    ],
  },
  {
    label: 'System',
    key: 'system',
    items: [
      { path: '/admin/world', icon: Globe2, label: 'Clubs Directory (World)' },
      { path: '/admin/data-issues', icon: AlertTriangle, label: 'Data Integrity' },
      { path: '/admin/preferences', icon: ToggleRight, label: 'User Preferences' },
      { path: '/admin/audit-log', icon: ScrollText, label: 'Audit Log' },
      { path: '/admin/settings', icon: Settings, label: 'Settings' },
    ],
  },
]

const COLLAPSED_STORAGE_KEY = 'admin.sidebar.collapsed.v1'

function loadCollapsedSections(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set()
  }
}

function saveCollapsedSections(collapsed: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...collapsed]))
  } catch {
    // localStorage full or disabled — silently skip; collapse state just
    // doesn't persist across reloads. Not worth surfacing to the user.
  }
}

export function AdminLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  // Collapsible section state. Persisted to localStorage so Tian's chosen
  // collapse layout sticks across reloads. The section containing the
  // active route is force-expanded below so a collapsed section never
  // hides where you currently are.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() =>
    loadCollapsedSections(),
  )

  // Resolve which section owns the active route — that section is always
  // expanded regardless of saved collapse state. Otherwise navigating
  // into a collapsed section would hide the current page in the sidebar.
  const activeSectionKey = useMemo(() => {
    for (const section of NAV_SECTIONS) {
      const match = section.items.some((item) =>
        item.exact
          ? location.pathname === item.path
          : location.pathname.startsWith(item.path),
      )
      if (match) return section.key
    }
    return null
  }, [location.pathname])

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      saveCollapsedSections(next)
      return next
    })
  }, [])

  // Global search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<AdminProfileListItem[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showSearchResults, setShowSearchResults] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  // Close sidebar when route changes
  useEffect(() => {
    setIsSidebarOpen(false)
  }, [location.pathname])

  // Close search results when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSearchResults(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([])
      setShowSearchResults(false)
      return
    }

    const timer = setTimeout(async () => {
      setIsSearching(true)
      try {
        const { profiles } = await searchProfiles({ query: searchQuery, limit: 5 })
        setSearchResults(profiles)
        setShowSearchResults(true)
      } catch {
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery])

  const handleSelectUser = useCallback((profileId: string) => {
    setSearchQuery('')
    setShowSearchResults(false)
    setSearchResults([])
    // Navigate to directory with the user selected
    navigate(`/admin/directory?profile=${profileId}`)
  }, [navigate])

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowSearchResults(false)
      setSearchQuery('')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-4">
            {/* Left section */}
            <div className="flex items-center gap-4 flex-shrink-0">
              {/* Mobile menu button */}
              <button
                type="button"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="lg:hidden p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                aria-label="Toggle menu"
              >
                {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>

              <a
                href="/dashboard/profile"
                className="hidden sm:flex items-center gap-2 text-gray-500 hover:text-gray-700 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-sm">Back to App</span>
              </a>
              <div className="hidden sm:block h-6 w-px bg-gray-200" />
              <h1 className="text-lg font-semibold text-gray-900">
                <span className="text-purple-600">HOCKIA</span> <span className="hidden sm:inline">Admin</span>
              </h1>
            </div>

            {/* Center section - Global Search */}
            <div ref={searchRef} className="flex-1 max-w-md relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="search"
                  placeholder="Search users by email or name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => searchResults.length > 0 && setShowSearchResults(true)}
                  onKeyDown={handleSearchKeyDown}
                  className="w-full pl-10 pr-10 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent placeholder:text-gray-400"
                  autoComplete="off"
                  enterKeyHint="search"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {isSearching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
                )}
              </div>

              {/* Search Results Dropdown */}
              {showSearchResults && searchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-50">
                  {searchResults.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => handleSelectUser(profile.id)}
                      className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left border-b border-gray-100 last:border-b-0"
                    >
                      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {profile.avatar_url ? (
                          <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xs font-medium text-gray-500">
                            {profile.full_name?.charAt(0) || '?'}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{profile.full_name}</p>
                        <p className="text-xs text-gray-500 truncate">{profile.email}</p>
                      </div>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full flex-shrink-0 ${
                        profile.role === 'player' ? 'bg-[#EFF6FF] text-[#2563EB]' :
                        profile.role === 'coach' ? 'bg-[#F0FDFA] text-[#0D9488]' :
                        profile.role === 'club' ? 'bg-[#FFF7ED] text-[#EA580C]' :
                        profile.role === 'brand' ? 'bg-[#FFF1F2] text-[#E11D48]' :
                        profile.role === 'umpire' ? 'bg-[#FEFCE8] text-[#A16207]' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {profile.role}
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      navigate(`/admin/directory?query=${encodeURIComponent(searchQuery)}`)
                      setShowSearchResults(false)
                      setSearchQuery('')
                    }}
                    className="w-full px-4 py-2 text-sm text-purple-600 hover:bg-purple-50 transition-colors text-center font-medium"
                  >
                    View all results in Directory →
                  </button>
                </div>
              )}

              {/* No results message */}
              {showSearchResults && searchQuery.length >= 2 && !isSearching && searchResults.length === 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-center z-50">
                  <p className="text-sm text-gray-500">No users found for "{searchQuery}"</p>
                </div>
              )}
            </div>

            {/* Right section. The amber "Admin Access" warning used to
                live in the sidebar footer where it ate vertical space on
                every page and got ignored after the first session. Moved
                here as a small pill so it stays visible but unobtrusive. */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <span
                className="hidden sm:inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-amber-50 text-amber-700 rounded-full border border-amber-200"
                title="Actions in this portal affect real user data."
              >
                <AlertTriangle className="w-3 h-3" />
                Live data
              </span>
              <span className="hidden sm:inline-flex px-2 py-1 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">
                Admin Portal
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Mobile sidebar overlay */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-30 lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside className={`
          fixed lg:sticky top-16 left-0 z-40 h-[calc(100vh-4rem)]
          w-64 bg-white border-r border-gray-200
          transform transition-transform duration-200 ease-in-out
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}>
          <nav className="p-4 space-y-4 overflow-y-auto h-full">
            {NAV_SECTIONS.map((section) => {
              // Single-item sections (Overview) render the item flat,
              // no section header or chevron — would be visual noise.
              if (section.label === null) {
                return (
                  <div key={section.key} className="space-y-1">
                    {section.items.map((item) => {
                      const isActive = item.exact
                        ? location.pathname === item.path
                        : location.pathname.startsWith(item.path)
                      return (
                        <NavLink
                          key={item.path}
                          to={item.path}
                          onClick={() => setIsSidebarOpen(false)}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                            isActive
                              ? 'bg-purple-50 text-purple-700'
                              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                          }`}
                        >
                          <item.icon className="w-5 h-5" />
                          {item.label}
                        </NavLink>
                      )
                    })}
                  </div>
                )
              }

              // Force-expand the section containing the active route so a
              // collapsed-by-default section never hides where you are.
              const isCollapsed =
                collapsedSections.has(section.key) && activeSectionKey !== section.key
              // Extracted as an explicitly-typed boolean so the jsx-a11y
              // lint rule can statically verify the aria-expanded value.
              // The inline expression form trips the rule even though
              // the runtime value is valid.
              const ariaExpanded: boolean = !isCollapsed

              return (
                <div key={section.key} className="space-y-1">
                  <button
                    type="button"
                    onClick={() => toggleSection(section.key)}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-600 transition-colors"
                    aria-expanded={ariaExpanded}
                    aria-controls={`nav-section-${section.key}`}
                  >
                    <span>{section.label}</span>
                    <ChevronRight
                      className={`w-3.5 h-3.5 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                    />
                  </button>
                  {!isCollapsed && (
                    <div id={`nav-section-${section.key}`} className="space-y-1">
                      {section.items.map((item) => {
                        const isActive = item.exact
                          ? location.pathname === item.path
                          : location.pathname.startsWith(item.path)
                        return (
                          <NavLink
                            key={item.path}
                            to={item.path}
                            onClick={() => setIsSidebarOpen(false)}
                            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                              isActive
                                ? 'bg-purple-50 text-purple-700'
                                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                            }`}
                          >
                            <item.icon className="w-5 h-5" />
                            {item.label}
                          </NavLink>
                        )
                      })}
                    </div>
                  )
                  }
                </div>
              )
            })}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 p-4 sm:p-6 min-w-0">
          <div className="max-w-6xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
