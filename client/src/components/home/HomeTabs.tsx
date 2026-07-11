import type { HomeTab } from '@/hooks/useHomeTab'

/** The Pulse / Feed segmented switch (Home redesign V2). State lives in the
 *  useHomeTab hook so this file only exports a component (fast-refresh rule). */
export function HomeTabBar({ tab, onChange }: { tab: HomeTab; onChange: (t: HomeTab) => void }) {
  return (
    <div className="mx-4 flex rounded-2xl bg-gray-100 p-1 md:mx-6">
      {(['pulse', 'feed'] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          aria-pressed={tab === t}
          className={`flex-1 rounded-xl py-2 text-sm font-bold capitalize transition-colors ${
            tab === t ? 'bg-white text-hockia-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}
