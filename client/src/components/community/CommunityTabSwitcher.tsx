import { useNavigate } from 'react-router-dom'
import { Users, MessageCircleQuestion } from 'lucide-react'

export type CommunityTab = 'all' | 'players' | 'coaches' | 'clubs' | 'umpires' | 'questions'

interface CommunityTabSwitcherProps {
  activeTab: CommunityTab
}

const TABS = [
  { id: 'members' as const, label: 'Members', icon: Users, path: '/community', matchTabs: ['all', 'players', 'coaches', 'clubs', 'umpires'] as CommunityTab[] },
  { id: 'questions' as const, label: 'Questions', icon: MessageCircleQuestion, path: '/community/questions', matchTabs: ['questions'] as CommunityTab[] },
]

export function CommunityTabSwitcher({ activeTab }: CommunityTabSwitcherProps) {
  const navigate = useNavigate()

  return (
    <div className="inline-flex items-center gap-1 bg-white rounded-xl p-1 shadow-sm border border-gray-200">
      {TABS.map(tab => {
        const Icon = tab.icon
        const isActive = tab.matchTabs.includes(activeTab)

        return (
          <button
            type="button"
            key={tab.id}
            onClick={() => navigate(tab.path)}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
              isActive
                ? 'bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white shadow-md'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
            aria-pressed={isActive}
          >
            <Icon className="w-4 h-4" />
            <span>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
