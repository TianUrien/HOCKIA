/**
 * AdminProductHealth — Phase 2D consolidation
 *
 * Tabbed shell over the three product-health pages so the sidebar shows
 * one "Product Health" entry instead of three (Funnels & Health,
 * Onboarding Funnel, Churn & Retention). Underlying pages are unchanged
 * — they render inside this shell based on the :tab URL param. Old
 * routes redirect into the matching tab so bookmarks survive.
 *
 * Activation = the existing AdminFunnels page (signup → activation flow
 * across all roles). Onboarding = AdminOnboardingFunnel (step-by-step
 * drop-off in the onboarding wizard). Retention = AdminChurn (cohort
 * retention + at-risk users).
 */

import { useEffect } from 'react'
import { NavLink, useParams, Navigate } from 'react-router-dom'
import { GitBranch, UserPlus, TrendingDown } from 'lucide-react'
import { AdminFunnels } from './AdminFunnels'
import { AdminOnboardingFunnel } from './AdminOnboardingFunnel'
import { AdminChurn } from './AdminChurn'

type HealthTab = 'activation' | 'onboarding' | 'retention'

const TABS: Array<{
  key: HealthTab
  label: string
  icon: typeof GitBranch
  title: string
}> = [
  { key: 'activation', label: 'Activation', icon: GitBranch, title: 'Activation Funnel | HOCKIA Admin' },
  { key: 'onboarding', label: 'Onboarding', icon: UserPlus, title: 'Onboarding Funnel | HOCKIA Admin' },
  { key: 'retention', label: 'Retention', icon: TrendingDown, title: 'Retention | HOCKIA Admin' },
]

const VALID_TABS = new Set(TABS.map((t) => t.key))

export function AdminProductHealth() {
  const { tab } = useParams<{ tab?: string }>()
  const activeTab = TABS.find((t) => t.key === tab)

  // Hook before early returns (react-hooks/rules-of-hooks).
  useEffect(() => {
    if (activeTab) document.title = activeTab.title
  }, [activeTab])

  if (!tab) {
    return <Navigate to="/admin/product-health/activation" replace />
  }

  // Unknown tab → fall back to Activation rather than 404.
  if (!VALID_TABS.has(tab as HealthTab)) {
    return <Navigate to="/admin/product-health/activation" replace />
  }

  const activeKey = tab as HealthTab

  return (
    <div className="space-y-6">
      {/* Tab nav — same pattern as AdminUsers. No outer h1 because
          each inner page renders its own. */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Product health by aspect">
          {TABS.map((t) => (
            <NavLink
              key={t.key}
              to={`/admin/product-health/${t.key}`}
              className={({ isActive }) =>
                `flex items-center gap-2 px-1 py-3 border-b-2 text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? 'border-purple-600 text-purple-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`
              }
              end
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div>
        {activeKey === 'activation' && <AdminFunnels />}
        {activeKey === 'onboarding' && <AdminOnboardingFunnel />}
        {activeKey === 'retention' && <AdminChurn />}
      </div>
    </div>
  )
}
