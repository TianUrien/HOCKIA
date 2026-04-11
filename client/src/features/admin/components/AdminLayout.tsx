/**
 * AdminLayout Component
 *
 * Layout wrapper for admin pages with sidebar navigation.
 * Features:
 * - Responsive sidebar (collapsible on mobile)
 * - Global user search in header
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  AlertTriangle,
  ScrollText,
  Settings,
  ArrowLeft,
  Briefcase,
  Building2,
  UserCheck,
  Activity,
  Store,
  Globe2,
  PieChart,
  Network,
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
  UserPlus,
  SearchCheck,
  MessageSquare,
  Share2,
  TrendingDown,
  Flag,
} from 'lucide-react'
import { searchProfiles } from '../api/adminApi'
import type { AdminProfileListItem } from '../types'

const NAV_ITEMS = [
  { path: '/admin/overview', icon: LayoutDashboard, label: 'Overview', exact: true },
  { path: '/admin/opportunities', icon: Briefcase, label: 'Opportunities' },
  { path: '/admin/clubs', icon: Building2, label: 'Club Analytics' },
  { path: '/admin/players', icon: UserCheck, label: 'Player Analytics' },
  { path: '/admin/brands', icon: Store, label: 'Brand Analytics' },
  { path: '/admin/engagement', icon: Activity, label: 'User Engagement' },
  { path: '/admin/feature-usage', icon: BarChart3, label: 'Feature Usage' },
  { path: '/admin/feed', icon: Heart, label: 'Feed & Content' },
  { path: '/admin/funnels', icon: GitBranch, label: 'Funnels & Health' },
  { path: '/admin/onboarding', icon: UserPlus, label: 'Onboarding Funnel' },
  { path: '/admin/churn', icon: TrendingDown, label: 'Churn & Retention' },
  { path: '/admin/attribution', icon: Share2, label: 'Attribution' },
  { path: '/admin/search-quality', icon: SearchCheck, label: 'Search Quality' },
  { path: '/admin/messaging-health', icon: MessageSquare, label: 'Messaging Health' },
  { path: '/admin/community', icon: HelpCircle, label: 'Community' },
  { path: '/admin/preferences', icon: ToggleRight, label: 'User Preferences' },
  { path: '/admin/discovery', icon: Sparkles, label: 'Discovery' },
  { path: '/admin/networking', icon: Network, label: 'Networking' },
  { path: '/admin/email', icon: Mail, label: 'Email' },
  { path: '/admin/outreach', icon: Megaphone, label: 'Outreach' },
  { path: '/admin/monthly-report', icon: FileText, label: 'Monthly Report' },
  { path: '/admin/investors', icon: PieChart, label: 'Investors' },
  { path: '/admin/world', icon: Globe2, label: 'Hockey World' },
  { path: '/admin/directory', icon: Users, label: 'Directory' },
  { path: '/admin/data-issues', icon: AlertTriangle, label: 'Data Issues' },
  { path: '/admin/reports', icon: Flag, label: 'Content Reports' },
  { path: '/admin/audit-log', icon: ScrollText, label: 'Audit Log' },
  { path: '/admin/settings', icon: Settings, label: 'Settings' },
]

export function AdminLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

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

            {/* Right section */}
            <div className="flex items-center gap-4 flex-shrink-0">
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
          <nav className="p-4 space-y-1 overflow-y-auto h-[calc(100%-6rem)]">
            {NAV_ITEMS.map((item) => {
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
          </nav>

          <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200 bg-white">
            <div className="px-3 py-2 bg-amber-50 rounded-lg">
              <p className="text-xs font-medium text-amber-800">⚠️ Admin Access</p>
              <p className="text-xs text-amber-600 mt-1">
                Actions here affect real user data.
              </p>
            </div>
          </div>
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
