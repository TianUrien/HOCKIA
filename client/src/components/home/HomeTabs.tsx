import type { HomeTab } from '@/hooks/useHomeTab'

/** The Feed / Pulse segmented switch. State lives in the useHomeTab hook so
 *  this file only exports a component (fast-refresh rule).
 *
 *  Feed sits first because it is the default tab — a segmented control whose
 *  selected item starts on the right reads as "you are somewhere secondary". */
export function HomeTabBar({ tab, onChange }: { tab: HomeTab; onChange: (t: HomeTab) => void }) {
  return (
    <div className="mx-4 flex rounded-2xl bg-gray-100 p-1 md:mx-6">
      {(['feed', 'pulse'] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          aria-pressed={tab === t}
          className={`flex-1 rounded-xl py-2 text-sm font-bold capitalize transition-colors ${
            // Inactive is gray-600, not gray-500: this sits on the gray-100
            // track, where gray-500 is 4.39:1 — just under AA. gray-600 is
            // 6.87:1, and the active tab is still obvious (white pill,
            // violet text, shadow).
            tab === t ? 'bg-white text-hockia-primary shadow-sm' : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}
