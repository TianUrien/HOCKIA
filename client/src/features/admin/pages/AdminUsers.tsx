/**
 * AdminUsers — Phase 2C consolidation
 *
 * Tabbed shell over the per-role analytics pages so the sidebar shows
 * one "Users & Roles" entry instead of three (Player / Club / Brand
 * Analytics). The underlying pages are unchanged — they just render
 * inside this shell based on the :role URL param. Old per-role routes
 * (/admin/players, /admin/clubs, /admin/brands) redirect into this
 * page with the matching tab active, so bookmarks survive.
 *
 * Coach and Umpire tabs are deliberately omitted for now — their
 * analytics pages don't exist yet, and the audit recommends adding
 * them as Phase 3 work (per-role onboarding + missing-field metrics).
 */

import { useEffect } from 'react'
import { NavLink, useParams, Navigate } from 'react-router-dom'
import { UserCheck, Building2, Store } from 'lucide-react'
import { AdminPlayers } from './AdminPlayers'
import { AdminClubs } from './AdminClubs'
import { AdminBrands } from './AdminBrands'

type RoleTab = 'players' | 'clubs' | 'brands'

const TABS: Array<{
  key: RoleTab
  label: string
  icon: typeof UserCheck
  title: string
}> = [
  { key: 'players', label: 'Players', icon: UserCheck, title: 'Player Analytics | HOCKIA Admin' },
  { key: 'clubs', label: 'Clubs', icon: Building2, title: 'Club Analytics | HOCKIA Admin' },
  { key: 'brands', label: 'Brands', icon: Store, title: 'Brand Analytics | HOCKIA Admin' },
]

const VALID_ROLES = new Set(TABS.map((t) => t.key))

export function AdminUsers() {
  const { role } = useParams<{ role?: string }>()
  const activeTab = TABS.find((t) => t.key === role)

  // Per-tab document title — keeps each role's tab title meaningful
  // when admin has multiple browser tabs open at different roles.
  // Must run BEFORE the early returns below to satisfy
  // react-hooks/rules-of-hooks (same hook order every render).
  useEffect(() => {
    if (activeTab) document.title = activeTab.title
  }, [activeTab])

  // /admin/users with no role → default to players (consistent with
  // the audit recommendation and what most admins look at first).
  if (!role) {
    return <Navigate to="/admin/users/players" replace />
  }

  // Unknown role (e.g. an old bookmark pointing at /admin/users/coaches
  // when the coach tab doesn't exist yet) → fall back to Players rather
  // than 404. Quiet recovery.
  if (!VALID_ROLES.has(role as RoleTab)) {
    return <Navigate to="/admin/users/players" replace />
  }

  const activeKey = role as RoleTab

  return (
    <div className="space-y-6">
      {/* Tab nav. Renders as NavLinks so deep-links (e.g. from email
          or a saved bookmark) drive the active tab via the URL — no
          local state needed. No outer "Users & Roles" h1 because each
          inner page (AdminPlayers etc.) already has its own h1; the
          tabs make the section clear without visual duplication. */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Users by role">
          {TABS.map((tab) => (
            <NavLink
              key={tab.key}
              to={`/admin/users/${tab.key}`}
              className={({ isActive }) =>
                `flex items-center gap-2 px-1 py-3 border-b-2 text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? 'border-purple-600 text-purple-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`
              }
              end
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Render the underlying role page. These are the existing pages
          unchanged — they keep their own filters, RPC calls, internal
          state, and document.title (the per-tab title above gets
          overridden inside each page, which is fine — last-write wins). */}
      <div>
        {activeKey === 'players' && <AdminPlayers />}
        {activeKey === 'clubs' && <AdminClubs />}
        {activeKey === 'brands' && <AdminBrands />}
      </div>
    </div>
  )
}
