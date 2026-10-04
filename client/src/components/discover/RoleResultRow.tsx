import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import type { OpportunityResultItem } from '@/hooks/useDiscover'
import { roleResultMeta, roleResultTitle } from '@/lib/hockiaAi'

interface RoleResultRowProps {
  role: OpportunityResultItem
}

/**
 * List item / Role result (Figma 534:2448): crest 48 (rounded square on
 * white), "Club · Position" 15 semibold, "League · package" 13 ink-2,
 * chevron → the role page. Only the role's own facts: never a fit level,
 * applicant count or reply time.
 */
export default function RoleResultRow({ role }: RoleResultRowProps) {
  const navigate = useNavigate()
  const meta = roleResultMeta(role)
  return (
    <li>
      <button
        type="button"
        onClick={() => navigate(role.navigate_to)}
        className="flex min-h-[64px] w-full items-center gap-3 rounded-[12px] px-2 py-2 text-left transition-colors active:bg-surface-muted-pressed"
        data-testid="ai-role-result"
      >
        <EntityAvatar src={role.logo_url} name={role.organization ?? role.title} role="club" size={48} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-row font-semibold text-ink-1">{roleResultTitle(role)}</span>
          {meta && <span className="block truncate text-secondary text-ink-2">{meta}</span>}
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-ink-4" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </li>
  )
}
