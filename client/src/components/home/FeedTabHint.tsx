import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { HomeTab } from '@/hooks/useHomeTab'

/**
 * One-time coachmark under the Feed tab (Home redesign V2): the community
 * feed + composer moved behind the Feed tab, and people who lived in the old
 * Home need one pointer to find them. Shows once, then never again:
 * dismissed by the ✕, by tapping the bubble (which jumps to the Feed tab),
 * or automatically the first time the user reaches the Feed tab themselves.
 */
const STORAGE_KEY = 'hockia.feed-tab-hint-seen'

function readSeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return true // storage unavailable → never show rather than show forever
  }
}

function writeSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // best-effort
  }
}

export function FeedTabHint({ tab, onGoToFeed }: { tab: HomeTab; onGoToFeed: () => void }) {
  const [visible, setVisible] = useState(() => !readSeen())

  // Found the Feed tab on their own — the hint has nothing left to teach.
  useEffect(() => {
    if (tab === 'feed' && visible) {
      writeSeen()
      setVisible(false)
    }
  }, [tab, visible])

  if (!visible || tab !== 'pulse') return null

  const dismiss = () => {
    writeSeen()
    setVisible(false)
  }

  return (
    <div className="pointer-events-none absolute left-1/2 right-4 top-full z-30 mt-2 md:right-6">
      {/* Arrow up at the Feed segment's center (the right half of the bar). */}
      <div className="mr-[calc(25%-6px)] ml-auto h-2 w-3 [clip-path:polygon(50%_0,0_100%,100%_100%)] bg-[#14141c]" />
      <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-[#14141c] px-3 py-2.5 shadow-lg">
        <button type="button" onClick={() => { dismiss(); onGoToFeed() }} className="min-w-0 flex-1 text-left">
          <p className="text-xs font-semibold text-white">Looking for posts?</p>
          <p className="text-[11px] leading-snug text-white/70">
            The community feed and composer now live in the Feed tab.
          </p>
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="flex-shrink-0 rounded-full p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
